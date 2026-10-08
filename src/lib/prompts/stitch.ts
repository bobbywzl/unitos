import type { Lang } from "@/lib/i18n/config";
import { languageName, SPECIFICITY_RULE, STYLE_RULE } from "@/lib/prompts/types";

// Stitch (SPEC.md §22): the assistant over the project's documents, from
// the graph. Three passes. The route pass reads the documents' gists and
// part summaries and names the parts the command needs; the select pass
// reads the skeletons' lines — every document's, or the named parts' —
// and names the blocks; the answer pass reads those blocks whole and
// answers the command in the reply, as links between the documents, as a
// generated document built from them, or a mix. The model reads and writes
// block aliases (the document's letter and the block's number: A1, B12),
// never the stored ids; the route resolves every alias and every quote
// against the real block text before anything is stored: a quote the model
// did not copy verbatim falls back to its whole block, and an alias that
// names no block drops (SPEC.md §4).
// Each pass has two halves. The rules (stitch*Rules) take nothing that
// changes from command to command, so they open the system message, before
// the documents, and the prefix caches. The command's half (stitch*Prompt)
// is the last user message: the documents not read, the command, and the
// JSON shape.

/** tag: the document's letter, its [document <tag>] in the system message;
    read: false when nothing of it is above. */
export type StitchDocumentCtx = { tag: string; title: string; read: boolean };

type CommandCtx = {
  documents: StitchDocumentCtx[];
  command: string;
  // True when the command follows earlier turns of the conversation.
  continued: boolean;
};

// The reading passes read the conversation as the reader's earlier
// commands (oldest first) and the blocks the earlier answers cited, as
// aliases of this reading, not as the turns themselves.
type ReadingCtx = CommandCtx & {
  earlier: string[];
  cited: string[];
};

export type StitchRouteCtx = ReadingCtx & {
  maxParts: number;
};

// A rare name of the command (lib/graph/stitch.ts nameHits) and the
// blocks whose full text names it.
export type StitchNameCtx = { term: string; aliases: string[] };

export type StitchSelectCtx = ReadingCtx & {
  maxBlocks: number;
  // True when only some parts' lines are above (the route pass, or the
  // ranker, cut the rest).
  partial: boolean;
  names?: StitchNameCtx[];
};

// The documents of the project a pick left out (ANS6-02): how many, and the
// titles named — every one up to 8, else the ones whose title or gist holds
// a word of the command (lib/graph/stitch.ts notPickedOf).
export type StitchNotPickedCtx = { count: number; titles: string[] };

export type StitchCtx = CommandCtx & {
  notPicked?: StitchNotPickedCtx;
  // True when the blocks above are the select pass's pick, not every document whole.
  selected: boolean;
  // The command's rare names: how many blocks of the documents read name
  // each, and how many of those are shown above.
  names?: { term: string; shown: number; total: number }[];
  // The links already in the project between blocks shown, as
  // "[block G6] – [block B20]" (lib/graph/stitch.ts existingPairs).
  existing?: string[];
};

/** True when the command asks where something is named: which documents
    or passages, a mention, where it is discussed (ANS4-06). Only then is a
    partial list of where a name occurs worth a sentence. */
export function asksWhere(command: string): boolean {
  return /\b(which|what) (documents?|passages?|texts?|parts?|blocks?|places?)\b|\bmention|\bwhere\b.*\b(named|mentioned|discussed|appears?)\b|\bevery (passage|place|mention)\b|哪些|哪几|提到|提及/i.test(command);
}

/** True when the command asks where something is, or for every one of a
    kind: which, every, all, each, 哪些, 所有, 每 (ANS5-10). Only then is the
    sentence that a list covers the blocks read worth its tokens. */
export function asksEvery(command: string): boolean {
  return asksWhere(command) || /\b(which|every|all|each|list)\b|哪些|哪几|所有|每一|全部/i.test(command);
}

/** True when the command is about the last answers themselves (ANS6-03):
    "why did you link the third one", "how many passages did that page
    quote", "which of those links", 第二点的原文. With earlier turns, such a
    command reads the blocks the earlier answers cited and stored, and no
    select pass runs (lib/graph/stitch.ts backSelection). "Back to the first
    answer" and "both of them" are left to the select pass: they name an
    older answer, or new passages. */
