import { Prisma } from "@prisma/client";
import { findQuoteLoose, matchInText } from "@/lib/anchors/match";
import { diffSegments, remapAnchor } from "@/lib/anchors/remap";
import { resolveAnchor } from "@/lib/anchors/resolve";
import { db } from "@/lib/db";
import { deriveBlocks, ensureBlockIds, type DerivedBlock } from "@/lib/docs/blocks";
import { hasFigures, sanitizeRichText, stableJson, withDocumentFigures, type RichNode } from "@/lib/docs/schema";
import { keepVersion } from "@/lib/docs/versions";

// One save of a document with rich text, a blank document or an import
// (SPEC.md §29): the rich text is stored and its paragraph index — the
// document's Block rows — is brought in line with it in the same
// transaction. Every anchor on a paragraph whose words changed is remapped
// the way the block edit route remaps it; an anchor whose words left their
// paragraph (Enter split it, Backspace joined it, the paragraph was removed)
// is found again by its quote across the document, and orphans visibly only
// when its words are gone (SPEC.md §5). An orphan on a paragraph whose words
// changed or came back (Ctrl+Z) tries its quote again. A figure object's
// anchor stays with its figure: it never moves into a paragraph.

/** Edits by one account to one paragraph within this long merge into one
    history row, so typing reads as one change, not one per save. */
const COALESCE_MS = 10 * 60 * 1000;

/** Rows per statement, under Postgres's limit on bound values. */
const ROWS_PER_STATEMENT = 500;

type OldBlock = {
  id: string;
  order: number;
  type: string;
  text: string;
  /** Null on a figure object's row: a save never reads a figure's html. */
  html: string | null;
  styles: Prisma.JsonValue;
  links: Prisma.JsonValue;
  page: number | null;
  region: Prisma.JsonValue;
  citations: Prisma.JsonValue;
  mediaId: string | null;
  cell: Prisma.JsonValue;
};

export type SyncOk = {
  ok: true;
  rev: number;
  /** The history row of each paragraph this save removed, by block id: the
      block routes answer with it, and undo restores through it. */
  removedEdits: Record<string, string>;
  /** A mark was lost or found again: the page's marks need the stored copy
      (a mark that only moved, the page moved with the typing). */
  marksChanged: boolean;
};
export type SyncConflict = { ok: false; reason: "rev"; rev: number; richText: RichNode | null };
export type SyncIdClash = { ok: false; reason: "ids"; ids: string[] };
/** A server-side edit that found nothing to change (its block is gone). */
export type SyncNoop = { ok: false; reason: "noop" };
export type SyncResult = SyncOk | SyncConflict | SyncIdClash | SyncNoop;

/** The kind a history row names for a block: paragraph, h1…h6, list, code. */
function kindOf(b: { type: string; html: string | null }): string {
  if (b.type === "HEADING") return `h${/^<h([1-6])/.exec(b.html ?? "")?.[1] ?? "2"}`;
  if (b.type === "LIST") return "list";
  if (b.type === "CODE") return "code";
  return "paragraph";
}

/** Two JSON values alike, whatever order their keys come in (jsonb reads
    them back in its own order). Null and a missing value are alike. */
function sameJson(a: unknown, b: unknown): boolean {
  return stableJson(a ?? null) === stableJson(b ?? null);
}

/** The row's layout changed: its type, or its html — a figure object's row
    compares its media instead, since its html is the media's. */
function formatDiffers(before: OldBlock, d: DerivedBlock): boolean {
  if (before.type !== d.type) return true;
  return d.mediaId === null && (before.mediaId !== null || (before.html ?? null) !== (d.html ?? null));
}

/** Anything of the row differs from what the rich text derives. A change to
    only its page, region, citations, media, or cell rewrites the row and
    writes no history. */
function rowDiffers(before: OldBlock, d: DerivedBlock): boolean {
  return (
    before.text !== d.text ||
    formatDiffers(before, d) ||
    (before.mediaId ?? null) !== d.mediaId ||
    (before.page ?? null) !== d.page ||
    !sameJson(before.styles ?? [], d.styles) ||
    !sameJson(before.links ?? [], d.links) ||
    !sameJson(before.citations ?? [], d.citations) ||
    !sameJson(before.region, d.region) ||
    !sameJson(before.cell, d.cell)
  );
}

/** A JSON value for a jsonb column: null stays SQL NULL. */
function jsonb(value: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return value === null || value === undefined ? Prisma.DbNull : (value as Prisma.InputJsonValue);
}

