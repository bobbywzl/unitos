import type { ModelMessage } from "ai";
import { ASSISTANT_WHOLE_THRESHOLD, STITCH_SELECTED_BUDGET } from "@/lib/derive/config";
import type { loadProfile } from "@/lib/derive/context";
import type { DocumentPick } from "@/lib/digest/render";
import type { DigestDocument } from "@/lib/digest/types";
import { chooseDepth } from "@/lib/assistant/depth";
import { db } from "@/lib/db";
import { rank, tokenize } from "@/lib/graph/rank";
import { readSkeleton, refreshSkeleton, skeletonStale } from "@/lib/graph/skeleton";
import { loadDocuments, pickBlocks, readingOf } from "@/lib/graph/stitch";

// The assistant at This page scope over a long document (SPEC.md §7). Under
// ASSISTANT_WHOLE_THRESHOLD of text the document goes whole, as it always
// did, and its prefix caches from message to message. Past it a message
// reads the document the way Stitch reads a project (SPEC.md §22): the
// reading passes find the blocks the message needs from the document's
// skeleton, and the digest renders the document's gist, its contents, and
// those blocks' real text, with every note and layer whole. A document
// whose skeleton is not built yet (the first minutes after a book is
// added) is read by a lexical pass over its blocks instead, so the first
// question is answered at once; the skeleton builds meanwhile. Either way
// a message's cost follows what it needs, not the length of the document,
// and every quote and citation still comes from stored block text.

/** The lexical pass: how many ranked blocks it reads before their
    neighbours, and how far around each (a passage runs over a block's
    edge; a table's or a list's rows stand in blocks of their own). */
const LEXICAL_SEEDS = 60;
const LEXICAL_AROUND = 1;
/** The document's opening (its title, abstract, or first page): read for
    every message, so the model knows what the document is. */
const OPENING_CHARS = 3_000;
/** A part the message names ("section 1.2", "the chapter on card
    shuffling") is read whole, the smallest named part first, to this share
    of the budget: a count or a list over a part needs every block of it. */
const PARTS_SHARE = 0.75;
/** A message over the whole document (a summary, its structure, its main
    argument, "every chapter") reads a sketch of it: each part's heading
    and the first block under it, to this share of the budget, so the
    answer covers every part and not the parts the words happen to match. */
const SKETCH_SHARE = 0.5;
const SKETCH_BLOCK_MAX = 1_200;
/** A gap of this many blocks or fewer between two picked blocks is read
    too: an argument runs through the blocks between the ones its words
    matched (a letter's steps between its opening and its conclusion). */
const BRIDGE_MAX = 3;
const OVERVIEW_RE = /\b(summar(y|i[sz]e)|overview|outline|synopsis|main (argument|points|ideas|claims|themes)|key (points|ideas|takeaways)|structure[d]?|how is (it|the \w+) organi[sz]ed|what (is|are) (this|the) (book|document|paper|article|text|report|thesis|chapters?) about|table of contents|each chapter|every chapter|all the chapters|chapter by chapter|section by section|the (whole|entire) (book|document|paper|article|text))\b|总结|概括|概述|大纲|主要观点|每一?章|整本|全文/i;

/** Whether the message reads over the whole document. */
export function wantsOverview(message: string): boolean {
  return OVERVIEW_RE.test(message) || chooseDepth({ message }).signals.includes("across the document");
}
/** The contents: every heading of the document, so the model knows the
    document's shape and names a part the passages do not cover. */
const CONTENTS_MAX = 400;

export type DocumentReading = {
  pick: DocumentPick;
  /** How the blocks were picked: the skeleton's reading passes, or the
      lexical pass over the blocks. */
  method: "skeleton" | "lexical";
  /** Every heading of the document, in order: `[block <id>] <title>`. */
  contents: string[];
  /** How many blocks the document has. */
  total: number;
};

type Turn = { role: "user" | "assistant"; content: string };

/** The blocks this message reads of the open document, or null when the
    document is short enough to read whole (or the message has no words). */
