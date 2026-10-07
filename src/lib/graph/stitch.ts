import type { ModelMessage } from "ai";
import { z } from "zod";
import { matchInText } from "@/lib/anchors/match";
import { bumpNotebook } from "@/lib/collab";
import { db } from "@/lib/db";
import {
  STITCH_EFFORT,
  STITCH_GROUP_CONCURRENCY,
  STITCH_GROUPED_MAX,
  STITCH_HISTORY_MAX,
  STITCH_MAX_OUTPUT_TOKENS,
  STITCH_QUESTION_SKELETON,
  STITCH_READ_HISTORY,
  STITCH_READS_GENERATED,
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
import { featureCall } from "@/lib/feature-models";
import { attachDocument } from "@/lib/parse/attach";
import { parseMarkdown } from "@/lib/parse/markdown";
import { PARSER_VERSION, type ParsedBlock } from "@/lib/parse/types";
import { ensureSkeleton, type Skeleton } from "@/lib/graph/skeleton";
import { jevRouteParts, jevSelectLines } from "@/lib/graph/stitch-jev";
import { jevEnabled, mapLimit } from "@/lib/jev";
import { rank } from "@/lib/graph/rank";
import {
  stitchPrompt,
  stitchRoutePrompt,
  stitchRouteRules,
  stitchRules,
  stitchSelectPrompt,
  stitchSelectRules,
  type StitchDocumentCtx,
} from "@/lib/prompts/stitch";
import { profileLines } from "@/lib/prompts/types";
import { estTokens } from "@/lib/tokens";
import type { StitchCommandKind, StitchDocument, StitchResult } from "@/lib/types";
import { transcriptIsStale } from "@/lib/video/types";

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
const MAX_CITED = 40; // blocks of the earlier answers the reading passes are told of
const CITED_TEXT = 600; // chars of a cited block's text in the result

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
    selection (STITCH_SELECTED_BUDGET): a page (gather, collect, write,
    summarise), links (connect, contradictions), or else an answer. A rule,
    not a model call: the kind is needed before the select pass runs — a
    question's select pass reads the lines ranked against it — and on the
    whole read, which has no select pass; it costs nothing and reads the
    same every time. A command the rule misses reads as a question, whose
    budget still holds about 60,000 characters of the blocks picked. */
export function commandKind(command: string): StitchCommandKind {
  const c = command.toLowerCase();
  if (
    /\b(gather|collect|compile|write|draft|pages?|combine|summari[sz]e|summary|synthesi[sz]e|synthesis|outline|every passage|all (the )?passages)\b|汇集|收集|汇总|整理|写一|写成|一页|页面|合并|总结|概括|综述/.test(c)
  )
    return "page";
  if (/\b(contradict\w*|disagree\w*|conflict\w*|connect\w*|links?|linking)\b|矛盾|冲突|分歧|连接|关联|联系/.test(c)) return "links";
  return "question";
}

export type StitchTurn = { role: "user" | "assistant"; content: string };

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

/** A quote against the blocks: in the named block first; then, when the
    model named the wrong block, exact in any block; then the named block
    whole — a quote that was not copied verbatim still points at real text.
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
    orderBy: { document: { createdAt: "asc" } },
    include: {
      document: {
        select: {
          id: true,
          title: true,
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

function header(letter: string, doc: Doc, note: string): string {
  return `[document ${letter}] "${doc.title}" (${note})`;
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
};

function renderDocument(doc: Doc, index: number): Rendered {
  const letter = documentLetter(index);
  const kind = docKind(doc);
  const blocks = docBlocks(doc, letter);
  const base = { id: doc.id, title: doc.title, kind, total: blocks.length };
  if (blocks.length === 0) {
    const coverage: StitchDocument = { ...base, status: "empty", blocks: 0, shown: null, ...emptyReason(doc) };
    return { letter, doc, blocks, coverage, section: header(letter, doc, coverageNote(coverage)) };
  }
  const coverage: StitchDocument = { ...base, status: "read", blocks: blocks.length, shown: null, reason: null, detail: null };
  return {
    letter,
    doc,
    blocks,
    coverage,
    section: `${header(letter, doc, coverageNote(coverage))}\n${aliasedLines(blocks, doc)}`,
  };
}

/** Every document rendered, in order. length: the chars of document text;
    tokens: its estimated tokens (lib/tokens.ts). */
function renderDocuments(docs: Doc[]): { rendered: Rendered[]; length: number; tokens: number } {
  const rendered = docs.map((doc, index) => renderDocument(doc, index));
  return {
    rendered,
    length: rendered.reduce((sum, r) => sum + r.section.length, 0),
    tokens: rendered.reduce((sum, r) => sum + estTokens(r.section), 0),
  };
}

/** The selected blocks: every document in order, its header saying how
    many of its blocks are shown, the blocks in reading order, a gap between
    two shown blocks declared. A document with nothing to read is declared
    with its reason, as in the whole rendering. */
function selectedSections(rendered: Rendered[], selected: Set<string>): string {
  const sections: string[] = [];
  for (const r of rendered) {
    if (r.coverage.status === "empty") {
      sections.push(r.section);
      continue;
    }
    const shown = r.blocks.filter((b) => selected.has(b.alias));
    const head = header(r.letter, r.doc, coverageNote(r.coverage, shown.length));
    if (shown.length === 0) {
      sections.push(head);
      continue;
    }
    const lines: string[] = [];
    let last = -1;
    for (const block of shown) {
      const at = r.blocks.indexOf(block);
      if (last !== -1 && at - last > 1) lines.push(`(${at - last - 1} blocks not shown)`);
      lines.push(aliasedLines([block], r.doc));
      last = at;
    }
    sections.push(`${head}\n${lines.join("\n\n")}`);
  }
  return sections.join("\n\n");
}

/** The answer pass's messages: the system message (the rules, the reader
    context, then the documents whole or the blocks selected), the turns so
    far, and the command. selected: the aliases the reading passes picked,
    or null for the whole read. */
export function answerMessages(input: {
  reading: Reading;
  selected: Set<string> | null;
  lang: Lang;
  profile: Profile;
  history: ModelMessage[];
  command: string;
}): ModelMessage[] {
  const { rendered, documentList } = input.reading;
  const rules = stitchRules(input.lang);
  const system = input.selected
    ? systemOf(rules, input.profile, "The blocks a first read picked for the command follow.", selectedSections(rendered, input.selected))
    : systemOf(rules, input.profile, "Every document follows.", rendered.map((r) => r.section).join("\n\n"));
  return [
    { role: "system", content: system },
    ...input.history,
    {
      role: "user",
      content: stitchPrompt({
        documents: documentList,
        command: input.command,
        continued: input.history.length > 0,
        selected: input.selected !== null,
      }),
    },
  ];
}

// ── The skeletons as the reading passes see them ─────────────────────────

export type SkeletonLineView = { alias: string; text: string; partAlias: string | null };
export type SkeletonPartView = { alias: string; title: string; summary: string };
export type SkeletonView = {
  r: Rendered;
  gist: string;
  parts: SkeletonPartView[];
  lines: SkeletonLineView[];
};

/** A document's skeleton under its aliases: every line keyed by the alias
    of its block, every part by the alias of its first block, and each line
    under the part it falls in. */
function skeletonView(r: Rendered, skeleton: Skeleton): SkeletonView {
  const aliasOf = new Map(r.blocks.map((b) => [b.id, b.alias]));
  const parts = skeleton.parts.flatMap((p) => {
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
  return { r, gist: skeleton.gist, parts, lines };
}

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
        ? v.parts.map((p) => `[part at ${p.alias}] "${p.title}"${p.summary ? `: ${p.summary}` : ""}`).join("\n")
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
    the lines in `shown` (a gap between two shown lines declared), each
    part's summary above its first shown line. Byte-identical from turn to
    turn when every line is shown. */
function skeletonSystem(views: SkeletonView[], rendered: Rendered[], shown: Set<string> | null, profile: Profile): string {
  const byLetter = new Map(views.map((v) => [v.r.letter, v]));
  const sections = rendered.map((r) => {
    const v = byLetter.get(r.letter);
    if (!v) return r.section;
    const lines = shown ? v.lines.filter((l) => shown.has(l.alias)) : v.lines;
    const note = coverageNote(r.coverage);
    const out: string[] = [
      header(r.letter, r.doc, shown ? `${note}; ${lines.length} of ${v.lines.length} skeleton lines shown` : note),
    ];
    if (v.gist) out.push(`gist: ${v.gist}`);
    const partOf = new Map(v.parts.map((p) => [p.alias, p]));
    let lastIndex = -1;
    let lastPart: string | null = null;
    for (const line of lines) {
      const at = v.lines.indexOf(line);
      if (lastIndex !== -1 && at - lastIndex > 1) out.push(`(${at - lastIndex - 1} lines not shown)`);
      if (line.partAlias && line.partAlias !== lastPart) {
        const p = partOf.get(line.partAlias);
        if (p) out.push(`[part at ${p.alias}] "${p.title}"${p.summary ? `: ${p.summary}` : ""}`);
        lastPart = line.partAlias;
      }
      out.push(`[block ${line.alias}] ${line.text}`);
      lastIndex = at;
    }
    if (lines.length === 0) out.push("(no lines shown)");
    return out.join("\n");
  });
  return systemOf(
    stitchSelectRules(),
    profile,
    "Each document's skeleton follows: one line per block, tagged [block <alias>], what the block says at a tenth of its length.",
    sections.join("\n\n"),
  );
}

/** The lines the select pass reads when the skeletons run past the budget:
    the routed parts' lines, then — when they still run past it — the lines
    ranked against the command, every document keeping at least its share
    of the top so no document goes unread. Returns the aliases shown. */
function cutLines(views: SkeletonView[], routed: Set<string> | null, command: string, budget: number): Set<string> {
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

  const ranked = rank(candidates, (c) => `${c.l.text} ${c.v.parts.find((p) => p.alias === c.l.partAlias)?.title ?? ""}`, command);
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
    turn), else groups of about `group` chars in document order, a long
    document's lines over several groups. Each group: its documents and the
    aliases it shows. */
export function skeletonGroups(
  views: SkeletonView[],
  shown: Set<string> | null,
  budget: number,
  group: number,
): { views: SkeletonView[]; shown: Set<string> | null }[] {
  const lines = views.flatMap((v) => v.lines.filter((l) => !shown || shown.has(l.alias)).map((l) => ({ v, l })));
  const total = lines.reduce((sum, x) => sum + lineCost(x.l), 0);
  if (total <= budget) return [{ views, shown }];
  const groups: { views: SkeletonView[]; shown: Set<string> }[] = [];
  let open: { views: SkeletonView[]; shown: Set<string> } | null = null;
  let used = 0;
  for (const { v, l } of lines) {
    const cost = lineCost(l);
    if (!open || used + cost > group) {
      groups.push((open = { views: [], shown: new Set() }));
      used = 0;
    }
    if (open.views[open.views.length - 1] !== v) open.views.push(v);
    open.shown.add(l.alias);
    used += cost;
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

/** The documents' picks as one list, most relevant first across docs:
    every document's first pick, then every document's second, and so on, so
    the budget below is spent on every document alike rather than on the
    document listed first. */
export function interleave(lists: string[][]): string[] {
  const out: string[] = [];
  const longest = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < longest; i++) for (const list of lists) if (i < list.length) out.push(list[i]);
  return out;
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
  return reply.replace(/\[block ([A-Za-z]+\d+)\]/g, (tag, alias: string) => {
    const block = blockByRef.get(alias.toUpperCase());
    return block ? `[block ${block.id}]` : tag;
  });
}

const BLOCK_TAG = /\[block ([^\]\s]+)\]/g;

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

/** The conversation as the passes read it: the last STITCH_HISTORY_MAX
    turns with text, each turn's block tags as this reading's aliases
    (historyWithAliases). Only blocks of documents attached to the project
    are named by title. */
export async function stitchHistory(turns: StitchTurn[], reading: Reading, notebookId: string): Promise<ModelMessage[]> {
  const kept = turns.filter((t) => t.content.trim()).slice(-STITCH_HISTORY_MAX);
  const unknown = new Set<string>();
  for (const t of kept) for (const m of t.content.matchAll(BLOCK_TAG)) if (!reading.blockByRef.has(m[1])) unknown.add(m[1]);
  const titles = new Map<string, string>();
  if (unknown.size > 0) {
    const rows = await db.block.findMany({
      where: { id: { in: [...unknown].slice(0, 500) }, document: { notebooks: { some: { notebookId } } } },
      select: { id: true, document: { select: { title: true } } },
    });
    for (const row of rows) titles.set(row.id, row.document.title);
  }
  return kept.map((t) => ({ role: t.role, content: historyWithAliases(t.content, reading.blockByRef, titles) }));
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
  return { rendered, read, blockByRef, documentList, length, tokens };
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
  const query = [...earlier, input.command].join("\n");
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

  // Every document's skeleton: stored, patched for small edits, or built
  // now. A build that fails reads the document's first words.
  const skeletons = await Promise.all(read.map((r) => ensureSkeleton(r.doc, input.userId, input.signal)));
  if (input.signal?.aborted) aborted();
  const views = read.map((r, i) => skeletonView(r, skeletons[i]));
  const skeletonLength = views.reduce((sum, v) => sum + v.lines.reduce((n, l) => n + lineCost(l), 0), 0);

  // Past the budget the select pass reads every line in groups (below);
  // past what the groups can read, the route pass names the parts first,
  // and the lines are cut to them and, if still too many, ranked against
  // the command. Jev reads part by part, so it routes past the budget. A
  // question past the budget reads the lines ranked against it, one
  // call's worth: a question needs the few blocks that answer it, and the
  // groups' calls would read every line of the project for them.
  let shown: Set<string> | null = null;
  const jev = jevEnabled();
  const routeOver = jev ? STITCH_SKELETON_BUDGET : STITCH_GROUPED_MAX;
  if (skeletonLength > routeOver) {
    // Jev first (one noul per part), else the GLM route pass.
    let routed: Set<string> | null = jev ? await jevRouteParts(views, jevCommand, input.userId, input.signal) : null;
    if (input.signal?.aborted) aborted();
    if (!routed) {
      const route = await callForJson({
        model: readModel,
        messages: [
          { role: "system", content: routeSystem(views, rendered, profile) },
          {
            role: "user",
            content: stitchRoutePrompt({ documents: documentList, command: input.command, continued, earlier, cited, maxParts: MAX_ROUTED }),
          },
        ],
        maxOutputTokens: STITCH_SELECT_MAX_OUTPUT_TOKENS,
        providerOptions: readRoute.providerOptions,
        schema: routeSchema,
        label: "STITCH_ROUTE",
        usage: readUsage,
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
    shown = cutLines(views, routed, query, kind === "question" ? STITCH_QUESTION_SKELETON : routeOver);
  } else if (!jev && kind === "question" && skeletonLength > STITCH_SKELETON_BUDGET) {
    shown = cutLines(views, null, query, STITCH_QUESTION_SKELETON);
  }

  // The picks by document, most relevant first within each: Jev's (one
  // noul per line), else the GLM select pass's, one call per group of
  // lines, the groups at once. failed: the documents of a group whose
  // call failed; they read as their openings below.
  const failed = new Set<string>();
  let byDoc: Map<string, string[]> | null = jev
    ? await jevSelectLines(views, shown, jevCommand, input.userId, input.signal)
    : null;
  if (input.signal?.aborted) aborted();
  if (!byDoc) {
    const groups = skeletonGroups(views, shown, STITCH_SKELETON_BUDGET, STITCH_SKELETON_GROUP);
    const answers = await mapLimit(groups, STITCH_GROUP_CONCURRENCY, async (group) => {
      const letters = new Set(group.views.map((v) => v.r.letter));
      const pick = await callForJson({
        model: readModel,
        messages: [
          {
            role: "system",
            content: skeletonSystem(group.views, rendered.filter((r) => letters.has(r.letter)), group.shown, profile),
          },
          {
            role: "user",
            content: stitchSelectPrompt({
              documents: groups.length > 1 ? documentList.filter((d) => letters.has(d.tag)) : documentList,
              command: input.command,
              continued,
              earlier,
              cited: groups.length > 1 ? cited.filter((a) => letters.has(blockLetter(a))) : cited,
              maxBlocks: STITCH_SELECTED_BLOCKS[kind],
              partial: group.shown !== null,
            }),
          },
        ],
        maxOutputTokens: STITCH_SELECT_MAX_OUTPUT_TOKENS,
        providerOptions: readSelect.providerOptions,
        schema: selectSchema,
        label: "STITCH_SELECT",
        usage: readUsage,
        abortSignal: input.signal,
      });
      if (!pick.ok) {
        if (!input.signal?.aborted) console.warn("[stitch] select pass failed, reading the group's openings:", pick.error);
        for (const v of group.views) failed.add(v.r.doc.id);
        return [];
      }
      return pick.data.blockIds.flatMap(expandPick);
    });
    if (input.signal?.aborted) aborted();
    byDoc = new Map<string, string[]>(read.map((r) => [r.doc.id, []]));
    for (const alias of answers.flat()) {
      const block = blockByRef.get(alias);
      if (block) byDoc.get(block.documentId)?.push(alias);
    }
  }
  const share = Math.floor(STITCH_SELECTED_BUDGET[kind] / read.length);
  // A document the select pass read and picked nothing of is left out: its
  // header says none of its blocks are shown. A document whose call failed
  // reads as its opening. When nothing at all was picked, every document
  // reads as its opening, so the answer pass has text to say so from.
  const picksByDoc = byDoc;
  let picks = read.map((r) => {
    const own = picksByDoc.get(r.doc.id) ?? [];
    return own.length > 0 || !failed.has(r.doc.id) ? own : opening(r, share);
  });
  if (picks.every((p) => p.length === 0)) picks = read.map((r) => opening(r, share));
  if (input.signal?.aborted) aborted();
  return cutSelection(interleave(picks), blockByRef, kind);
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
  // The stitch feature's model answers (lib/feature-models.ts); the
  // stitch-select feature's model reads the skeletons in the route and
  // select passes, each at its own effort.
  const answer = await featureCall("stitch", STITCH_EFFORT);
  const model = answer.model;
  const usage = { userId: input.userId, feature: "stitch" as const, model: answer.modelId };

  // ── The reading passes: the blocks the command needs, from the skeletons ──
  let selected: Set<string> | null = null;
  if (reading.tokens > STITCH_WHOLE_THRESHOLD) {
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

  // ── The answer pass ──────────────────────────────────────────────────────
  const result = await callForJson({
    model,
    messages: answerMessages({ reading, selected, lang: input.lang, profile, history, command: input.command }),
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
  const existing = await db.docLink.findMany({
    where: { fromDocumentId: { in: docs.map((m) => m.id) }, OR: [{ notebookId: input.notebookId }, { notebookId: null }] },
    select: { fromBlockId: true, quotedText: true, toDocumentId: true, toBlockId: true },
  });
  const seen = new Set(existing.map((l) => `${l.fromBlockId}|${l.quotedText}|${l.toBlockId ?? l.toDocumentId}`));
  let linkCount = 0;
  for (const link of result.data.links) {
    if (linkCount >= MAX_LINKS) break;
    const from = resolveQuote(blockByRef, link.fromBlockId, link.fromQuote);
    const to = resolveQuote(blockByRef, link.toBlockId, link.toQuote);
    if (!from || !to || from.documentId === to.documentId) continue;
    const key = `${from.blockId}|${from.quotedText}|${to.blockId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    await db.docLink.create({
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
    linkCount++;
  }

  // ── The generated document ───────────────────────────────────────────────
  // A page made by a follow-up records the command before it too, so
  // Generated content says what "make that a page" made a page of.
  let document: StitchResult["document"] = null;
  if (result.data.document && !input.signal?.aborted) {
    const previous = [...input.history].reverse().find((t) => t.role === "user" && t.content.trim());
    document = await materializeGenerated({
      notebookId: input.notebookId,
      userId: input.userId,
      command: previous ? `${previous.content.trim()} → ${input.command}` : input.command,
      title: result.data.document.title.trim(),
      parts: result.data.document.parts.slice(0, MAX_PARTS),
      blockById: blockByRef,
    });
  }

  if (linkCount > 0 || document) await bumpNotebook(input.notebookId);
  const reply = replyWithIds(result.data.reply.trim(), blockByRef);
  // No reply and nothing stored: the reader would see an empty turn.
  if (!reply && linkCount === 0 && !document) throw input.onFailure(STITCH_EMPTY_ANSWER);
  const titleOf = new Map(rendered.map((r) => [r.doc.id, r.doc.title]));
  const picked = selected;
  const documents = picked
    ? coverage.map((c) => {
        if (c.status !== "read") return c;
        const r = rendered.find((x) => x.doc.id === c.id);
        return { ...c, shown: r ? r.blocks.filter((b) => picked.has(b.alias)).length : 0 };
      })
    : coverage;
  return { reply, linkCount, document, documents, cited: citedBlocks(reply, blockByRef, titleOf) };
}

type Part = z.infer<typeof partSchema>;

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
}): Promise<StitchResult["document"]> {
  // One markdown chunk per part, and the sources each chunk carries. A quote
  // part's text is the resolved passage, never the model's copy of it.
  const chunks: { markdown: string; sources: Resolved[] }[] = [];
  const quoted = new Set<string>();
  for (const part of input.parts) {
    if (part.kind === "heading") {
      const text = part.text.trim().replace(/^#+\s*/, "");
      if (text) chunks.push({ markdown: `## ${text}`, sources: [] });
    } else if (part.kind === "quote") {
      const resolved = resolveQuote(input.blockById, part.blockId, part.quote);
      if (!resolved || !resolved.quotedText.trim()) continue;
      // The same passage twice on one page is one passage.
      const key = `${resolved.blockId}|${resolved.startOffset}|${resolved.endOffset}`;
      if (quoted.has(key)) continue;
      quoted.add(key);
      chunks.push({ markdown: resolved.quotedText, sources: [resolved] });
    } else {
      const markdown = part.markdown.trim();
      if (!markdown) continue;
      const sources = part.sources
        .map((s) => resolveQuote(input.blockById, s.blockId, s.quote))
        .filter((s): s is Resolved => s !== null);
      chunks.push({ markdown, sources });
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
    const blocks = parseMarkdown(chunk.markdown);
    blocks.forEach((b, i) => {
      rows.push({
        order: rows.length,
        type: b.type,
        text: b.text,
        html: b.html,
        citations: b.citations,
        styles: b.styles,
        links: b.links,
        // The chunk's sources ride on its first block.
        sources: i === 0 ? chunk.sources : [],
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
  return { id: created.id, title: created.title };
}