export function refersBack(command: string): boolean {
  return /\b(?:(?:that|this|those|these) (?:page|links?|passages?|quotes?|answers?|ones?|points?|numbers?|two|sentences?)\b|the (?:first|second|third|fourth|fifth|last|other|\d+(?:st|nd|rd|th)) (?:one|link|point|passage|quote|sentence)\b|the (?:page|link)\b|(?:first|second|third|fourth|fifth|last) link\b|you (?:linked|cited|quoted|said|wrote|drew|proposed|made|left)\b|which of (?:those|these)\b)|第.(?:点|条|个|段)|原文|那页|这页|那一页|这一页|那条|这条|这些链接|那些链接|这些段落|那些段落|这两|那两/i.test(command);
}

// The documents with no text above. Named only when the command bears on
// them: the box lists every document under every reply already.
function unreadLines(documents: StitchDocumentCtx[]): string[] {
  const unread = documents.filter((m) => !m.read);
  if (unread.length === 0) return [];
  return [
    `Not read: ${unread.map((m) => `"${m.title}"`).join(", ")}. These documents have no text above. Never cite them and never guess what they say. Name them in reply, with the reason given, only when the command asks about them or its answer could be in them.`,
  ];
}

// The documents a pick left out (ANS6-02): the answer pass knows they
// exist, so "the passages read do not give it" can point at the one to pick.
function notPickedLines(n: StitchNotPickedCtx | undefined): string[] {
  if (!n || n.count === 0) return [];
  const docs = `${n.count} other document${n.count === 1 ? "" : "s"} of the project`;
  const named = n.titles.map((t) => `"${t}"`).join(", ");
  const list =
    n.titles.length === n.count
      ? `${docs}: ${named}`
      : n.titles.length > 0
        ? `${docs}; the ones whose title or gist holds a word of the command: ${named}`
        : `${docs}, none whose title or gist holds a word of the command`;
  return [
    `Not picked in the graph, so not read: ${list}. Never cite them or guess what they say. When the answer could be in one of them, say in one sentence to pick it in the graph.`,
  ];
}

const CONTINUED =
  'This command continues the conversation above. Read it with the earlier turns: "it", "the second one", and "those numbers" name what the earlier turns named.';
const CONTINUED_COMMANDS =
  'This command continues the earlier commands. Read it with them: "it", "the second one", and "those numbers" name what the earlier commands and their answers named.';

function commandLines(ctx: CommandCtx & { earlier?: string[] }): string[] {
  if (!ctx.earlier) return ["The reader's command:", ctx.command, ...(ctx.continued ? ["", CONTINUED] : [])];
  return [
    ...(ctx.earlier.length > 0
      ? ["The reader's earlier commands in this conversation, oldest first:", ...ctx.earlier.map((c) => `- ${c.replace(/\s+/g, " ").trim()}`), ""]
      : []),
    "The reader's command:",
    ctx.command,
    ...(ctx.continued ? ["", CONTINUED_COMMANDS] : []),
  ];
}

function citedLine(cited: string[], what: string): string[] {
  if (cited.length === 0) return [];
  return [`The earlier answers cited ${cited.map((a) => `[block ${a}]`).join(", ")}. ${what}`];
}

const READING_ONLY = "Do not think longer than the reading takes: this is a reading, not a problem to solve.";

// ── The route pass ─────────────────────────────────────────────────────────

export function stitchRouteRules(): string {
  return [
    "Your task: name the parts of the documents a reader's command needs. Below is each document's gist and one summary per part, each part tagged [part at <alias>] with the alias of its first block. The documents' text is not below.",
    "A second read will pick the blocks the command needs from the parts named here, reading those parts line by line, and a third will do what the command asks over the picked blocks. Name every part that bears on the command: a part that treats the command's topic, answers its question, makes a claim the command asks to compare with the other documents, defines a term the command or its answer turns on, or holds passages the command asks to gather.",
    "For a command over the documents as a whole — the contradictions between them, a synthesis with no topic named — name the parts that carry claims, findings, numbers, definitions, and conclusions, in every document.",
    "Leave out references, acknowledgements, and boilerplate. When in doubt, name the part: a part left out here is never read.",
    READING_ONLY,
  ].join("\n");
}

