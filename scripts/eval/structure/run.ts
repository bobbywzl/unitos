// The Breakwork loop's runner (SPEC.md §32). The model and the judge are
// outside this script: an agent reads each prompt file and writes the
// answer, so any Claude session can stand in for STRUCTURE_MODEL. This
// script builds each turn's messages exactly as the route does
// (structureMessages), reads the answers with the route's own schema and
// resolveProposal, checks them, writes a judge packet per case, and scores.
//
//   npx tsx scripts/eval/structure/run.ts prepare --round r0 [--cases a,b]
//   npx tsx scripts/eval/structure/run.ts batches --round r0 --file prompt.md --size 2
//   … a model agent answers prompt.md with answer.json in each case directory …
//   npx tsx scripts/eval/structure/run.ts check --round r0
//   … a judge agent reads judge.md and writes scores.json …
//   npx tsx scripts/eval/structure/run.ts score --round r0 [--baseline r0]
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { extractJson } from "@/lib/derive/json";
import {
  readableBlocks,
  resolveProposal,
  structureAnswerSchema,
  structureMessages,
  type StructureDocBlock,
} from "@/lib/structure-assist";
import { childBuckets, emptyStructure, parseRanges, pieceHash, piecePreview, type Structure } from "@/lib/structure";
import { STRUCTURE_CASES, type StructureCase } from "./cases";
import { runFollow } from "./follow";

const ROOT = join(process.cwd(), ".eval", "structure");
const FIXTURES = join(process.cwd(), "scripts", "eval", "structure", "fixtures");
const args = process.argv.slice(2);
const command = args[0];
const flag = (name: string): string | null => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? null : (args[at + 1] ?? "");
};
const round = flag("round") ?? "r0";
const wanted = flag("cases")?.split(",").filter(Boolean) ?? null;
const cases = () => STRUCTURE_CASES.filter((c) => !wanted || wanted.includes(c.id));
const dirOf = (r: string, id: string) => join(ROOT, r, id);
const readText = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : null);
const writeJson = (p: string, v: unknown) => writeFileSync(p, JSON.stringify(v, null, 2));

