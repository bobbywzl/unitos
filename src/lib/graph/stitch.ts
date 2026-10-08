import type { ModelMessage } from "ai";
import { z } from "zod";
import { matchInText } from "@/lib/anchors/match";
import { bumpNotebook } from "@/lib/collab";
import { db } from "@/lib/db";
import {
  SKELETON_BUILD_CONCURRENCY,
  STITCH_CUT_OVER,
  STITCH_EFFORT,
  STITCH_EXPAND_EFFORT,
  STITCH_EXPAND_MAX_OUTPUT_TOKENS,
  STITCH_EXPAND_WORDS,
  STITCH_GROUP_CONCURRENCY,
  STITCH_GROUPED_MAX,
  STITCH_HISTORY_FIRST_MIN,
  STITCH_HISTORY_MAX,
  STITCH_LINKS_SKELETON,
  STITCH_MAX_OUTPUT_TOKENS,
  STITCH_QUESTION_SKELETON,
  STITCH_READ_HISTORY,
  STITCH_READS_GENERATED,
  STITCH_REPLY_LANGUAGE,
  STITCH_ROUTE_EFFORT,
  STITCH_SELECT_EFFORT,
  STITCH_SELECT_MAX_OUTPUT_TOKENS,
  STITCH_SELECTED_BLOCKS,
  STITCH_SELECTED_BUDGET,
  STITCH_SKELETON_BUDGET,
  STITCH_SKELETON_GROUP,
  STITCH_WHOLE_THRESHOLD,
} from "@/lib/derive/config";
import { loadProfile, pageNames, renderBlockLines } from "@/lib/derive/context";
import { callForJson } from "@/lib/derive/json-call";
import type { Lang } from "@/lib/i18n/config";
import { translatorFor } from "@/lib/i18n/dictionaries";
import { featureCall } from "@/lib/feature-models";
import { attachDocument } from "@/lib/parse/attach";
import { parseMarkdown } from "@/lib/parse/markdown";
import { PARSER_VERSION, type ParsedBlock } from "@/lib/parse/types";
import { ensureSkeleton, readSkeleton, type Skeleton } from "@/lib/graph/skeleton";
import { projectLinks } from "@/lib/link-scope";
import { jevRouteParts, jevSelectLines } from "@/lib/graph/stitch-jev";
import { jevEnabled, mapLimit } from "@/lib/jev";
import { rank, tokenize } from "@/lib/graph/rank";
import {
  asksMore,
  refersBack,
  stitchExpandPrompt,
  stitchPrompt,
  stitchRoutePrompt,
  stitchRouteRules,
  stitchRules,
  stitchSelectPrompt,
  stitchSelectRules,
  type StitchDocumentCtx,
  type StitchNotPickedCtx,
} from "@/lib/prompts/stitch";
import { profileLines } from "@/lib/prompts/types";
import { estTokens } from "@/lib/tokens";
import type { StitchCommandKind, StitchDocument, StitchRecord, StitchResult } from "@/lib/types";
import { transcriptIsStale } from "@/lib/video/types";
import { COMMAND_CHAIN } from "@/lib/graph/generated-label";
import { ATTACH_ORDER } from "@/lib/document-order";

// Stitch (SPEC.md §22): one command over the project's documents, from the
// graph — the documents the reader selected in the graph, or every attached
// document when none is selected. The documents are read through their
// skeletons (lib/graph/skeleton.ts): one line per block at a tenth of the
// length, so the cost of finding the blocks a command needs scales with
// the skeletons, not the text. Every budget is in estimated tokens
// (lib/tokens.ts), so Chinese text costs what English text of the same
// tokens does. Up to three passes. The select pass reads every skeleton in
// one call — byte-identical from turn to turn for the same documents, so
// the prefix caches — and names the blocks the command needs. Past
// STITCH_SKELETON_BUDGET the lines are read in groups, one call each; a
// question instead reads the lines ranked against it (lib/graph/rank.ts),
// one call's worth. Past STITCH_GROUPED_MAX a route pass first reads only
// the documents' gists and part summaries and names the parts, the select
// pass reads those parts' lines, ranked and cut when they still run past.
// The answer pass reads the picked blocks' real text, in document order
// with the gaps declared, cut to the budget of the command's kind
// (commandKind: a question reads a third of what a page reads), and
// answers in the reply, with links, a generated document, or a mix.
// Documents under STITCH_WHOLE_THRESHOLD together skip the reading passes:
// the answer pass reads them whole. Each pass's system message opens with
// its rules and the reader context, which do not change from command to
// command, so the prefix caches; the command comes last.
// A follow-up reads the conversation: the history's block tags are
// rewritten from the stored ids back to this reading's aliases
// (stitchHistory), the answer pass reads the turns, and the reading passes
// read the reader's last commands and the blocks the earlier answers
// cited, so "the second one" finds what it names.
// With Jev configured (lib/jev.ts, TYPESAFE_API_KEY) the route and select
// passes are Jev's (lib/graph/stitch-jev.ts): one calibrated yes/no per
// part and per skeleton line, every line of every document read getting
// its own decision, in small parallel calls. A Jev pass that fails falls
// back to the GLM pass below, so the command always runs.
// The model reads and writes short block aliases, never the stored ids: the
// document's letter and the block's number in it (A1, B12), so a pick of 400
// blocks is a few hundred tokens rather than thousands, a range (B10-B15)
// names consecutive blocks at once, and an alias is copied right far more
// often than a 25-character id. Every alias resolves to the stored block
// here, and the reply's [block …] tags are rewritten to the stored ids
// before the reply leaves.
// A video or audio document reads as its transcript lines and a handwritten
// document as its converted text; a document with nothing to read is
// declared as such to the model, with the reason. The result says what was
// read of every document (StitchDocument), so the reader sees which
// documents the answer rests on and why one was not read. With fewer than
// two documents read the command does not run.
// Every block alias and every quote resolves against the real block text
// before anything is stored: a quote the model did not copy verbatim falls
// back to its whole block, and an alias that names no block drops. Links land
// as recommended links — the reader approves everything (SPEC.md §1). A
// generated document is a real document of the project
// (Document.generatedCommand), every quote part a verbatim passage of a
// document read, every part linked back to the block it came from.

const MAX_SELECTED = 400; // blocks the select pass may name
const MAX_ROUTED = 80; // parts the route pass may name
const MAX_LINKS = 24;
const MAX_PARTS = 200;
const SELECT_GROUP_MIN = 20; // ids a select call of many groups may still name (groupMaxBlocks)
// Past this many documents read, the answer pass's lists are short
// (COST5-04): the documents with no block shown are a count and the titles
// that hold a word of the command, and a document with GIST_MIN_SHOWN - 1
// or fewer blocks shown has no gist line.
const SHORT_LISTS_PAST = 20;
const GIST_MIN_SHOWN = 4;
const NOT_SHOWN_NAMED = 8; // documents the "No block shown" line names past SHORT_LISTS_PAST
const MAX_CITED = 40; // blocks of the earlier answers the reading passes are told of
const CITED_TEXT = 600; // chars of a cited block's text in the result
const BACK_BUDGET = 6_000; // tokens of cited blocks a follow-up reads with no select pass (backSelection)

// The answer's limits cut what runs over instead of failing it: one field
// over its limit would otherwise fail validation and re-run the whole
// answer pass (lib/derive/json-call.ts). The prompt states each limit.
const cut = (max: number) => z.string().transform((s) => s.slice(0, max));
const quote = cut(2_000).optional();
const sourceSchema = z.object({ blockId: z.string().min(1), quote });
const partSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("heading"), text: z.string().min(1).transform((s) => s.slice(0, 300)) }),
  z.object({ kind: z.literal("quote"), blockId: z.string().min(1), quote }),
  z.object({
    kind: z.literal("text"),
    markdown: z.string().min(1).transform((s) => s.slice(0, 20_000)),
    sources: z
      .array(sourceSchema)
      .default([])
      .transform((a) => a.slice(0, 8)),
  }),
]);
const selectSchema = z.object({
  blockIds: z.array(z.string().min(1)).max(MAX_SELECTED * 2).default([]),
});
const routeSchema = z.object({
  parts: z.array(z.string().min(1)).max(MAX_ROUTED * 2).default([]),
});
const outputSchema = z.object({
  reply: cut(4_000).default(""),
  links: z
    .array(
      z.object({
        fromBlockId: z.string().min(1),
        fromQuote: quote,
        toBlockId: z.string().min(1),
        toQuote: quote,
        reason: z.string().min(1).transform((s) => s.slice(0, 600)),
      }),
    )
    .default([])
    .transform((a) => a.slice(0, 48)),
  document: z
    .object({
      title: z.string().min(1).transform((s) => s.slice(0, 200)),
      parts: z
        .array(partSchema)
        .transform((a) => a.slice(0, 400)),
    })
    .nullable()
    .default(null),
});

/** The reason stitch() fails with when the model wrote no reply and stored
    nothing: the route says so in the reader's language. */
export const STITCH_EMPTY_ANSWER = "empty answer";

/** What the command asks for, which sets what the answer pass reads after
    selection (STITCH_SELECTED_BUDGET) and how the reading passes read: a
    page, links, or else an answer. A page is asked by a page verb at the
    start, after a polite opening ("could you", "I want you to", 请, 帮我):
    gather, collect, write, list every …, make a timeline, put them
    together, turn these into …, "give me a page …", 汇集, 整理成, 列出所有;
    or by a page noun anywhere (a page, a timeline, study guide, every
    passage). A bare noun (the timeline in my notes, 第一页, 页面) is not. A
    summary or an overview is an answer in the reply unless it asks for a
    page; the answer prompt routes it the same way (stitchRules);
    links by a contradiction word (contradict, disagree, 矛盾, 不一致,
    意见不同), or a command to draw links (connect …, find connections,
    conflicts between); anything else is a question — so
    "what did he write about pity" and "how does he link X and Y" stay
    questions. A rule, not a model call: the kind is needed before the
    select pass runs — a question's select pass may read the lines ranked
    against it — and on the whole read, which has no select pass; it costs
    nothing and reads the same every time. A command the rule misses reads
    as a question, whose budget still holds about 60,000 characters of the
    blocks picked. */
export function commandKind(command: string): StitchCommandKind {
  const c = command.toLowerCase().trim().replace(/[‘’]/g, "'");
  // A polite opening before the verb: "could you gather", "I want you to
  // write", "please list".
  const lead =
    String.raw`^(?:(?:please|now|then|ok(?:ay)?|so)[,\s]+|(?:can|could|would|will) you\s+(?:please\s+)?|i(?: would|'d)? (?:want|need|like) you to\s+|help me\s+)*`;
  // Verbs that ask for a page on their own, write and draft unless they
  // write an answer ("write a short answer: …" is a question); list only
  // with every, all, or each ("list every claim"; "list the three reasons" is a question).
  // make, create, build, put, and turn only with what they make: "make a
  // timeline", "put them together", "turn these into a page" — never "make
  // sense of", "put simply", "turn to", "build an argument".
  const pageVerb = new RegExp(
    lead +
      String.raw`(?:(?:gather|collect|compile|combine)\b|(?:write|draft)\b(?!\s+(?:me\s+)?(?:(?:a|an|one|your)\s+)?(?:(?:short|brief|quick|simple)\s+)?(?:answer|reply|response)\b)|list\b.*\b(?:every|all|each)\b|give me (?:a|an|one) (?:page|timeline|list|table|study guide)\b|(?:make|create|build|draw up|produce|prepare) (?:me )?(?:a|an|one|the|that|this|it)?\s*(?:[\w-]+\s+){0,2}?(?:page|timeline|list|table|study guide|cheat sheet|chronology|glossary|reading list)\b|put (?:(?:them|these|those|it|this|that)(?: [\w-]+)?|all (?:the )?[\w-]+|every [\w-]+|the [\w-]+(?: [\w-]+)?) (?:together|into|in one|on one)\b|turn (?:(?:it|this|that|these|them|those)(?: [\w-]+)?|the [\w-]+(?: [\w-]+)?) into\b)`,
  );
  // Nouns that ask for a page anywhere; a timeline only as a thing to make
  // ("a timeline"), never "the timeline in my notes".
  const pageNoun =
    /\b(one page|a page|new page|into (one|a) page|that a page|it a page|(a|one) timeline|study guide|every passage|all (the )?passages|cheat sheet)\b/;
  // Chinese: the page verb opens the command (after a polite opening or a
  // 把 object), as in English; 列出 only with 所有, 每, 各, or 全部; 整理
  // (一下) only with what it gathers: 段落, 引文, 内容, 说法.
  const zhLead = "^(?:请|帮我|帮忙|麻烦你?|你能|你可以|能不能|能否|可以|可不可以)*";
  const zhVerb = new RegExp(`${zhLead}(?:把.{1,30}?)?(?:汇集|收集|汇总|整理成|整理出|整理(?:一下|好)?.{0,20}?(?:段落|引文|内容|说法)|写成|写一页|写一篇|做成|合并成|生成|列出.*(?:所有|每|各|全部))`);
  const zhNoun = /一页纸|新页面|成一页|做成页面|(给我|做|画|列|写)(一个|一条|一份)?时间线|时间线页面|学习指南|所有段落|每一段/;
  if (pageVerb.test(c) || pageNoun.test(c) || zhVerb.test(c) || zhNoun.test(c)) return "page";
  const links = new RegExp(
    String.raw`\b(contradict\w*|disagree\w*|inconsisten\w*)\b|` +
      lead +
      String.raw`(connect|link|draw|propose)\b|\b(draw|propose|find|add|make)\s+(the\s+|some\s+)?(links?|connections?)\b|\bconflict\w* between\b`,
  );
  if (links.test(c) || /矛盾|冲突|分歧|不一致|意见不同|看法不同|相反|连接|关联/.test(c)) return "links";
  return "question";
}

// Words of a command that are never a name, though capitalised.
const NAME_STOP = new Set(
  "what which who whom whose when where why how does did do is are was were has have had the a an and or of in on to for from with about i my me we our you your he his she her they their it its this that these those quote list compare gather collect write make find show tell give please can could would will should".split(" "),
);
const NAME_HITS_MAX = 8; // a name in more blocks than this (or a quarter of the documents) is common: the select pass finds it in the lines
const NAME_TERMS_MAX = 6;

/** The rare names of a command: its capitalised words after the first
    word (Darwin, Parsifal; Nietzsche's is Nietzsche), and its quoted
    phrases ("eternal recurrence", 《敌基督》). Question words and the
    like drop. */