export function stitchRoutePrompt(ctx: StitchRouteCtx): string {
  return [
    ...unreadLines(ctx.documents),
    ...commandLines(ctx),
    ...citedLine(ctx.cited, "Name the parts that hold them as well, when the command refers back to them."),
    "",
    `parts: the aliases, most relevant first, up to ${ctx.maxParts}, from every document that bears on the command. Copy each alias exactly as tagged. An empty list means nothing bears on the command.`,
    'Return ONLY JSON: {"parts": ["A1", "B12"]}',
  ].join("\n");
}

// ── The select pass ────────────────────────────────────────────────────────

export function stitchSelectRules(): string {
  return [
    "Your task: pick the blocks of the documents a reader's command needs. Below is each document's skeleton: one line per block, what the block says at a tenth of its length, under the block's alias. The blocks' full text is not below.",
    "A second read will do what the command asks over the full text of the blocks picked here, and nothing else. Pick every block that bears on the command: a block that mentions the command's topic, answers its question, makes a claim the command asks to compare with the other documents, or holds a passage the command asks to gather, and every block that defines a term the command or its answer turns on.",
    "For a command over the documents as a whole — the contradictions between them, a synthesis with no topic named — pick the blocks that carry claims, findings, numbers, definitions, and conclusions, from every document.",
    "Leave out references, acknowledgements, navigation, and boilerplate. When in doubt, pick the block: a block left out here is never read again. Pick from every document that bears on the command: a passage in the last document counts as much as one in the first.",
    READING_ONLY,
  ].join("\n");
}

export function stitchSelectPrompt(ctx: StitchSelectCtx): string {
  return [
    ...unreadLines(ctx.documents),
    ...(ctx.partial
      ? ["The skeletons above are cut to the lines a first read found for this command; (…) marks lines not shown between two lines."]
      : []),
    ...(ctx.names ?? []).map((n) => `Blocks whose full text names "${n.term}", though their skeleton line may not: ${n.aliases.join(", ")}.`),
    ...commandLines(ctx),
    ...citedLine(ctx.cited, "Pick them as well, when the command refers back to them."),
    "",
    `blockIds: the aliases, most relevant first, up to ${ctx.maxBlocks}: the block that answers best comes first, even when it comes late in its document. Copy each alias exactly as tagged. Consecutive blocks of one document go as one range, first-last (B10-B15); a range counts at the place of its most relevant block. An empty list means nothing bears on the command.`,
    'Return ONLY JSON: {"blockIds": ["A3", "B10-B15"]}',
  ].join("\n");
}

// ── The expansion ──────────────────────────────────────────────────────────

export type StitchExpandCtx = {
  command: string;
  earlier: string[];
  // The titles of the documents read: they tell the documents' language
  // and field.
  titles: string[];
  maxWords: number;
};

/** The words a passage that answers the command would use, for the ranked
    cut of the skeleton lines (lib/graph/rank.ts): the reader asks in their
    own words, the documents use theirs. One cheap call; no documents. */
export function stitchExpandPrompt(ctx: StitchExpandCtx): string {
  return [
    "Your task: list the words a passage of the documents below would use when it answers the reader's command. A ranker finds the passages by the words they share with your list.",
    `The documents: ${ctx.titles.map((t) => `"${t}"`).join(", ")}.`,
    "",
    ...(ctx.earlier.length > 0
      ? ["The reader's earlier commands in this conversation, oldest first:", ...ctx.earlier.map((c) => `- ${c.replace(/\s+/g, " ").trim()}`), ""]
      : []),
    "The reader's command:",
    ctx.command,
    "",
    `words: up to ${ctx.maxWords} words or short terms: each key word of the command, its synonyms, the word a translator of these documents would use for it, the names, and the terms of the field. Write the words in the language the documents are written in, even when the command is in another language: a Chinese command over English documents gets English words; documents in two languages get the words in both. No sentence, no word the command's topic does not need.`,
    READING_ONLY,
    'Return ONLY JSON: {"words": ["…", "…"]}',
  ].join("\n");
}

// ── The answer pass ────────────────────────────────────────────────────────