function chunks<T>(list: T[], size = ROWS_PER_STATEMENT): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

type Placed = {
  blockId: string;
  startOffset: number;
  endOffset: number;
  quotedText: string;
  prefix: string;
  suffix: string;
  orphaned: boolean;
};

// Where the anchors go (SPEC.md §5). The paragraphs that changed or left
// between two unchanged ones form a run (each paragraph its own run when none
// split, joined, came, or went); its words before and after the save
// (paragraphs joined by SEP) differ in one stretch. A mark outside the
// stretch moves with its words, into the new paragraph after an Enter or the
// joined one after a Backspace; typing right before or after a mark stays
// outside it, typing inside grows it, a delete shrinks it. A mark inside a
// longer stretch is found by its quote, else by its paragraph's word diff,
// else by its quote across the document; it orphans only when its words are
// gone. Words never land on a figure object, and a figure's anchor lands only
// on its figure.

const SEP = "\u0000";

type Span = { blockId: string; start: number; end: number };

type Run = {
  oldText: string;
  newText: string;
  /** Each old paragraph's start in oldText. */
  oldStart: Map<string, number>;
  /** The run's new paragraphs and their starts in newText; figure rows are
      in the words but never a place for a mark. */
  newBlocks: { id: string; start: number; text: string; figure: boolean }[];
  /** The shared start, and the shared end left after it. */
  head: number;
  tail: number;
  /** The longest shared end: a letter typed right before a mark that begins
      with it stays outside the mark. */
  longTail: number;
};

type Moves = {
  old: OldBlock[];
  oldIndex: Map<string, number>;
  derived: DerivedBlock[];
  newIndex: Map<string, number>;
  newById: Map<string, DerivedBlock>;
  /** Paragraphs with the same id and the same words before and after. */
  stable: Set<string>;
  runs: Map<string, Run | null>;
  /** An import or a re-parse: every figure has new media, so a figure's
      anchor may find its figure by the caption. */
  bulk: boolean;
};

function movesOf(old: OldBlock[], derived: DerivedBlock[], newById: Map<string, DerivedBlock>, bulk: boolean): Moves {
  return {
    old,
    oldIndex: new Map(old.map((b, i) => [b.id, i])),
    derived,
    newIndex: new Map(derived.map((d, i) => [d.id, i])),
    newById,
    stable: new Set(old.filter((b) => newById.get(b.id)?.text === b.text).map((b) => b.id)),
    runs: new Map(),
    bulk,
  };
}

/** The run around an old paragraph; null when the paragraphs around it moved
    out of order and no run lines up. */
function runAround(m: Moves, blockId: string): Run | null {
  const i = m.oldIndex.get(blockId);
  if (i === undefined) return null;
  let a = i;
  while (a > 0 && !m.stable.has(m.old[a - 1].id)) a--;
  let b = i;
  while (b + 1 < m.old.length && !m.stable.has(m.old[b + 1].id)) b++;
  let from = a > 0 ? (m.newIndex.get(m.old[a - 1].id) ?? -2) + 1 : 0;
  let to = b + 1 < m.old.length ? (m.newIndex.get(m.old[b + 1].id) ?? -1) : m.derived.length;
  // No paragraph split, joined, added, or removed: each paragraph is its own
  // run, so an edit in the next paragraph never reaches a mark in this one.
  if (from >= 0 && to - from === b - a + 1 && m.old.slice(a, b + 1).every((block, k) => m.derived[from + k].id === block.id)) {
    from += i - a;
    to = from + 1;
    a = b = i;
  }
  const key = m.old[a].id;
  const cached = m.runs.get(key);
  if (cached !== undefined) return cached;
  let run: Run | null = null;
  if (from >= 0 && to >= from) {
    const oldStart = new Map<string, number>();
    let oldText = "";
    m.old.slice(a, b + 1).forEach((block, k) => {
      if (k > 0) oldText += SEP;
      oldStart.set(block.id, oldText.length);
      oldText += block.text;
    });
    const newBlocks: Run["newBlocks"] = [];
    let newText = "";
    m.derived.slice(from, to).forEach((block, k) => {
      if (k > 0) newText += SEP;
      newBlocks.push({ id: block.id, start: newText.length, text: block.text, figure: block.type === "FIGURE" });
      newText += block.text;
    });
    const most = Math.min(oldText.length, newText.length);
    // A change of letter case alone (Capitalization) moves no word: every
    // anchor keeps its offsets.
    const recased = oldText.length === newText.length && oldText.toLowerCase() === newText.toLowerCase();
    let head = recased ? most : 0;
    while (head < most && oldText[head] === newText[head]) head++;
    let tail = 0;
    while (tail < most - head && oldText[oldText.length - 1 - tail] === newText[newText.length - 1 - tail]) tail++;
    let longTail = tail;
    while (longTail < most && oldText[oldText.length - 1 - longTail] === newText[newText.length - 1 - longTail]) {
      longTail++;
    }
    run = { oldText, newText, oldStart, newBlocks, head, tail, longTail };
  }
  m.runs.set(key, run);
  return run;
}

