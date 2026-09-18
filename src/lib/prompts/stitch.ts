import type { Lang } from "@/lib/i18n/config";
import { languageName, profileLines, type ReaderProfileCtx } from "@/lib/prompts/types";

// Stitch (SPEC.md §22): the assistant over the project's documents, from
// the graph. Two passes, two prompts. The select pass reads one document
// whole, one call per document, and names the blocks of that document the
// command needs. The answer pass reads those blocks and answers the command
// as links between the documents, a generated document built from them, or
// both. Each document's note says what of it is above — its blocks or its
// transcript lines, cut for length, or nothing and why. The model reads and
// writes block aliases (the document's letter and the block's number: A1,
// B12), never the stored ids; the route resolves every alias and every
// quote against the real block text before anything is stored: a quote the
// model did not copy verbatim falls back to its whole block, and an alias
// that names no block drops (SPEC.md §4).

/** tag: the document's letter, its [document <tag>] in the system message;
    note: what was read of the document (lib/graph/stitch.ts coverageNote);
    read: false when nothing of it is above. */
export type StitchDocumentCtx = { tag: string; title: string; note: string; read: boolean };

export type StitchSelectCtx = {
  profile: ReaderProfileCtx;
  documents: StitchDocumentCtx[];
  // The tag of the one document above.
  document: string;
  command: string;
  maxBlocks: number;
};

export type StitchCtx = {
  profile: ReaderProfileCtx;
  lang: Lang;
  documents: StitchDocumentCtx[];
  command: string;
  // True when the blocks above are the select pass's pick, not every document whole.
  selected: boolean;
};

function documentLines(documents: StitchDocumentCtx[]): string[] {
  const listed = documents.map((m) => `[document ${m.tag}] "${m.title}" (${m.note})`).join("; ");
  const unread = documents.filter((m) => !m.read);
  return [
    `The documents, each under its letter, with what of it was read: ${listed}. Every block is tagged [block <alias>]: the document's letter and the block's number in it (A1, B12); aliases are unique across all documents. A video or audio document is its transcript lines.`,
    ...(unread.length > 0
      ? [
          `Not read: ${unread.map((m) => `"${m.title}"`).join(", ")}. These documents have no text above. Never cite them, never guess what they say, and name them in reply as not read, with the reason given.`,
        ]
      : []),
  ];
}

export function stitchSelectPrompt(ctx: StitchSelectCtx): string {
  const document = ctx.documents.find((m) => m.tag === ctx.document);
  return [
    profileLines(ctx.profile),
    "",
    ...documentLines(ctx.documents),
    `Above is one document only: [document ${ctx.document}]${document ? ` "${document.title}"` : ""}. The other documents are read in calls of their own.`,
    "",
    "The reader's command:",
    ctx.command,
    "",
    "A second read will do what the command asks over every document, reading only the blocks picked here and in the other documents' reads. Pick every block of this document that bears on the command: a block that mentions the command's topic, answers its question, makes a claim the command asks to compare with the other documents, or holds a passage the command asks to gather.",
    "For a command over the documents as a whole — the contradictions between them, a synthesis with no topic named — pick the blocks that carry claims, findings, numbers, definitions, and conclusions.",
    "Leave out references, acknowledgements, navigation, and boilerplate. When in doubt, pick the block: a block left out here is never read again.",
    `blockIds: the aliases, most relevant first, up to ${ctx.maxBlocks}. Copy each alias exactly as tagged. Consecutive blocks go as one range, first-last (${ctx.document}10-${ctx.document}15). An empty list means nothing in this document bears on the command.`,
    "Do not think longer than the reading takes: this is a reading, not a problem to solve.",
    `Return ONLY JSON: {"blockIds": ["${ctx.document}3", "${ctx.document}10-${ctx.document}15"]}`,
  ].join("\n");
}

export function stitchPrompt(ctx: StitchCtx): string {
  const name = languageName(ctx.lang);
  return [
    profileLines(ctx.profile),
    "",
    ...documentLines(ctx.documents),
    ...(ctx.selected
      ? [
          "A first read picked the blocks above for this command out of every document; each document's header says how many of its blocks are shown. Answer from the blocks shown.",
        ]
      : []),
    "",
    "The reader's command:",
    ctx.command,
    "",
    "Read every document shown before answering: a passage in the last document counts as much as one in the first. Answer the command with these three outputs. Use only the outputs the command needs; leave the others empty.",
    `1. links: connections between passages of different documents — passages that answer the same question, make the same claim, contradict each other, or use the same term. One link is one block in one document and one block in another document: fromBlockId and toBlockId, the aliases as tagged, in different documents. fromQuote and toQuote: the passage copied verbatim from the block text, 8 to 300 characters, never paraphrased; leave a quote out to link the whole block. reason: one plain sentence saying how the two passages relate, in ${name}. For a contradiction, say what each side claims. Up to 24 links. An empty list is a valid answer.`,
    `2. document: a new page built from the documents, when the command asks for one — a page of every passage on a topic, the answers to a question gathered, the contradictions laid out, a synthesis. title: short, in ${name}. parts, in reading order:`,
    '   - {"kind": "heading", "text": "…"}: a section heading. Use a document\'s title as a heading when the page groups passages by document.',
    '   - {"kind": "quote", "blockId": "<alias>"}: one whole block of a document, copied as it is. Add "quote": "…" with a verbatim part of the block to keep that part alone. Use quote parts for everything the command asks to gather, collect, or list from the documents; a quote part never rewrites.',
    `   - {"kind": "text", "markdown": "…", "sources": [{"blockId": "<alias>", "quote": "…"}]}: your own writing, in ${name}, in markdown (paragraphs, lists, bold). sources: the blocks the writing rests on, each with a verbatim quote of 8 to 300 characters. Every text part needs at least one source. Write nothing the documents do not support.`,
    "   Up to 200 parts. A command that asks to gather and to summarise gets both: the quote parts, then a text part with the summary. null when the command asks for no page.",
    `3. reply: the answer to the command in plain sentences, in ${name}. A question gets its answer here — concise, concrete, every claim with the document it comes from named — and a page only when the command asks for one. A command to gather, link, or write gets one to three sentences on what the page holds, how many links, or why the command could not be done with these documents. A document not read, or read only in part, gets one sentence saying so. Never restate the page.`,
    "Rules: every blockId is an alias tagged above, copied exactly; never invent one. In reply, cite a block as [block <alias>]. Every quote is real text of the named block, copied exactly. When the command cannot be done with these documents, say so in reply and return empty links and a null document.",
    'Return ONLY JSON: {"reply": "…", "links": [{"fromBlockId": "A3", "fromQuote": "…", "toBlockId": "B12", "toQuote": "…", "reason": "…"}], "document": {"title": "…", "parts": [{"kind": "heading", "text": "…"}, {"kind": "quote", "blockId": "A4"}, {"kind": "quote", "blockId": "B7", "quote": "…"}, {"kind": "text", "markdown": "…", "sources": [{"blockId": "A4", "quote": "…"}]}]}}',
  ].join("\n");
}
