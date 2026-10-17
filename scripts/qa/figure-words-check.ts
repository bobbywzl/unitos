// Words from a figure (SPEC.md §7), with no model: the insert_paragraph
// actions right after the selected figure come apart from the rest; on a
// document without rich text they pass the plan with numbers the document's
// text does not state (they come from the figure's picture), while the same
// words after any other block are still held to the text; on a document
// with rich text they become one insert_blocks op after the figure.
// Run: npx tsx scripts/qa/figure-words-check.ts
import { enrichActions, figureWordsMarkdown, splitFigureWords, type ReadActions } from "@/lib/assistant/plan";
import { resolveOps, type BlockPlace } from "@/lib/docs/suggest-ops";
import type { TFunc } from "@/lib/i18n/dictionaries";

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
};

const t = ((key: string) => key) as unknown as TFunc;
const blocks = [
  { id: "p0", type: "PARAGRAPH", text: "Duality of patterning.", html: null },
  { id: "f1", type: "FIGURE", text: "", html: '<figure><img src="/api/images/abc"></figure>' },
  { id: "p2", type: "PARAGRAPH", text: "Ch 5: Learning words.", html: null },
];
const read: ReadActions = {
  actions: [
    { type: "insert_paragraph", afterBlockId: "f1", text: "A study led by Jane Gillette (1999) tested college undergraduates.", description: "Put the text under the image." },
    { type: "insert_paragraph", afterBlockId: "f1", text: "Students guessed nouns better than verbs\nThe sound was removed", kind: "list", description: "Put the key points under the image." },
    { type: "insert_paragraph", afterBlockId: "p2", text: "Gillette (1999) is the study.", description: "Add a line." },
    { type: "add_section", title: "Images", description: "A section." },
  ],
  unreadable: [],
};

const split = splitFigureWords(read, "f1");
check(split.words.length === 2 && split.rest.actions.length === 2, "the figure's words come apart from the other actions");
check(splitFigureWords(read, null).words.length === 0, "no figure selected: nothing comes apart");

const ctx = {
  documentId: "d",
  edits: "blocks" as const,
  format: null,
  blocks,
  attachedIds: new Set(["d"]),
  sectionIds: new Set<string>(),
  sources: ["Put the text under the image."],
  t,
};
const withFigure = enrichActions(read, { ...ctx, figureBlockId: "f1" });
const under = withFigure.actions.filter((a) => a.type === "insert_paragraph" && a.afterBlockId === "f1");
check(under.length === 2, "words under the selected figure pass with the figure's numbers");
check(
  !withFigure.actions.some((a) => a.type === "insert_paragraph" && a.afterBlockId === "p2"),
  "the same number after another block is still held to the text",
);
const noFigure = enrichActions(read, ctx);
check(
  !noFigure.actions.some((a) => a.type === "insert_paragraph" && a.text.includes("1999")),
  "with no figure selected, the figure's number is held to the text",
);

const markdown = figureWordsMarkdown(split.words);
check(
  markdown ===
    "A study led by Jane Gillette (1999) tested college undergraduates.\n\n- Students guessed nouns better than verbs\n- The sound was removed",
  "the words become a paragraph, then a bulleted list",
);
check(figureWordsMarkdown([{ ...split.words[1], kind: "numbered", text: "- one\n- two" }]) === "1. one\n2. two", "a numbered list renumbers its lines");
check(figureWordsMarkdown([{ ...split.words[0], kind: "h2", text: "Gillette\n(1999)" }]) === "## Gillette (1999)", "a heading is one line");

const rows = blocks.map(({ id, type, text }) => ({ id, type, text }));
const places = new Map<string, BlockPlace>([
  ["p0", { style: "normal" as const, where: "body" as const, container: "", group: null }],
  ["f1", { style: null, where: "body" as const, container: "", group: null, image: true as const }],
  ["p2", { style: "normal" as const, where: "body" as const, container: "", group: null }],
]);
const resolved = resolveOps([{ op: "insert_blocks", afterBlockId: "f1", markdown, why: "Put the text under the image." }], {
  rows,
  places,
  scope: { kind: "blocks", blockIds: ["f1"] },
  budget: { chars: 100_000 },
});
check(
  resolved.ops.length === 1 && resolved.ops[0].op === "insert_blocks" && resolved.ops[0].afterBlockId === "f1",
  "on rich text the words are one suggestion of new blocks right after the figure",
);

console.log(failures === 0 ? "figure-words-check: all passed" : `figure-words-check: ${failures} failed`);
if (failures > 0) process.exit(1);