/** The new paragraph a range of the run's new words lands in: the paragraph
    holding most of it, trimmed of spaces; null when only spaces are left. */
function spanIn(run: Run, from: number, to: number): Span | null {
  let best: Span | null = null;
  for (const block of run.newBlocks) {
    if (block.figure) continue;
    let start = Math.max(from, block.start) - block.start;
    let end = Math.min(to, block.start + block.text.length) - block.start;
    while (start < end && /\s/.test(block.text[start])) start++;
    while (end > start && /\s/.test(block.text[end - 1])) end--;
    if (end > start && (!best || end - start > best.end - best.start)) best = { blockId: block.id, start, end };
  }
  return best;
}

/** An anchor through its run: its new place, "inside" when it lies in the
    changed stretch whole, or null when its words are gone. */
function mapInRun(run: Run, anchor: { blockId: string; startOffset: number; endOffset: number }): Span | "inside" | null {
  const base = run.oldStart.get(anchor.blockId);
  if (base === undefined) return null;
  const start = base + anchor.startOffset;
  const end = base + anchor.endOffset;
  const oldEnd = run.oldText.length - run.tail;
  const newEnd = run.newText.length - run.tail;
  const delta = run.newText.length - run.oldText.length;
  // Before the change (typing right after the mark stays outside it).
  if (end <= run.head) return spanIn(run, start, end);
  // After the change (typing right before the mark stays outside it).
  if (start >= run.oldText.length - run.longTail) return spanIn(run, start + delta, end + delta);
  // The whole change is inside the mark: it grows or shrinks with it; an
  // Enter cuts it, and it keeps the larger part.
  if (start <= run.head && end >= oldEnd) return spanIn(run, start, end + delta);
  if (start >= run.head && end <= oldEnd) return "inside";
  // The change takes one end of the mark and words outside it: the rest stays.
  return start < run.head ? spanIn(run, start, run.head) : spanIn(run, newEnd, end + delta);
}

type Anchor = {
  blockId: string;
  startOffset: number;
  endOffset: number;
  /** The words the anchor covers now. */
  quote: string;
  /** The words as quoted; a mark cut short covers them again when they stand
      together again. */
  original: string;
  prefix: string;
  suffix: string;
};

/** The words inside the changed stretch, found again in the run's paragraphs:
    as quoted, else in another case (findQuoteLoose). */
function findInRun(run: Run, anchor: Anchor): Span | null {
  const quote = { quotedText: anchor.quote, prefix: anchor.prefix, suffix: anchor.suffix };
  for (const find of [matchInText, findQuoteLoose]) {
    for (const block of run.newBlocks) {
      if (block.figure) continue;
      const hit = find(block.text, quote);
      if (hit) return { blockId: block.id, start: hit.start, end: hit.end };
    }
  }
  return null;
}

/** The word diff of the anchor's own paragraph, when it is still there. */
function remapInBlock(m: Moves, anchor: Anchor): Span | null {
  const i = m.oldIndex.get(anchor.blockId);
  const before = i === undefined ? undefined : m.old[i];
  const after = m.newById.get(anchor.blockId);
  if (!before || !after || before.text === after.text || after.type === "FIGURE") return null;
  const r = remapAnchor(diffSegments(before.text, after.text), after.text, {
    startOffset: anchor.startOffset,
    endOffset: anchor.endOffset,
    quotedText: anchor.quote,
  });
  return r.orphaned ? null : { blockId: anchor.blockId, start: r.startOffset, end: r.endOffset };
}

/** A mark cut short covers its quote again once the quote's words stand
    together around it (an Enter inside it, taken back). */