export function commandNames(command: string): string[] {
  const out = new Set<string>();
  for (const m of command.matchAll(/["“«《「『]([^"“”«»《》「」『』]{2,60})["”»》」』]/g)) {
    const t = m[1].trim();
    if (t.length >= 3 || /[㐀-鿿]{2}/.test(t)) out.add(t);
  }
  // A run of capitalised words is one name (New Testament), its question
  // words and articles dropped; the command's first word only when the
  // run goes on past it.
  const first = command.search(/\p{L}/u);
  for (const m of command.matchAll(/(?<![\p{L}\p{N}])\p{Lu}[\p{L}\p{N}-]{2,}(?:\s+\p{Lu}[\p{L}\p{N}-]{2,})*/gu)) {
    let words = m[0].split(/\s+/);
    if (m.index === first) words = words.slice(1);
    words = words.filter((w) => !NAME_STOP.has(w.toLowerCase()));
    if (words.length > 0) out.add(words.join(" "));
  }
  return [...out].slice(0, NAME_TERMS_MAX);
}

/** The blocks whose full text names each of the command's rare names
    (commandNames): a word-start match, any case, so Darwin finds
    Darwinian. A name kept only when 1 to NAME_HITS_MAX blocks name it.
    A skeleton line keeps at most 40 words of a block, so a name deep in a
    long block can be missing from its line: the select pass is told
    which blocks name it (ANS3-01). A term in a title of a document read
    (titles) names the document, not a topic, and drops: "Beyond Good" of
    "Beyond Good and Evil" is not a rare name (ANS4-06). */
export function nameHits(
  command: string,
  blocks: { alias: string; text: string }[],
  titles: string[] = [],
): { term: string; aliases: string[] }[] {
  const out: { term: string; aliases: string[] }[] = [];
  const titled = titles.map((t) => t.toLowerCase());
  // More documents, more blocks a rare name can be in (ANS5-09): 9 of 36
  // documents' blocks name Darwin.
  const max = Math.max(NAME_HITS_MAX, Math.ceil(titles.length / 4));
  for (const term of commandNames(command)) {
    if (titled.some((t) => t.includes(term.toLowerCase()))) continue;
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const rx = /^[\p{L}\p{N}]/u.test(term) && !/[㐀-鿿]/.test(term) ? new RegExp(`(?<![\\p{L}\\p{N}])${escaped}`, "iu") : new RegExp(escaped, "iu");
    const aliases: string[] = [];
    for (const b of blocks) {
      if (!rx.test(b.text)) continue;
      aliases.push(b.alias);
      if (aliases.length > max) break;
    }
    if (aliases.length >= 1 && aliases.length <= max) out.push({ term, aliases });
  }
  return out;
}

/** One turn of the conversation as the box sends it; an assistant turn may
    carry its record (StitchResult.record): what it stored. */
export type StitchTurn = { role: "user" | "assistant"; content: string; record?: StitchRecord };

/** One readable block of a doc: its stored id, and the alias the model
    reads it under (the document's letter and the block's number, B12). */
type DocBlock = { id: string; alias: string; type: string; text: string; documentId: string };

type Resolved = {
  blockId: string;
  documentId: string;
  startOffset: number;
  endOffset: number;
  quotedText: string;
  prefix: string;
  suffix: string;
};

function resolvedAt(block: DocBlock, start: number, end: number): Resolved {
  return {
    blockId: block.id,
    documentId: block.documentId,
    startOffset: start,
    endOffset: end,
    quotedText: block.text.slice(start, end),
    prefix: block.text.slice(Math.max(0, start - 32), start),
    suffix: block.text.slice(end, end + 32),
  };
}

// The quote in this block: exact first, then the whitespace-tolerant match.
function findIn(block: DocBlock, text: string): Resolved | null {
  const at = block.text.indexOf(text);
  const hit =
    at !== -1
      ? { start: at, end: at + text.length }
      : matchInText(block.text, { quotedText: text, prefix: "", suffix: "" });
  if (!hit || hit.end <= hit.start) return null;
  return resolvedAt(block, hit.start, hit.end);
}

// The words of a text, for the sentence window: Latin words and numbers,
// and each CJK character on its own.
const spanWords = (s: string) => s.toLowerCase().match(/[㐀-鿿]|[\p{L}\p{N}]+/gu) ?? [];

/** The shortest window of 1 to 4 sentences of the text that holds at least
    60% of the quote's words and is at most 2.5 times the quote's length:
    where a quote the model did not copy exactly comes from (ANS4-05).
    Null when no window does. */
export function sentenceWindow(text: string, wanted: string): { start: number; end: number } | null {
  const want = new Set(spanWords(wanted));
  if (want.size === 0) return null;
  const sentences = [...text.matchAll(/[^.!?。！？]+(?:[.!?。！？]+|$)["'”’)\]）」』]*\s*/g)].map((m) => ({
    start: m.index + (m[0].length - m[0].trimStart().length),
    end: m.index + m[0].trimEnd().length,
    words: spanWords(m[0]),
  }));
  let best: { start: number; end: number; score: number } | null = null;
  for (let i = 0; i < sentences.length; i++) {
    const got = new Set<string>();
    for (let j = i; j < Math.min(sentences.length, i + 4); j++) {
      for (const w of sentences[j].words) if (want.has(w)) got.add(w);
      const score = got.size / want.size;
      const start = sentences[i].start;
      const len = sentences[j].end - start;
      if (len > wanted.length * 2.5) break;
      if (score >= 0.6 && (!best || len < best.end - best.start || (len === best.end - best.start && score > best.score))) {
        best = { start, end: sentences[j].end, score };
      }
    }
  }
  return best && best.end > best.start ? { start: best.start, end: best.end } : null;
}

/** A quote against the blocks: in the named block first; then, when the
    model named the wrong block, exact in any block; then the shortest
    window of the named block's sentences that holds most of the quote's
    words (sentenceWindow); then the named block whole — a quote that was
    not copied verbatim still points at real text.
    No quote is the named block whole. Null when the alias names no block.
    blockByRef: every block under its alias (lib/graph/stitch.ts documentLetter)
    and under its stored id, so either form the model writes resolves. */
export function resolveQuote(
  blockByRef: Map<string, DocBlock>,
  blockId: string,
  text: string | undefined,
): Resolved | null {
  const ref = blockId.trim();
  const named = blockByRef.get(ref) ?? blockByRef.get(ref.toUpperCase());
  if (!named) return null;
  const wanted = text?.trim() ?? "";
  if (!wanted || !named.text.trim()) return resolvedAt(named, 0, named.text.length);
  const inNamed = findIn(named, wanted);
  if (inNamed) return inNamed;
  if (wanted.length >= 20) {
    for (const block of blockByRef.values()) {
      const at = block.text.indexOf(wanted);
      if (at !== -1) return resolvedAt(block, at, at + wanted.length);
    }
  }
  const window = sentenceWindow(named.text, wanted);
  if (window) return resolvedAt(named, window.start, window.end);
  return resolvedAt(named, 0, named.text.length);
}

/** The documents Stitch reads, with their blocks, and the state of each
    document's transcript or conversion: the attached documents of the
    project, in attach order — the ones named by documentIds when given,
    every one otherwise. An id that names no attached document is
    skipped. generated: false leaves the generated documents out of the
    every-document read (STITCH_READS_GENERATED); a named one is read. */
export async function loadDocuments(
  notebookId: string,
  documentIds: string[] | null,
  options: { generated?: boolean } = {},
) {
  const rows = await db.notebookDocument.findMany({
    where: {
      notebookId,
      ...(documentIds ? { documentId: { in: documentIds } } : {}),
      ...(!documentIds && options.generated === false ? { document: { generatedCommand: null } } : {}),
    },
    // The id breaks a tie of two documents added in one millisecond, so
    // the letters, the aliases, and the cached prefix stay the same.
    orderBy: ATTACH_ORDER,
    include: {
      document: {
        select: {
          id: true,
          title: true,
          generatedCommand: true,
          skeleton: true,
          handwritten: true,
          importRev: true,
          pageLabels: true,
          conversionStatus: true,
          conversionError: true,
          video: {
            select: {
              mimeType: true,
              transcriptStatus: true,
              transcriptError: true,
              transcriptStartedAt: true,
            },
          },
          blocks: {
            orderBy: { order: "asc" },
            select: { id: true, type: true, text: true, startTime: true, endTime: true, cell: true, page: true },
          },
        },
      },
    },
  });
  return rows.map((r) => r.document);
}

type Doc = Awaited<ReturnType<typeof loadDocuments>>[number];

/** The document's letter, by its place among the documents read: A to Z, then AA,
    AB, … — the document tag the model reads, and the first part of every
    block alias of the doc. */
export function documentLetter(index: number): string {
  let n = index;
  let letters = "";
  do {
    letters = String.fromCharCode(65 + (n % 26)) + letters;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return letters;
}

// The blocks of a document the model can read: blocks with text. The VIDEO
// block holds the title and a PAGE block its page number — neither is
// content — so a video or audio document reads as its transcript lines and a
// handwritten document as its converted text.
function readableBlocks(doc: Doc): Doc["blocks"] {
  return doc.blocks.filter(
    (b) => b.type !== "VIDEO" && b.type !== "PAGE" && b.text.trim().length > 0,
  );
}

/** The document's readable blocks under their aliases, in reading order. */
function docBlocks(doc: Doc, letter: string): DocBlock[] {
  return readableBlocks(doc).map((b, i) => ({
    id: b.id,
    alias: `${letter}${i + 1}`,
    type: b.type,
    text: b.text,
    documentId: doc.id,
  }));
}

function docKind(doc: Doc): StitchDocument["kind"] {
  if (doc.video) return doc.video.mimeType?.startsWith("audio/") ? "audio" : "video";
  return doc.handwritten ? "handwritten" : "text";
}

// Why a document has nothing to read: its transcript or its conversion has
// not landed, or the document holds no text. detail is the stored error.
function emptyReason(doc: Doc): Pick<StitchDocument, "reason" | "detail"> {
  if (doc.video) {
    switch (doc.video.transcriptStatus) {
      case "PENDING":
        return {
          reason: transcriptIsStale("PENDING", doc.video.transcriptStartedAt)
            ? "transcriptStale"
            : "transcriptPending",
          detail: null,
        };
      case "FAILED":
        return { reason: "transcriptFailed", detail: doc.video.transcriptError };
      case "NONE":
        return { reason: "transcriptNone", detail: null };
      case "READY":
        return { reason: "noText", detail: null };
    }
  }
  if (doc.handwritten) {
    switch (doc.conversionStatus) {
      case "PENDING":
        return { reason: "conversionPending", detail: null };
      case "FAILED":
        return { reason: "conversionFailed", detail: doc.conversionError };
      case "READY":
        return { reason: "noText", detail: null };
      case "NONE":
      case "OFF":
        return { reason: "conversionNone", detail: null };
    }
  }
  return { reason: "noText", detail: null };
}

// The reason as the model reads it, in the system message and the prompt.
const EMPTY_NOTE: Record<NonNullable<StitchDocument["reason"]>, string> = {
  transcriptPending: "its transcript is still being written",
  transcriptStale: "its last transcription run did not finish",
  transcriptFailed: "its transcription failed",
  transcriptNone: "it has no transcript yet",
  conversionPending: "its conversion to text is still running",
  conversionFailed: "its conversion to text failed",
  conversionNone: "it is handwritten and not converted to text yet",
  noText: "it holds no text",
};

const UNIT: Record<StitchDocument["kind"], string> = {
  text: "blocks",
  video: "transcript lines",
  audio: "transcript lines",
  handwritten: "converted blocks",
};

/** One document's coverage as its header states it beside the document's
    title: its kind and its blocks, or why it has nothing to read. shown:
    how many of its blocks the answer pass sees after selection. */
export function coverageNote(m: StitchDocument, shown?: number): string {
  switch (m.status) {
    case "read":
      return shown === undefined
        ? `${m.kind}, ${m.blocks} ${UNIT[m.kind]}`
        : `${m.kind}, ${shown} of ${m.blocks} ${UNIT[m.kind]} shown`;
    case "empty":
      return `${m.kind}, nothing to read: ${EMPTY_NOTE[m.reason ?? "noText"]}`;
  }
}

const CONTEXT_HEAD = [
  "Each document starts with its letter as [document <letter>] and its title, and its header says what of it is here; each block starts with its alias as [block <alias>]: the document's letter and the block's number in it, in reading order (A1, A2, B1). Aliases are unique across all documents. Reference blocks by alias exactly as given.",
  "A video or audio document is its transcript: every line is a TRANSCRIPT block tagged with its seconds. A document marked (… nothing to read: …) has no text here: never cite it and never guess what it says.",
];

type Profile = Awaited<ReturnType<typeof loadProfile>>;

/** A pass's system message: the pass's rules and the reader context first —
    the same bytes for every command of a project, so the prefix caches —
    then how the documents are tagged, then the documents. */
function systemOf(rules: string, profile: Profile, intro: string, sections: string): string {
  return [
    "You assist a reader working across the documents of a project.",
    rules,
    "",
    profileLines(profile),
    "",
    ...CONTEXT_HEAD,
    "",
    intro,
    "",
    sections,
  ].join("\n");
}

/** A pass's system message as sent: a provider that caches only on a hint
    (Anthropic) caches it too; the others cache prefixes on their own and
    ignore the hint. */
function systemMessage(content: string): ModelMessage {
  return { role: "system", content, providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } } };
}

// A generated document says so in its header: its blocks are copies of the
// other documents' blocks, and the answer cites the original.
function header(letter: string, doc: Doc, note: string): string {
  return `[document ${letter}] "${doc.title}" (${doc.generatedCommand !== null ? "a page Stitch generated; " : ""}${note})`;
}

/** One document's readable blocks as the model reads them: the stored block
    lines under their aliases. */
function aliasedLines(blocks: DocBlock[], doc: Doc): string {
  const stored = new Map(doc.blocks.map((b) => [b.id, b]));
  return renderBlockLines(
    blocks.flatMap((b) => {
      const row = stored.get(b.id);
      return row ? [{ ...row, id: b.alias }] : [];
    }),
    pageNames(doc),
  );
}

/** One document read: its letter, its blocks under their
    aliases, what went into its rendering (coverage), and the rendering
    itself — the document whole, cut at a block boundary past the document's
    budget, or declared with the reason it has nothing to read. The
    rendering is byte-identical from turn to turn, so the select pass's
    prefix caches per doc. */
type Rendered = {
  letter: string;
  doc: Doc;
  blocks: DocBlock[];
  coverage: StitchDocument;
  section: string;
  tokens: number; // the rendering's estimated tokens
};

function renderDocument(doc: Doc, index: number): Rendered {
  const letter = documentLetter(index);
  const kind = docKind(doc);
  const blocks = docBlocks(doc, letter);
  const base = { id: doc.id, title: doc.title, kind, total: blocks.length };
  if (blocks.length === 0) {
    const coverage: StitchDocument = { ...base, status: "empty", blocks: 0, shown: null, ...emptyReason(doc) };
    const section = header(letter, doc, coverageNote(coverage));
    return { letter, doc, blocks, coverage, section, tokens: estTokens(section) };
  }
  const coverage: StitchDocument = { ...base, status: "read", blocks: blocks.length, shown: null, reason: null, detail: null };
  const section = `${header(letter, doc, coverageNote(coverage))}\n${aliasedLines(blocks, doc)}`;
  return { letter, doc, blocks, coverage, section, tokens: estTokens(section) };
}

/** Every document rendered, in order. length: the chars of document text;
    tokens: its estimated tokens (lib/tokens.ts). */
function renderDocuments(docs: Doc[]): { rendered: Rendered[]; length: number; tokens: number } {
  const rendered = docs.map((doc, index) => renderDocument(doc, index));
  return {
    rendered,
    length: rendered.reduce((sum, r) => sum + r.section.length, 0),
    tokens: rendered.reduce((sum, r) => sum + r.tokens, 0),
  };
}

