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
/** When the message names a part, the ranked blocks outside the named
    parts are the message's reach beyond them ("compare 1.2 with chapter
    2"): fewer, since the part itself is read whole. */
const LEXICAL_SEEDS_OUTSIDE = 15;
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
/** The parts the query points at, read whole as the skeleton's route pass
    reads parts: among the leaf parts (no part inside them) of three blocks
    or more, the share of blocks that match a query word, weighted by how
    many; the best one or two, each at half the best's score or more. A
    question's answer sits in a part more often than in the blocks whose
    words match it one by one (the book's section on simulating coin
    tosses, where every block says "toss" a little). */
const ROUTE_PARTS = 2;
const ROUTE_MIN_SHARE = 0.5;
const ROUTE_MIN_BLOCKS = 3;

/** The words of a message that point at nothing in a document: the
    message's own frame ("what does the book say about"), left out of the
    ranking so the blocks that hold its subject stand out. */
const STOPWORDS = new Set(
  "a an the this that these those it its is are was were be been being am do does did doing have has had having of in on at to for from by with about into over under between through during before after above below up down out off again further then once here there when where why how all any both each few more most other some such no nor not only own same so than too very can will just should would could may might must shall and but or if because as until while what which who whom whose book document paper article text chapter section page say says said tell tells mean means explain explains describe describes discuss discusses about regarding concerning please me my our we you your i they them their he she his her".split(
    " ",
  ),
);

/** A query with its stopwords left out, for the ranking; the query whole
    when nothing else is left. */
export function contentWords(query: string): string {
  const words = query.split(/\s+/).filter((w) => w && !STOPWORDS.has(w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "")));
  return words.length > 0 ? words.join(" ") : query;
}

/** The parts the ranked blocks point at: leaf parts, scored by the share
    of their blocks that match, times the log of how many match. */
export function routeParts(blocks: Block[], parts: { start: number; end: number }[], scoreOf: Map<number, number>): { start: number; end: number; score: number }[] {
  const leaf = parts.filter((p) => p.end - p.start >= ROUTE_MIN_BLOCKS && !parts.some((o) => o !== p && o.start > p.start && o.end <= p.end));
  return leaf
    .map((p) => {
      let hits = 0;
      for (let k = p.start; k < p.end; k++) if ((scoreOf.get(k) ?? 0) > 0) hits++;
      return { start: p.start, end: p.end, score: (hits / (p.end - p.start)) * Math.log2(1 + hits) };
    })
    .filter((p) => p.score > 0)
    .sort((a, b) => b.score - a.score);
}
/** A gap between two picked blocks inside one part is read too when it is
    this many blocks or fewer, or twice as many when they are short (this
    many characters or fewer in all): an argument runs through the blocks
    between the ones its words matched (Pascal's letter's steps between
    its opening and its conclusion, six short blocks that name neither
    Pascal nor Fermat). */
const BRIDGE_MAX = 3;
const BRIDGE_CHARS = 3_000;
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
  /** The characters of block text the lexical pass reads for this message:
      the selected budget, or half of it for a message at low effort (a
      lookup, a one-place change: the passage it needs ranks first). */
  budget?: number;
}): Promise<DocumentReading | null> {
  if (input.document.chars <= ASSISTANT_WHOLE_THRESHOLD || !input.question.trim()) return null;
  const docs = await loadDocuments(input.notebookId, [input.document.id]);
  const doc = docs[0];
  if (!doc) return null;
  const { length, ...reading } = readingOf(docs);
  if (length <= ASSISTANT_WHOLE_THRESHOLD || reading.read.length === 0) return null;
  const read = reading.read[0];
  // The headings' levels, from their html: the contents indent a heading
  // under the heading over it, and a part runs to the next heading at its
  // level or over it.
  const headings = await db.block.findMany({ where: { documentId: doc.id, type: "HEADING" }, select: { id: true, html: true } });
  const depthById = new Map(headings.map((h) => [h.id, Number(/<h([1-6])/i.exec(h.html ?? "")?.[1] ?? 2)]));
  const contents = contentsOf(read.blocks, depthById);
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
    // What the lexical pass reads whatever the skeleton says: the opening,
    // the blocks the last answers cited, and the parts the message names
    // whole, to the budget.
    supplementPicks(read.blocks, blockIds, lexicalQuery(input.question, input.history), { depthById, cited: citedBlocks(input.history), budget: input.budget });
    return { pick: { blockIds, gist }, method: "skeleton", contents, total };
  }
  void refreshSkeleton(doc.id, input.userId).catch((err: unknown) => {
    console.warn("[assistant] skeleton refresh failed:", err);
  });
  const blockIds = lexicalPicks(read.blocks, lexicalQuery(input.question, input.history), { depthById, cited: citedBlocks(input.history), budget: input.budget });
  return { pick: { blockIds, gist }, method: "lexical", contents, total };
}