export function stitchRules(lang: Lang): string {
  const name = languageName(lang);
  return [
    "Your task: answer a reader's command over the documents below, with three outputs. Use only the outputs the command needs; leave the others empty.",
    "A question (what, which, how many, when, why, does, compare) and a summary (summarise, overview, outline) get reply only: links empty and document null, unless the command also asks to link, gather, collect, list, or write a page, a timeline, or a study guide.",
    "Read every document shown before answering: a passage in the last document counts as much as one in the first.",
    `1. links: connections between passages of different documents — passages that answer the same question, make the same claim, contradict each other, or use the same term. One link is one block in one document and one block in another document: fromBlockId and toBlockId, the aliases as tagged, in different documents. fromQuote and toQuote: the passage copied verbatim from the block text, 8 to 300 characters, never paraphrased; leave a quote out to link the whole block. reason: one plain sentence saying how the two passages relate, in ${name}, at most 600 characters. For a contradiction, say what each side claims, with its numbers. Before you call two passages a contradiction, check that they measure the same thing: when the definition, the scope, or the date differs, the reason says that instead. A block that repeats another document's block word for word is a copy: never link a block to its copy. Up to 24 links. An empty list is a valid answer.`,
    `2. document: a new page built from the documents, when the command asks for one — a page of every passage on a topic, the answers to a question gathered, the contradictions laid out, a synthesis the command asks to have as a page. title: short, in ${name}. parts, in reading order:`,
    '   - {"kind": "heading", "text": "…"}: a section heading. Use a document\'s title as a heading when the page groups passages by document.',
    '   - {"kind": "quote", "blockId": "<alias>"}: one whole block of a document, copied as it is. Add "quote": "…" with a verbatim part of the block to keep that part alone. Use quote parts for everything the command asks to gather, collect, or list from the documents; a quote part never rewrites.',
    `   - {"kind": "text", "markdown": "…", "sources": [{"blockId": "<alias>", "quote": "…"}]}: your own writing, in ${name}, in markdown (one paragraph or one list, bold). sources: the blocks the writing rests on, up to 8, each with a verbatim quote of 8 to 300 characters. Every text part needs at least one source. A finding in two paragraphs is two text parts, each with its own sources. A text part never repeats its heading, and is never a lead-in alone: put the lead-in in the list's text part. A quote in the writing is copied exactly from a block. Write nothing the documents do not support.`,
    "   Up to 200 parts. A command that asks to gather and to summarise gets both: the quote parts, then a text part with the summary. A page that combines findings gets one heading per topic and one text part per finding, each with its own sources; no finding of the documents on the topic is left out. null when the command asks for no page.",
    `3. reply: the answer to the command, in ${name}. A question gets its answer here: start with the answer in one sentence. Then one line per piece of evidence the first sentence does not already say: its document by its title, the shortest quote that proves it (one clause), and its block as [block <alias>]. Never restate the first sentence as a list. Stop when the command is answered: no closing remark, no point the command did not ask about. A why question starts with the reason the documents give, in their words; say no reason is given only when no block shown names a cause, a method, or an adjustment. A summary gives the key points of every document that bears on the topic, each with its document and block. Before you say a document says nothing on the topic, check its blocks for the topic's causes and effects: a block on what causes it or on what it causes is on the topic. When the documents give different values or claims on the same point, give each with its document and say they differ; never pick one. Except: when a later-dated document of the reader's says the value changed (moved, now, new, replaced, instead), give the later value first as the current one, and the earlier one as what it replaced. Two documents that name different causes differ only when one denies the other's cause; else give both causes. When two figures differ in what they cover, say what each covers. Never say which to use for a purpose the documents do not name. When the documents answer only in part, answer that part, then say in one sentence what they do not answer. When they do not answer at all, say so in one sentence. Then give a figure only when a block shown gives the same quantity for another scope or date; else stop. When a document marked not read could hold the answer, say in one sentence that it has no text to read. A number you work out from the documents' numbers is marked as worked out and shows the numbers it comes from. A command to gather or write a page gets one sentence: what the page finds (the agreement, the contradiction, the answer), or why the command could not be done with these documents. Never describe the page or count its parts: the count is added under the reply. A command to link gets the count of links, then one clause per group of links, or why no link could be drawn. A count of links equals the number of links you propose. A link listed as already in the project is never proposed again: say in one sentence that it is already in the graph. Never restate the page. A command that also asks a question gets its answer first, as a question does, then one sentence on the links or the page. Answer only what the command asks, from the documents only: no fact, number, comparison, or label the documents do not state (never call a figure a "lab rating" or a cause a "delay" unless a document does), and no topic the command did not ask about. At most 3,000 characters. Markdown: short paragraphs, a list when the answer has three or more parallel items, bold for the one or two key figures, no headings, no bold label on a line of its own. ${SPECIFICITY_RULE} ${STYLE_RULE}`,
    `Rules: every blockId is an alias tagged below, copied exactly; never invent one. In reply, cite a block as [block <alias>], one block per tag: [block B19] [block B21], never [block B19, B21]. Every quote is real text of the named block, copied exactly. A quote in reply is copied exactly from the block it cites; cut words with … instead of rewording. A quote is the document's words in the document's language: a translation or a paraphrase gets no quote marks. When a block repeats another document's block word for word, cite the original, not the copy: the original is in a document not marked "a page Stitch generated", else in the earlier document. Name a document by its title, never by its letter: the reader does not see the letters. When the command cannot be done with these documents, say so in reply and return empty links and a null document.`,
    "You read only the documents' text: never the reader's notes, the replies on links, or the links in the graph, except the links listed as already in the project and what your earlier answers stored. A command about the reader's notes, replies, or links gets one sentence saying you cannot read them, and where they are: notes in the Notes list, replies in the link's panel, links in the graph. Never add the partial-read sentence or advise picking documents for it. You cannot remove, accept, or edit a link, a note, or a document: say so in one sentence, and where the reader does it: a link in its panel, a recommended link under Recommended links, a note in the Notes list.",
  ].join("\n");
}