export async function documentPicks(input: {
  notebookId: string;
  document: DigestDocument;
  question: string;
  history: Turn[];
  profile: Awaited<ReturnType<typeof loadProfile>>;
  userId: string;
  signal?: AbortSignal;
}): Promise<DocumentReading | null> {
  if (input.document.chars <= ASSISTANT_WHOLE_THRESHOLD || !input.question.trim()) return null;
  const docs = await loadDocuments(input.notebookId, [input.document.id]);
  const doc = docs[0];
  if (!doc) return null;
  const { length, ...reading } = readingOf(docs);
  if (length <= ASSISTANT_WHOLE_THRESHOLD || reading.read.length === 0) return null;
  const read = reading.read[0];
  const contents = read.blocks
    .filter((b) => b.type === "HEADING" && b.text.trim())
    .slice(0, CONTENTS_MAX)
    .map((b) => `[block ${b.id}] ${b.text.trim().replace(/\s+/g, " ")}`);
  const total = read.blocks.length;
  const skeleton = readSkeleton(doc.skeleton);
  const gist = skeleton?.gist ?? "";
  // The skeleton's reading passes, when the document has a skeleton that
  // still fits its text: a stale or missing one would build now, a minute
  // or more for a book, so the lexical pass reads instead and the build
  // runs in the background for the next message.
  if (skeleton && !skeletonStale(skeleton, doc.blocks)) {
    const history: ModelMessage[] = input.history
      .filter((turn) => turn.content.trim())
      .slice(-20)
      .map((turn) => ({ role: turn.role, content: turn.content }));
    const aliases = await pickBlocks({
      reading,
      command: input.question,
      history,
      profile: input.profile,
      userId: input.userId,
      feature: "assistant",
      signal: input.signal,
    });
    const blockIds = new Set<string>();
    for (const alias of aliases) {
      const block = reading.blockByRef.get(alias);
      if (block) blockIds.add(block.id);
    }
    withOpening(read.blocks, blockIds);
    return { pick: { blockIds, gist }, method: "skeleton", contents, total };
  }
  void refreshSkeleton(doc.id, input.userId).catch((err: unknown) => {
    console.warn("[assistant] skeleton refresh failed:", err);
  });
  // The headings' levels, from their html: a part runs to the next heading
  // at its level or over it.
  const headings = await db.block.findMany({ where: { documentId: doc.id, type: "HEADING" }, select: { id: true, html: true } });
  const depthById = new Map(headings.map((h) => [h.id, Number(/<h([1-6])/i.exec(h.html ?? "")?.[1] ?? 2)]));
  const blockIds = lexicalPicks(read.blocks, lexicalQuery(input.question, input.history), { depthById });
  return { pick: { blockIds, gist }, method: "lexical", contents, total };
}

/** The words the lexical pass ranks by: the message, and the reader's two
    messages before it (a follow-up names its subject by a pronoun). */
function lexicalQuery(question: string, history: Turn[]): string {
  const earlier = history
    .filter((t) => t.role === "user" && t.content.trim())
    .slice(-2)
    .map((t) => t.content);
  return [...earlier, question].join("\n");
}

type Block = { id: string; type: string; text: string };

/** A part of the document: its heading's index and the index its blocks
    end before. A numbered heading ("1.2 …", "Chapter 3") runs to the next
    numbered heading or a heading over it; any other heading runs to the
    next heading at its level or over it. */
export function partsOf(blocks: Block[], depthById: Map<string, number>): { start: number; end: number }[] {
  const heads = blocks.flatMap((b, k) => (b.type === "HEADING" ? [k] : []));
  const depth = (k: number) => depthById.get(blocks[k].id) ?? 2;
  const numberOf = (k: number) => HEADING_NUMBER_RE.exec(blocks[k].text.trim())?.[1] ?? null;
  return heads.map((k, i) => {
    const own = numberOf(k);
    let end = blocks.length;
    for (const j of heads.slice(i + 1)) {
      const other = numberOf(j);
      // A numbered part holds its children ("3" holds "3.1" and "3.2.4")
      // and ends at the next number that is no child, or at a heading over
      // it; an unnumbered part ends at the next heading at its level or over it.
      const ends = depth(j) < depth(k) || (own ? other !== null && !other.startsWith(`${own}.`) : depth(j) <= depth(k));
      if (ends) {
        end = j;
        break;
      }
    }
    return { start: k, end };
  });
}

/** A heading's number: "1.2" of "1.2 Discrete …", "3" of "Chapter 3". */
const HEADING_NUMBER_RE = /^(?:(?:chapter|part|section|appendix|unit|lecture|week)\s+)?(\d+(?:\.\d+)*)\.?(?:\s|$)/i;

/** Whether the message names this heading: its number stands in the
    message ("1.2"; "chapter 3" names the heading "Chapter 3" or "3 …"), or
    the heading has two words of four letters or more and most of them
    stand in the message, or it is one word of six letters or more, in the
    message, that no other heading repeats ("Combinatorics", never
    "Exercises"). */
export function namesHeading(heading: string, query: QueryTerms): boolean {
  const title = heading.trim();
  const number = /^(?:(?:chapter|part|section|appendix|unit|lecture|week)\s+)?(\d+(?:\.\d+)*)/i.exec(title)?.[1];
  if (number && number.includes(".") && query.tokens.has(number)) return true;
  if (number && !number.includes(".") && query.chapters.has(number)) return true;
  const words = tokenize(title).filter((w) => w.length >= 4 && !/^\d/.test(w));
  if (words.length === 1) return words[0].length >= 6 && query.tokens.has(words[0]) && (query.headingCounts.get(title.toLowerCase()) ?? 0) === 1;
  if (words.length < 2) return false;
  const hit = words.filter((w) => queryTokens(query).has(w)).length;
  return hit >= Math.ceil(words.length * 0.7);
}

