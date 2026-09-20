// Ratings into eval cases (SPEC.md §25): reads the thumbs down of the last
// N days from ToolRating, writes each as a fixture (the document the tool
// ran on, rendered from its blocks) and a case in
// scripts/eval/cases/from-ratings.json, with the reader's comment as what a
// good answer must fix. The runner reads that file beside cases.ts. Needs
// DATABASE_URL. Usage: npx tsx scripts/eval/import-ratings.ts [--days 30] [--limit 40]
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { db } from "@/lib/db";
import type { EvalCase, EvalTool } from "./cases";
import { FIXTURES_DIR } from "./lib";

const args = process.argv.slice(2);
const flag = (name: string, fallback: number) => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? fallback : Number(args[at + 1]);
};
const days = flag("days", 30);
const limit = flag("limit", 40);

// The rating's tool, as the eval names it. act and assistant read the
// question from the input; distill and act read the selection from it.
const TOOL_OF: Record<string, EvalTool | null> = {
  simplify: "simplify",
  assistant: "assistant",
  act: "act",
  distill: "distill",
  summarize: "summarize",
  ask: "ask",
  find: "find",
  analyze: null, // needs the figure image: not an eval case yet
  visualize: null,
  explain: null,
  formalize: null,
  stitch: null,
};

async function main() {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await db.toolRating.findMany({
    // Thumbs down, and the flags the check raised (lib/derive/check.ts).
    where: { rating: { in: ["down", "flag"] }, createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  const cases: EvalCase[] = [];
  mkdirSync(FIXTURES_DIR, { recursive: true });
  for (const row of rows) {
    const tool = TOOL_OF[row.tool] ?? null;
    if (!tool || !row.documentId) continue;
    const document = await db.document.findUnique({
      where: { id: row.documentId },
      select: { title: true, blocks: { orderBy: { order: "asc" }, select: { type: true, text: true, startTime: true, endTime: true } } },
    });
    if (!document) continue;
    const name = `rated-${row.id}`;
    // The document as a fixture: title, then one chunk per block in the
    // fixture format (lib.ts parseFixture).
    const chunks = document.blocks.map((b) => {
      if (b.type === "HEADING") return `## ${b.text}`;
      if (b.type === "TRANSCRIPT" && b.startTime !== null && b.endTime !== null) {
        const stamp = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
        return `[${stamp(b.startTime)}–${stamp(b.endTime)}] ${b.text.replace(/\n+/g, " ")}`;
      }
      if (b.type === "CODE") return "```\n" + b.text + "\n```";
      return b.text.replace(/\n{2,}/g, "\n");
    });
    writeFileSync(join(FIXTURES_DIR, `${name}.md`), [`# ${document.title}`, "", ...chunks].join("\n\n"));
    // The selection: the first line of the input that the document holds.
    const [firstLine, ...rest] = row.input.split("\n\n");
    const blockIndex = document.blocks.findIndex((b) => firstLine && b.text.includes(firstLine.slice(0, 80)));
    const selection = blockIndex >= 0 ? { block: blockIndex + 1, text: firstLine.slice(0, 200) } : undefined;
    const question = tool === "simplify" || tool === "summarize" ? undefined : rest.join("\n\n") || (selection ? undefined : firstLine);
    cases.push({
      id: name,
      tool,
      fixture: name,
      lang: row.lang === "zh" ? "zh" : "en",
      profile: null,
      selection: tool === "simplify" || tool === "act" ? selection : undefined,
      question: question || undefined,
      expect: row.comment ? `The reader rated the earlier answer poor and said: "${row.comment}". A good answer fixes that.` : "The reader rated the earlier answer poor without saying why.",
    });
  }
  const out = join(process.cwd(), "scripts", "eval", "cases", "from-ratings.json");
  writeFileSync(out, JSON.stringify(cases, null, 2));
  console.log(`${cases.length} cases from ${rows.length} ratings → ${out}`);
  await db.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
