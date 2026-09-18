import type { ModelMessage } from "ai";
import { z } from "zod";
import { matchInText } from "@/lib/anchors/match";
import { bumpNotebook } from "@/lib/collab";
import { db } from "@/lib/db";
import {
  STITCH_EFFORT,
  STITCH_MAX_OUTPUT_TOKENS,
  STITCH_MODEL,
  STITCH_ROUTE_EFFORT,
  STITCH_SELECT_EFFORT,
  STITCH_SELECT_MAX_OUTPUT_TOKENS,
  STITCH_SELECTED_BUDGET,
  STITCH_SKELETON_BUDGET,
  STITCH_WHOLE_THRESHOLD,
} from "@/lib/derive/config";
import { loadProfile, renderBlockLines } from "@/lib/derive/context";
import { callForJson } from "@/lib/derive/json-call";
import type { Lang } from "@/lib/i18n/config";
import { kimi, kimiOptions } from "@/lib/kimi";
import { attachDocument } from "@/lib/parse/attach";
import { parseMarkdown } from "@/lib/parse/markdown";
import { PARSER_VERSION, type ParsedBlock } from "@/lib/parse/types";
import { ensureSkeleton, type Skeleton } from "@/lib/graph/skeleton";
import { rank } from "@/lib/graph/rank";
import { stitchPrompt, stitchRoutePrompt, stitchSelectPrompt } from "@/lib/prompts/stitch";
import type { StitchDocument, StitchResult } from "@/lib/types";
import { transcriptIsStale } from "@/lib/video/types";
import { resolveModelId } from "@/lib/models";

// Stitch (SPEC.md §22): one command over the project's documents, from the
// graph — the documents the reader selected in the graph, or every attached
// document when none is selected. The documents are read through their
// skeletons (lib/graph/skeleton.ts): one line per block at a tenth of the
// length, so the cost of finding the blocks a command needs scales with
// the skeletons, not the text. Up to three passes. The select pass reads
// every skeleton in one call — byte-identical from turn to turn for the
// same documents, so the prefix caches — and names the blocks the command
// needs. When the skeletons together run past STITCH_SKELETON_BUDGET, a
// route pass first reads only the documents' gists and part summaries and
// names the parts, the select pass reads those parts' lines, and when
// they still run past the budget the lines are ranked against the command
// (lib/graph/rank.ts) and cut to it. The answer pass reads the picked
// blocks' real text, in document order with the gaps declared, and answers
// with links, a generated document, or both. Documents under
// STITCH_WHOLE_THRESHOLD together skip the reading passes: the answer pass
// reads them whole.
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
const MAX_HISTORY = 20;

const quote = z.string().max(2_000).optional();
const sourceSchema = z.object({ blockId: z.string().min(1), quote });
const partSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("heading"), text: z.string().min(1).max(300) }),
  z.object({ kind: z.literal("quote"), blockId: z.string().min(1), quote }),
  z.object({
    kind: z.literal("text"),
    markdown: z.string().min(1).max(20_000),
    sources: z.array(sourceSchema).max(8).default([]),
  }),
]);
const selectSchema = z.object({
  blockIds: z.array(z.string().min(1)).max(MAX_SELECTED * 2).default([]),
});
const routeSchema = z.object({
  parts: z.array(z.string().min(1)).max(MAX_ROUTED * 2).default([]),
});
const outputSchema = z.object({
  reply: z.string().max(4_000).default(""),
  links: z
    .array(
      z.object({
        fromBlockId: z.string().min(1),
        fromQuote: quote,
        toBlockId: z.string().min(1),
        toQuote: quote,
        reason: z.string().min(1).max(600),
      }),
    )
    .max(48)
    .default([]),
  document: z
    .object({ title: z.string().min(1).max(200), parts: z.array(partSchema).max(400) })
    .nullable()
    .default(null),
});

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
    skipped. */
