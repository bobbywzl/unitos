// Parse compare (SPEC.md §2): the same pages parsed under two models, and
// what differs. Each URL is fetched once and walked once (the mechanical
// parse); the model passes — core, then layout on the page's html — run
// under model A and under model B on the same walked blocks, and the report
// says, per page and per model, how many blocks survived, which blocks one
// model kept and the other dropped, where the heading levels and layout
// roles disagree, whether every figure with media survived, and how long
// the passes took. No database is needed and nothing is stored. Usage:
//   npx tsx scripts/parse-compare.ts <url> [<url> …] [--a claude-opus-5:high] [--b kimi-k3:high]
// Keys: ANTHROPIC_API_KEY for a claude- id, MOONSHOT_API_KEY for any other.
// The report prints and lands under .eval/parse-compare/<stamp>.md.
import "./eval/env";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CLAUDE_OPUS_5, KIMI_K3 } from "@/lib/derive/config";
import { hasMedia } from "@/lib/parse/figure-audit";
import { fetchPage } from "@/lib/parse/fetch-page";
import { refineUrlBlocks } from "@/lib/parse/ingest";
import type { ParseModel } from "@/lib/parse/model";
import { parseHtmlContent } from "@/lib/parse/url";
import type { ParsedBlock } from "@/lib/parse/types";

function choiceOf(spec: string): ParseModel {
  const [id, effort = "high"] = spec.split(":");
  return { id, effort: effort as ParseModel["effort"] };
}

function args(argv: string[]): { urls: string[]; a: ParseModel; b: ParseModel } {
  const urls: string[] = [];
  let a = `${CLAUDE_OPUS_5}:high`;
  let b = `${KIMI_K3}:high`;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--a") a = argv[++i];
    else if (argv[i] === "--b") b = argv[++i];
    else urls.push(argv[i]);
  }
  return { urls, a: choiceOf(a), b: choiceOf(b) };
}

const clip = (s: string, n = 90) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

// A block's layout as the reader will draw it: its type, a heading's level,
// and the class tokens the layout pass wrote (kicker, meta, caption, …).
function shape(b: ParsedBlock): string {
  const level = b.type === "HEADING" ? /^<h([1-6])/i.exec(b.html ?? "")?.[1] ?? "?" : "";
  const tokens = /^<[a-z][a-z0-9]*\b[^>]*\bclass="([^"]*)"/i.exec(b.html ?? "")?.[1]?.trim() ?? "";
  return `${b.type}${level ? ` h${level}` : ""}${tokens ? ` [${tokens}]` : ""}`;
}

type Run = { choice: ParseModel; blocks: ParsedBlock[]; ms: number; font?: string };

// Whether a walked block survived into the run: a figure by its html (a
// figure row wraps it whole), text as a block of its own or inside a join
// or a merge.
function kept(run: Run, walked: ParsedBlock): boolean {
  if (walked.type === "FIGURE") {
    const html = walked.html ?? "";
    return html === "" || run.blocks.some((b) => b.type === "FIGURE" && (b.html ?? "").includes(html));
  }
  const text = walked.text.trim();
  if (!text) return true;
  return run.blocks.some((b) => b.text.includes(text));
}

function summary(run: Run, walked: ParsedBlock[]): string[] {
  const types: Record<string, number> = {};
  for (const b of run.blocks) types[b.type] = (types[b.type] ?? 0) + 1;
  const figures = walked.filter(hasMedia);
  const figuresKept = figures.filter((f) => kept(run, f)).length;
  const dropped = walked.filter((b) => !kept(run, b)).length;
  return [
    `- **${run.choice.id}** (${run.choice.effort}): ${run.blocks.length} blocks in ${(run.ms / 1000).toFixed(1)} s; ${dropped} of ${walked.length} walked blocks dropped; figures with media kept ${figuresKept} of ${figures.length}${run.font ? `; font ${run.font}` : ""}`,
    `  - by type: ${Object.entries(types).map(([t, n]) => `${t} ${n}`).join(", ")}`,
  ];
}

async function comparePage(url: string, a: ParseModel, b: ParseModel): Promise<string[]> {
  const out: string[] = [`## ${url}`, ""];
  const fetched = await fetchPage(url);
  if (fetched.kind === "pdf") return [...out, "A PDF link: the compare reads web pages only.", ""];
  const parsed = await parseHtmlContent(fetched.html, url);
  out.push(`Walked: ${parsed.blocks.length} blocks, ${parsed.blocks.filter(hasMedia).length} figures with media. Title: ${parsed.title ?? "(none)"}`, "");
  const runs: Run[] = [];
  for (const choice of [a, b]) {
    const started = Date.now();
    const refined = await refineUrlBlocks(parsed, undefined, { pageHtml: fetched.html, url, choice });
    runs.push({ choice, blocks: refined.blocks, ms: Date.now() - started, font: refined.font });
  }
  const [ra, rb] = runs;
  out.push(...summary(ra, parsed.blocks), ...summary(rb, parsed.blocks), "");

  // Blocks one model kept and the other dropped.
  const onlyA = parsed.blocks.filter((w) => kept(ra, w) && !kept(rb, w));
  const onlyB = parsed.blocks.filter((w) => !kept(ra, w) && kept(rb, w));
  const list = (blocks: ParsedBlock[]) => blocks.map((w) => `  - ${w.type}: ${clip(w.text) || clip(w.html ?? "")}`);
  if (onlyA.length > 0) out.push(`Kept by ${ra.choice.id}, dropped by ${rb.choice.id} (${onlyA.length}):`, ...list(onlyA), "");
  if (onlyB.length > 0) out.push(`Kept by ${rb.choice.id}, dropped by ${ra.choice.id} (${onlyB.length}):`, ...list(onlyB), "");

  // Where the two runs draw the same text differently.
  const shapesB = new Map(rb.blocks.map((blk) => [blk.text.trim(), shape(blk)]));
  const differs: string[] = [];
  for (const blk of ra.blocks) {
    const other = shapesB.get(blk.text.trim());
    if (other !== undefined && other !== shape(blk)) differs.push(`  - ${clip(blk.text, 70)}: ${shape(blk)} | ${other}`);
  }
  if (differs.length > 0) out.push(`Same text, different shape (${ra.choice.id} | ${rb.choice.id}; ${differs.length}):`, ...differs, "");
  if (onlyA.length === 0 && onlyB.length === 0 && differs.length === 0) out.push("No difference between the two runs.", "");
  return out;
}

async function main() {
  const { urls, a, b } = args(process.argv.slice(2));
  if (urls.length === 0) {
    console.error("Usage: npx tsx scripts/parse-compare.ts <url> [<url> …] [--a <model>[:effort]] [--b <model>[:effort]]");
    process.exit(1);
  }
  const report: string[] = [`# Parse compare: ${a.id}:${a.effort} vs ${b.id}:${b.effort}`, "", `${new Date().toISOString()}`, ""];
  for (const url of urls) {
    try {
      report.push(...(await comparePage(url, a, b)));
    } catch (err) {
      report.push(`## ${url}`, "", `Failed: ${err instanceof Error ? err.message : String(err)}`, "");
    }
  }
  const text = report.join("\n");
  console.log(text);
  const dir = join(process.cwd(), ".eval", "parse-compare");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}.md`);
  writeFileSync(file, text);
  console.log(`\nReport: ${file}`);
}

void main();