function regrow(text: string, span: Span, original: string): Span {
  const covered = text.slice(span.start, span.end);
  const at = covered && covered !== original ? original.indexOf(covered) : -1;
  if (at < 0) return span;
  const start = span.start - at;
  return start >= 0 && text.slice(start, start + original.length) === original
    ? { ...span, start, end: start + original.length }
    : span;
}

const CONTEXT = 32;

function placedAt(span: Span, text: string): Placed {
  return {
    blockId: span.blockId,
    startOffset: span.start,
    endOffset: span.end,
    quotedText: text.slice(span.start, span.end),
    prefix: text.slice(Math.max(0, span.start - CONTEXT), span.start),
    suffix: text.slice(span.end, span.end + CONTEXT),
    orphaned: false,
  };
}

function orphanedAt(anchor: Anchor): Placed {
  return {
    blockId: anchor.blockId,
    startOffset: anchor.startOffset,
    endOffset: anchor.endOffset,
    quotedText: anchor.quote,
    prefix: anchor.prefix,
    suffix: anchor.suffix,
    orphaned: true,
  };
}

/** Whether the anchor sits on a figure: its row was a FIGURE row, or is one. */
function onFigure(m: Moves, blockId: string): boolean {
  const i = m.oldIndex.get(blockId);
  return (i === undefined ? m.newById.get(blockId)?.type : m.old[i].type) === "FIGURE";
}

/** Where an anchor's words are after the save. */
function relocate(anchor: Anchor, m: Moves): Placed {
  if (onFigure(m, anchor.blockId)) return refindFigure(anchor, m);
  const run = runAround(m, anchor.blockId);
  const mapped = run ? mapInRun(run, anchor) : "inside";
  let span = mapped === "inside" ? ((run && findInRun(run, anchor)) ?? remapInBlock(m, anchor)) : mapped;
  if (span) {
    const text = m.newById.get(span.blockId)?.text ?? "";
    span = regrow(text, span, anchor.original);
    return placedAt(span, text);
  }
  return refind(anchor, m);
}

/** An anchor's words found by its quote across the document's words — never
    in a figure's caption — else orphaned. A figure's anchor goes to its
    figure (refindFigure). */
function refind(anchor: Anchor, m: Moves): Placed {
  if (onFigure(m, anchor.blockId)) return refindFigure(anchor, m);
  const found = resolveAnchor(
    m.derived.filter((d) => d.type !== "FIGURE"),
    {
      blockId: anchor.blockId,
      startOffset: anchor.startOffset,
      endOffset: anchor.endOffset,
      quotedText: anchor.quote,
      prefix: anchor.prefix,
      suffix: anchor.suffix,
    },
  );
  return found ? { ...found, orphaned: false } : orphanedAt(anchor);
}

/** A figure's anchor (R5): on its own figure while it stands; else on the
    figure object with the same media (it moved, or was cut and pasted);
    else, after an import or a re-parse — every figure with new media — on
    the figure whose caption is the quote, the one at the same place among
    the figures with that caption. Never on a paragraph: with no figure, it
    orphans. */
function refindFigure(anchor: Anchor, m: Moves): Placed {
  const figures = m.derived.filter((d) => d.type === "FIGURE");
  const own = m.newById.get(anchor.blockId);
  const before = m.old[m.oldIndex.get(anchor.blockId) ?? -1];
  let target: DerivedBlock | undefined = own?.type === "FIGURE" ? own : undefined;
  if (!target && before?.mediaId) target = figures.find((d) => d.mediaId === before.mediaId);
  if (!target && m.bulk) {
    const same = figures.filter((d) => d.text === anchor.quote);
    const rank = m.old.filter((b) => b.type === "FIGURE" && b.text === anchor.quote).findIndex((b) => b.id === anchor.blockId);
    target = same[Math.min(Math.max(rank, 0), same.length - 1)];
  }
  if (!target) return orphanedAt(anchor);
  const found = resolveAnchor([target], {
    blockId: target.id,
    startOffset: anchor.startOffset,
    endOffset: anchor.endOffset,
    quotedText: anchor.quote,
    prefix: anchor.prefix,
    suffix: anchor.suffix,
  });
  return found ? { ...found, orphaned: false } : orphanedAt(anchor);
}