/** The blocks the assistant's last two answers cited: a follow-up asks
    about them ("and how did his way differ?"), so the message reads them
    again whatever words it uses. */
export function citedBlocks(history: Turn[]): string[] {
  return history
    .filter((t) => t.role === "assistant")
    .slice(-2)
    .flatMap((t) => [...t.content.matchAll(/\[block ([^\]\s]+)\]/g)].map((m) => m[1]));
}

/** The words the lexical pass ranks by: the message, and the reader's two
    messages before it (a follow-up names its subject by a pronoun). */
export function lexicalQuery(question: string, history: Turn[]): string {
  const earlier = history
    .filter((t) => t.role === "user" && t.content.trim())
    .slice(-2)
    .map((t) => t.content);
  return [...earlier, question].join("\n");
}

type Block = { id: string; type: string; text: string };

/** The document's contents as the prompt lists them: every heading with
    its block tag, indented two spaces per level under the shallowest
    heading, so a summary tells a chapter from its sections. */
export function contentsOf(blocks: Block[], depthById: Map<string, number>): string[] {
  const heads = blocks.filter((b) => b.type === "HEADING" && b.text.trim()).slice(0, CONTENTS_MAX);
  const depths = heads.map((b) => depthById.get(b.id) ?? 2);
  const top = Math.min(...depths, 6);
  return heads.map((b, i) => `${"  ".repeat(Math.max(0, depths[i] - top))}[block ${b.id}] ${b.text.trim().replace(/\s+/g, " ")}`);
}

/** A part of the document: its heading's index and the index its blocks
    end before. A numbered heading ("1.2 …", "Chapter 3") runs to the next
    numbered heading or a heading over it; any other heading runs to the
    next heading at its level or over it. */