// "(3 blocks not shown)", "(1 block not shown)".
const notShown = (n: number, unit: "block" | "line") => `(${n} ${unit}${n === 1 ? "" : "s"} not shown)`;

// The document's gist under its header (ANS4-07): what a document titled
// "BOOK TWO" or "chapter3.pdf" is. Empty when it has no skeleton yet.
function gistLine(r: Rendered, gists: Map<string, string>): string {
  const gist = gists.get(r.doc.id)?.replace(/\s+/g, " ").trim();
  return gist ? `\ngist: ${gist}` : "";
}

// A document read whole, its gist under its header.
function wholeSection(r: Rendered, gists: Map<string, string>): string {
  const gist = r.coverage.status === "read" ? gistLine(r, gists) : "";
  if (!gist) return r.section;
  const at = r.section.indexOf("\n");
  return at === -1 ? `${r.section}${gist}` : `${r.section.slice(0, at)}${gist}${r.section.slice(at)}`;
}

/** The selected blocks: every document something of is shown, in order,
    its header saying how many of its blocks are shown, the blocks in
    reading order, a gap between two shown blocks declared. A partly shown
    document that a pick of it and the shortest other document would read
    whole says so in its header ("read whole when picked"), so the reply's
    partial-read sentence gives advice that works. A document with nothing
    to read is declared with its reason, as in the whole rendering; the
    documents none of whose blocks were picked share one line at the end.
    Past SHORT_LISTS_PAST documents (COST5-04) that line is their count and
    up to NOT_SHOWN_NAMED of the ones whose title or gist holds a word of
    the command (titleMatches), and a gist goes only under a document with
    GIST_MIN_SHOWN blocks shown or more, or whose title or gist holds a word
    of the command: a document of one to three blocks shown, off the
    command's words, is read from its blocks. */
function selectedSections(
  rendered: Rendered[],
  selected: Set<string>,
  gists: Map<string, string> = new Map(),
  command = "",
  words?: string[],
): string {
  const sections: string[] = [];
  const none: Rendered[] = [];
  const read = rendered.filter((r) => r.coverage.status === "read");
  const short = rendered.length > SHORT_LISTS_PAST;
  const gistFirst = new Map<string, string>();
  for (const r of rendered) {
    if (r.coverage.status === "empty") {
      sections.push(r.section);
      continue;
    }
    const shown = r.blocks.filter((b) => selected.has(b.alias));
    if (shown.length === 0) {
      none.push(r);
      continue;
    }
    const shortest = Math.min(Infinity, ...read.filter((x) => x !== r).map((x) => x.tokens));
    const whole = shown.length < r.blocks.length && r.tokens + shortest <= STITCH_WHOLE_THRESHOLD;
    let gist = short && shown.length < GIST_MIN_SHOWN && titleMatches([r], command, gists, words).length === 0 ? "" : gistLine(r, gists);
    // The parts of one long work share one gist: past the first, the line
    // names the document it is the same as (ANS6-01: I-4's 18 gists).
    const first = gist ? gistFirst.get(gist) : undefined;
    if (first) gist = `\ngist: as [document ${first}]`;
    else if (gist) gistFirst.set(gist, r.letter);
    const head = `${header(r.letter, r.doc, `${coverageNote(r.coverage, shown.length)}${whole ? "; read whole when picked with one short document" : ""}`)}${gist}`;
    const lines: string[] = [];
    let last = -1;
    for (const block of shown) {
      const at = r.blocks.indexOf(block);
      // The heading a block falls under, when the heading is in the gap
      // before it, not shown (ANS5-07): stratagem XXVII's body says it is XXVII.
      let head = at - 1;
      while (head > last && r.blocks[head].type !== "HEADING") head--;
      const under = head > last && block.type !== "HEADING" ? `under the heading "${r.blocks[head].text.replace(/\s+/g, " ").trim().slice(0, 80)}"` : "";
      if (last !== -1 && at - last > 1) lines.push(under ? `${notShown(at - last - 1, "block").slice(0, -1)}; ${under})` : notShown(at - last - 1, "block"));
      else if (last === -1 && under) lines.push(`(${under})`);
      lines.push(aliasedLines([block], r.doc));
      last = at;
    }
    sections.push(`${head}\n${lines.join("\n\n")}`);
  }
  const named = (list: Rendered[]) => list.map((r) => `"${r.doc.title}" (${r.coverage.blocks} ${UNIT[r.coverage.kind]})`).join(", ");
  if (none.length > 0 && !short) sections.push(`No block shown for this command: ${named(none)}.`);
  else if (none.length > 0) {
    const matching = titleMatches(none, command, gists, words);
    const more = matching.length > NOT_SHOWN_NAMED ? ` and ${matching.length - NOT_SHOWN_NAMED} more` : "";
    sections.push(
      `No block shown for this command: ${none.length} ${none.length === 1 ? "document" : "documents"}` +
        (matching.length > 0
          ? `; the ones whose title or gist holds a word of the command: ${named(matching.slice(0, NOT_SHOWN_NAMED))}${more}.`
          : `, none whose title or gist holds a word of the command.`),
    );
  }
  return sections.join("\n\n");
}

// Words of a command that never make a title match (titleMatches).
const TITLE_STOP = new Set([..."all any every each more most other some such than then there into over only also not no yes say says said document documents project passage passages text texts part parts art work works".split(" "), ...NAME_STOP]);

/** The documents whose title or gist holds a word of the command (ANS6-01):
    a Latin word of three letters or more that is not a question word or
    the like, or two CJK characters in a row (the ranker's tokens,
    lib/graph/rank.ts). gists: the documents' gists by document id. words:
    the expansion's words (Reading.words), matched too when the command is
    in CJK: a Chinese command shares no word with English titles. */
export function titleMatches<T extends { doc: { id?: string; title: string } }>(
  docs: T[],
  command: string,
  gists?: Map<string, string>,
  words?: string[],
): T[] {
  const cjk = /[㐀-鿿]/.test(command);
  const wanted = new Set(
    tokenize([command, ...(cjk ? (words ?? []) : [])].join("\n")).filter((t) =>
      /[^\x00-\u024f]/.test(t) ? [...t].length >= 2 : t.length >= 3 && !TITLE_STOP.has(t),
    ),
  );
  if (wanted.size === 0) return [];
  return docs.filter((d) => tokenize(`${d.doc.title}\n${(d.doc.id && gists?.get(d.doc.id)) || ""}`).some((t) => wanted.has(t)));
}

/** The documents of the project a pick left out (ANS6-02), for the answer
    pass's line: their count, and every title up to NOT_SHOWN_NAMED, else up
    to NOT_SHOWN_NAMED of the ones whose title or gist holds a word of the
    command (titleMatches). Generated documents are left out, as in an
    every-document read. One light query: titles and stored gists only. */
export async function notPickedOf(notebookId: string, picked: string[], command: string, words?: string[]): Promise<StitchNotPickedCtx> {
  const rows = await db.$queryRaw<{ id: string; title: string; gist: string | null }[]>`
    SELECT d."id", d."title", d."skeleton"->>'gist' AS "gist"
    FROM "NotebookDocument" nd JOIN "Document" d ON d."id" = nd."documentId"
    WHERE nd."notebookId" = ${notebookId} AND d."generatedCommand" IS NULL AND NOT (d."id" = ANY(${picked}))
    ORDER BY d."createdAt" ASC, d."id" ASC`;
  const docs = rows.map((r) => ({ doc: { id: r.id, title: r.title } }));
  const gists = new Map(rows.flatMap((r) => (r.gist ? [[r.id, r.gist] as [string, string]] : [])));
  const named = docs.length <= NOT_SHOWN_NAMED ? docs : titleMatches(docs, command, gists, words).slice(0, NOT_SHOWN_NAMED);
  return { count: rows.length, titles: named.map((d) => d.doc.title) };
}

/** The answer pass's messages: the system message (the rules, the reader
    context, then the documents whole or the blocks selected), the turns so
    far, and the command. selected: the aliases the reading passes picked,
    or null for the whole read. links: the links already in the project
    between the documents read, as aliases; the prompt lists the ones whose
    two blocks are both shown (ANS4-01). */
export function answerMessages(input: {
  reading: Reading;
  selected: Set<string> | null;
  lang: Lang;
  profile: Profile;
  history: ModelMessage[];
  command: string;
  // The command's rare names (nameHits), counted against the blocks shown.
  names?: { term: string; aliases: string[] }[];
  // True when selected is the blocks the earlier answers cited
  // (backSelection): no read ran for this command.
  back?: boolean;
  links?: { from: string; to: string; state?: ExistingState }[];
  // The history's tokens past which it comes before the blocks
  // (STITCH_HISTORY_FIRST_MIN).
  historyFirstMin?: number;
  // The documents of the project a pick left out (notPickedOf).
  notPicked?: StitchNotPickedCtx;
}): ModelMessage[] {
  const { rendered, documentList, gists } = input.reading;
  const selected = input.selected;
  const rules = stitchRules(input.lang);
  const shownBlock = (alias: string) => (selected ? selected.has(alias) : input.reading.blockByRef.has(alias));
  const prompt = stitchPrompt({
    documents: documentList,
    command: input.command,
    continued: input.history.length > 0,
    selected: selected !== null,
    back: selected !== null && input.back === true,
    names: selected
      ? (input.names ?? []).map((n) => ({ term: n.term, total: n.aliases.length, shown: n.aliases.filter((a) => selected.has(a)).length }))
      : undefined,
    existing: existingPairs(input.links ?? [], shownBlock),
    notPicked: input.notPicked,
  });
  // The blocks picked change every command, so behind them nothing caches:
  // past STITCH_HISTORY_FIRST_MIN tokens of history the conversation comes
  // before them, and turn t reads turn t-1's history from the cache
  // (COST4-01). The documents read whole stay in the system message: they
  // are the same every command.
  const historyTokens = input.history.reduce((sum, m) => sum + estTokens(textOf(m)), 0);
  if (selected && historyTokens >= (input.historyFirstMin ?? STITCH_HISTORY_FIRST_MIN)) {
    return [
      systemMessage(systemOf(rules, input.profile, "The blocks a first read picked for the command are in the reader's last message.", "")),
      ...input.history,
      { role: "user", content: `${selectedSections(rendered, selected, gists, input.command, input.reading.words)}\n\n${prompt}` },
    ];
  }
  if (selected) {
    // Behind the blocks picked nothing caches, so the older answers are cut
    // (COST6-05); the whole read's history caches and stays whole.
    const system = systemOf(rules, input.profile, "The blocks a first read picked for the command follow.", selectedSections(rendered, selected, gists, input.command, input.reading.words));
    return [systemMessage(system), ...trimmedHistory(input.history), { role: "user", content: prompt }];
  }
  const system = systemOf(rules, input.profile, "Every document follows.", rendered.map((r) => wholeSection(r, gists)).join("\n\n"));
  return [systemMessage(system), ...input.history, { role: "user", content: prompt }];
}

const HISTORY_FULL_ANSWERS = 2; // the latest answers the answer pass reads whole
const HISTORY_SHORT_LEAD = 40; // tokens under which an answer's first paragraph keeps the next
const RECORD_START = /(?:^|\n\n)\((?:Stored|Proposed) by this answer/;

/** The history as the answer pass reads it after the blocks picked
    (COST6-05): every answer older than the last HISTORY_FULL_ANSWERS keeps
    its first paragraph — and the next when the first is under
    HISTORY_SHORT_LEAD tokens ("两份文档的说法不一致。") —, one line naming
    the block tags of the text cut, and its record. The commands stay
    whole, and the reading passes read every answer whole (citedAliases). */
export function trimmedHistory(history: ModelMessage[]): ModelMessage[] {
  const answers = history.flatMap((m, i) => (m.role === "assistant" ? [i] : []));
  const cut = new Set(answers.slice(0, Math.max(0, answers.length - HISTORY_FULL_ANSWERS)));
  return history.map((m, i) => {
    if (!cut.has(i) || m.role !== "assistant" || typeof m.content !== "string") return m;
    const at = m.content.search(RECORD_START);
    const body = (at === -1 ? m.content : m.content.slice(0, at)).trim();
    const record = at === -1 ? "" : m.content.slice(at).trim();
    const paras = body.split(/\n\s*\n/);
    const n = paras.length > 1 && estTokens(paras[0]) < HISTORY_SHORT_LEAD ? 2 : 1;
    const kept = paras.slice(0, n).join("\n\n");
    const tagsOf = (text: string) => [...text.matchAll(BLOCK_TAG)].map((t) => t[0]);
    const keptTags = new Set(tagsOf(kept));
    const tags = [...new Set(tagsOf(paras.slice(n).join("\n\n")))].filter((t) => !keptTags.has(t));
    const also = tags.length > 0 ? `(This answer also cited ${tags.join(" ")}.)` : "";
    const content = [kept, also, record].filter(Boolean).join("\n\n");
    return content === m.content ? m : { ...m, content };
  });
}

const EXISTING_MAX = 40; // links listed to the answer pass

/** The links already in the project whose two blocks are both shown, once
    per pair of blocks, as "[block G6] – [block B20]", with its state when
    it is not accepted (WALK5-03): "(waiting under Recommended links)" or
    "(removed by the reader)". */
export function existingPairs(links: { from: string; to: string; state?: ExistingState }[], shown: (alias: string) => boolean): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const l of links) {
    if (!shown(l.from) || !shown(l.to)) continue;
    const key = [l.from, l.to].sort().join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    const state = l.state === "waiting" ? " (waiting under Recommended links)" : l.state === "removed" ? " (removed by the reader)" : "";
    out.push(`[block ${l.from}] – [block ${l.to}]${state}`);
    if (out.length >= EXISTING_MAX) break;
  }
  return out;
}

// ── The skeletons as the reading passes see them ─────────────────────────

export type SkeletonLineView = { alias: string; text: string; partAlias: string | null };
// opening: the lines before a document's first part, as a part of their
// own (ANS5-03), so the route pass can name them; it has no title or
// summary of its own and is not drawn in the select pass.
export type SkeletonPartView = { alias: string; title: string; summary: string; opening?: boolean };
export type SkeletonView = {
  r: Rendered;
  gist: string;
  parts: SkeletonPartView[];
  lines: SkeletonLineView[];
};

/** A document's skeleton under its aliases: every line keyed by the alias
    of its block, every part by the alias of its first block, and each line
    under the part it falls in. The lines before the first part fall in an
    opening part at the document's first line (ANS5-03): without it a
    routed document lost them. Read from the stored lines; no rebuild. */
export function skeletonView(r: Rendered, skeleton: Skeleton): SkeletonView {
  const aliasOf = new Map(r.blocks.map((b) => [b.id, b.alias]));
  const parts: SkeletonPartView[] = skeleton.parts.flatMap((p) => {
    const alias = aliasOf.get(p.blockId);
    return alias ? [{ alias, title: p.title, summary: p.summary }] : [];
  });
  const partStarts = new Set(parts.map((p) => p.alias));
  let partAlias: string | null = null;
  const lines = skeleton.lines.flatMap((l) => {
    const alias = aliasOf.get(l.blockId);
    if (!alias) return [];
    if (partStarts.has(alias)) partAlias = alias;
    return [{ alias, text: l.text, partAlias }];
  });
  if (parts.length > 0 && lines.length > 0 && lines[0].partAlias === null) {
    const at = lines[0].alias;
    for (const l of lines) {
      if (l.partAlias !== null) break;
      l.partAlias = at;
    }
    parts.unshift({ alias: at, title: OPENING_TITLE, summary: "", opening: true });
  }
  return { r, gist: skeleton.gist, parts, lines };
}