/** Store a document's rich text and bring its Block rows in line. Either
    `richText` — the editor's copy, which must start from `baseRev` — or
    `edit`, a server-side change applied to the stored text under the same
    lock, so an editor save and a server edit never overwrite each other.

    `bulk` is an import or a re-parse (SPEC.md §29): the rows are written in
    bulk with no history row per paragraph and no version of the sitting
    (the caller keeps its named one, lib/docs/versions.ts keepNamedVersion),
    a new row counts as parsed (originalText null), a figure's anchor may
    find its figure by the caption, and Document.importRev takes the new
    revision. `tx` runs the save inside the caller's transaction. */
export async function syncRichText({
  documentId,
  userId,
  baseRev,
  richText: given,
  edit,
  bulk = false,
  tx: outer,
}: {
  documentId: string;
  userId: string | null;
  baseRev: number | null;
  richText?: RichNode;
  edit?: (current: RichNode) => RichNode | null;
  bulk?: boolean;
  tx?: Prisma.TransactionClient;
}): Promise<SyncResult> {
  const save = async (tx: Prisma.TransactionClient): Promise<SyncResult> => {
    // One save at a time per document: the row lock orders them. keptAt is
    // the newest version's time, else the first edit's (lib/docs/versions.ts).
    const [locked] = await tx.$queryRaw<
      { richTextRev: number; richTextSavedAt: Date | null; richTextSavedBy: string | null; createdAt: Date; keptAt: Date | null }[]
    >`
      SELECT "richTextRev", "richTextSavedAt", "richTextSavedBy", "createdAt",
        COALESCE(
          (SELECT "savedAt" FROM "DocumentVersion" WHERE "documentId" = ${documentId} ORDER BY "rev" DESC LIMIT 1),
          (SELECT min("createdAt") FROM "BlockEdit" WHERE "documentId" = ${documentId})
        ) AS "keptAt"
      FROM "Document" WHERE "id" = ${documentId} FOR UPDATE`;
    if (!locked) throw new Error("document not found");
    let richText = given ?? null;
    if (edit) {
      const current = await tx.document.findUnique({ where: { id: documentId }, select: { richText: true } });
      const next = current?.richText ? edit(current.richText as unknown as RichNode) : null;
      richText = next ? sanitizeRichText(ensureBlockIds(next)) : null;
      if (!richText) return { ok: false as const, reason: "noop" as const };
    }
    if (!richText) return { ok: false as const, reason: "noop" as const };
    if (baseRev !== null && locked.richTextRev !== baseRev) {
      const current = await tx.document.findUnique({ where: { id: documentId }, select: { richText: true } });
      return {
        ok: false as const,
        reason: "rev" as const,
        rev: locked.richTextRev,
        richText: (current?.richText ?? null) as RichNode | null,
      };
    }
    // Figure objects hold only this document's media, and their words are
    // the media's (R6): a crafted save or a paste from another document
    // changes no caption and brings no figure.
    if (hasFigures(richText)) {
      const media = await tx.figureMedia.findMany({
        where: { documentId },
        select: { id: true, caption: true, page: true, region: true },
      });
      richText = withDocumentFigures(richText, new Map(media.map((f) => [f.id, f])));
    }
    const derived = deriveBlocks(richText);

    // The stored rows, a figure object's html left in the database: a save
    // compares a figure's media, never its html.
    const old = await tx.$queryRaw<OldBlock[]>`
      SELECT "id", "order", "type"::text AS "type", "text",
        CASE WHEN "mediaId" IS NULL THEN "html" END AS "html",
        "styles", "links", "page", "region", "citations", "mediaId", "cell"
      FROM "Block" WHERE "documentId" = ${documentId} ORDER BY "order" ASC`;
    const oldById = new Map<string, OldBlock>(old.map((b) => [b.id, b]));
    const newById = new Map(derived.map((d) => [d.id, d]));

    const created = derived
      .map((d, order) => ({ d, order }))
      .filter(({ d }) => !oldById.has(d.id));
    // A new paragraph's id must be new everywhere: a pasted node can carry
    // an id from another document. The editor gives those nodes fresh ids
    // and saves again.
    if (created.length > 0) {
      const taken = await tx.block.findMany({
        where: { id: { in: created.map(({ d }) => d.id) } },
        select: { id: true },
      });
      if (taken.length > 0) return { ok: false as const, reason: "ids" as const, ids: taken.map((b) => b.id) };
    }
    const removed = old.filter((b) => !newById.has(b.id));
    const kept: { d: DerivedBlock; order: number; before: OldBlock }[] = [];
    derived.forEach((d, order) => {
      const before = oldById.get(d.id);
      if (before) kept.push({ d, order, before });
    });
    const textChanged = kept.filter((k) => k.before.text !== k.d.text);
    const formatChanged = kept.filter((k) => formatDiffers(k.before, k.d));
    const contentChanged = kept.filter((k) => rowDiffers(k.before, k.d));
    const moved = kept.filter((k) => k.before.order !== k.order);

    // Anchors on paragraphs whose words changed or left, and the orphans on
    // paragraphs whose words changed or came back.
    const affected = [...textChanged.map((k) => k.d.id), ...removed.map((b) => b.id)];
    const returned = [...textChanged.map((k) => k.d.id), ...created.map(({ d }) => d.id)];
    const moves = movesOf(old, derived, newById, bulk);
    let marksChanged = false;
    if (affected.length > 0 || returned.length > 0) {
      // An orphan that covered its whole block (a figure's anchor, a whole
      // paragraph) comes back when a block with exactly its words is added
      // or rewritten: a figure cut in one save and pasted in the next.
      const wholeTexts = bulk
        ? []
        : [...new Set(returned.map((id) => newById.get(id)?.text ?? "").filter((text) => text.trim()))].slice(0, 500);
      const [sources, links, wholeOrphans] = await Promise.all([
        tx.source.findMany({
          where: {
            documentId,
            layer: null,
            startTime: null,
            OR: [
              { blockId: { in: affected }, orphaned: false },
              { blockId: { in: returned }, orphaned: true },
            ],
          },
        }),
        affected.length > 0
          ? tx.docLink.findMany({ where: { OR: [{ fromBlockId: { in: affected } }, { toBlockId: { in: affected } }] } })
          : [],
        wholeTexts.length > 0
          ? tx.source.findMany({
              where: {
                documentId,
                layer: null,
                startTime: null,
                orphaned: true,
                startOffset: 0,
                prefix: "",
                suffix: "",
                OR: [{ anchoredText: { in: wholeTexts } }, { anchoredText: null, quotedText: { in: wholeTexts } }],
              },
            })
          : [],
      ]);
      for (const src of wholeOrphans) {
        // Only an orphan whose own block is gone: one on a block that stands
        // stays with it.
        if (newById.has(src.blockId)) continue;
        const words = src.anchoredText ?? src.quotedText;
        const row = returned.map((id) => newById.get(id)).find((d) => d?.text === words);
        if (!row) continue;
        const placed = placedAt({ blockId: row.id, start: 0, end: row.text.length }, row.text);
        marksChanged = true;
        await tx.source.update({
          where: { id: src.id },
          data: {
            blockId: placed.blockId,
            startOffset: placed.startOffset,
            endOffset: placed.endOffset,
            anchoredText: placed.quotedText === src.quotedText ? null : placed.quotedText,
            prefix: placed.prefix,
            suffix: placed.suffix,
            orphaned: false,
          },
        });
      }
      for (const src of sources) {
        const anchor = {
          blockId: src.blockId,
          startOffset: src.startOffset,
          endOffset: src.endOffset,
          quote: src.anchoredText ?? src.quotedText,
          original: src.quotedText,
          prefix: src.prefix,
          suffix: src.suffix,
        };
        const placed = src.orphaned ? refind(anchor, moves) : relocate(anchor, moves);
        if (placed.orphaned && src.orphaned) continue;
        if (placed.orphaned !== src.orphaned) marksChanged = true;
        await tx.source.update({
          where: { id: src.id },
          data: placed.orphaned
            ? { orphaned: true }
            : {
                blockId: placed.blockId,
                startOffset: placed.startOffset,
                endOffset: placed.endOffset,
                // The quote never changes (SPEC.md §5); the words the
                // anchor covers now ride anchoredText.
                anchoredText: placed.quotedText === src.quotedText ? null : placed.quotedText,
                prefix: placed.prefix,
                suffix: placed.suffix,
                orphaned: false,
              },
        });
      }
      const touched = new Set(affected);
      for (const link of links) {
        if (touched.has(link.fromBlockId) && link.fromDocumentId === documentId && !link.fromOrphaned) {
          const placed = relocate(
            {
              blockId: link.fromBlockId,
              startOffset: link.startOffset,
              endOffset: link.endOffset,
              quote: link.quotedText,
              original: link.quotedText,
              prefix: link.prefix,
              suffix: link.suffix,
            },
            moves,
          );
          if (placed.orphaned) marksChanged = true;
          await tx.docLink.update({
            where: { id: link.id },
            data: placed.orphaned
              ? { fromOrphaned: true }
              : {
                  fromBlockId: placed.blockId,
                  startOffset: placed.startOffset,
                  endOffset: placed.endOffset,
                  quotedText: placed.quotedText,
                  prefix: placed.prefix,
                  suffix: placed.suffix,
                },
          });
        }
        if (
          link.toBlockId &&
          touched.has(link.toBlockId) &&
          link.toDocumentId === documentId &&
          !link.toOrphaned &&
          link.toStartOffset !== null &&
          link.toEndOffset !== null &&
          link.toQuotedText !== null
        ) {
          const placed = relocate(
            {
              blockId: link.toBlockId,
              startOffset: link.toStartOffset,
              endOffset: link.toEndOffset,
              quote: link.toQuotedText,
              original: link.toQuotedText,
              prefix: link.toPrefix ?? "",
              suffix: link.toSuffix ?? "",
            },
            moves,
          );
          if (placed.orphaned) marksChanged = true;
          await tx.docLink.update({
            where: { id: link.id },
            data: placed.orphaned
              ? { toOrphaned: true }
              : {
                  toBlockId: placed.blockId,
                  toStartOffset: placed.startOffset,
                  toEndOffset: placed.endOffset,
                  toQuotedText: placed.quotedText,
                  toPrefix: placed.prefix,
                  toSuffix: placed.suffix,
                },
          });
        }
      }
    }

    // A figure object's row copies its media's html when the row is new or
    // its media changed; any other save leaves the html where it is.
    const mediaIds = new Set<string>();
    for (const { d } of created) if (d.mediaId) mediaIds.add(d.mediaId);
    for (const { d, before } of contentChanged) if (d.mediaId && d.mediaId !== before.mediaId) mediaIds.add(d.mediaId);
    const mediaHtml = new Map<string, string | null>();
    if (mediaIds.size > 0) {
      const media = await tx.figureMedia.findMany({
        where: { documentId, id: { in: [...mediaIds] } },
        select: { id: true, html: true },
      });
      for (const f of media) mediaHtml.set(f.id, f.html);
    }
    const htmlOf = (d: DerivedBlock) => (d.mediaId ? (mediaHtml.get(d.mediaId) ?? null) : d.html);

    // The rows themselves.
    if (removed.length > 0) {
      await tx.block.deleteMany({ where: { id: { in: removed.map((b) => b.id) } } });
    }
    for (const part of chunks(created)) {
      await tx.block.createMany({
        data: part.map(({ d, order }) => ({
          id: d.id,
          documentId,
          order,
          type: d.type,
          text: d.text,
          html: htmlOf(d),
          styles: d.styles as unknown as Prisma.InputJsonValue,
          links: d.links as unknown as Prisma.InputJsonValue,
          citations: d.citations as unknown as Prisma.InputJsonValue,
          page: d.page,
          region: jsonb(d.region),
          mediaId: d.mediaId,
          cell: jsonb(d.cell),
          // An import's rows are its parse's; a row typed later is
          // user-authored, like an inserted paragraph.
          originalText: bulk ? null : "",
        })),
      });
    }
    for (const part of chunks(contentChanged)) {
      const rows = part.map(({ d, before }) => {
        // A figure object's row keeps its html while its media stays.
        const keepHtml = d.mediaId !== null && d.mediaId === before.mediaId;
        const json = (value: unknown) => (value === null || value === undefined ? null : JSON.stringify(value));
        return Prisma.sql`(${d.id}, ${d.text}, ${d.type}, ${keepHtml ? null : htmlOf(d)}::text, ${keepHtml}::boolean,
          ${json(d.styles)}::jsonb, ${json(d.links)}::jsonb, ${json(d.citations)}::jsonb, ${d.page}::int,
          ${json(d.region)}::jsonb, ${d.mediaId}::text, ${json(d.cell)}::jsonb)`;
      });
      await tx.$executeRaw`
        UPDATE "Block" AS b SET
          "text" = v.text, "type" = v.type::"BlockType", "html" = CASE WHEN v.keep THEN b."html" ELSE v.html END,
          "styles" = v.styles, "links" = v.links, "citations" = v.citations, "page" = v.page,
          "region" = v.region, "mediaId" = v.media, "cell" = v.cell
        FROM (VALUES ${Prisma.join(rows)})
          AS v(id, text, type, html, keep, styles, links, citations, page, region, media, cell)
        WHERE b."id" = v.id`;
    }
    for (const part of chunks(moved)) {
      const rows = Prisma.join(part.map((k) => Prisma.sql`(${k.d.id}, ${k.order}::int)`));
      await tx.$executeRaw`
        UPDATE "Block" AS b SET "order" = v.o FROM (VALUES ${rows}) AS v(id, o) WHERE b."id" = v.id`;
    }
    for (const part of chunks(textChanged)) {
      // The search vector no longer matches the words; the next search re-embeds.
      const ids = Prisma.join(part.map((k) => k.d.id));
      await tx.$executeRaw`UPDATE "Block" SET "embedding" = NULL WHERE "id" IN (${ids})`;
    }

    // The history (SPEC.md §12): one row per paragraph added, removed,
    // retyped, or restyled — typing merges into the account's last row for
    // the paragraph while it is fresh. An import and a re-parse write none:
    // the caller writes its one entry.
    const removedEdits: Record<string, string> = {};
    if (!bulk) {
      const since = new Date(Date.now() - COALESCE_MS);
      const touchedIds = [...removed.map((b) => b.id), ...textChanged.map((k) => k.d.id), ...formatChanged.map((k) => k.d.id)];
      const recent =
        touchedIds.length > 0
          ? await tx.blockEdit.findMany({
              where: { documentId, userId, blockId: { in: touchedIds }, createdAt: { gte: since } },
              orderBy: { createdAt: "desc" },
            })
          : [];
      const latest = new Map<string, (typeof recent)[number]>();
      for (const e of recent) if (e.blockId && !latest.has(e.blockId)) latest.set(e.blockId, e);

      for (const { d } of created) {
        await tx.blockEdit.create({
          data: { documentId, blockId: d.id, kind: "BLOCK_ADD", after: d.text, userId },
        });
      }
      for (const b of removed) {
        const last = latest.get(b.id);
        if (last && last.kind === "BLOCK_ADD") {
          // Added and taken away while fresh: nothing to keep.
          await tx.blockEdit.deleteMany({ where: { documentId, blockId: b.id, userId, createdAt: { gte: since } } });
          continue;
        }
        const removal = await tx.blockEdit.create({
          data: {
            documentId,
            blockId: b.id,
            kind: "BLOCK_REMOVE",
            before: b.text,
            // A figure object comes back from its media (lib/docs/ops.ts nodeForBlock).
            meta: { order: b.order, type: b.type, html: b.html, originalText: "", ...(b.mediaId ? { mediaId: b.mediaId } : {}) },
            userId,
          },
        });
        removedEdits[b.id] = removal.id;
      }
      for (const { d, before } of textChanged) {
        const last = latest.get(d.id);
        if (last && (last.kind === "TEXT_EDIT" || last.kind === "BLOCK_ADD")) {
          await tx.blockEdit.update({ where: { id: last.id }, data: { after: d.text } });
        } else {
          await tx.blockEdit.create({
            data: { documentId, blockId: d.id, kind: "TEXT_EDIT", before: before.text, after: d.text, userId },
          });
        }
      }
      for (const { d, before } of formatChanged) {
        const from = kindOf(before);
        const to = kindOf(d);
        if (from === to) continue;
        const last = latest.get(d.id);
        if (last && last.kind === "FORMAT") {
          await tx.blockEdit.update({ where: { id: last.id }, data: { after: to, meta: { from: last.before, to } } });
        } else {
          await tx.blockEdit.create({
            data: { documentId, blockId: d.id, kind: "FORMAT", before: from, after: to, meta: { from, to }, userId },
          });
        }
      }

      await keepVersion(tx, documentId, {
        rev: locked.richTextRev,
        savedAt: locked.richTextSavedAt ?? locked.createdAt,
        savedBy: locked.richTextSavedBy,
        keptAt: locked.keptAt,
      });
    }
    const rev = locked.richTextRev + 1;
    await tx.document.update({
      where: { id: documentId },
      data: {
        richText: richText as unknown as Prisma.InputJsonValue,
        richTextRev: rev,
        richTextSavedAt: new Date(),
        richTextSavedBy: userId,
        // What the import, or its re-parse, stored: a later revision is an edit.
        ...(bulk ? { importRev: rev } : {}),
      },
    });
    return { ok: true as const, rev, removedEdits, marksChanged };
  };
  if (outer) return save(outer);
  return db.$transaction(save, { timeout: bulk ? 120_000 : 30_000, maxWait: 15_000 });
}