// A fixture's blocks: one per non-empty line. "#" lines are headings, "- "
// lines list lines, the rest paragraphs (the parser's shapes, enough for
// sorting).
function fixtureBlocks(name: string): { title: string; blocks: StructureDocBlock[] } {
  const path = join(FIXTURES, `${name}.md`);
  const text = readText(path);
  if (!text) throw new Error(`fixture ${name} is missing (${path})`);
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const blocks = lines.map((line, i) => {
    if (/^#{1,6}\s/.test(line)) return { id: `${name}-${i + 1}`, type: "HEADING", text: line.replace(/^#{1,6}\s+/, "") };
    if (/^[-*]\s/.test(line)) return { id: `${name}-${i + 1}`, type: "LIST", text: line.replace(/^[-*]\s+/, "") };
    return { id: `${name}-${i + 1}`, type: "PARAGRAPH", text: line };
  });
  const title = blocks.find((b) => b.type === "HEADING")?.text ?? blocks[0]?.text ?? name;
  return { title, blocks };
}

/** The canvas of a case as a stored structure, by the fixture's block ids. */
function canvasOf(c: StructureCase, blocks: StructureDocBlock[]): Structure {
  if (!c.canvas) return emptyStructure();
  const readable = readableBlocks(blocks);
  const s = emptyStructure();
  c.canvas.forEach((b, i) => {
    s.buckets.push({ id: b.id, title: b.title, description: b.description ?? "", parentId: b.parent ?? null, x: i * 460, y: 0, color: null, order: i });
    parseRanges(b.blocks, readable.length).forEach((n, order) => {
      const block = readable[n - 1];
      s.pieces.push({ blockId: block.id, hash: pieceHash(block.text), preview: piecePreview(block.text), bucketId: b.id, order, label: "" });
    });
  });
  return s;
}

function messageText(content: unknown): string {
  return typeof content === "string" ? content : JSON.stringify(content);
}

// ── prepare: the messages, as the route sends them ────────────────────────
function prepare(): void {
  for (const c of cases()) {
    const { title, blocks } = fixtureBlocks(c.fixture);
    const { messages } = structureMessages({
      title,
      blocks,
      structure: canvasOf(c, blocks),
      profile: null,
      lang: c.lang,
      history: c.history,
      message: c.message,
    });
    const dir = dirOf(round, c.id);
    mkdirSync(dir, { recursive: true });
    const parts = messages.map((m) => `=====[${m.role.toUpperCase()}]=====\n${messageText(m.content)}`);
    writeFileSync(join(dir, "prompt.md"), parts.join("\n\n"));
    writeJson(join(dir, "case.json"), c);
  }
  console.log(`prepared ${cases().length} cases in ${join(ROOT, round)}`);
}

function batches(): void {
  const size = Number(flag("size") ?? "2");
  const file = flag("file") ?? "prompt.md";
  const dirs = cases().map((c) => dirOf(round, c.id)).filter((d) => existsSync(join(d, file)));
  for (let i = 0; i < dirs.length; i += size) console.log(dirs.slice(i, i + size).join(" "));
}

// ── check: the answer as the route reads it, then the checks ─────────────
type Check = { name: string; ok: boolean; detail: string };

function check(): void {
  const rows: string[] = [];
  for (const c of cases()) {
    const dir = dirOf(round, c.id);
    if (!existsSync(dir)) continue;
    const raw = readText(join(dir, "answer.json"));
    const checks: Check[] = [];
    const add = (name: string, ok: boolean, detail = "") => checks.push({ name, ok, detail });
    if (!raw) {
      add("answered", false, "no answer.json");
      writeJson(join(dir, "result.json"), { checks });
      continue;
    }
    const tokens = Math.round(raw.length / 4);
    const json = extractJson(raw);
    const parsed = structureAnswerSchema.safeParse(json);
    add("schema", parsed.success, parsed.success ? "" : parsed.error.message.slice(0, 200));
    if (!parsed.success) {
      writeJson(join(dir, "result.json"), { checks, tokens });
      continue;
    }
    const answer = parsed.data;
    const { title, blocks } = fixtureBlocks(c.fixture);
    const readable = readableBlocks(blocks);
    const byNumber = new Map(readable.map((b, i) => [i + 1, b]));
    const current = canvasOf(c, blocks);
    add("kind", (answer.structure === null) === (c.expect.kind === "talk"), `answered ${answer.structure ? "a structure" : "talk"}, expected ${c.expect.kind}`);
    add("reply", answer.reply.trim().length > 0 && answer.reply.length <= 900, `${answer.reply.length} characters`);
    if (c.lang === "zh") add("language", /[一-鿿]/.test(answer.reply), "the reply is in Chinese");
    add("tokens", tokens <= 3000, `${tokens} tokens`);
    let packet = "";
    if (!answer.structure) for (const f of c.follow ?? []) add(`follow:${f.why}`, false, "no structure");
    if (answer.structure) {
      const { structure, summary } = resolveProposal(answer, current, byNumber);
      const numberOf = new Map(readable.map((b, i) => [b.id, i + 1]));
      const content = readable.filter((b, i) => !(i === 0 && b.type === "HEADING"));
      const placed = structure.pieces.length;
      const coverage = placed / Math.max(1, content.length);
      if (c.expect.whole) add("coverage", coverage >= 0.85, `${placed} of ${content.length} blocks placed (${Math.round(coverage * 100)}%)`);
      const tops = childBuckets(structure, null);
      add("tops", tops.length >= 2 && tops.length <= 12, `${tops.length} top buckets`);
      const count = (id: string): number =>
        structure.pieces.filter((p) => p.bucketId === id).length + childBuckets(structure, id).reduce((s, b) => s + count(b.id), 0);
      const tiny = structure.buckets.filter((b) => count(b.id) < 2);
      add("tiny", c.expect.tinyOk === true || tiny.length <= 1, `${tiny.length} buckets under 2 blocks${tiny.length ? `: ${tiny.map((b) => b.title).join("; ")}` : ""}`);
      if (c.expect.themes) {
        const big = structure.buckets.filter((b) => structure.pieces.filter((p) => p.bucketId === b.id).length > readable.length / 3);
        add("lumping", big.length === 0, big.length ? `over a third: ${big.map((b) => b.title).join("; ")}` : "");
      }
      if (c.expect.nested) add("nested", structure.buckets.some((b) => b.parentId), "a bucket inside a bucket");
      const longTitles = structure.buckets.filter((b) => b.title.split(/\s+/).length > 7 || b.title.length > 60);
      add("titles", longTitles.length === 0 && structure.buckets.every((b) => b.title.trim()), longTitles.map((b) => b.title).join("; "));
      add("connections", structure.connections.length <= 12, `${structure.connections.length} connections`);
      if (c.expect.labels) {
        const labeled = structure.pieces.filter((p) => p.label).length;
        add("labels", labeled >= Math.max(3, summary.piecesMoved * 0.5), `${labeled} labeled`);
      } else {
        add("no-labels", Object.keys(answer.structure.labels).length === 0, `${Object.keys(answer.structure.labels).length} labels written`);
      }
      for (const keep of c.expect.keep ?? []) add(`keep:${keep}`, structure.buckets.some((b) => b.id === keep), "");
      // What the request asked for, as hard facts (follow.ts).
      const canvasMap = new Map(
        (c.canvas ?? []).map((b) => [b.id, { title: b.title, parent: b.parent ?? null, blocks: parseRanges(b.blocks, readable.length) }]),
      );
      for (const f of runFollow(c.follow ?? [], { structure, canvas: canvasMap, numberOf, blockCount: readable.length })) {
        add(`follow:${f.why}`, f.ok, f.detail);
      }
      // The judge's packet: the structure as the reader would see it.
      const lineOf = (blockId: string) => {
        const n = numberOf.get(blockId)!;
        const b = byNumber.get(n)!;
        const flat = b.text.replace(/\s+/g, " ");
        return `[${n}] ${flat.length > 150 ? `${flat.slice(0, 150)}…` : flat}`;
      };
      const draw = (parentId: string | null, depth: number): string[] =>
        childBuckets(structure, parentId).flatMap((b) => [
          `${"  ".repeat(depth)}## ${b.title} — ${b.description}`,
          ...structure.pieces
            .filter((p) => p.bucketId === b.id)
            .sort((x, y) => x.order - y.order)
            .map((p) => `${"  ".repeat(depth + 1)}- ${p.label ? `«${p.label}» ` : ""}${lineOf(p.blockId)}`),
          ...draw(b.id, depth + 1),
        ]);
      const unsorted = readable.filter((b) => !structure.pieces.some((p) => p.blockId === b.id));
      const endText = (e: { kind: string; id: string }) =>
        e.kind === "bucket" ? `bucket "${structure.buckets.find((b) => b.id === e.id)?.title}"` : `block ${numberOf.get(e.id)}`;
      packet = [
        "## The structure",
        ...draw(null, 0),
        "",
        `## Unsorted (${unsorted.length})`,
        ...unsorted.map((b) => `- ${lineOf(b.id)}`),
        "",
        "## Connections",
        ...(structure.connections.length
          ? structure.connections.map((x) => `- ${endText(x.from)} → ${endText(x.to)}: «${x.label}» ${x.comment}`)
          : ["none"]),
      ].join("\n");
    }
    const failed = checks.filter((x) => !x.ok);
    const follows = checks.filter((x) => x.name.startsWith("follow:"));
    writeJson(join(dir, "result.json"), {
      checks,
      tokens,
      failed: failed.map((x) => x.name),
      follow: { passed: follows.filter((x) => x.ok).length, total: follows.length },
    });
    // The structure as text, for the side-by-side judge (pair).
    writeFileSync(join(dir, "packet.md"), [`## The assistant's reply\n${answer.reply}`, "", packet || "## The structure\n(none: the assistant answered in words only)"].join("\n"));
    const doc = readable.map((b, i) => `[${i + 1}] (${b.type}) ${b.text.replace(/\s+/g, " ")}`).join("\n");
    writeFileSync(
      join(dir, "judge.md"),
      [
        "# Judge one turn of the Breakwork assistant",
        "",
        "A reader of a reading app sorts a document into buckets on a canvas: boxes with a title, a description, and the document's blocks inside; a bucket can hold buckets; connections join buckets or blocks. The Breakwork assistant proposes the structure from the reader's request. You judge one turn.",
        "",
        `## The document: ${title}`,
        doc,
        "",
        "## The conversation before this turn",
        ...(c.history.length ? c.history.map((h) => `${h.role}: ${h.content}`) : ["(none)"]),
        ...(c.canvas ? ["", "## The canvas before this turn", ...c.canvas.map((b) => `- ${b.id} "${b.title}"${b.parent ? ` (inside ${b.parent})` : ""}: blocks ${b.blocks}`)] : []),
        "",
        `## The reader's request\n${c.message}`,
        "",
        `## What a good answer does\n${c.good}`,
        "",
        `## The assistant's reply\n${answer.reply}`,
        "",
        packet || "## The structure\n(none: the assistant answered in words only)",
        "",
        "## The mechanical checks",
        ...checks.map((x) => `- ${x.ok ? "pass" : "FAIL"} ${x.name}${x.detail ? `: ${x.detail}` : ""}`),
        "",
        "## Score",
        "Read the document and the structure whole. Then write `scores.json` beside this file: {\"request\": 1-5, \"coherence\": 1-5, \"coverage\": 1-5, \"naming\": 1-5, \"connections\": 1-5, \"reply\": 1-5, \"overall\": 1-5, \"worst\": \"the one biggest fault, concrete, naming blocks or buckets\", \"fix\": \"one rule for the prompt that would fix that fault class\"}.",
        "- request: does the structure follow the reader's sorting rule exactly (the dimensions, the nesting, what to keep)? A talking turn: does the reply answer the question usefully?",
        "- coherence: does every block sit in the bucket it belongs in? Check at least 15 placements against the document. Three misplaced blocks cap it at 3.",
        "- coverage: is every block with content placed, and is what is left unsorted really nothing to sort?",
        "- naming: are titles short names of what each bucket holds, and descriptions one clear sentence?",
        "- connections: do they join things that really bear on each other, with labels that say how? None when none were asked and none are useful is a 4.",
        "- reply: does it say what was done in one to three plain sentences (or answer the question)?",
        "- overall: would this reader be glad to press Apply? Be strict: 5 is rare.",
      ].join("\n"),
    );
    rows.push(`${c.id}: ${failed.length ? `FAIL ${failed.map((x) => x.name).join(", ")}` : "checks pass"} (${tokens} tokens)`);
  }
  console.log(rows.join("\n"));
}

// ── pair: the candidate beside the base, blind ───────────────────────────
// For each case, the base answer is the first of the --base rounds that has
// one. The two packets are shown as X and Y in an order fixed by the case id,
// so no letter names the candidate; pair-key.json keeps which is which.
function pair(): void {
  const bases = (flag("base") ?? "").split(",").filter(Boolean);
  let n = 0;
  for (const c of cases()) {
    const dir = dirOf(round, c.id);
    const cand = readText(join(dir, "packet.md"));
    const baseDir = bases.map((b) => dirOf(b, c.id)).find((d) => existsSync(join(d, "packet.md")));
    const base = baseDir ? readText(join(baseDir, "packet.md")) : null;
    if (!cand || !base) continue;
    const flip = [...`${round}${c.id}`].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7) % 2 === 1;
    const [x, y] = flip ? [base, cand] : [cand, base];
    writeJson(join(dir, "pair-key.json"), { X: flip ? "base" : "candidate", Y: flip ? "candidate" : "base", base: baseDir });
    const judge = readText(join(dir, "judge.md")) ?? "";
    const head = judge.slice(0, judge.indexOf("## The assistant's reply"));
    writeFileSync(
      join(dir, "pair.md"),
      [
        head.replace("# Judge one turn of the Breakwork assistant", "# Compare two answers to one turn of the Breakwork assistant"),
        "# Answer X",
        x.replace(/^## /gm, "### "),
        "",
        "# Answer Y",
        y.replace(/^## /gm, "### "),
        "",
        "## Choose",
        "Read the document, then both answers whole. Check at least 10 placements in each against the document. Then write `pair.json` beside this file: {\"winner\": \"X\" | \"Y\" | \"tie\", \"margin\": 1-3 (1 slight, 3 clear), \"why\": \"the decisive differences, concrete, naming blocks or buckets\"}. Prefer the answer this reader would rather press Apply on. Length is no merit; a tie is fine when neither is better.",
      ].join("\n"),
    );
    n++;
  }
  console.log(`wrote ${n} pair packets`);
}

// ── score: the table ─────────────────────────────────────────────────────
type Scores = Record<"request" | "coherence" | "coverage" | "naming" | "connections" | "reply" | "overall", number> & { worst: string; fix: string };
const KEYS = ["request", "coherence", "coverage", "naming", "connections", "reply", "overall"] as const;

function scoresOf(r: string): Map<string, { scores: Scores | null; failed: string[]; tokens: number }> {
  const out = new Map<string, { scores: Scores | null; failed: string[]; tokens: number }>();
  const base = join(ROOT, r);
  if (!existsSync(base)) return out;
  for (const id of readdirSync(base)) {
    const s = readText(join(base, id, "scores.json"));
    const res = readText(join(base, id, "result.json"));
    const result = res ? (JSON.parse(res) as { failed?: string[]; tokens?: number; checks?: Check[] }) : null;
    out.set(id, {
      scores: s ? (JSON.parse(s) as Scores) : null,
      failed: result?.failed ?? result?.checks?.filter((x) => !x.ok).map((x) => x.name) ?? ["unread"],
      tokens: result?.tokens ?? 0,
    });
  }
  return out;
}

function score(): void {
  const now = scoresOf(round);
  const baseline = flag("baseline");
  const before = baseline ? scoresOf(baseline) : null;
  const lines = [
    `# Breakwork loop ${round}${baseline ? ` against ${baseline}` : ""}`,
    "",
    `| case | ${KEYS.join(" | ")} | checks failed | tokens |`,
    `|---|${KEYS.map(() => "---").join("|")}|---|---|`,
  ];
  const means: Record<string, number[]> = Object.fromEntries(KEYS.map((k) => [k, []]));
  for (const c of cases()) {
    const r = now.get(c.id);
    if (!r) continue;
    const b = before?.get(c.id);
    const cell = (k: (typeof KEYS)[number]) => {
      const v = r.scores?.[k];
      if (typeof v === "number") means[k].push(v);
      const was = b?.scores?.[k];
      return v === undefined ? "–" : typeof was === "number" && was !== v ? `${v} (${was})` : String(v);
    };
    lines.push(`| ${c.id} | ${KEYS.map(cell).join(" | ")} | ${r.failed.join(", ") || "none"} | ${r.tokens} |`);
  }
  // The side-by-side verdicts: candidate wins, base wins, ties.
  let wins = 0, losses = 0, ties = 0;
  const verdicts: string[] = [];
  for (const c of cases()) {
    const dir = dirOf(round, c.id);
    const p = readText(join(dir, "pair.json"));
    const k = readText(join(dir, "pair-key.json"));
    if (!p || !k) continue;
    const verdict = JSON.parse(p) as { winner: string; margin?: number; why?: string };
    const key = JSON.parse(k) as Record<string, string>;
    const who = verdict.winner === "tie" ? "tie" : key[verdict.winner];
    if (who === "candidate") wins++;
    else if (who === "base") losses++;
    else ties++;
    verdicts.push(`- **${c.id}**: ${who}${verdict.margin ? ` (${verdict.margin})` : ""} — ${verdict.why ?? ""}`);
  }
  lines.push(`| **mean** | ${KEYS.map((k) => (means[k].length ? (means[k].reduce((a, b) => a + b, 0) / means[k].length).toFixed(2) : "–")).join(" | ")} | | |`);
  if (verdicts.length) lines.push("", `## Side by side: candidate ${wins} wins, ${losses} losses, ${ties} ties`, ...verdicts);
  lines.push("", "## Worst faults");
  for (const c of cases()) {
    const r = now.get(c.id);
    if (r?.scores) lines.push(`- **${c.id}** (${r.scores.overall}): ${r.scores.worst} — fix: ${r.scores.fix}`);
  }
  const report = lines.join("\n");
  writeFileSync(join(ROOT, round, "report.md"), report);
  console.log(report);
}

// ── follow: how often each round did what was asked ─────────────────────
//   run.ts follow --rounds m-haiku,m-sonnet [--cases a,b]
function followTable(): void {
  const rounds = (flag("rounds") ?? round).split(",").filter(Boolean);
  const head = `| case | ${rounds.join(" | ")} |`;
  const lines = [head, `|---|${rounds.map(() => "---").join("|")}|`];
  const totals = rounds.map(() => ({ passed: 0, total: 0, cases: 0, clean: 0, tokens: 0 }));
  for (const c of cases()) {
    const cells = rounds.map((r, i) => {
      const res = readText(join(dirOf(r, c.id), "result.json"));
      if (!res) return "–";
      const { follow, failed, tokens } = JSON.parse(res) as { follow?: { passed: number; total: number }; failed?: string[]; tokens?: number };
      const t = totals[i];
      t.cases++;
      t.tokens += tokens ?? 0;
      const f = follow ?? { passed: 0, total: 0 };
      t.passed += f.passed;
      t.total += f.total;
      const missed = (failed ?? []).filter((x) => x.startsWith("follow:") || x === "kind" || x === "schema");
      if (missed.length === 0) t.clean++;
      return missed.length ? `${f.passed}/${f.total} ✗ ${missed.map((x) => x.replace("follow:", "")).join("; ").slice(0, 80)}` : `${f.passed}/${f.total}`;
    });
    if (cells.every((x) => x === "–")) continue;
    lines.push(`| ${c.id} | ${cells.join(" | ")} |`);
  }
  lines.push(`| **checks passed** | ${totals.map((t) => `${t.passed}/${t.total} (${t.total ? Math.round((100 * t.passed) / t.total) : 0}%)`).join(" | ")} |`);
  lines.push(`| **cases fully followed** | ${totals.map((t) => `${t.clean}/${t.cases}`).join(" | ")} |`);
  lines.push(`| **mean answer tokens** | ${totals.map((t) => (t.cases ? Math.round(t.tokens / t.cases) : 0)).join(" | ")} |`);
  console.log(lines.join("\n"));
}

if (command === "follow") followTable();
else if (command === "prepare") prepare();
else if (command === "batches") batches();
else if (command === "check") check();
else if (command === "score") score();
else if (command === "pair") pair();
else console.log("commands: prepare, batches, check, pair, score");