/** The message's words as the parts are matched by: its tokens (numbers
    with a point among them), the numbers after "chapter", "part", or
    "section", and how often each heading's words stand among the
    document's headings. */
export type QueryTerms = { tokens: Set<string>; chapters: Set<string>; headingCounts: Map<string, number> };
const queryTokens = (q: QueryTerms) => q.tokens;

export function queryTerms(query: string, headings: string[]): QueryTerms {
  const tokens = new Set([...tokenize(query), ...(query.match(/\d+(?:\.\d+)+/g) ?? [])]);
  const chapters = new Set([...query.matchAll(/\b(?:chapter|part|section|appendix|unit|lecture|week|ch\.?|sec\.?)\s+(\d+)\b/gi)].map((m) => m[1]));
  const headingCounts = new Map<string, number>();
  for (const h of headings) {
    const key = h.trim().toLowerCase();
    headingCounts.set(key, (headingCounts.get(key) ?? 0) + 1);
  }
  return { tokens, chapters, headingCounts };
}

/** The blocks the lexical pass reads: the document's opening, the parts
    the message names whole (the smallest first, to a share of the budget),
    then the blocks ranked highest against the query with the blocks around
    each and the heading over each, in reading order, to the selected
    budget. */
export function lexicalPicks(blocks: Block[], query: string, opts: { depthById?: Map<string, number>; budget?: number } = {}): Set<string> {
  const budget = opts.budget ?? STITCH_SELECTED_BUDGET;
  const picked = new Set<string>();
  let spent = 0;
  const take = (k: number, limit = budget): boolean => {
    const b = blocks[k];
    if (!b || picked.has(b.id)) return true;
    const cost = b.text.length + 40;
    if (spent + cost > limit) return false;
    spent += cost;
    picked.add(b.id);
    return true;
  };
  withOpening(blocks, picked, (k) => take(k));
  // The parts the message names, whole.
  const terms = queryTerms(
    query,
    blocks.filter((b) => b.type === "HEADING").map((b) => b.text),
  );
  const named = partsOf(blocks, opts.depthById ?? new Map())
    .filter((p) => namesHeading(blocks[p.start].text, terms))
    .map((p) => ({ ...p, size: blocks.slice(p.start, p.end).reduce((n, b) => n + b.text.length + 40, 0) }))
    .sort((a, b) => a.size - b.size);
  const partsLimit = Math.floor(budget * PARTS_SHARE);
  for (const part of named) {
    if (spent + part.size > partsLimit) continue;
    for (let k = part.start; k < part.end; k++) take(k);
  }
  // A message over the whole document: the sketch, every heading and the
  // first block under it.
  const message = query.split("\n").filter((l) => l.trim()).at(-1) ?? query;
  if (wantsOverview(message)) {
    const sketchLimit = Math.floor(budget * SKETCH_SHARE);
    for (let k = 0; k < blocks.length; k++) {
      if (blocks[k].type !== "HEADING") continue;
      if (!take(k, sketchLimit)) break;
      const next = blocks[k + 1];
      if (next && next.type !== "HEADING" && next.text.length <= SKETCH_BLOCK_MAX) take(k + 1, sketchLimit);
    }
  }
  const ranked = rank(
    blocks.map((b, k) => k),
    (k) => blocks[k].text,
    query,
  ).filter((r) => r.score > 0);
  for (const { item: k } of ranked.slice(0, LEXICAL_SEEDS)) {
    if (!take(k)) break;
    for (let d = 1; d <= LEXICAL_AROUND; d++) {
      take(k - d);
      take(k + d);
    }
    // The heading over the block: the part it stands in.
    for (let j = k - 1; j >= 0; j--) {
      if (blocks[j].type !== "HEADING") continue;
      take(j);
      break;
    }
  }
  // The short gaps between picked blocks.
  let last = -1;
  for (let k = 0; k < blocks.length; k++) {
    if (!picked.has(blocks[k].id)) continue;
    if (last >= 0 && k - last - 1 <= BRIDGE_MAX && !blocks.slice(last + 1, k).some((b) => b.type === "HEADING")) {
      for (let j = last + 1; j < k; j++) take(j);
    }
    last = k;
  }
  return picked;
}

/** The document's opening added to a pick: its first blocks to
    OPENING_CHARS, the title and what the document is about. */
function withOpening(blocks: Block[], picked: Set<string>, take?: (k: number) => boolean): void {
  let chars = 0;
  for (let k = 0; k < blocks.length && chars < OPENING_CHARS; k++) {
    chars += blocks[k].text.length;
    if (take) {
      if (!take(k)) return;
    } else picked.add(blocks[k].id);
  }
}