// The opening part's title in the route pass: the lines before the
// document's first part.
const OPENING_TITLE = "(opening lines)";

// A line's cost in estimated tokens: its text and its [block <alias>] tag.
const lineCost = (l: SkeletonLineView) => estTokens(l.text) + Math.ceil((l.alias.length + 9) / 4);

/** The route pass's system message: every document's gist and part
    summaries, no lines. */
function routeSystem(views: SkeletonView[], rendered: Rendered[], profile: Profile): string {
  const byLetter = new Map(views.map((v) => [v.r.letter, v]));
  const sections = rendered.map((r) => {
    const v = byLetter.get(r.letter);
    if (!v) return r.section;
    const head = `${header(r.letter, r.doc, coverageNote(r.coverage))}${v.gist ? `\ngist: ${v.gist}` : ""}`;
    const parts =
      v.parts.length > 0
        ? v.parts.map((p) => `[part at ${p.alias}] ${p.opening ? p.title : `"${p.title}"`}${p.summary ? `: ${p.summary}` : ""}`).join("\n")
        : "(one part: the whole document)";
    return `${head}\n${parts}`;
  });
  return systemOf(
    stitchRouteRules(),
    profile,
    "Each document's gist and the summary of each of its parts follow. A part is tagged [part at <alias>] with the alias of its first block.",
    sections.join("\n\n"),
  );
}

/** The select pass's system message: every document's skeleton lines, or
    the lines in `shown` (a gap between two shown lines marked "(…)"), each
    part's title above its first shown line, with its summary when every
    line is shown or the route pass named the part (`routed`): a cut chose
    its lines by their own words and the part's title, so an unrouted
    part's summary changes no pick and was a third of the prompt
    (COST7-01). Byte-identical from turn to
    turn when every line is shown. A cut puts every document's header and
    gist first, the same bytes every command, and the lines after them
    under '[document X] "<title>": N of M skeleton lines shown', so the headers cache
    (COST6-02). */
export function skeletonSystem(views: SkeletonView[], rendered: Rendered[], shown: Set<string> | null, profile: Profile, routed: Set<string> | null = null): string {
  const byLetter = new Map(views.map((v) => [v.r.letter, v]));
  const head = (r: Rendered, v: SkeletonView) => `${header(r.letter, r.doc, coverageNote(r.coverage))}${v.gist ? `\ngist: ${v.gist}` : ""}`;
  const sections = rendered.flatMap((r) => {
    const v = byLetter.get(r.letter);
    if (!v) return shown ? [] : [r.section];
    const lines = shown ? v.lines.filter((l) => shown.has(l.alias)) : v.lines;
    const out: string[] = [shown ? `[document ${r.letter}] "${r.doc.title}": ${lines.length} of ${v.lines.length} skeleton lines shown` : head(r, v)];
    const partOf = new Map(v.parts.map((p) => [p.alias, p]));
    let lastIndex = -1;
    let lastPart: string | null = null;
    for (const line of lines) {
      const at = v.lines.indexOf(line);
      if (lastIndex !== -1 && at - lastIndex > 1) out.push(shown ? "(…)" : notShown(at - lastIndex - 1, "line"));
      if (line.partAlias && line.partAlias !== lastPart) {
        const p = partOf.get(line.partAlias);
        const summary = p?.summary && (!shown || routed?.has(p.alias)) ? `: ${p.summary}` : "";
        if (p && !p.opening) out.push(`[part at ${p.alias}] "${p.title}"${summary}`);
        lastPart = line.partAlias;
      }
      out.push(`[block ${line.alias}] ${line.text}`);
      lastIndex = at;
    }
    if (lines.length === 0) out.push("(no lines shown)");
    return [out.join("\n")];
  });
  if (!shown) {
    return systemOf(
      stitchSelectRules(),
      profile,
      "Each document's skeleton follows: one line per block, tagged [block <alias>], what the block says at a tenth of its length.",
      sections.join("\n\n"),
    );
  }
  const heads = rendered.map((r) => {
    const v = byLetter.get(r.letter);
    return v ? head(r, v) : r.section;
  });
  return systemOf(
    stitchSelectRules(),
    profile,
    "Each document's title and gist follow, then the skeleton lines read for this command: one line per block, tagged [block <alias>], what the block says at a tenth of its length, under its document's letter and title.",
    `${heads.join("\n\n")}\n\nThe skeleton lines read for this command:\n\n${sections.join("\n\n")}`,
  );
}

/** The lines the select pass reads when the skeletons run past the budget:
    the routed parts' lines, then — when they still run past it — the lines
    ranked against the query, every document keeping at least its share
    of the top so no document goes unread. query: called only when the
    lines run past the budget (the expansion is a model call). Returns the
    aliases shown. */
export async function cutLines(
  views: SkeletonView[],
  routed: Set<string> | null,
  query: () => Promise<string>,
  budget: number,
): Promise<Set<string>> {
  const candidates = views.flatMap((v) =>
    v.lines
      .filter((l) => !routed || (l.partAlias !== null && routed.has(l.partAlias)))
      .map((l) => ({ v, l })),
  );
  // A document whose parts the route pass left out still gets its top
  // lines below, from every line of it.
  const covered = new Set(candidates.map((c) => c.v.r.letter));
  for (const v of views) if (!covered.has(v.r.letter)) for (const l of v.lines) candidates.push({ v, l });
  const total = candidates.reduce((sum, c) => sum + lineCost(c.l), 0);
  if (total <= budget) return new Set(candidates.map((c) => c.l.alias));

  let ranked = rank(candidates, (c) => `${c.l.text} ${c.v.parts.find((p) => p.alias === c.l.partAlias && !p.opening)?.title ?? ""}`, await query());
  // No line shares a word with the query (a Chinese command over English
  // lines whose expansion failed or came back in Chinese): a cut by score
  // would be a cut by position, the first documents kept and the last
  // lost. Read every line instead, in groups, up to what the groups can
  // read; past that, the documents take turns, line by line, so each
  // keeps its opening lines.
  if (ranked.length > 0 && ranked[0].score === 0) {
    console.warn(`[stitch] no skeleton line matches the command; reading ${total <= STITCH_GROUPED_MAX ? "every line" : "every document's opening lines"}`);
    if (total <= STITCH_GROUPED_MAX) return new Set(candidates.map((c) => c.l.alias));
    const byDoc = new Map<string, typeof ranked>();
    for (const r of ranked) {
      const letter = r.item.v.r.letter;
      if (!byDoc.has(letter)) byDoc.set(letter, []);
      byDoc.get(letter)!.push(r);
    }
    ranked = [];
    const lists = [...byDoc.values()];
    for (let i = 0; ranked.length < candidates.length; i++) for (const list of lists) if (i < list.length) ranked.push(list[i]);
    budget = STITCH_GROUPED_MAX;
  }
  const shown = new Set<string>();
  let used = 0;
  // Every document's top lines first, up to a share of the budget.
  const share = Math.floor(budget / (4 * Math.max(1, views.length)));
  const perDoc = new Map<string, number>();
  for (const { item } of ranked) {
    const letter = item.v.r.letter;
    const spent = perDoc.get(letter) ?? 0;
    const cost = lineCost(item.l);
    if (spent + cost > share) continue;
    perDoc.set(letter, spent + cost);
    shown.add(item.l.alias);
    used += cost;
  }
  // Then the rest of the budget, most relevant first.
  for (const { item } of ranked) {
    if (shown.has(item.l.alias)) continue;
    const cost = lineCost(item.l);
    if (used + cost > budget) continue;
    shown.add(item.l.alias);
    used += cost;
  }
  return shown;
}

/** The lines the select pass reads, split into calls: one call when they fit
    the skeleton budget (the lines as they are, byte-identical from turn to
    turn), else groups of about `group` tokens in document order. A group
    closes at a document's end when the next document fits a group whole,
    so a call reads whole documents; a document longer than a group runs
    over several. Each group: its documents and the aliases it shows. */
export function skeletonGroups(
  views: SkeletonView[],
  shown: Set<string> | null,
  budget: number,
  group: number,
): { views: SkeletonView[]; shown: Set<string> | null }[] {
  const own = views.map((v) => ({ v, lines: v.lines.filter((l) => !shown || shown.has(l.alias)) }));
  const total = own.reduce((sum, x) => sum + x.lines.reduce((n, l) => n + lineCost(l), 0), 0);
  if (total <= budget) return [{ views, shown }];
  const groups: { views: SkeletonView[]; shown: Set<string> }[] = [];
  let open: { views: SkeletonView[]; shown: Set<string> } | null = null;
  let used = 0;
  for (const { v, lines } of own) {
    if (lines.length === 0) continue;
    const cost = lines.reduce((n, l) => n + lineCost(l), 0);
    if (open && used + cost > group && cost <= group) open = null;
    for (const l of lines) {
      const c = lineCost(l);
      if (!open || used + c > group) {
        groups.push((open = { views: [], shown: new Set() }));
        used = 0;
      }
      if (open.views[open.views.length - 1] !== v) open.views.push(v);
      open.shown.add(l.alias);
      used += c;
    }
  }
  return groups;
}

const PICK_RX = /^([A-Z]+)(\d+)(?:\s*-\s*(?:([A-Z]+))?(\d+))?$/;

/** One pick of the select pass as aliases: an alias as it is (B12), or a
    range of consecutive blocks (B10-B15, B10-15) expanded in order. A pick
    that is not an alias is nothing. */
export function expandPick(pick: string): string[] {
  const m = PICK_RX.exec(pick.trim().toUpperCase());
  if (!m) return [];
  const [, letter, fromText, toLetter, toText] = m;
  if (toText === undefined) return [`${letter}${Number(fromText)}`];
  if (toLetter !== undefined && toLetter !== letter) return [];
  const from = Number(fromText);
  const to = Number(toText);
  if (to < from || to - from >= MAX_SELECTED) return [`${letter}${from}`];
  const out: string[] = [];
  for (let n = from; n <= to; n++) out.push(`${letter}${n}`);
  return out;
}

/** Several lists as one: every list's first, then every list's second,
    and so on — the groups' picks, each in its own order, so no group's
    picks wait for another's. */
export function interleave(lists: string[][]): string[] {
  const out: string[] = [];
  const longest = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < longest; i++) for (const list of lists) if (i < list.length) out.push(list[i]);
  return out;
}

/** The picks in the select pass's order, most relevant first, with every
    document's first pick moved to the front: a comparison still opens with
    every document's best block, and the rest of the budget goes where the
    select pass ranked it, not to every document alike. docOf: the
    document of an alias; an alias with none drops. cap: the first picks
    moved to the front hold this many tokens at most (costOf): a first pick
    that does not fit keeps its place in the select pass's order, and the
    next documents' first picks still lead while they fit (COST3-01): on a project of 100
    documents the first picks alone would fill a question's budget, one
    block per document, and the blocks that answer best would be cut.
    Thirty documents' first picks fit a third of a question's budget, so
    under that the order is unchanged. */
export function firstsFirst(
  aliases: string[],
  docOf: (alias: string) => string | undefined,
  cap?: { tokens: number; costOf: (alias: string) => number },
): string[] {
  const firsts: string[] = [];
  const rest: string[] = [];
  const seen = new Set<string>();
  let used = 0;
  for (const alias of aliases) {
    const doc = docOf(alias);
    if (doc === undefined) continue;
    if (seen.has(doc)) {
      rest.push(alias);
      continue;
    }
    seen.add(doc);
    if (cap) {
      const cost = cap.costOf(alias);
      // A long first pick waits in the select order; the documents after
      // it still lead with their first picks while they fit (REV4-07).
      if (used + cost > cap.tokens) {
        rest.push(alias);
        continue;
      }
      used += cost;
    }
    firsts.push(alias);
  }
  return [...firsts, ...rest];
}

// A block's cost in the answer pass, in estimated tokens: its text and its tag line.
const blockCost = (text: string) => estTokens(text) + 10;

/** The select pass's pick cut to the kind's budget (STITCH_SELECTED_BUDGET,
    STITCH_SELECTED_BLOCKS): known aliases, once each, in the given order
    (most relevant first) until the tokens run out. */
export function cutSelection(
  aliases: string[],
  blockByRef: Map<string, DocBlock>,
  kind: StitchCommandKind = "page",
): Set<string> {
  const picked = new Set<string>();
  let used = 0;
  for (const alias of aliases) {
    const block = blockByRef.get(alias);
    if (!block || picked.has(block.alias)) continue;
    if (picked.size >= STITCH_SELECTED_BLOCKS[kind]) break;
    const cost = blockCost(block.text);
    if (used + cost > STITCH_SELECTED_BUDGET[kind]) continue;
    used += cost;
    picked.add(block.alias);
  }
  return picked;
}

// A document's opening, cut to its share of the budget: what the answer pass
// reads of a document whose select call failed.
function opening(r: Rendered, share: number): string[] {
  const picked: string[] = [];
  let used = 0;
  for (const block of r.blocks) {
    const cost = blockCost(block.text);
    if (used + cost > share) break;
    used += cost;
    picked.push(block.alias);
  }
  return picked;
}

/** The reply's block tags as the stored ids: the model writes [block B12],
    the reader's chips need [block <id>] (components/markdown.tsx). */
export function replyWithIds(reply: string, blockByRef: Map<string, DocBlock>): string {
  // A tag that names several blocks ([block B19, block B21], [blocks B19;
  // B21]) is one tag per block, so each gets its chip.
  const split = reply.replace(
    /\[blocks? ([A-Za-z]+\d+(?:\s*[,;]\s*(?:block\s+)?[A-Za-z]+\d+)+)\]/g,
    (_tag, list: string) =>
      list
        .split(/\s*[,;]\s*/)
        .map((a) => `[block ${a.replace(/^block\s+/, "")}]`)
        .join(" "),
  );
  return split.replace(/\[block ([A-Za-z]+\d+)\]/g, (tag, alias: string) => {
    const block = blockByRef.get(alias.toUpperCase());
    return block ? `[block ${block.id}]` : tag;
  });
}

const BLOCK_TAG = /\[block ([^\]\s]+)\]/g;