export function stitchPrompt(ctx: StitchCtx): string {
  return [
    ...unreadLines(ctx.documents),
    ...notPickedLines(ctx.notPicked),
    ...(ctx.selected
      ? [
          `A first read picked the blocks above for this command out of every document${ctx.notPicked?.count ? " picked" : ""}; each document's header says how many of its blocks are shown. Answer from the blocks shown. A block not shown was judged off the command: when the blocks shown do not answer, say that the passages read do not answer it, not that the documents do not. When the answer is missing or incomplete, add one sentence, for the one document most likely to hold the rest (its title or its other blocks bear on the topic): when its header says "read whole when picked", "Only <shown> of <total> blocks of "<title>" were read for this command; pick it and one short document in the graph to have it read whole."; else "Only <shown> of <total> blocks of "<title>" were read for this command; ask about one part of it to have that part read." Never add it when no document is likely to hold the answer, and never for a document with no blocks shown.`,
          // A rare name whose every block is shown answers "which documents
          // mention it" in full: no hedge then.
          // A command with no rare name gets it only when it asks where or
          // for every one (ANS5-10), and not about the last answers (ANS6-11).
          ...(((ctx.names ?? []).length > 0 && (ctx.names ?? []).every((n) => n.shown >= n.total)) ||
          ((ctx.names ?? []).length === 0 && (!asksEvery(ctx.command) || (ctx.continued && refersBack(ctx.command))))
            ? []
            : [
                `A command that asks which documents or passages mention something, or asks for every one of them: when some document is only partly shown, say in one sentence that the list covers the blocks read for this command.`,
              ]),
          ...(ctx.names ?? []).flatMap((n) =>
            n.shown >= n.total
              ? [`Every block of the documents read that names "${n.term}" is shown above (${n.total}).`]
              : asksWhere(ctx.command)
                ? [`${n.total} blocks of the documents read name "${n.term}"; ${n.shown} of them are shown above. A list of where "${n.term}" is named is partial: say so.`]
                : [],
          ),
        ]
      : []),
    ...((ctx.existing ?? []).length > 0
      ? [`Links already in the project between the blocks above: ${(ctx.existing ?? []).join("; ")}. Never propose them again. When the command asks for links, say in one sentence that these are already in the graph, and how many wait under Recommended links when some do; never mention one removed by the reader.`]
      : []),
    ...commandLines(ctx),
    "",
    "Answer with the three outputs and the rules at the top of the system message.",
    'Return ONLY JSON: {"reply": "…", "links": [{"fromBlockId": "A3", "fromQuote": "…", "toBlockId": "B12", "toQuote": "…", "reason": "…"}], "document": {"title": "…", "parts": [{"kind": "heading", "text": "…"}, {"kind": "quote", "blockId": "A4"}, {"kind": "quote", "blockId": "B7", "quote": "…"}, {"kind": "text", "markdown": "…", "sources": [{"blockId": "A4", "quote": "…"}]}]}}',
  ].join("\n");
}