export async function loadDocuments(notebookId: string, documentIds: string[] | null) {
  const rows = await db.notebookDocument.findMany({
    where: {
      notebookId,
      ...(documentIds ? { documentId: { in: documentIds } } : {}),
    },
    orderBy: { document: { createdAt: "asc" } },
    include: {
      document: {
        select: {
          id: true,
          title: true,
          skeleton: true,
          handwritten: true,
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
            select: { id: true, type: true, text: true, startTime: true, endTime: true },
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

/** One document's coverage as the prompt states it beside the document's title. */
export function coverageNote(m: StitchDocument): string {
  switch (m.status) {
    case "read":
      return `${m.kind}, ${m.blocks} ${UNIT[m.kind]} read`;
    case "empty":
      return `${m.kind}, not read: ${EMPTY_NOTE[m.reason ?? "noText"]}`;
  }
}

const CONTEXT_HEAD = [
  "You assist a reader working across the documents of a project.",
  "Each document starts with its letter as [document <letter>]; each block starts with its alias as [block <alias>]: the document's letter and the block's number in it, in reading order (A1, A2, B1). Aliases are unique across all docs. Reference blocks by alias exactly as given.",
  "A video or audio document is its transcript: every line is a TRANSCRIPT block tagged with its seconds. A document marked (nothing to read: …) has no text here: never cite it and never guess what it says.",
  "",
];

function emptySection(letter: string, doc: Doc, reason: StitchDocument["reason"]): string {
  return `[document ${letter}] "${doc.title}"\n(nothing to read: ${EMPTY_NOTE[reason ?? "noText"]})`;
}

/** One document's readable blocks as the model reads them: the stored block
    lines under their aliases. */
function aliasedLines(blocks: DocBlock[], source: Doc["blocks"]): string {
  const stored = new Map(source.map((b) => [b.id, b]));
  return renderBlockLines(
    blocks.flatMap((b) => {
      const row = stored.get(b.id);
      return row ? [{ ...row, id: b.alias }] : [];
    }),
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
    const empty = emptyReason(doc);
    return {
      letter,
      doc,
      blocks,
      coverage: { ...base, status: "empty", blocks: 0, ...empty },
      section: emptySection(letter, doc, empty.reason),
    };
  }
  return {
    letter,
    doc,
    blocks,
    coverage: { ...base, status: "read", blocks: blocks.length, reason: null, detail: null },
    section: `[document ${letter}] "${doc.title}"\n${aliasedLines(blocks, doc.blocks)}`,
  };
}

/** Every document rendered, in order. length: the chars of document text. */
function renderDocuments(docs: Doc[]): { rendered: Rendered[]; length: number } {
  const rendered = docs.map((doc, index) => renderDocument(doc, index));
  return { rendered, length: rendered.reduce((sum, r) => sum + r.section.length, 0) };
}

/** Every document whole, as one system message: what the answer pass reads
    when the documents are short enough to skip the select pass. */
function wholeSystem(rendered: Rendered[]): string {
  return [...CONTEXT_HEAD, "Every document follows.", "", rendered.map((r) => r.section).join("\n\n")].join("\n");
}

/** The selected blocks as one system message: every document in order, its
    header saying how many of its blocks are shown, the blocks in reading
    order, a gap between two shown blocks declared. A document with nothing
    to read is declared with its reason, as in the whole rendering. */
export function selectedSystem(rendered: Rendered[], selected: Set<string>): string {
  const sections: string[] = [];
  for (const r of rendered) {
    if (r.coverage.status === "empty") {
      sections.push(r.section);
      continue;
    }
    const shown = r.blocks.filter((b) => selected.has(b.alias));
    const header = `[document ${r.letter}] "${r.doc.title}" (${shown.length} of ${r.blocks.length} blocks shown)`;
    if (shown.length === 0) {
      sections.push(header);
      continue;
    }
    const lines: string[] = [];
    let last = -1;
    for (const block of shown) {
      const at = r.blocks.indexOf(block);
      if (last !== -1 && at - last > 1) lines.push(`(${at - last - 1} blocks not shown)`);
      lines.push(aliasedLines([block], r.doc.blocks));
      last = at;
    }
    sections.push(`${header}\n${lines.join("\n\n")}`);
  }
  return [...CONTEXT_HEAD, "The blocks a first read picked for the command follow.", "", sections.join("\n\n")].join("\n");
}

// ── The skeletons as the reading passes see them ─────────────────────────

type SkeletonLineView = { alias: string; text: string; partAlias: string | null };
type SkeletonPartView = { alias: string; title: string; summary: string };
type SkeletonView = {
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

const lineCost = (l: SkeletonLineView) => l.text.length + l.alias.length + 12;

/** The route pass's system message: every document's gist and part
    summaries, no lines. */
function routeSystem(views: SkeletonView[], rendered: Rendered[]): string {
  const byLetter = new Map(views.map((v) => [v.r.letter, v]));
  const sections = rendered.map((r) => {
    const v = byLetter.get(r.letter);
    if (!v) return r.section;
    const head = `[document ${r.letter}] "${r.doc.title}"${v.gist ? `\ngist: ${v.gist}` : ""}`;
    const parts =
      v.parts.length > 0
        ? v.parts.map((p) => `[part at ${p.alias}] "${p.title}"${p.summary ? `: ${p.summary}` : ""}`).join("\n")
        : "(one part: the whole document)";
    return `${head}\n${parts}`;
  });
  return [
    ...CONTEXT_HEAD,
    "Each document's gist and the summary of each of its parts follow. A part is tagged [part at <alias>] with the alias of its first block.",
    "",
    sections.join("\n\n"),
  ].join("\n");
}

/** The select pass's system message: every document's skeleton lines, or
    the lines in `shown` (a gap between two shown lines declared), each
    part's summary above its first shown line. Byte-identical from turn to
    turn when every line is shown. */
function skeletonSystem(views: SkeletonView[], rendered: Rendered[], shown: Set<string> | null): string {
  const byLetter = new Map(views.map((v) => [v.r.letter, v]));
  const sections = rendered.map((r) => {
    const v = byLetter.get(r.letter);
    if (!v) return r.section;
    const lines = shown ? v.lines.filter((l) => shown.has(l.alias)) : v.lines;
    const header = shown
      ? `[document ${r.letter}] "${r.doc.title}" (${lines.length} of ${v.lines.length} skeleton lines shown)`
      : `[document ${r.letter}] "${r.doc.title}"`;
    const out: string[] = [header];
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
  return [
    ...CONTEXT_HEAD,
    "Each document's skeleton follows: one line per block, tagged [block <alias>], what the block says at a tenth of its length.",
    "",
    sections.join("\n\n"),
  ].join("\n");
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

/** The select pass's pick cut to the budget: known aliases, once each, in
    the given order (most relevant first) until the chars run out. */
export function cutSelection(aliases: string[], blockByRef: Map<string, DocBlock>): Set<string> {
  const picked = new Set<string>();
  let used = 0;
  for (const alias of aliases) {
    const block = blockByRef.get(alias);
    if (!block || picked.has(block.alias)) continue;
    if (picked.size >= MAX_SELECTED) break;
    const cost = block.text.length + 40;
    if (used + cost > STITCH_SELECTED_BUDGET) continue;
    used += cost;
    picked.add(block.alias);
  }
  return picked;
}

// A document's opening, cut to its share of the budget: what the answer pass
// reads of a document the select pass picked nothing of.
function opening(r: Rendered, share: number): string[] {
  const picked: string[] = [];
  let used = 0;
  for (const block of r.blocks) {
    const cost = block.text.length + 40;
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
  const docs = await loadDocuments(input.notebookId, input.documentIds);
  const { rendered, length } = renderDocuments(docs);
  const coverage = rendered.map((r) => r.coverage);
  // Fewer than two documents read: no links can be drawn and no page can rest
  // on the docs, so nothing runs and nothing is stored. The result says
  // what was read of every document and why the rest were not.
  const read = rendered.filter((r) => r.coverage.status === "read");
  if (read.length < 2) return { reply: "", linkCount: 0, document: null, documents: coverage };

  // Every block under its alias and under its stored id.
  const blockByRef = new Map<string, DocBlock>();
  for (const r of rendered) {
    for (const b of r.blocks) {
      blockByRef.set(b.alias, b);
      blockByRef.set(b.id, b);
    }
  }
  const profile = await loadProfile(input.notebookId);
  const documentList = rendered.map((r) => ({
    tag: r.letter,
    title: r.doc.title,
    note: coverageNote(r.coverage),
    read: r.coverage.status === "read",
  }));
  const history: ModelMessage[] = input.history
    .slice(-MAX_HISTORY)
    .filter((turn) => turn.content.trim())
    .map((turn) => ({ role: turn.role, content: turn.content }));
  const model = await kimi(STITCH_MODEL);
  const usage = { userId: input.userId, feature: "stitch" as const, model: await resolveModelId(STITCH_MODEL) };

  // ── The reading passes: the blocks the command needs, from the skeletons ──
  let context = wholeSystem(rendered);
  let selected = false;
  if (length > STITCH_WHOLE_THRESHOLD) {
    // Every document's skeleton: stored, patched for small edits, or built
    // now. A build that fails reads the document's first words.
    const skeletons = await Promise.all(read.map((r) => ensureSkeleton(r.doc, input.userId, input.signal)));
    if (input.signal?.aborted) throw input.onFailure("aborted");
    const views = read.map((r, i) => skeletonView(r, skeletons[i]));
    const skeletonLength = views.reduce((sum, v) => sum + v.lines.reduce((n, l) => n + lineCost(l), 0), 0);

    // Past the budget: the route pass names the parts, and the lines are
    // cut to them and, if still too many, ranked against the command.
    let shown: Set<string> | null = null;
    if (skeletonLength > STITCH_SKELETON_BUDGET) {
      let routed: Set<string> | null = null;
      const route = await callForJson({
        model,
        messages: [
          { role: "system", content: routeSystem(views, rendered) },
          ...history,
          {
            role: "user",
            content: stitchRoutePrompt({ profile, documents: documentList, command: input.command, maxParts: MAX_ROUTED }),
          },
        ],
        maxOutputTokens: STITCH_SELECT_MAX_OUTPUT_TOKENS,
        providerOptions: kimiOptions(STITCH_ROUTE_EFFORT),
        schema: routeSchema,
        label: "STITCH_ROUTE",
        usage,
        abortSignal: input.signal,
      });
      if (!route.ok) {
        if (input.signal?.aborted) throw input.onFailure(route.error);
        console.warn("[stitch] route pass failed, ranking every line:", route.error);
      } else {
        const partAliases = new Set(views.flatMap((v) => v.parts.map((p) => p.alias)));
        const picked = route.data.parts.map((p) => p.trim().toUpperCase()).filter((p) => partAliases.has(p));
        if (picked.length > 0) routed = new Set(picked);
      }
      shown = cutLines(views, routed, input.command, STITCH_SKELETON_BUDGET);
    }

    const pick = await callForJson({
      model,
      messages: [
        { role: "system", content: skeletonSystem(views, rendered, shown) },
        ...history,
        {
          role: "user",
          content: stitchSelectPrompt({
            profile,
            documents: documentList,
            command: input.command,
            maxBlocks: MAX_SELECTED,
            partial: shown !== null,
          }),
        },
      ],
      maxOutputTokens: STITCH_SELECT_MAX_OUTPUT_TOKENS,
      providerOptions: kimiOptions(STITCH_SELECT_EFFORT),
      schema: selectSchema,
      label: "STITCH_SELECT",
      usage,
      abortSignal: input.signal,
    });
    if (!pick.ok) {
      if (input.signal?.aborted) throw input.onFailure(pick.error);
      console.warn("[stitch] select pass failed, reading every document's opening:", pick.error);
    }
    const share = Math.floor(STITCH_SELECTED_BUDGET / read.length);
    // The picks by document, most relevant first within each; a document
    // the pick names nothing of reads as its opening, so every document
    // read is under the answer pass.
    const byDoc = new Map<string, string[]>(read.map((r) => [r.doc.id, []]));
    for (const alias of pick.ok ? pick.data.blockIds.flatMap(expandPick) : []) {
      const block = blockByRef.get(alias);
      if (block) byDoc.get(block.documentId)?.push(alias);
    }
    const picks = read.map((r) => {
      const own = byDoc.get(r.doc.id) ?? [];
      return own.length > 0 ? own : opening(r, share);
    });
    if (input.signal?.aborted) throw input.onFailure("aborted");
    context = selectedSystem(rendered, cutSelection(interleave(picks), blockByRef));
    selected = true;
  }

  // ── The answer pass ──────────────────────────────────────────────────────
  const result = await callForJson({
    model,
    messages: [
      { role: "system", content: context },
      ...history,
      {
        role: "user",
        content: stitchPrompt({
          profile,
          lang: input.lang,
          documents: documentList,
          command: input.command,
          selected,
        }),
      },
    ],
    maxOutputTokens: STITCH_MAX_OUTPUT_TOKENS,
    providerOptions: kimiOptions(STITCH_EFFORT),
    schema: outputSchema,
    label: "STITCH",
    usage,
    abortSignal: input.signal,
  });
  if (!result.ok) throw input.onFailure(result.error);

  // ── Links: block to block across docs, stored recommended ─────────────
  const existing = await db.docLink.findMany({
    where: { fromDocumentId: { in: docs.map((m) => m.id) } },
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
  let document: StitchResult["document"] = null;
  if (result.data.document) {
    document = await materializeGenerated({
      notebookId: input.notebookId,
      userId: input.userId,
      command: input.command,
      title: result.data.document.title.trim(),
      parts: result.data.document.parts.slice(0, MAX_PARTS),
      blockById: blockByRef,
    });
  }

  if (linkCount > 0 || document) await bumpNotebook(input.notebookId);
  return { reply: replyWithIds(result.data.reply.trim(), blockByRef), linkCount, document, documents: coverage };
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