// A quote's text as compared with a block's: case, whitespace, quote
// marks, markdown emphasis, and dashes folded.
// A dash with or without spaces around it is one "-" (models re-space em
// dashes); soft hyphens and zero-width characters drop (REV4-05).
const foldQuote = (t: string) =>
  t
    .replace(/[\u00ad\u200b-\u200d\u2060\ufeff]/g, "")
    .normalize("NFKC")
    .replace(/[*_"'“”‘’「」『』]/g, "")
    .replace(/\s*[‐-―−]\s*|\s+-\s+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

// A span in quote marks: straight or curly, opened after a space, a
// bracket, or a CJK character (他说"…"), closed before a space, a
// punctuation mark, a block tag ("…"[block F24]), or a CJK character; or
// a span in corner brackets, 「…」 or 『…』, anywhere (ANS5-01).
const CJK_CHAR = "㐀-鿿";
const QUOTE_SPAN = new RegExp(
  String.raw`(^|[\s(（:：，,、。；—–\[「『${CJK_CHAR}])(?:(["“])([^"“”「」『』\n]+?)["”](?=[\s.,;:!?)）\]\[，。、；：！？…」』${CJK_CHAR}]|$)|「([^「」\n]+?)」|『([^『』\n]+?)』)`,
  "g",
);
const QUOTE_MIN = 12; // chars of a quote checked; a CJK quote from 6
const QUOTE_CJK_MIN = 6;

/** The reply's quotes checked against the blocks it cites (ANS3-05), as
    the link and page quotes resolve against theirs: a span in quote marks
    on a line that cites blocks must be in one of them, or in any block
    the reply cites when the line cites none, or verbatim in any block
    read, or in the line's cited blocks joined in order (a quote across
    two blocks). Cut words (… or ...) and an editor's [insertion] split it
    into pieces, each in the block. Dashes match with or without spaces,
    and soft hyphens drop. A
    span that is in none loses its quote marks and keeps its words, so a
    paraphrase never reads as the document's words. A document's title in
    quote marks is left alone. Runs on the model's aliases, before
    replyWithIds. unquoted: the spans that lost their marks. */
export function checkReplyQuotes(
  reply: string,
  blockByRef: Map<string, DocBlock>,
  titles: Set<string>,
): { reply: string; unquoted: string[] } {
  const unquoted: string[] = [];
  const textOf = (alias: string) => blockByRef.get(alias.toUpperCase())?.text ?? "";
  const tagsIn = (t: string) => [...t.matchAll(/\[block ([A-Za-z]+\d+)\]/g)].map((m) => m[1]);
  const all = tagsIn(reply);
  const every = [...new Set([...blockByRef.values()])];
  const lines = reply.split("\n").map((line) =>
    line.replace(QUOTE_SPAN, (span, lead: string, _open: string | undefined, straight?: string, corner?: string, white?: string) => {
      const inner = straight ?? corner ?? white ?? "";
      const cjk = /[㐀-鿿]/.test(inner);
      if (inner.trim().length < (cjk ? QUOTE_CJK_MIN : QUOTE_MIN) || titles.has(inner.trim())) return span;
      const pieces = inner
        .split(/\s*(?:…|\.\.\.|\[[^\]]{1,40}\])\s*/)
        .map(foldQuote)
        .map((p) => p.replace(/^[\s.,;:!?]+|[\s.,;:!?]+$/g, ""))
        .filter((p) => p.length >= 4);
      if (pieces.length === 0) return span;
      const holds = (text: string) => {
        const folded = foldQuote(text);
        return pieces.every((p) => folded.includes(p));
      };
      const tags = tagsIn(line);
      const cited = tags.length > 0 ? tags : all;
      if (cited.some((a) => holds(textOf(a)))) return span;
      // A quote that runs from one cited block into the next: the cited
      // blocks in their order, joined, with or without the first block's
      // closing stop.
      if (tags.length > 1) {
        const texts = tags.map(textOf);
        const joined = texts.join(" ");
        const trimmed = texts.map((t) => t.replace(/[\s.,;:!?。，；：]+$/, "")).join(" ");
        if (holds(joined) || holds(trimmed)) return span;
      }
      if (every.some((b) => holds(b.text))) return span;
      unquoted.push(inner);
      return `${lead}${inner}`;
    }),
  );
  return { reply: lines.join("\n"), unquoted };
}

/** The language the reply is written in (STITCH_REPLY_LANGUAGE): the UI's,
    or, with "command", the command's when it is plainly in one language
    (four CJK characters and at least as many as Latin letters: Chinese;
    eight Latin letters and no CJK: English), else the UI's. */
export function replyLanguage(command: string, uiLang: Lang, mode: "ui" | "command" = STITCH_REPLY_LANGUAGE): Lang {
  if (mode === "ui") return uiLang;
  const cjk = (command.match(/[㐀-鿿]/g) ?? []).length;
  const latin = (command.match(/[A-Za-z]/g) ?? []).length;
  if (cjk >= 4 && cjk >= latin) return "zh";
  if (latin >= 8 && cjk === 0) return "en";
  return uiLang;
}

/** What the reply cites, for the box's chips (StitchResult.cited): every
    stored block id the reply cites as [block <id>], with its document's id
    and title and the block's text, cut to CITED_TEXT chars. */
export function citedBlocks(
  reply: string,
  blockByRef: Map<string, DocBlock>,
  titleOf: Map<string, string>,
): StitchResult["cited"] {
  const out: StitchResult["cited"] = {};
  for (const m of reply.matchAll(BLOCK_TAG)) {
    const block = blockByRef.get(m[1]);
    if (!block || block.id !== m[1] || out[block.id]) continue;
    out[block.id] = {
      documentId: block.documentId,
      title: titleOf.get(block.documentId) ?? "",
      text: block.text.slice(0, CITED_TEXT),
    };
  }
  return out;
}

/** A history turn's block tags as this reading's aliases: the box keeps the
    replies with the stored ids (replyWithIds), which the model cannot map
    to the passages it reads. A block of this reading becomes its alias; a
    block of a document of the project not in this reading becomes (a
    passage of "<title>") (titles: stored id → title); any other tag
    drops. */
export function historyWithAliases(
  text: string,
  blockByRef: Map<string, DocBlock>,
  titles: Map<string, string>,
): string {
  return text.replace(BLOCK_TAG, (_tag, ref: string) => {
    const block = blockByRef.get(ref) ?? blockByRef.get(ref.toUpperCase());
    if (block) return `[block ${block.alias}]`;
    const title = titles.get(ref);
    return title !== undefined ? `(a passage of "${title}")` : "";
  });
}

/** One stored link of a turn's record, as read again from the project. */
export type RecordLink = { id: string; fromBlockId: string; toBlockId: string | null; reason: string | null; recommended: boolean };
/** One block of a turn's generated page with its sources: quote, true when
    the block is a copy of its source (a quote part). */
export type RecordPageBlock = { quote: boolean; sources: { blockId: string; title: string }[] };

const RECORD_QUOTES_MAX = 20; // quote parts of a page named by block

/** A turn's record as the model reads it (ANS4-02): what the turn stored,
    under the reply. Each link in the order the answer proposed it, its two
    blocks as stored ids (historyWithAliases makes them this reading's
    aliases) and its stored reason; a link gone from the project by the two
    titles the box sent. The page by its title, its quote parts counted by
    the document they come from, and the blocks they copy. "" when the turn
    stored nothing. */
export function recordText(
  record: StitchRecord,
  links: Map<string, RecordLink>,
  page: RecordPageBlock[] | null,
): string {
  const lines: string[] = [];
  record.links.forEach((l, i) => {
    // A proposed link not stored keeps its number (ANS5-02).
    if (l.status === "unstored") {
      lines.push(`- link ${i + 1}: not stored (its passages did not resolve)`);
      return;
    }
    if (l.status === "copy") {
      lines.push(`- link ${i + 1}: not stored (it joined a passage to its word-for-word copy)`);
      return;
    }
    if (l.status === "removed") {
      lines.push(`- link ${i + 1}: removed by the reader before, not stored again${l.from && l.to ? ` ("${l.from}" – "${l.to}")` : ""}`);
      return;
    }
    const row = links.get(l.id);
    if (!row) {
      lines.push(`- link ${i + 1}: "${l.from}" – "${l.to}" (no longer in the graph)`);
      return;
    }
    const to = row.toBlockId ? `[block ${row.toBlockId}]` : `"${l.to}"`;
    const reason = row.reason?.replace(/\s+/g, " ").trim();
    const state = l.status === "existing" ? ` (already in the graph${row.recommended ? ", waiting under Recommended links" : ""}; not stored again)` : row.recommended ? "" : " (accepted)";
    lines.push(`- link ${i + 1}${state}: [block ${row.fromBlockId}] – ${to}${reason ? `: ${reason}` : ""}`);
  });
  if (record.document) {
    const title = record.document.title.replace(/\s+/g, " ").trim();
    if (!page) {
      lines.push(`- page "${title}" (no longer in the project)`);
    } else {
      const quotes = page.filter((b) => b.quote);
      const byTitle = new Map<string, number>();
      for (const b of quotes) for (const src of b.sources.slice(0, 1)) byTitle.set(src.title, (byTitle.get(src.title) ?? 0) + 1);
      const from = [...byTitle].map(([t, n]) => `"${t}" ${n}`).join(", ");
      const tags = quotes.slice(0, RECORD_QUOTES_MAX).flatMap((b) => b.sources.slice(0, 1).map((src) => `[block ${src.blockId}]`));
      const texts = page.filter((b) => !b.quote && b.sources.length > 0).length;
      lines.push(
        `- page "${title}": ${quotes.length} quote part${quotes.length === 1 ? "" : "s"}${from ? ` (${from})` : ""}${tags.length > 0 ? `: ${tags.join(" ")}${quotes.length > tags.length ? " …" : ""}` : ""}; ${texts} text block${texts === 1 ? "" : "s"} with sources`,
      );
    }
  }
  return lines.length > 0 ? `(${record.links.some((l) => l.status) ? "Proposed" : "Stored"} by this answer, in the order it proposed them:\n${lines.join("\n")})` : "";
}

/** The records of the turns, read again inside the project: the links by
    id, and each page's blocks with their provenance links. A link or a
    page of another project is not read. */
async function loadRecords(turns: StitchTurn[], notebookId: string): Promise<{ links: Map<string, RecordLink>; pages: Map<string, RecordPageBlock[]> }> {
  const linkIds = [...new Set(turns.flatMap((t) => t.record?.links.map((l) => l.id).filter(Boolean) ?? []))].slice(0, 500);
  const pageIds = [...new Set(turns.flatMap((t) => (t.record?.document ? [t.record.document.id] : [])))].slice(0, 20);
  const links = new Map<string, RecordLink>();
  const pages = new Map<string, RecordPageBlock[]>();
  if (linkIds.length > 0) {
    // A link of the project's scope whose two documents are in the
    // project: a record naming a link of another account's documents
    // reads as gone (REV5-05).
    const rows = await db.docLink.findMany({
      where: {
        id: { in: linkIds },
        ...projectLinks(notebookId),
        fromDocument: { notebooks: { some: { notebookId } } },
        toDocument: { notebooks: { some: { notebookId } } },
      },
      select: { id: true, fromBlockId: true, toBlockId: true, reason: true, recommended: true },
    });
    for (const row of rows) links.set(row.id, row);
  }
  if (pageIds.length > 0) {
    const docs = await db.document.findMany({
      where: { id: { in: pageIds }, generatedCommand: { not: null }, notebooks: { some: { notebookId } } },
      select: {
        id: true,
        blocks: { orderBy: { order: "asc" }, select: { id: true, text: true } },
        linksFrom: {
          where: { recommended: false },
          orderBy: { createdAt: "asc" },
          select: { fromBlockId: true, toBlockId: true, toQuotedText: true, toDocument: { select: { title: true } } },
        },
      },
    });
    for (const d of docs) {
      const byBlock = new Map<string, typeof d.linksFrom>();
      for (const l of d.linksFrom) byBlock.set(l.fromBlockId, [...(byBlock.get(l.fromBlockId) ?? []), l]);
      pages.set(
        d.id,
        d.blocks.map((b) => {
          const from = byBlock.get(b.id) ?? [];
          const sources = from.flatMap((l) => (l.toBlockId ? [{ blockId: l.toBlockId, title: l.toDocument.title }] : []));
          // A quote part is a copy of its one source; its markdown
          // emphasis parsed away (_pity_ is pity), so compared folded.
          return { quote: from.length === 1 && foldQuote(from[0].toQuotedText ?? "").replace(/-/g, "") === foldQuote(b.text).replace(/-/g, ""), sources };
        }),
      );
    }
  }
  return { links, pages };
}

/** The conversation as the passes read it: the last STITCH_HISTORY_MAX
    turns with text, each assistant turn with its record under it
    (recordText), each turn's block tags as this reading's aliases
    (historyWithAliases). Only blocks of documents attached to the project
    are named by title. */
export async function stitchHistory(turns: StitchTurn[], reading: Reading, notebookId: string): Promise<ModelMessage[]> {
  // A turn with no text but a record (an answer that was only links or a
  // page) is kept: its record is what the model reads of it.
  const kept = turns.filter((t) => t.content.trim() || t.record?.links.length || t.record?.document).slice(-STITCH_HISTORY_MAX);
  const records = await loadRecords(kept.filter((t) => t.role === "assistant"), notebookId);
  const contents = kept.map((t) => {
    if (t.role !== "assistant" || !t.record) return t.content;
    const page = t.record.document ? (records.pages.get(t.record.document.id) ?? null) : null;
    const text = recordText(t.record, records.links, page);
    return [t.content.trim(), text].filter(Boolean).join("\n\n");
  });
  const unknown = new Set<string>();
  for (const c of contents) for (const m of c.matchAll(BLOCK_TAG)) if (!reading.blockByRef.has(m[1])) unknown.add(m[1]);
  const titles = new Map<string, string>();
  if (unknown.size > 0) {
    const rows = await db.block.findMany({
      where: { id: { in: [...unknown].slice(0, 500) }, document: { notebooks: { some: { notebookId } } } },
      select: { id: true, document: { select: { title: true } } },
    });
    for (const row of rows) titles.set(row.id, row.document.title);
  }
  return kept.map((t, i) => ({ role: t.role, content: historyWithAliases(contents[i], reading.blockByRef, titles) }));
}

const textOf = (m: ModelMessage): string => (typeof m.content === "string" ? m.content : "");

/** The aliases the earlier answers cited, the latest answer's first, once
    each, up to MAX_CITED: what "it" and "the second one" most often name. */
export function citedAliases(history: ModelMessage[], blockByRef: Map<string, DocBlock>): string[] {
  const out: string[] = [];
  for (const m of [...history].reverse()) {
    if (m.role !== "assistant") continue;
    for (const tag of textOf(m).matchAll(BLOCK_TAG)) {
      const block = blockByRef.get(tag[1]);
      if (block && !out.includes(block.alias)) out.push(block.alias);
      if (out.length >= MAX_CITED) return out;
    }
  }
  return out;
}

/** The documents as the reading passes and the answer pass see them: every
    document rendered under its letter, the ones with text to read, every
    block under its alias and its stored id, and the list the prompts name. */
export type Reading = {
  rendered: Rendered[];
  read: Rendered[];
  blockByRef: Map<string, DocBlock>;
  documentList: StitchDocumentCtx[];
  // Each document's skeleton gist by document id: the stored ones, and the
  // ones the reading passes build (pickBlocks).
  gists: Map<string, string>;
  // The expansion's words, when the reading passes asked for them
  // (pickBlocks): what a CJK command's titleMatches reads.
  words?: string[];
};

/** The documents loaded by loadDocuments, ready for the reading passes.
    length: the chars of document text; tokens: its estimated tokens. */
export function readingOf(docs: Doc[]): Reading & { length: number; tokens: number } {
  const { rendered, length, tokens } = renderDocuments(docs);
  const read = rendered.filter((r) => r.coverage.status === "read");
  const blockByRef = new Map<string, DocBlock>();
  for (const r of rendered) {
    for (const b of r.blocks) {
      blockByRef.set(b.alias, b);
      blockByRef.set(b.id, b);
    }
  }
  const documentList = rendered.map((r) => ({
    tag: r.letter,
    title: r.doc.title,
    read: r.coverage.status === "read",
  }));
  const gists = new Map<string, string>();
  for (const r of read) {
    const gist = readSkeleton(r.doc.skeleton)?.gist;
    if (gist) gists.set(r.doc.id, gist);
  }
  return { rendered, read, blockByRef, documentList, gists, length, tokens };
}

const expandSchema = z.object({
  words: z
    .array(z.string())
    .default([])
    .transform((a) =>
      a
        .map((w) => w.trim().slice(0, 60))
        .filter(Boolean)
        .slice(0, STITCH_EXPAND_WORDS * 2),
    ),
});

/** The expansion (STITCH_EXPAND_*): the words a passage that answers the
    command would use, for the ranked cut. One cheap call on the
    stitch-select model, its usage recorded like every pass's. A failed
    call is no words: the cut ranks against the command alone. */
async function expandWords(input: {
  command: string;
  earlier: string[];
  titles: string[];
  usage: { userId: string | null; feature: string };
  signal?: AbortSignal;
}): Promise<string[]> {
  const call = await featureCall("stitch-select", STITCH_EXPAND_EFFORT);
  const result = await callForJson({
    model: call.model,
    messages: [
      {
        role: "user",
        content: stitchExpandPrompt({
          command: input.command,
          earlier: input.earlier,
          titles: input.titles.slice(0, 60),
          maxWords: STITCH_EXPAND_WORDS,
        }),
      },
    ],
    maxOutputTokens: STITCH_EXPAND_MAX_OUTPUT_TOKENS,
    providerOptions: call.providerOptions,
    schema: expandSchema,
    label: "STITCH_EXPAND",
    usage: { ...input.usage, model: call.modelId, pass: "expand" },
    abortSignal: input.signal,
  });
  if (!result.ok) {
    if (!input.signal?.aborted) console.warn("[stitch] expansion failed, ranking against the command:", result.error);
    return [];
  }
  return result.data.words;
}

/** The reading passes (SPEC.md §22): the blocks a command needs, found from
    the documents' skeletons — the route pass past what the groups can
    read, then the select pass — as aliases cut to the answer pass's budget
    for the command's kind. The reading passes read the reader's last
    STITCH_READ_HISTORY commands, not the replies, and are told which
    blocks the earlier answers cited; the ranker and Jev judge the lines
    against the earlier commands and the command together, so a follow-up
    finds what it refers to. A pass that fails falls back (every line
    ranked, the failed group's documents' openings), so the blocks always
    come back. Stitch reads them; so does the assistant at Project scope
    past the whole threshold (lib/assistant/project-reading.ts).
    feature: the usage record's name for the calls. kind: the command's
    kind (commandKind); a page by default, the widest budget. */
export async function pickBlocks(input: {
  reading: Reading;
  command: string;
  history: ModelMessage[];
  profile: Profile;
  userId: string | null;
  feature: string;
  signal?: AbortSignal;
  kind?: StitchCommandKind;
}): Promise<Set<string>> {
  const { rendered, read, blockByRef, documentList } = input.reading;
  const { profile } = input;
  const kind = input.kind ?? "page";
  // What the command refers back to is in the reader's commands; the
  // replies are the answer pass's, and the blocks they cited are named.
  const earlier = input.history
    .filter((m) => m.role === "user")
    .map(textOf)
    .filter((t) => t.trim())
    .slice(-STITCH_READ_HISTORY);
  const continued = input.history.length > 0;
  const cited = citedAliases(input.history, blockByRef);
  // The blocks whose full text names the command's rare names: the select
  // pass is told of them, and a cut keeps their lines.
  const names = nameHits(input.command, read.flatMap((r) => r.blocks), read.map((r) => r.doc.title));
  const jevCommand =
    earlier.length > 0
      ? `Earlier commands of the conversation:\n${earlier.join("\n")}\n\nThe command:\n${input.command}`
      : input.command;
  const readRoute = await featureCall("stitch-select", STITCH_ROUTE_EFFORT);
  const readSelect = await featureCall("stitch-select", STITCH_SELECT_EFFORT);
  const readModel = readRoute.model;
  const readUsage = { userId: input.userId, feature: input.feature, model: readRoute.modelId };
  const aborted = () => {
    throw new Error("aborted");
  };
  // The ranker's query: the earlier commands, the command, and the words
  // of its expansion — asked for once, and only when a cut ranks.
  let query: Promise<string> | null = null;
  const rankQuery = () =>
    (query ??= expandWords({
      command: input.command,
      earlier,
      titles: read.map((r) => r.doc.title),
      usage: { userId: input.userId, feature: input.feature },
      signal: input.signal,
    }).then((words) => {
      input.reading.words = words;
      return [...earlier, input.command, ...(words.length > 0 ? [words.join(" ")] : [])].join("\n");
    }));

  // Every document's skeleton: stored, patched for small edits, or built
  // now, SKELETON_BUILD_CONCURRENCY at a time. A build that fails reads
  // the document's first words.
  const skeletons = await mapLimit(read, SKELETON_BUILD_CONCURRENCY, (r) => ensureSkeleton(r.doc, input.userId, input.signal));
  if (input.signal?.aborted) aborted();
  const views = read.map((r, i) => skeletonView(r, skeletons[i]));
  for (const v of views) if (v.gist) input.reading.gists.set(v.r.doc.id, v.gist);
  const skeletonLength = views.reduce((sum, v) => sum + v.lines.reduce((n, l) => n + lineCost(l), 0), 0);

  // Past the budget the select pass reads every line in groups (below);
  // past what the groups can read, the route pass names the parts first,
  // and the lines are cut to them and, if still too many, ranked against
  // the command. Jev reads part by part, so it routes past the budget. A
  // question or a links command past STITCH_CUT_OVER reads the lines
  // ranked against it and its expansion, one call's worth: it needs the
  // few blocks that bear on it, and under STITCH_CUT_OVER the groups'
  // cached prefixes cost less than an uncached cut from the second
  // command on.
  let shown: Set<string> | null = null;
  let routedParts: Set<string> | null = null;
  const jev = jevEnabled();
  const routeOver = jev ? STITCH_SKELETON_BUDGET : STITCH_GROUPED_MAX;
  const cutBudget =
    kind === "question" ? STITCH_QUESTION_SKELETON : kind === "links" ? STITCH_LINKS_SKELETON : routeOver;
  if (skeletonLength > routeOver) {
    // Jev first (one noul per part), else the GLM route pass.
    let routed: Set<string> | null = jev ? await jevRouteParts(views, jevCommand, input.userId, input.signal) : null;
    if (input.signal?.aborted) aborted();
    if (!routed) {
      const route = await callForJson({
        model: readModel,
        messages: [
          systemMessage(routeSystem(views, rendered, profile)),
          {
            role: "user",
            content: stitchRoutePrompt({ documents: documentList, command: input.command, continued, earlier, cited, maxParts: MAX_ROUTED }),
          },
        ],
        maxOutputTokens: STITCH_SELECT_MAX_OUTPUT_TOKENS,
        providerOptions: readRoute.providerOptions,
        schema: routeSchema,
        label: "STITCH_ROUTE",
        usage: { ...readUsage, pass: "route" },
        abortSignal: input.signal,
      });
      if (!route.ok) {
        if (input.signal?.aborted) aborted();
        console.warn("[stitch] route pass failed, ranking every line:", route.error);
      } else {
        const partAliases = new Set(views.flatMap((v) => v.parts.map((p) => p.alias)));
        const picked = route.data.parts.map((p) => p.trim().toUpperCase()).filter((p) => partAliases.has(p));
        if (picked.length > 0) routed = new Set(picked);
      }
    }
    routedParts = routed;
    shown = await cutLines(views, routed, rankQuery, Math.min(cutBudget, routeOver));
  } else if (!jev && kind !== "page" && skeletonLength > STITCH_CUT_OVER) {
    shown = await cutLines(views, null, rankQuery, cutBudget);
  }
  if (shown) for (const n of names) for (const a of n.aliases) shown.add(a);
  if (input.signal?.aborted) aborted();

  // The picks most relevant first: Jev's by document (one noul per line),
  // else the GLM select pass's, one call per group of lines, the groups at
  // once, each group's list in its call's order. A group whose call failed
  // reads as its documents' openings.
  const share = Math.floor(STITCH_SELECTED_BUDGET[kind] / read.length);
  let lists: string[][];
  const jevByDoc = jev ? await jevSelectLines(views, shown, jevCommand, input.userId, input.signal) : null;
  if (input.signal?.aborted) aborted();
  if (jevByDoc) {
    lists = [interleave(read.map((r) => jevByDoc.get(r.doc.id) ?? []))];
  } else {
    const groups = skeletonGroups(views, shown, STITCH_SKELETON_BUDGET, STITCH_SKELETON_GROUP);
    const maxBlocks = groupMaxBlocks(kind, groups.length);
    lists = await mapLimit(groups, STITCH_GROUP_CONCURRENCY, async (group) => {
      const letters = new Set(group.views.map((v) => v.r.letter));
      const pick = await callForJson({
        model: readModel,
        messages: [
          systemMessage(skeletonSystem(group.views, rendered.filter((r) => letters.has(r.letter)), group.shown, profile, routedParts)),
          {
            role: "user",
            content: stitchSelectPrompt({
              documents: groups.length > 1 ? documentList.filter((d) => letters.has(d.tag)) : documentList,
              command: input.command,
              continued,
              earlier,
              cited: groups.length > 1 ? cited.filter((a) => letters.has(blockLetter(a))) : cited,
              maxBlocks,
              partial: group.shown !== null,
              names: names
                .map((n) => ({ term: n.term, aliases: n.aliases.filter((a) => letters.has(blockLetter(a))) }))
                .filter((n) => n.aliases.length > 0),
            }),
          },
        ],
        maxOutputTokens: STITCH_SELECT_MAX_OUTPUT_TOKENS,
        providerOptions: readSelect.providerOptions,
        schema: selectSchema,
        label: "STITCH_SELECT",
        usage: { ...readUsage, pass: "select" },
        abortSignal: input.signal,
      });
      if (!pick.ok) {
        if (!input.signal?.aborted) console.warn("[stitch] select pass failed, reading the group's openings:", pick.error);
        return interleave(group.views.map((v) => opening(v.r, share)));
      }
      return pick.data.blockIds.flatMap(expandPick);
    });
    if (input.signal?.aborted) aborted();
  }
  // Every document's first pick, up to a third of the budget, then the
  // rest in the select pass's order (firstsFirst), cut to the kind's budget. A document the select pass
  // read and picked nothing of is left out: none of its blocks are shown.
  // When nothing at all was picked, the answer pass reads the blocks that
  // name the command's rare names, NAME_FALLBACK per name (COST6-04), or,
  // when no name hits, every document's opening, so it has text to say so
  // from.
  let picks = firstsFirst(interleave(lists), (alias) => blockByRef.get(alias)?.documentId, {
    tokens: STITCH_SELECTED_BUDGET[kind] / 3,
    costOf: (alias) => blockCost(blockByRef.get(alias)?.text ?? ""),
  });
  if (picks.length === 0) picks = namePicks(names);
  if (picks.length === 0) picks = interleave(read.map((r) => opening(r, share)));
  if (input.signal?.aborted) aborted();
  return cutSelection(picks, blockByRef, kind);
}

// The blocks per rare name the answer pass reads when the select pass
// picked nothing (COST6-04).
const NAME_FALLBACK = 2;

/** The blocks the answer pass reads when the select pass picked nothing:
    the first NAME_FALLBACK blocks that name each of the command's rare
    names (COST6-04), once each. Empty when no name hits. */
export function namePicks(names: { aliases: string[] }[]): string[] {
  return [...new Set(names.flatMap((n) => n.aliases.slice(0, NAME_FALLBACK)))];
}

/** The blocks a command about the last answers reads (ANS6-03): the
    blocks the earlier answers cited and stored (citedAliases, which reads
    the records under the replies), cut to the kind's budget, so no select
    pass runs; that pass returned these same blocks. null — run the select
    pass — when the command is not a follow-up that refers back
    (refersBack), when it asks for more than the blocks cited (asksMore,
    ANS7-01), when nothing was cited, when it names a rare name whose
    blocks were not cited, when it holds a word of a document's title and
    no document whose title holds that word has a block cited (ANS7-01:
    "What does Schopenhauer say about those points?" after an answer from
    The Antichrist alone; nameHits drops a title's words), or when the
    blocks cited cost more than BACK_BUDGET tokens. docs: the documents
    read. */
export function backSelection(
  command: string,
  history: ModelMessage[],
  blockByRef: Map<string, DocBlock>,
  names: { term: string; aliases: string[] }[],
  kind: StitchCommandKind,
  docs: { doc: { id: string; title: string } }[] = [],
): Set<string> | null {
  if (history.length === 0 || !refersBack(command) || asksMore(command)) return null;
  const cited = citedAliases(history, blockByRef);
  if (cited.length === 0) return null;
  if (names.some((n) => !n.aliases.some((a) => cited.includes(a)))) return null;
  const citedDocs = new Set(cited.map((a) => blockByRef.get(a)?.documentId));
  for (const word of new Set(tokenize(command))) {
    const titled = titleMatches(docs, word);
    if (titled.length > 0 && !titled.some((d) => citedDocs.has(d.doc.id))) return null;
  }
  // The answer pass reads on the answer model, uncached: past BACK_BUDGET
  // the select pass's few blocks cost less than every block cited.
  const cost = cited.reduce((sum, a) => sum + blockCost(blockByRef.get(a)?.text ?? ""), 0);
  if (cost > BACK_BUDGET) return null;
  return cutSelection(cited, blockByRef, kind);
}

/** The ids one select call may name (COST5-01): the kind's block cap
    (STITCH_SELECTED_BLOCKS) shared over the groups, twice over, so a group
    that holds most of the answer still names enough, and never under
    SELECT_GROUP_MIN. One group names up to the cap. The answer pass reads
    no more than the cap in all, so ids past a group's share were written,
    paid for and waited on, and then cut. */
export function groupMaxBlocks(kind: StitchCommandKind, groups: number): number {
  const cap = STITCH_SELECTED_BLOCKS[kind];
  if (groups <= 1) return cap;
  return Math.min(cap, Math.max(SELECT_GROUP_MIN, Math.ceil((2 * cap) / groups)));
}

// The document letter of an alias (B12 → B).
const blockLetter = (alias: string) => /^[A-Z]+/.exec(alias)?.[0] ?? "";

/** Run one Stitch command. Throws with the reason on a failed model call. */
export async function stitch(input: {
  notebookId: string;
  // The documents to read: the ones selected in the graph, or null for
  // every attached document.
  documentIds: string[] | null;
  userId: string | null;
  lang: Lang;
  command: string;
  history: StitchTurn[];
  signal?: AbortSignal;
  onFailure: (reason: string) => Error;
  // The answer pass's history-first threshold, for a check that compares
  // the two layouts; STITCH_HISTORY_FIRST_MIN when absent.
  historyFirstMin?: number;
}): Promise<StitchResult> {
  const docs = await loadDocuments(input.notebookId, input.documentIds, { generated: STITCH_READS_GENERATED });
  const reading = readingOf(docs);
  const { rendered, read, blockByRef } = reading;
  const coverage = rendered.map((r) => r.coverage);
  // Fewer than two documents read: no links can be drawn and no page can rest
  // on the docs, so nothing runs and nothing is stored. The result says
  // what was read of every document and why the rest were not.
  if (read.length < 2) return { reply: "", linkCount: 0, document: null, documents: coverage, cited: {} };

  const profile = await loadProfile(input.notebookId);
  const history = await stitchHistory(input.history, reading, input.notebookId);
  const kind = commandKind(input.command);
  const lang = replyLanguage(input.command, input.lang);
  // The stitch feature's model answers (lib/feature-models.ts); the
  // stitch-select feature's model reads the skeletons in the route and
  // select passes, each at its own effort.
  const answer = await featureCall("stitch", STITCH_EFFORT);
  const model = answer.model;
  const usage = { userId: input.userId, feature: "stitch" as const, model: answer.modelId, pass: "answer" as const };

  // ── The reading passes: the blocks the command needs, from the skeletons ──
  let selected: Set<string> | null = null;
  // The command's rare names (nameHits), for the back selection and the
  // answer pass.
  const names = reading.tokens > STITCH_WHOLE_THRESHOLD ? nameHits(input.command, read.flatMap((r) => r.blocks), read.map((r) => r.doc.title)) : undefined;
  if (reading.tokens > STITCH_WHOLE_THRESHOLD) {
    // A command about the last answers reads the blocks they cited and
    // stored, with no select pass (ANS6-03). Only when the last answer came
    // back with its record: without it the history names no stored link or
    // page block (F4n, F5n: the block asked about was missing).
    const lastAnswer = [...input.history].reverse().find((t) => t.role === "assistant");
    if (lastAnswer?.record) selected = backSelection(input.command, history, blockByRef, names ?? [], kind, read);
  }
  const back = selected !== null;
  if (reading.tokens > STITCH_WHOLE_THRESHOLD && !selected) {
    selected = await pickBlocks({
      reading,
      command: input.command,
      history,
      profile,
      userId: input.userId,
      feature: "stitch",
      signal: input.signal,
      kind,
    }).catch((err: unknown) => {
      throw input.signal?.aborted ? input.onFailure("aborted") : err;
    });
  }

  // The links already in the project between the documents read: the
  // answer pass is told of the ones between blocks it reads, and a link it
  // proposes again is not stored again (ANS4-01). Removed links count, so
  // a link the reader removed is never proposed back.
  const docIds = docs.map((m) => m.id);
  const existingRows = await db.docLink.findMany({
    where: { fromDocumentId: { in: docIds }, toDocumentId: { in: docIds }, ...projectLinks(input.notebookId, { withHidden: true }) },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      recommended: true,
      hiddenIn: { where: { notebookId: input.notebookId }, select: { notebookId: true } },
      fromBlockId: true,
      startOffset: true,
      endOffset: true,
      toDocumentId: true,
      toBlockId: true,
      toStartOffset: true,
      toEndOffset: true,
      fromOrphaned: true,
      toOrphaned: true,
    },
  });
  // Each link's state in this project (WALK5-03): accepted, waiting under
  // Recommended links, or removed. A link whose quote an edit removed
  // (fromOrphaned, toOrphaned) is left out (ANS7-02): it is not "already in
  // the graph" for the new text, it is never lit, and a link on the new
  // text is stored. The row is not touched and is drawn as before.
  const existing = liveLinks(existingRows).map((l) => ({ ...l, state: existingState(l) }));
  const aliasOf = (id: string | null) => (id ? blockByRef.get(id)?.alias : undefined);
  const existingAliases = existing.flatMap((l) => {
    const from = aliasOf(l.fromBlockId);
    const to = aliasOf(l.toBlockId);
    return from && to ? [{ id: l.id, from, to, state: l.state }] : [];
  });

  // The documents a pick left out: the answer pass is told of them, and the
  // box says how many (ANS6-02).
  const notPicked = input.documentIds ? await notPickedOf(input.notebookId, docs.map((d) => d.id), input.command, reading.words) : undefined;

  // ── The answer pass ──────────────────────────────────────────────────────
  const result = await callForJson({
    model,
    messages: answerMessages({
      reading,
      selected,
      lang,
      profile,
      history,
      command: input.command,
      names: selected ? names : undefined,
      back,
      links: existingAliases,
      historyFirstMin: input.historyFirstMin,
      notPicked,
    }),
    maxOutputTokens: STITCH_MAX_OUTPUT_TOKENS,
    providerOptions: answer.providerOptions,
    schema: outputSchema,
    label: "STITCH",
    usage,
    abortSignal: input.signal,
  });
  if (!result.ok) throw input.onFailure(result.error);
  // Stop pressed while the model answered: nothing is stored.
  if (input.signal?.aborted) throw input.onFailure("aborted");

  // ── Links: block to block across docs, stored recommended ─────────────
  // A link that joins the same two blocks as a link already in the project
  // or one stored just before, with an end overlapping it, is that link
  // again (duplicateOf): not stored, and counted by its state. Every link
  // proposed keeps its place in the record (ANS5-02), so "the third one"
  // is the reply's third link.
  const kept: { ends: LinkEnds; id: string; state: ExistingState | "new" }[] = existing.map((l) => ({
    ends: [
      { block: l.fromBlockId, start: l.startOffset, end: l.endOffset },
      { block: l.toBlockId ?? l.toDocumentId, start: l.toStartOffset ?? 0, end: l.toEndOffset ?? Number.MAX_SAFE_INTEGER },
    ],
    id: l.id,
    state: l.state,
  }));
  let linkCount = 0;
  let linksExisting = 0;
  const again: Record<ExistingState, number> = { accepted: 0, waiting: 0, removed: 0 };
  const linkIds: string[] = [];
  const existingLinkIds = new Set<string>();
  const recordLinks: StitchRecord["links"] = [];
  const titleOf = new Map(rendered.map((r) => [r.doc.id, r.doc.title]));
  const generatedIds = new Set(rendered.filter((r) => r.doc.generatedCommand).map((r) => r.doc.id));
  // A link between a passage and its word-for-word copy is not stored, and
  // an end on a copy moves to the original (ANS6-07).
  const originals = result.data.links.length > 0 ? copyOriginals(rendered) : new Map<string, DocBlock>();
  const original = (end: Resolved | null): Resolved | null => {
    const o = end ? originals.get(end.blockId) : undefined;
    if (!end || !o) return end;
    const whole = end.startOffset === 0 && end.endOffset === (blockByRef.get(end.blockId)?.text.length ?? -1);
    return resolveQuote(blockByRef, o.id, whole ? undefined : end.quotedText) ?? end;
  };
  let linksCopied = 0;
  for (const link of result.data.links) {
    const named = [resolveQuote(blockByRef, link.fromBlockId, link.fromQuote), resolveQuote(blockByRef, link.toBlockId, link.toQuote)];
    const copied =
      named[0] !== null && named[1] !== null &&
      copyPair(
        blockByRef.get(named[0].blockId)?.text ?? "",
        blockByRef.get(named[1].blockId)?.text ?? "",
        generatedIds.has(named[0].documentId) || generatedIds.has(named[1].documentId),
      );
    const from = original(named[0]);
    const to = original(named[1]);
    const sides = { from: from ? (titleOf.get(from.documentId) ?? "") : "", to: to ? (titleOf.get(to.documentId) ?? "") : "" };
    if (from && to && (copied || from.blockId === to.blockId || (from.documentId === to.documentId && named[0]?.documentId !== named[1]?.documentId))) {
      linksCopied++;
      recordLinks.push({ id: "", ...sides, status: "copy" });
      continue;
    }
    if (!from || !to || from.documentId === to.documentId || linkCount >= MAX_LINKS) {
      recordLinks.push({ id: "", ...sides, status: "unstored" });
      continue;
    }
    const ends: LinkEnds = [
      { block: from.blockId, start: from.startOffset, end: from.endOffset },
      { block: to.blockId, start: to.startOffset, end: to.endOffset },
    ];
    const same = duplicateOf(ends, kept.map((k) => k.ends));
    if (same !== -1) {
      const k = kept[same];
      linksExisting++;
      if (k.state !== "new") again[k.state]++;
      if (k.state !== "removed" && k.state !== "new") existingLinkIds.add(k.id);
      recordLinks.push({ id: k.id, ...sides, status: k.state === "removed" ? "removed" : "existing" });
      continue;
    }
    const made = await db.docLink.create({
      data: {
        recommended: true,
        reason: link.reason.trim(),
        createdById: input.userId,
        notebookId: input.notebookId,
        fromDocumentId: from.documentId,
        fromBlockId: from.blockId,
        startOffset: from.startOffset,
        endOffset: from.endOffset,
        quotedText: from.quotedText,
        prefix: from.prefix,
        suffix: from.suffix,
        toDocumentId: to.documentId,
        toBlockId: to.blockId,
        toStartOffset: to.startOffset,
        toEndOffset: to.endOffset,
        toQuotedText: to.quotedText,
        toPrefix: to.prefix,
        toSuffix: to.suffix,
      },
    });
    kept.push({ ends, id: made.id, state: "new" });
    linkIds.push(made.id);
    recordLinks.push({ id: made.id, ...sides });
    linkCount++;
  }

  // ── The generated document ───────────────────────────────────────────────
  // A page made by a follow-up records the earlier command it continues
  // too (pageCommand), so Generated content says what "make that a page"
  // made a page of.
  // Titles in quote marks are not quotes: the documents read, and the
  // pages the earlier turns stored.
  const titles = new Set([
    ...rendered.map((r) => r.doc.title),
    ...input.history.flatMap((t) => (t.record?.document ? [t.record.document.title] : [])),
  ]);
  let document: StitchResult["document"] = null;
  let pageNote = "";
  if (result.data.document && !input.signal?.aborted) {
    const parts = result.data.document.parts.slice(0, MAX_PARTS);
    const page = await materializeGenerated({
      notebookId: input.notebookId,
      userId: input.userId,
      command: pageCommand(input.command, history, partBlocks(parts, blockByRef), blockByRef),
      title: result.data.document.title.trim(),
      parts,
      blockById: blockByRef,
      titles,
    });
    document = page?.document ?? null;
    if (page) pageNote = pageCountNote(page.counts, lang);
  }

  if (linkCount > 0 || document) await bumpNotebook(input.notebookId);
  const checked = checkReplyQuotes(result.data.reply.trim(), blockByRef, titles);
  if (checked.unquoted.length > 0) console.warn(`[stitch] ${checked.unquoted.length} quote(s) in the reply not in the blocks cited; shown without quote marks`);
  // The reply says how many of the links it proposed were already in the
  // project, one line per state (WALK5-03), so its count and the links
  // stored agree, and the reader knows where to find each.
  const t = translatorFor(lang);
  const existingNote = (["accepted", "waiting", "removed"] as const)
    .filter((state) => again[state] > 0)
    .map((state) => t(`stitch.${EXISTING_NOTE[state]}${again[state] === 1 ? "1" : "N"}`, { n: again[state] }))
    .concat(linksCopied > 0 ? [t(`stitch.stitchLinksCopy${linksCopied === 1 ? "1" : "N"}`, { n: linksCopied })] : [])
    .join(" ");
  // When some of two or more links proposed were not added, the note leads
  // with how many were (ANS7-06): the reply's "I proposed 2 links" is then
  // not read as 2 added.
  const proposed = result.data.links.length;
  const addedLead =
    existingNote && proposed >= 2 && linkCount < proposed
      ? t(`stitch.stitchLinksAdded${linkCount === 0 ? "None" : linkCount === 1 ? "Of1" : "OfN"}`, { n: proposed, added: linkCount })
      : "";
  const linksNote = [addedLead, existingNote].filter(Boolean).join(" ");
  // The links already in the project the answer is about are lit with the
  // new ones (ANS5-05): every one a links command was told of, and any
  // whose two blocks the reply cites side by side.
  for (const id of existingNamed(checked.reply, existingAliases, selected, kind === "links")) existingLinkIds.add(id);
  const reply = replyWithIds([checked.reply, pageNote, linksNote].filter(Boolean).join("\n\n"), blockByRef);
  // No reply and nothing stored: the reader would see an empty turn.
  if (!reply && linkCount === 0 && !document) throw input.onFailure(STITCH_EMPTY_ANSWER);
  const picked = selected;
  const documents = picked
    ? coverage.map((c) => {
        if (c.status !== "read") return c;
        const r = rendered.find((x) => x.doc.id === c.id);
        return { ...c, shown: r ? r.blocks.filter((b) => picked.has(b.alias)).length : 0 };
      })
    : coverage;
  const record: StitchRecord = { links: recordLinks, document };
  return {
    reply,
    linkCount,
    linkIds,
    linksExisting,
    existingLinkIds: [...existingLinkIds],
    record,
    document,
    documents,
    cited: citedBlocks(reply, blockByRef, titleOf),
    ...(notPicked && notPicked.count > 0 ? { notPicked: notPicked.count } : {}),
  };
}

// Folded chars a block needs before one that holds it whole counts as its
// copy (copyPair): a short heading inside a long passage is not a copy.
const COPY_MIN = 40;
// Outside a generated document, the share of the longer block the shorter
// must fill for containment to count as a copy (REV7-05): a commentary that
// quotes a passage whole is a link, not a copy.
const COPY_SHARE = 0.8;

/** True when one block is a word-for-word copy of the other (ANS6-07): the
    folded texts are equal, or the longer holds the shorter whole, the
    shorter has COPY_MIN folded chars or more, and either an end lies in a
    generated document or the shorter is COPY_SHARE of the longer. */
export function copyPair(a: string, b: string, generated = false): boolean {
  const x = foldQuote(a);
  const y = foldQuote(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= COPY_MIN && (generated || short.length >= COPY_SHARE * long.length) && long.includes(short);
}

/** The original of every copied block of the documents read (ANS6-07), by
    the copy's stored id: the first block with the same folded text, in a
    document that is not a generated document when one holds it, else in
    the earlier document. Blocks under COPY_MIN folded chars have none. */
export function copyOriginals(rendered: { doc: { generatedCommand: string | null }; blocks: DocBlock[] }[]): Map<string, DocBlock> {
  const first = new Map<string, DocBlock>();
  const all: [string, DocBlock][] = [];
  const order = [...rendered.filter((r) => !r.doc.generatedCommand), ...rendered.filter((r) => r.doc.generatedCommand)];
  for (const r of order) {
    for (const b of r.blocks) {
      const key = foldQuote(b.text);
      if (key.length < COPY_MIN) continue;
      all.push([key, b]);
      if (!first.has(key)) first.set(key, b);
    }
  }
  const out = new Map<string, DocBlock>();
  for (const [key, b] of all) {
    const original = first.get(key);
    if (original && original.id !== b.id) out.set(b.id, original);
  }
  return out;
}

/** A link's two ends: each end's block (or the document, for a link to a
    whole document) and its range in the block. */
export type LinkEnds = [{ block: string; start: number; end: number }, { block: string; start: number; end: number }];

/** True when a link of `kept` joins the same two blocks as `link`, in
    either direction, and overlaps it on at least one end: the same link
    proposed again, though its quote differs by a word or its direction is
    reversed. Two links between other passages of the same two blocks are
    two links. */
export function duplicateLink(link: LinkEnds, kept: LinkEnds[]): boolean {
  return duplicateOf(link, kept) !== -1;
}

/** The index in `kept` of the link `link` repeats (duplicateLink), or -1. */
export function duplicateOf(link: LinkEnds, kept: LinkEnds[]): number {
  const overlaps = (a: LinkEnds[number], b: LinkEnds[number]) => a.block === b.block && a.start < b.end && b.start < a.end;
  const [x, y] = link;
  return kept.findIndex(([a, b]) =>
    a.block === x.block && b.block === y.block
      ? overlaps(a, x) || overlaps(b, y)
      : a.block === y.block && b.block === x.block && (overlaps(a, y) || overlaps(b, x)),
  );
}

/** A link's state in the project the command runs in (WALK5-03). */
export type ExistingState = "accepted" | "waiting" | "removed";
/** The links whose two quotes are still in their blocks (ANS7-02): an
    edit that removed a link's quote marks that end orphaned
    (lib/docs/sync.ts). */
export function liveLinks<T extends { fromOrphaned: boolean; toOrphaned: boolean }>(rows: T[]): T[] {
  return rows.filter((l) => !l.fromOrphaned && !l.toOrphaned);
}

function existingState(l: { recommended: boolean; hiddenIn: unknown[] }): ExistingState {
  return l.hiddenIn.length > 0 ? "removed" : l.recommended ? "waiting" : "accepted";
}
// The reply's line per state of the links proposed again.
const EXISTING_NOTE = {
  accepted: "stitchLinksExisting",
  waiting: "stitchLinksWaiting",
  removed: "stitchLinksRemoved",
} as const satisfies Record<ExistingState, string>;

// The end of a sentence of a reply (existingNamed): a CJK full stop, or a
// Latin one before a capital, a quote mark, or a tag.
const SENTENCE_END = /(?<=[。！？])|(?<=[.!?])\s+(?=["“'(\[\p{Lu}])/u;

/** The links already in the project a reply is about (ANS5-05), as ids:
    with `all` (a links command), every one the answer pass was told of —
    both blocks shown (existingPairs) — the reply's "these are already in
    the graph"; else the ones whose two blocks the reply cites one after
    the other in one sentence, [block G6] – [block B20], [block G6] [block
    B20], or "Mencken says … [block A8]; the notes say … [block G7].", or
    in two sentences of one paragraph when one of them cites only that
    block. A removed
    link is never lit: it is not drawn. reply: the model's, with aliases. */
export function existingNamed(
  reply: string,
  links: { id: string; from: string; to: string; state: ExistingState }[],
  selected: Set<string> | null,
  all: boolean,
): string[] {
  const shown = (alias: string) => !selected || selected.has(alias);
  const visible = links.filter((l) => l.state !== "removed");
  if (all) return visible.filter((l) => shown(l.from) && shown(l.to)).map((l) => l.id);
  const pairs = new Set<string>();
  // Two tags one after the other pair inside one sentence, and across a
  // sentence end of one paragraph only when one of the two is its
  // sentence's only tag (ANS6-06): "§225 [block E2] [block D32]. Link 3
  // joins … [block G9] [block E21]" names E2–D32 and G9–E21, not D32–G9;
  // "… [block B30]. Your notes agree: … [block G6]." names B30–G6.
  for (const line of reply.split("\n")) {
    let last: string[] = [];
    for (const sentence of line.split(SENTENCE_END)) {
      const tags = [...sentence.matchAll(/\[block ([A-Za-z]+\d+)\]/g)].map((m) => m[1].toUpperCase());
      if (tags.length === 0) continue;
      if (last.length > 0 && (last.length === 1 || tags.length === 1)) pairs.add([last[last.length - 1], tags[0]].sort().join("|"));
      for (let i = 1; i < tags.length; i++) pairs.add([tags[i - 1], tags[i]].sort().join("|"));
      last = tags;
    }
  }
  return visible.filter((l) => pairs.has([l.from, l.to].sort().join("|"))).map((l) => l.id);
}

/** The stored blocks a page's parts quote or rest on. */
function partBlocks(parts: Part[], blockByRef: Map<string, DocBlock>): Set<string> {
  const out = new Set<string>();
  for (const part of parts) {
    const refs = part.kind === "quote" ? [part.blockId] : part.kind === "text" ? part.sources.map((s) => s.blockId) : [];
    for (const ref of refs) {
      const block = blockByRef.get(ref.trim()) ?? blockByRef.get(ref.trim().toUpperCase());
      if (block) out.add(block.id);
    }
  }
  return out;
}

/** The command a generated page records (ANS4-10): the command, after the
    earliest earlier command whose answer cited at least two of the blocks
    the page rests on (one, when the page rests on one), so Generated
    content says what "make that a page" made a page of; the command alone
    when no earlier answer did. history: the turns as the passes read them
    (aliases), each answer with its record. */
export function pageCommand(command: string, history: ModelMessage[], pageBlocks: Set<string>, blockByRef: Map<string, DocBlock>): string {
  const need = Math.min(2, pageBlocks.size);
  if (need === 0) return command;
  for (let i = 1; i < history.length; i++) {
    const m = history[i];
    const asked = history[i - 1];
    if (m.role !== "assistant" || asked.role !== "user") continue;
    const cited = new Set<string>();
    for (const tag of textOf(m).matchAll(BLOCK_TAG)) {
      const block = blockByRef.get(tag[1]);
      if (block && pageBlocks.has(block.id)) cited.add(block.id);
    }
    if (cited.size >= need) return `${textOf(asked).trim()}${COMMAND_CHAIN}${command}`;
  }
  return command;
}

type Part = z.infer<typeof partSchema>;

/** A text part's sources spread over its blocks (ANS4-03): each source on
    the block whose words its quote shares most (the first on a tie), and a
    block of text that gets none takes the part's first source, so every
    paragraph and list item of the part clicks back to a block it rests on.
    A heading gets none. One block: every source on it. */
export function assignSources<S extends { quotedText: string }>(blocks: { type: string; text: string }[], sources: S[]): S[][] {
  const out: S[][] = blocks.map(() => []);
  if (blocks.length === 0 || sources.length === 0) return out;
  // Words of three letters or more, and CJK characters: "the" and "of"
  // tell no two paragraphs apart.
  const keyWords = (t: string) => new Set(spanWords(t).filter((w) => w.length >= 3 || /[㐀-鿿]/.test(w)));
  const text = blocks.map((b, i) => ({ i, heading: b.type === "HEADING", words: keyWords(b.text) })).filter((b) => !b.heading);
  if (text.length === 0) {
    out[0] = [...sources];
    return out;
  }
  for (const source of sources) {
    const words = keyWords(source.quotedText);
    let best = text[0];
    let bestScore = -1;
    for (const b of text) {
      let score = 0;
      for (const w of words) if (b.words.has(w)) score++;
      if (score > bestScore) {
        best = b;
        bestScore = score;
      }
    }
    out[best.i].push(source);
  }
  for (const b of text) if (out[b.i].length === 0) out[b.i].push(sources[0]);
  return out;
}

/** A quote part's blocks (ANS7-05): one paragraph, in italic over its whole
    text, so the documents' words read apart from the page's own writing. A
    leading list, heading or quote marker ("157. The thought of suicide…",
    "- ", "# ", "> ") stays as written, so the passage is not a list item;
    the rest parses as markdown, as before, so "_mistake_" is italic. A quote
    of any other block (a list, a table, a transcript line) parses as
    markdown, as before. */
export function quoteBlocks(text: string, sourceType: string | undefined): ParsedBlock[] {
  if (sourceType !== "PARAGRAPH" && sourceType !== "HEADING") return parseMarkdown(text);
  const lead = /^\s*(?:\d+[.)]|[-*+]|#{1,6}|>)\s+/.exec(text)?.[0] ?? "";
  const parsed = parseMarkdown(text.slice(lead.length));
  const one = parsed.length === 1 && parsed[0].type === "PARAGRAPH" && !parsed[0].html ? parsed[0] : null;
  const shift = <S extends { start: number; end: number }>(spans: S[] | undefined): S[] =>
    (spans ?? []).map((sp) => ({ ...sp, start: sp.start + lead.length, end: sp.end + lead.length }));
  const block: ParsedBlock = one
    ? { ...one, text: lead + one.text, styles: shift(one.styles), citations: one.citations && shift(one.citations), links: one.links && shift(one.links) }
    : { type: "PARAGRAPH", text };
  const italic = { start: 0, end: block.text.length, style: "italic" as const, quotedText: block.text };
  return [{ ...block, styles: [italic, ...(block.styles ?? [])] }];
}

// The generated document: parts become markdown, the markdown becomes blocks
// (lib/parse/markdown.ts), and every part links back to the document block it
// came from — a quote part to the passage it copied, a text part to each of
// its sources. Null when no part resolved: an empty page is not a document.
async function materializeGenerated(input: {
  notebookId: string;
  userId: string | null;
  command: string;
  title: string;
  parts: Part[];
  blockById: Map<string, DocBlock>;
  // The titles of the documents read: a title in quote marks is not a quote.
  titles: Set<string>;
}): Promise<{ document: NonNullable<StitchResult["document"]>; counts: PageCounts } | null> {
  // One markdown chunk per part, and the sources each chunk carries. A quote
  // part's text is the resolved passage, never the model's copy of it.
  const chunks: { markdown: string; sources: Resolved[]; kind: Part["kind"] }[] = [];
  // The passage of the part just before: the same passage twice in a row is
  // one passage. A passage two pairs or two sections share is kept in each
  // (ANS5-04): a page of links quotes both sides of every link.
  let lastQuote = "";
  for (const part of input.parts) {
    if (part.kind === "heading") {
      const text = part.text.trim().replace(/^#+\s*/, "");
      if (text) chunks.push({ markdown: `## ${text}`, sources: [], kind: "heading" });
      lastQuote = "";
    } else if (part.kind === "quote") {
      const resolved = resolveQuote(input.blockById, part.blockId, part.quote);
      if (!resolved || !resolved.quotedText.trim()) continue;
      const key = `${resolved.blockId}|${resolved.startOffset}|${resolved.endOffset}`;
      if (key === lastQuote) continue;
      lastQuote = key;
      chunks.push({ markdown: resolved.quotedText, sources: [resolved], kind: "quote" });
    } else {
      // A quote in the writing that is in no block read loses its quote
      // marks, as in the reply (ANS4-04).
      const checked = checkReplyQuotes(part.markdown.trim(), input.blockById, input.titles);
      if (checked.unquoted.length > 0) console.warn(`[stitch] ${checked.unquoted.length} quote(s) in a page's text part not in the blocks read; shown without quote marks`);
      const markdown = checked.reply;
      if (!markdown) continue;
      const sources = part.sources
        .map((s) => resolveQuote(input.blockById, s.blockId, s.quote))
        .filter((s): s is Resolved => s !== null);
      chunks.push({ markdown, sources, kind: "text" });
      lastQuote = "";
    }
  }
  if (!chunks.some((c) => c.sources.length > 0)) return null;

  // Each chunk parses on its own, so a chunk's blocks are known exactly; the
  // document is the chunks' blocks in order.
  const rows: (Pick<ParsedBlock, "type" | "text" | "html" | "citations" | "styles" | "links"> & {
    order: number;
    sources: Resolved[];
  })[] = [];
  for (const chunk of chunks) {
    const blocks = chunk.kind === "quote" ? quoteBlocks(chunk.markdown, input.blockById.get(chunk.sources[0].blockId)?.type) : parseMarkdown(chunk.markdown);
    // Each block of a text part of several paragraphs or list items gets
    // its own sources (ANS4-03); a quote part is one block.
    const sources = assignSources(blocks, chunk.sources);
    blocks.forEach((b, i) => {
      rows.push({
        order: rows.length,
        type: b.type,
        text: b.text,
        html: b.html,
        citations: b.citations,
        styles: b.styles,
        links: b.links,
        sources: sources[i],
      });
    });
  }
  if (rows.length === 0) return null;

  const created = await db.$transaction(async (tx) => {
    const doc = await tx.document.create({
      data: {
        title: input.title,
        parserVersion: PARSER_VERSION,
        generatedCommand: input.command.slice(0, 4_000),
      },
    });
    const blocks = await Promise.all(
      rows.map((row) =>
        tx.block.create({
          data: {
            documentId: doc.id,
            order: row.order,
            type: row.type,
            text: row.text,
            html: row.html,
            citations: row.citations,
            styles: row.styles,
            links: row.links,
          },
          select: { id: true, text: true },
        }),
      ),
    );
    // Provenance (SPEC.md §1): every part clicks back to the document block it
    // came from. The whole generated block is the anchor on this side.
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const block = blocks[i];
      if (!block.text.trim()) continue;
      for (const source of row.sources) {
        await tx.docLink.create({
          data: {
            recommended: false,
            reason: null,
            createdById: input.userId,
            notebookId: input.notebookId,
            fromDocumentId: doc.id,
            fromBlockId: block.id,
            startOffset: 0,
            endOffset: block.text.length,
            quotedText: block.text,
            prefix: "",
            suffix: "",
            toDocumentId: source.documentId,
            toBlockId: source.blockId,
            toStartOffset: source.startOffset,
            toEndOffset: source.endOffset,
            toQuotedText: source.quotedText,
            toPrefix: source.prefix,
            toSuffix: source.suffix,
          },
        });
      }
    }
    return doc;
  });
  await attachDocument(input.notebookId, created.id);
  // What the page holds, as stored: the reply states it (ANS5-04).
  const counts: PageCounts = {
    quotes: chunks.filter((c) => c.kind === "quote").length,
    headings: chunks.filter((c) => c.kind === "heading").length,
    texts: chunks.filter((c) => c.kind === "text").length,
  };
  return { document: { id: created.id, title: created.title }, counts };
}

/** A generated page's parts as stored: quote parts, headings, and text
    parts (one paragraph or one list of the writing each). */
export type PageCounts = { quotes: number; headings: number; texts: number };

/** The reply's line on what a page holds (ANS5-04): the server counts the
    page, so the reply's count is the page's. "The page holds 7 quotes,
    3 headings, and 6 paragraphs of writing." */
export function pageCountNote(counts: PageCounts, lang: Lang): string {
  const t = translatorFor(lang);
  const items = (["quotes", "headings", "texts"] as const)
    .filter((k) => counts[k] > 0)
    .map((k) => t(`stitch.stitchPage_${k}${counts[k] === 1 ? "1" : "N"}`, { n: counts[k] }));
  if (items.length === 0) return "";
  const list =
    items.length === 1
      ? items[0]
      : `${items.slice(0, -1).join(t("stitch.stitchPageListComma"))}${t(items.length === 2 ? "stitch.stitchPageListAnd2" : "stitch.stitchPageListAnd")}${items[items.length - 1]}`;
  return t("stitch.stitchPageHolds", { list });
}
