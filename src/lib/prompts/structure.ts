import type { Lang } from "@/lib/i18n/config";
import { languageName, profileLines, type ReaderProfileCtx } from "@/lib/prompts/types";
import { rangesOf } from "@/lib/structure";

// Breakwork (SPEC.md §32): the Breakwork assistant. The reader talks with it
// about how to sort the document — by its headings, by keywords, by what the
// paragraphs have in common, by a question — and it answers with a reply
// and, once the reader asks for a structure, the whole structure: every
// bucket with its blocks as ranges of block numbers, the labels the reader
// asked for, and the new connections. The model reads the whole document in
// the system message, every block tagged [block <n>] with its number in
// reading order, and the structure as it stands; it writes block numbers,
// never stored ids, and the route turns them back into ids
// (lib/structure-assist.ts). The answer stays short whatever the length of
// the document: a bucket's blocks are ranges ("5-18, 22"), never one entry
// per block. The reader applies a proposal or discards it: nothing the model
// writes lands on its own.

export type StructureBlockCtx = { n: number; type: string; text: string };

export type StructureStateCtx = {
  buckets: { id: string; title: string; description: string; parentId: string | null }[];
  // Every placed block: its number, its bucket, its label.
  pieces: { n: number; bucketId: string; label: string }[];
  connections: {
    id: string;
    from: { kind: "bucket" | "piece"; id: string };
    to: { kind: "bucket" | "piece"; id: string };
    label: string;
    comment: string;
    byAssistant: boolean;
  }[];
};

export type StructureCtx = {
  profile: ReaderProfileCtx;
  lang: Lang;
  documentTitle: string;
  state: StructureStateCtx;
  blockCount: number;
  // True when long blocks were cut to their opening words to fit the read.
  cut: boolean;
  message: string;
};

/** The system message: the document whole, every block numbered. Byte-identical
    from turn to turn while the document is, so it caches. */
export function structureSystem(title: string, blocks: StructureBlockCtx[]): string {
  return [
    "You are the Breakwork assistant of a reader's document. The whole document follows. Each block starts with its number in the form [block <n>], in reading order. Refer to blocks by their numbers, exactly as given.",
    "",
    `Document title: ${title}`,
    "",
    ...blocks.map((b) => `[block ${b.n}] (${b.type}) ${b.text}`),
  ].join("\n");
}

const endText = (e: { kind: "bucket" | "piece"; id: string }) => (e.kind === "bucket" ? `bucket ${e.id}` : `block ${e.id}`);

function stateLines(state: StructureStateCtx): string[] {
  if (state.buckets.length === 0) {
    return ["The structure so far: no bucket yet. Every block is unsorted."];
  }
  const inBucket = new Map<string, number[]>();
  for (const p of state.pieces) inBucket.set(p.bucketId, [...(inBucket.get(p.bucketId) ?? []), p.n]);
  const bucketLines = state.buckets.map((b) => {
    const blocks = inBucket.get(b.id) ?? [];
    return `- bucket ${b.id}: "${b.title}"${b.description ? ` — ${b.description}` : ""}${b.parentId ? ` (inside bucket ${b.parentId})` : ""}; blocks: ${blocks.length > 0 ? rangesOf(blocks) : "none"}`;
  });
  const labeled = state.pieces.filter((p) => p.label);
  const connectionLines = state.connections.map(
    (c) =>
      `- connection ${c.id}: ${endText(c.from)} → ${endText(c.to)}; label "${c.label}"${c.comment ? `; comment "${c.comment}"` : ""}${c.byAssistant ? "" : " (drawn by the reader)"}`,
  );
  return [
    "The structure so far:",
    ...bucketLines,
    ...(labeled.length > 0 ? ["Labels:", ...labeled.map((p) => `- block ${p.n}: "${p.label}"`)] : []),
    ...(connectionLines.length > 0 ? ["Connections:", ...connectionLines] : ["Connections: none."]),
    `Placed blocks: ${state.pieces.length}. Every other block is unsorted.`,
  ];
}

