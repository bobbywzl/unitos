// A note the assistant writes from several blocks keeps one passage per
// block (lib/assistant/plan.ts, add_note sources): the first is the note's
// source, the rest its further sources, in the document's order, and a
// passage the block does not hold is dropped with a warning.
import { enrichActions, parseActionsFence, type PlanContext } from "@/lib/assistant/plan";
import { translatorFor } from "@/lib/i18n/dictionaries";

let failed = 0;
const check = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `\n     got  ${JSON.stringify(got)}\n     want ${JSON.stringify(want)}`}`);
};

const ctx: PlanContext = {
  documentId: "doc",
  edits: "blocks",
  format: null,
  blocks: [
    { id: "b1", type: "HEADING", text: "Method", html: null },
    { id: "b2", type: "PARAGRAPH", text: "A router is a two-layer network of 12 million parameters. It keeps the top 4,096 keys.", html: null },
    { id: "b3", type: "PARAGRAPH", text: "Routing adds one pass of scoring. At 256,000 tokens it is 2.3 percent of the cost of dense attention.", html: null },
  ],
  attachedIds: new Set(["doc"]),
  sectionIds: new Set(),
  t: translatorFor("en"),
};

const plan = (json: unknown) => enrichActions(parseActionsFence(JSON.stringify(json)) ?? { actions: [], unreadable: [] }, ctx);

const two = plan([
  {
    type: "add_note",
    content: "The router keeps 4,096 keys, and at 256,000 tokens its scoring costs 2.3 percent of dense attention.",
    sources: [
      { blockId: "b3", quote: "At 256,000 tokens it is 2.3 percent of the cost of dense attention." },
      { blockId: "b2", quote: "It keeps the top 4,096 keys." },
    ],
    description: "Adds a note on the router's keys and cost.",
  },
]);
const note = two.actions[0];
check("two passages: the first in the document is the source", note?.type === "add_note" ? note.source?.blockId : null, "b2");
check("two passages: the other is a further source", note?.type === "add_note" ? note.moreSources?.map((s) => s.blockId) : null, ["b3"]);
check("two passages: no warning", two.warnings, []);

const one = plan([{ type: "add_note", content: "The router has 12 million parameters.", blockId: "b2", quote: "A router is a two-layer network of 12 million parameters.", description: "Adds a note." }]);
check("one passage: a source and no further sources", one.actions[0]?.type === "add_note" ? [one.actions[0].source?.blockId, one.actions[0].moreSources] : null, ["b2", undefined]);

const lost = plan([
  {
    type: "add_note",
    content: "The router keeps 4,096 keys.",
    sources: [
      { blockId: "b2", quote: "It keeps the top 4,096 keys." },
      { blockId: "b3", quote: "words the block does not hold" },
    ],
    description: "Adds a note.",
  },
]);
check("a passage the block does not hold is dropped", lost.actions[0]?.type === "add_note" ? [lost.actions[0].source?.blockId, lost.actions[0].moreSources] : null, ["b2", undefined]);
check("and warned about", lost.warnings.length, 1);

console.log(failed === 0 ? "note-sources-check: all passed" : `note-sources-check: ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