export function partsOf(blocks: Block[], depthById: Map<string, number>): { start: number; end: number }[] {
  const heads = blocks.flatMap((b, k) => (b.type === "HEADING" ? [k] : []));
  const numberOf = (k: number) => HEADING_NUMBER_RE.exec(blocks[k].text.trim())?.[1] ?? null;
  // A bare label ("Chapter 1") with its title as the heading right after it
  // ("Discrete Probability Distributions") is one heading in two blocks, at
  // the title's depth: a book's chapter label is often set smaller than
  // the chapter's title.
  const isLabel = (k: number) => /^(?:chapter|part|section|appendix|unit|lecture|week)\s+\d+(?:\.\d+)*\.?$/i.test(blocks[k].text.trim());
  const depth = (k: number): number => {
    const next = blocks[k + 1];
    if (next && next.type === "HEADING" && isLabel(k) && numberOf(k + 1) === null) return depthById.get(next.id) ?? 2;
    return depthById.get(blocks[k].id) ?? 2;
  };
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
  if (number && (query.chapters.has(number) || (number.includes(".") && query.tokens.has(number)))) return true;
  // The label words of a numbered heading ("Chapter 1", "Section 1.2")
  // name nothing of their own: the number does.
  const words = tokenize(title).filter((w) => w.length >= 4 && !/^\d/.test(w) && !LABEL_WORDS.has(w));
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

const LABEL_WORDS = new Set(["chapter", "section", "part", "appendix", "unit", "lecture", "week"].map((w) => tokenize(w)[0] ?? w));

export function queryTerms(query: string, headings: string[]): QueryTerms {
  const tokens = new Set([...tokenize(query), ...(query.match(/\d+(?:\.\d+)+/g) ?? [])]);
  // "chapter 3", "chapters 1 and 2", "sections 1.2, 1.3 and 2.1": every
  // number after the label.
  const chapters = new Set<string>();
  for (const m of query.matchAll(/\b(?:chapters?|parts?|sections?|appendi(?:x|ces)|units?|lectures?|weeks?|ch\.?|secs?\.?)\s+(\d+(?:\.\d+)*(?:\s*(?:,|and|&|to|–|-)\s*\d+(?:\.\d+)*)*)/gi)) {
    for (const n of m[1].match(/\d+(?:\.\d+)*/g) ?? []) chapters.add(n);
  }
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
export function lexicalPicks(blocks: Block[], query: string, opts: { depthById?: Map<string, number>; budget?: number; cited?: string[] } = {}): Set<string> {
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
  // The blocks the last answers cited, with the block on either side.
  const index = new Map(blocks.map((b, k) => [b.id, k]));
  for (const id of opts.cited ?? []) {
    const k = index.get(id);
    if (k === undefined) continue;
    take(k);
    take(k - 1);
    take(k + 1);
  }
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
  // A message over the whole document, or over the parts it names ("summarize
  // chapters 1 and 2"): a sketch, every heading and the first block under it,
  // of the named parts, else of the document. Any other message that names a
  // part reads it whole ("each exercise of section 1.2") and no sketch.
  const message = query.split("\n").filter((l) => l.trim()).at(-1) ?? query;
  const overview = wantsOverview(message);
  const sketch = (from: number, to: number, limit: number) => {
    for (let k = from; k < to; k++) {
      if (blocks[k].type !== "HEADING") continue;
      if (!take(k, limit)) break;
      const next = blocks[k + 1];
      if (next && next.type !== "HEADING" && next.text.length <= SKETCH_BLOCK_MAX) take(k + 1, limit);
    }
  };
  for (const part of named) {
    if (overview) {
      sketch(part.start, part.end, Math.floor(budget * SKETCH_SHARE));
      continue;
    }
    if (spent + part.size > partsLimit) continue;
    for (let k = part.start; k < part.end; k++) take(k);
  }
  if (named.length === 0 && overview) sketch(0, blocks.length, Math.floor(budget * SKETCH_SHARE));
  const ranked = rank(
    blocks.map((b, k) => k),
    (k) => blocks[k].text,
    contentWords(query),
  ).filter((r) => r.score > 0);
  // The parts the query points at, whole (the named parts aside, which
  // are read already).
  if (named.length === 0) {
    const scoreOf = new Map(ranked.map((r) => [r.item, r.score]));
    const routed = routeParts(blocks, partsOf(blocks, opts.depthById ?? new Map()), scoreOf);
    const best = routed[0]?.score ?? 0;
    for (const part of routed.slice(0, ROUTE_PARTS)) {
      const size = blocks.slice(part.start, part.end).reduce((n, b) => n + (picked.has(b.id) ? 0 : b.text.length + 40), 0);
      if (part.score < best * ROUTE_MIN_SHARE || spent + size > partsLimit) continue;
      for (let k = part.start; k < part.end; k++) take(k);
    }
  }
  const inNamed = (k: number) => named.some((p) => k >= p.start && k < p.end);
  let outside = 0;
  for (const { item: k } of ranked.slice(0, LEXICAL_SEEDS)) {
    if (named.length > 0 && !inNamed(k) && ++outside > LEXICAL_SEEDS_OUTSIDE) continue;
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
    const between = blocks.slice(last + 1, k);
    const short = between.length <= BRIDGE_MAX || (between.length <= BRIDGE_MAX * 2 && between.reduce((n, b) => n + b.text.length, 0) <= BRIDGE_CHARS);
    if (last >= 0 && short && !between.some((b) => b.type === "HEADING")) {
      for (let j = last + 1; j < k; j++) take(j);
    }
    last = k;
  }
  return picked;
}

/** The skeleton's picks supplemented with what every reading holds: the
    opening, the blocks the last answers cited with their neighbours, and
    the parts the message names whole, each taken while the picks stay
    under the budget (the skeleton's picks were cut to it already, so a
    named part fits only where they left room). */
export function supplementPicks(blocks: Block[], picked: Set<string>, query: string, opts: { depthById?: Map<string, number>; budget?: number; cited?: string[] }): void {
  const budget = opts.budget ?? STITCH_SELECTED_BUDGET;
  let spent = blocks.reduce((n, b) => n + (picked.has(b.id) ? b.text.length + 40 : 0), 0);
  const take = (k: number): boolean => {
    const b = blocks[k];
    if (!b || picked.has(b.id)) return true;
    const cost = b.text.length + 40;
    if (spent + cost > budget * 1.25) return false;
    spent += cost;
    picked.add(b.id);
    return true;
  };
  withOpening(blocks, picked, (k) => take(k));
  const index = new Map(blocks.map((b, k) => [b.id, k]));
  for (const id of opts.cited ?? []) {
    const k = index.get(id);
    if (k === undefined) continue;
    take(k);
    take(k - 1);
    take(k + 1);
  }
  const terms = queryTerms(query, blocks.filter((b) => b.type === "HEADING").map((b) => b.text));
  const named = partsOf(blocks, opts.depthById ?? new Map())
    .filter((p) => namesHeading(blocks[p.start].text, terms))
    .map((p) => ({ ...p, size: blocks.slice(p.start, p.end).reduce((n, b) => n + (picked.has(b.id) ? 0 : b.text.length + 40), 0) }))
    .sort((a, b) => a.size - b.size);
  for (const part of named) {
    if (spent + part.size > budget * 1.25) continue;
    for (let k = part.start; k < part.end; k++) take(k);
  }
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