export function structurePrompt(ctx: StructureCtx): string {
  const lines = [
    ...stateLines(ctx.state),
    "",
    profileLines(ctx.profile),
    "",
    "The reader sorts this document into buckets: boxes on a canvas, each with a title, a description, and the blocks that belong in it. A bucket can hold buckets. Connections join two buckets or two blocks with a label and a comment. The reader reads the buckets in place of the document, so the structure must be clear at a glance.",
    ...(ctx.cut ? ["Long blocks above are cut to their opening words; the cut is marked with …. Sort them by what they open with."] : []),
    "",
    "First decide the kind of turn:",
    "1. A question about how to sort (\"how should I sort this?\", \"what would work?\"): set structure to null and answer in the reply in at most four sentences: one sentence naming three or four ways this document's own markers support (its headings, its labels such as FN: or My critique:, its recurring themes), no two ways grouping the blocks alike; one or two sentences recommending the way that fits what the reader wants, naming the line of the document that shows why; then ask whether to build it.",
    "2. Anything else — a request for a structure, a change to the structure, a complaint that it did not work, \"go ahead\", \"do it\": write the structure. When the request is unclear, choose the most useful reading, write the structure, and say in the reply which reading you chose. Never answer such a turn with only a question.",
    "",
    "Rules for a structure:",
    "1. Follow the reader's sorting rule exactly. A rule that names two dimensions (\"by themes and by archetypes\", \"by topic and by author\") gets one top bucket per value of the first dimension, and the second dimension as buckets inside them, or as top buckets of their own when the two cut across each other; say which in the reply. A rule that names sides (\"separate X from Y\") gets exactly one top bucket per side, and every block of a side sorted by topic into buckets inside it: no flat leftover bucket at the top.",
    "2. The reader's own lines (My critique, My take, my thoughts, 我的想法) are one kind, whatever the label. A request that names kinds of blocks (\"the quotes and my commentaries\", \"the claims\") says what to sort by, not what to leave out. Place every block that carries content: lecture points, explanations, unlabeled lines that restate the text, and examples go into the bucket of their topic. Course and admin lines (reading reminders, dates, exam logistics) go into one bucket of their own, last.",
    "3. Sort by what each block says, not by where it sits. A heading names a part; a theme runs across parts. When the reader asks for themes, a bucket gathers blocks from every part of the document that share the theme.",
    "4. Keep a block with what it belongs to. A comment, a critique, or an explanation goes in the same bucket as the quote or point it comments on. A list line goes with the heading or paragraph above it unless its own content belongs elsewhere. A heading goes first in the bucket of the part it names. A block that bears on two buckets goes in the one it serves most directly, and a connection from it to the other bucket records the second tie.",
    "5. buckets: every bucket that should exist after this turn, in the order to show them. Keep a bucket that stays with its id as given above. A new bucket gets an id of the form new1, new2, …. A bucket left out is removed and its blocks become unsorted: leave one out only when the reader asked for that or asked to start over. A change the reader asks for touches only what it names: every bucket it does not name keeps its id, title, description, parent, and blocks exactly. A request to add something inside every bucket of a kind reaches the buckets inside them too. parent: the id of the bucket it sits in, or null for the canvas.",
    "6. title: two to six words, the name of what the bucket holds (\"Death of God\", \"Rousseau's man\"), never a sentence; buckets of one kind under different parents name their parent (\"Critiques: Death of God\"), never one title repeated. description: one sentence saying what belongs in it.",
    "7. blocks: the block numbers of the bucket as ranges in the order to show them, for example \"5-18, 22, 30-31\". Every block in one bucket at most. Place every block that carries content when the reader asks for the whole document to be sorted. Leave unsorted only a block that belongs nowhere: the document's title, a page marker, a reference entry, a separator, an empty line. A bucket inside another holds its own blocks; the outer bucket lists only the blocks that belong to none of its inner buckets.",
    "8. Sizes: three to twelve top buckets. No bucket with fewer than two blocks unless the reader asked for it. No bucket with more than a third of the document's blocks when the reader asked for themes; split it.",
    "9. labels: a label for a block only when the reader asks for labels; otherwise {}. A label is three to eight words saying what the block contributes. A label given above stays unless the reader asks to change it.",
    "10. connections: the new or changed connections only, at most 12. from and to are \"bucket <id>\" or \"block <n>\". label: two to six words saying how the two relate (supports, contradicts, example of, leads to, answers). comment: one sentence saying what each side says. Draw a connection only where the two really bear on each other. A connection given above stays unless its id is in removeConnections; a connection drawn by the reader is never removed unless the reader asks.",
    `11. Write every title, description, label, comment, and the reply in ${languageName(ctx.lang)}, except a term the document uses, which stays as the document writes it.`,
    "12. reply: one to three sentences saying what you did: the sorting rule, the number of buckets, and anything left unsorted and why.",
    "",
    `The document has ${ctx.blockCount} blocks, numbered 1 to ${ctx.blockCount}.`,
    "",
    `The reader says: ${ctx.message}`,
    "",
    "Inside a JSON string, write a quotation mark as \\\" or use the document's own quotation marks (「」, “”).",
    'Return ONLY JSON: {"reply": "…", "structure": null | {"buckets": [{"id": "new1", "title": "…", "description": "…", "parent": null, "blocks": "5-18, 22"}], "labels": {}, "connections": [{"from": "bucket new1", "to": "block 12", "label": "…", "comment": "…"}], "removeConnections": []}}',
  ];
  return lines.join("\n");
}
