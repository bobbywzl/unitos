import type { Lang } from "@/lib/i18n/config";
import { languageName, profileLines, STYLE_RULE, type ReaderProfileCtx } from "@/lib/prompts/types";

// Stitch (SPEC.md §22): the assistant over the project's documents, from
// the graph. Three prompts. The route pass reads the documents' gists and
// part summaries and names the parts the command needs; the select pass
// reads the skeletons' lines — every document's, or the named parts' —
// and names the blocks; the answer pass reads those blocks whole and
// answers the command in its reply, and makes links between the documents
// or a generated document built from them only when the command asks for
// them. Each document's note says what of it is above — its blocks or its
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

export type StitchRouteCtx = {
  profile: ReaderProfileCtx;
  documents: StitchDocumentCtx[];
  command: string;
  maxParts: number;
};

export type StitchSelectCtx = {
  profile: ReaderProfileCtx;
  documents: StitchDocumentCtx[];
  command: string;
  maxBlocks: number;
  // True when only some parts' lines are above (the route pass, or the
  // ranker, cut the rest).
  partial: boolean;
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

// The route pass (SPEC.md §22): the documents' gists and part summaries
// are above; the model names the parts whose lines the select pass reads.
export function stitchRoutePrompt(ctx: StitchRouteCtx): string {
  return [
    profileLines(ctx.profile),
    "",
    ...documentLines(ctx.documents),
    "Above is each document's gist and one summary per part, each part tagged [part at <alias>] with the alias of its first block. The documents' text is not above.",
    "",
    "The reader's command:",
    ctx.command,
    "",
    "A second read will pick the blocks the command needs from the parts named here, reading those parts line by line, and a third will do what the command asks over the picked blocks. Name every part that bears on the command: a part that treats the command's topic, answers its question, makes a claim the command asks to compare with the other documents, or holds passages the command asks to gather.",
    "For a command over the documents as a whole — the contradictions between them, a synthesis with no topic named — name the parts that carry claims, findings, numbers, definitions, and conclusions, in every document.",
    "Leave out references, acknowledgements, and boilerplate. When in doubt, name the part: a part left out here is never read.",
    `parts: the aliases, most relevant first, up to ${ctx.maxParts}, from every document that bears on the command. Copy each alias exactly as tagged. An empty list means nothing bears on the command.`,
    "Do not think longer than the reading takes: this is a reading, not a problem to solve.",
    'Return ONLY JSON: {"parts": ["A1", "B12"]}',
  ].join("\n");
}

// The select pass (SPEC.md §22): the skeletons are above — one line per
// block — and the model names the blocks the answer pass reads whole.
export function stitchSelectPrompt(ctx: StitchSelectCtx): string {
  return [
    profileLines(ctx.profile),
    "",
    ...documentLines(ctx.documents),
    ctx.partial
      ? "Above is each document's skeleton, cut to the parts a first read named for this command: one line per block, what the block says at a tenth of its length, under the block's alias. A gap between two lines is declared. The blocks' full text is not above."
      : "Above is each document's skeleton: one line per block, what the block says at a tenth of its length, under the block's alias. The blocks' full text is not above.",
    "",
    "The reader's command:",
    ctx.command,
    "",
    "A second read will do what the command asks over the full text of the blocks picked here, and nothing else. Pick every block that bears on the command: a block that mentions the command's topic, answers its question, makes a claim the command asks to compare with the other documents, or holds a passage the command asks to gather.",
    "For a command over the documents as a whole — the contradictions between them, a synthesis with no topic named — pick the blocks that carry claims, findings, numbers, definitions, and conclusions, from every document.",
    "Leave out references, acknowledgements, navigation, and boilerplate. When in doubt, pick the block: a block left out here is never read again. Pick from every document that bears on the command: a passage in the last document counts as much as one in the first.",
    `blockIds: the aliases, most relevant first, up to ${ctx.maxBlocks}. Copy each alias exactly as tagged. Consecutive blocks of one document go as one range, first-last (B10-B15). An empty list means nothing bears on the command.`,
    "Do not think longer than the reading takes: this is a reading, not a problem to solve.",
    'Return ONLY JSON: {"blockIds": ["A3", "B10-B15"]}',
  ].join("\n");
}

// The answer pass (SPEC.md §22). Stitch answers, and makes links or a page
// only when the reader's own words ask for them: `asked` is decided first,
// and the route stores a link or a page only under it (lib/graph/stitch.ts,
// which also holds links back when the command names no link at all). A
// command to extract, find, or list what the documents say is answered in
// reply, in full, every point with its block.
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
    "Read every document shown before answering: a passage in the last document counts as much as one in the first. Only the documents above are in reach: never name, cite, or link a document that is not above.",
    "",
    "First decide what the command asks you to make. You always answer in reply. You make links or a page only when the reader's own words ask for them:",
    "- asked.links: true only when the command asks, in its own words, for links or connections between passages: to link, connect, relate, cross-reference, or tie passages together. A command to extract, find, gather, list, quote, summarise, compare, or explain, and any question, does not ask for links, however closely the passages relate.",
    "- asked.page: true only when the command asks, in its own words, for something to keep: a page, a document, a write-up, a report, a guide. A command to extract, find, list, or summarise that names no page does not ask for one.",
    "- A message that only confirms (\"yes\", \"do it\") asks for what the message before it asked for or what the reply before it offered.",
    "- When in doubt, false. The reader can ask for links or a page in one more message; a link or a page nobody asked for clutters the project.",
    "",
    "Then answer with these outputs.",
    `1. reply: always, in ${name}, as markdown. It is the answer itself, never a note that an answer exists elsewhere.`,
    "   - A command to extract, find, gather, or list what the documents say on a topic, when asked.page is false, is answered here in full. One bold line per document that holds something: the document's title. Under it, one bullet (\"- \") per point: the point in one plain sentence, with who says it and the number or the name it carries; then, where the wording matters, the words that carry it in quotation marks, copied exactly from the block; then its [block <alias>] tag. Give every point the documents hold on the topic, in each document's reading order. No point without its tag, and nothing the documents do not say. A document read that holds nothing on the topic gets one line saying so. When the command spans several documents, end with one or two sentences on what the points share or how they change from document to document.",
    "   - A question gets its answer: concrete, every claim with its [block <alias>] tag and the document it comes from named. A question about where the documents disagree names what each side claims, each with its tag.",
    "   - A command that asked for links or a page gets one to three sentences on how many links and what they connect, or what the page holds. Never restate the page.",
    "   - A document not read, or read only in part, gets one sentence saying so.",
    `   As long as the command needs and no longer, 1,200 words at most. ${STYLE_RULE}`,
    `2. links: only when asked.links is true; otherwise an empty list. Connections between passages of different documents: passages that answer the same question, make the same claim, contradict each other, or use the same term. One link is one block in one document and one block in another document: fromBlockId and toBlockId, the aliases as tagged, in different documents. fromQuote and toQuote: the passage copied verbatim from the block text, 8 to 300 characters, never paraphrased; leave a quote out to link the whole block. reason: one plain sentence saying how the two passages relate, in ${name}. For a contradiction, say what each side claims. Up to 24 links.`,
    `3. document: only when asked.page is true; otherwise null. A new page built from the documents: a page of every passage on a topic, the answers to a question gathered, the contradictions laid out, a synthesis. title: short, in ${name}. parts, in reading order:`,
    '   - {"kind": "heading", "text": "…"}: a section heading. Use a document\'s title as a heading when the page groups passages by document.',
    '   - {"kind": "quote", "blockId": "<alias>"}: one whole block of a document, copied as it is. Add "quote": "…" with a verbatim part of the block to keep that part alone. Use quote parts for everything the command asks to gather, collect, or list from the documents; a quote part never rewrites.',
    `   - {"kind": "text", "markdown": "…", "sources": [{"blockId": "<alias>", "quote": "…"}]}: your own writing, in ${name}, in markdown (paragraphs, lists, bold). sources: the blocks the writing rests on, each with a verbatim quote of 8 to 300 characters. Every text part needs at least one source. Write nothing the documents do not support.`,
    "   Up to 200 parts. A command that asks for a page that gathers and summarises gets both: the quote parts, then a text part with the summary.",
    "Rules: every blockId is an alias tagged above, copied exactly; never invent one. In reply, cite a block as [block <alias>]. Every quote is real text of the named block, copied exactly. When the command cannot be done with these documents, say so in reply and return empty links and a null document.",
    'Return ONLY JSON, asked first: {"asked": {"links": false, "page": false}, "reply": "…", "links": [{"fromBlockId": "A3", "fromQuote": "…", "toBlockId": "B12", "toQuote": "…", "reason": "…"}], "document": {"title": "…", "parts": [{"kind": "heading", "text": "…"}, {"kind": "quote", "blockId": "A4"}, {"kind": "quote", "blockId": "B7", "quote": "…"}, {"kind": "text", "markdown": "…", "sources": [{"blockId": "A4", "quote": "…"}]}]}}',
  ].join("\n");
}
