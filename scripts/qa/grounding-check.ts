// The grounding check on the assistant's edits (lib/docs/grounding.ts),
// with no model: a number or a quotation in new words must stand in the
// document or the conversation, and resolveOps skips the op that names one
// that does not. Run: npx tsx scripts/qa/grounding-check.ts
import { groundingOf, ungrounded } from "@/lib/docs/grounding";
import { resolveOps } from "@/lib/docs/suggest-ops";

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
};

const doc = [
  "Revenue rose 12.5% to $1,200 million in 2025.",
  "“We will not raise prices this year,” the chief executive said.",
  "This is a bold promise, and I doubt it.",
];
const g = groundingOf([...doc, "Shorten the commentary."]);

check(ungrounded("Revenue grew 12.5% to $1200 million.", g) === null, "a number the document states stands, commas or not");
check(ungrounded("Revenue grew 14% in 2025.", g) === "14", "a number the document does not state is named");
check(ungrounded('"We will not raise prices this year," said the CEO.', g) === null, "a quotation copied as it stands, straight quotes for curly");
check(ungrounded('"We will never raise prices," said the CEO.', g) !== null, "a reworded quotation is named");
check(ungrounded("1. Revenue rose.\n2. Prices hold.", g) === null, "a numbered line's marker is no number");
check(ungrounded("I doubt the promise.", g) === null, "words with no number and no quotation stand");

const rows = doc.map((text, k) => ({ id: `b${k}`, type: "PARAGRAPH", text }));
const places = new Map(rows.map((r) => [r.id, { style: "normal" as const, where: "body" as const, container: "", group: null }]));
const { ops, skipped } = resolveOps(
  [
    { op: "rewrite_block", blockId: "b2", text: "A bold promise.", why: "Shorter." },
    { op: "rewrite_block", blockId: "b0", text: "Revenue rose 30% in 2025.", why: "Shorter." },
  ],
  { rows, places, scope: { kind: "blocks", blockIds: rows.map((r) => r.id) }, budget: { chars: 10_000 }, grounding: g },
);
check(ops.length === 1 && ops[0].op === "rewrite_block" && ops[0].blockId === "b2", "resolveOps keeps the grounded op");
check(skipped.length === 1 && skipped[0].reason === "unsupported" && skipped[0].why.startsWith("30"), "resolveOps skips the op with a made-up number, naming it");

console.log(failures === 0 ? "grounding-check: all passed" : `grounding-check: ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
