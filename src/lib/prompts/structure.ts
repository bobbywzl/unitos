import type { Lang } from "@/lib/i18n/config";
import { languageName, profileLines, type ReaderProfileCtx } from "@/lib/prompts/types";

// Structure (SPEC.md §32): the structure assistant. The reader talks with it
// about how to sort the document — by its headings, by keywords, by what the
// paragraphs have in common, by a question — and it answers with a reply
// and, once the reader asks for a structure, the whole structure: every
// bucket, every block's bucket, the connections between them. The model
// reads the whole document in the system message, every block tagged
// [block <n>] with its number in reading order, and the structure as it
// stands; it writes block numbers, never stored ids, and the route turns
// them back into ids (lib/structure-assist.ts). The reader applies a
// proposal or discards it: nothing the model writes lands on its own.

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
  message: string;
};

/** The system message: the document whole, every block numbered. Byte-identical
    from turn to turn, so it caches. */
export function structureSystem(title: string, blocks: StructureBlockCtx[]): string {
  return [
    "You are the structure assistant of a reader's document. The whole document follows. Each block starts with its number in the form [block <n>], in reading order. Refer to blocks by their numbers, exactly as given.",
    "",
    `Document title: ${title}`,
    "",
    ...blocks.map((b) => `[block ${b.n}] (${b.type}) ${b.text}`),
  ].join("\n");
}

function stateLines(state: StructureStateCtx): string[] {
  if (state.buckets.length === 0) {
    return ["The structure so far: no bucket yet. Every block is unsorted."];
  }
  const pieces = new Map<string, { n: number; label: string }[]>();
  for (const p of state.pieces) {
    const list = pieces.get(p.bucketId) ?? [];
    list.push({ n: p.n, label: p.label });
    pieces.set(p.bucketId, list);
  }
  const bucketLines = state.buckets.map((b) => {
    const inside = pieces.get(b.id) ?? [];
    const blocks = inside.map((p) => (p.label ? `${p.n} "${p.label}"` : String(p.n))).join(", ");
    return `- bucket ${b.id}: "${b.title}"${b.description ? ` — ${b.description}` : ""}${b.parentId ? ` (inside bucket ${b.parentId})` : ""}; blocks: ${blocks || "none"}`;
  });
  const connectionLines = state.connections.map(
    (c) =>
      `- connection ${c.id}: ${c.from.kind} ${c.from.id} → ${c.to.kind} ${c.to.id}; label "${c.label}"${c.comment ? `; comment "${c.comment}"` : ""}${c.byAssistant ? "" : " (drawn by the reader)"}`,
  );
  const placed = new Set(state.pieces.map((p) => p.n));
  return [
    "The structure so far (a piece is one block placed in a bucket; a connection's piece end names a block number):",
    ...bucketLines,
    ...(connectionLines.length > 0 ? ["Connections:", ...connectionLines] : ["Connections: none."]),
    `Placed blocks: ${placed.size}. Every other block is unsorted.`,
  ];
}

export function structurePrompt(ctx: StructureCtx): string {
  const lines = [
    ...stateLines(ctx.state),
    "",
    profileLines(ctx.profile),
    "",
    "The reader is sorting this document into buckets: boxes on a canvas, each a title, a description, and the blocks that belong in it, in order; a bucket can hold buckets. Connections join two buckets or two pieces with a label and a comment. The reader reads the buckets in place of the article, so a structure must be clear at a glance.",
    "Two kinds of turn:",
    "1. The reader is talking: asking how the document could be sorted, what to sort it by, or what a bucket should hold. Answer in the reply, in a few plain sentences, and set structure to null. If the reader's ask is unclear, ask one question. Suggest one or two concrete ways to sort the document when it helps: by its parts, by keyword, by what the paragraphs have in common, by the question each answers.",
    "2. The reader asks for a structure, a change to it, or says to go ahead: write the whole structure as it should stand after this turn, and say in the reply what you did in one to three sentences.",
    "Rules for a structure:",
    "- buckets: every bucket that should exist after this turn, in the order to show them. Keep a bucket that stays with its id as given above; a new bucket gets an id of the form new1, new2, …. A bucket left out is removed and its blocks become unsorted, so leave a bucket out only when the reader asked for that or asked to start over. parentId: the bucket it sits in, or null for the canvas. A title of two to six words; a description of one sentence saying what belongs in it.",
    "- pieces: every block that belongs in a bucket, each once, as its number. A block stays unsorted only when it belongs nowhere: a title, a page marker, a reference entry, a separator. Sort every content block when the reader asked for the whole document to be sorted. Keep the order the blocks have in the document inside a bucket unless the reader asked for another. A label is a phrase of three to eight words saying what the block contributes; keep a label given above unless the reader asked to change it.",
    "- connections: the new or changed connections only; a connection given above stays unless its id is in removeConnectionIds. A connection joins two buckets (kind bucket, the bucket's id) or two pieces (kind piece, the block's number). label: two to six words saying how the two relate (supports, contradicts, example of, leads to, defines the term in). comment: one or two sentences saying what each side says. Draw a connection only when the two really bear on each other; never one for every pair.",
    "- A connection the reader drew is never removed unless the reader asks.",
    `- Write every title, description, label, comment, and the reply in ${languageName(ctx.lang)}, except a term the document uses, which stays as the document writes it.`,
    `The document has ${ctx.blockCount} blocks, numbered 1 to ${ctx.blockCount}.`,
    "",
    `The reader says: ${ctx.message}`,
    "",
    'Return ONLY JSON: {"reply": "…", "structure": null | {"buckets": [{"id": "…", "title": "…", "description": "…", "parentId": null}], "pieces": [{"n": 12, "bucketId": "…", "label": "…"}], "connections": [{"id": "…" (omit for a new one), "from": {"kind": "bucket", "id": "…"}, "to": {"kind": "piece", "id": "12"}, "label": "…", "comment": "…"}], "removeConnectionIds": []}}',
  ];
  return lines.join("\n");
}
