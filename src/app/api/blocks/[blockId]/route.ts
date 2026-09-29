import { Prisma } from "@prisma/client";
import { after, NextResponse } from "next/server";
import { z } from "zod";
import { formatKind, stripListMarkers, withListMarkers, type FormatKind } from "@/lib/block-kind";
import { blockTakes, documentShape } from "@/lib/block-takes";
import { diffSegments, remapAnchor, remapRange } from "@/lib/anchors/remap";
import { bumpDocument, documentAccess } from "@/lib/collab";
import { db } from "@/lib/db";
import { removeBlock, replaceBlockText, setBlockKind } from "@/lib/docs/ops";
import { editRichText, importSharedResponse, isRichTextDocument } from "@/lib/docs/server";
import { refreshSkeleton } from "@/lib/graph/skeleton";
import { REPLICA_REFUSAL, replicaEdit, sheetCutSchema, slidePicture, type SheetCut } from "@/lib/replica";
import { serverT } from "@/lib/i18n/server";
import { parseBody } from "@/lib/validate";

const patchSchema = z
  .object({
    text: z.string().max(50_000).optional(),
    // code: a code block again (Undo of a code block's format change).
    kind: z.enum(["paragraph", "h1", "h2", "h3", "list", "numbered", "code"]).optional(),
  })
  .refine((d) => d.text !== undefined || d.kind !== undefined, {
    message: "text or kind is required",
  });

const KIND_TO_BLOCK: Record<
  string,
  { type: "PARAGRAPH" | "HEADING" | "LIST" | "CODE"; html: string | null }
> = {
  paragraph: { type: "PARAGRAPH", html: null },
  h1: { type: "HEADING", html: "<h1>" },
  h2: { type: "HEADING", html: "<h2>" },
  h3: { type: "HEADING", html: "<h3>" },
  // Both list kinds store as LIST; the numbering lives in the text markers.
  list: { type: "LIST", html: null },
  numbered: { type: "LIST", html: null },
  code: { type: "CODE", html: null },
};

type StyleSpan = { start: number; end: number; style: string; quotedText: string };

// The rows or columns a sheet edit took out, kept on the edit so Undo puts
// them back; past this size they are not kept, and Undo builds them anew.
const CUT_MAX = 100_000;

/** What the block's last edit took out of its sheet, when this edit takes
    that one back: the text goes back to the text before it. */
async function cutTakenBack(block: { id: string; documentId: string; text: string }, text: string): Promise<SheetCut | null> {
  const last = await db.blockEdit.findFirst({
    where: { documentId: block.documentId, blockId: block.id, kind: "TEXT_EDIT" },
    orderBy: { createdAt: "desc" },
    select: { before: true, after: true, meta: true },
  });
  if (!last || last.before !== text || last.after !== block.text) return null;
  const parsed = sheetCutSchema.safeParse((last.meta as Record<string, unknown> | null)?.cut);
  return parsed.success ? parsed.data : null;
}

/** A list conversion's text, as the reader's edit toolbar writes it: into a
    list, every line takes its marker; out of one, the markers go. */
function convertedText(text: string, from: FormatKind, to: FormatKind): string {
  if (to === "list" || to === "numbered") return withListMarkers(text, to);
  return from === "list" || from === "numbered" ? stripListMarkers(text) : text;
}

// Edit a block's text. TABLE and FIGURE content is sanitized html, not text, so they are
// not editable. block.html is left untouched — for HEADING it stores the level tag.
// The document glossary is left alone; term offsets re-resolve at render.
export async function PATCH(req: Request, ctx: { params: Promise<{ blockId: string }> }) {
  const t = await serverT();
  const { blockId } = await ctx.params;
  const { data, error } = await parseBody(req, patchSchema);
  if (error) return error;

  const block = await db.block.findUnique({ where: { id: blockId } });
  if (!block) return NextResponse.json({ error: t("api.blockNotFound") }, { status: 404 });
  const access = await documentAccess(block.documentId, "editor");
  if (access instanceof NextResponse) return access;

  // A figure's html is its content; a slide's, a sheet's, and a converted
  // table's replica takes new words through its text (below), never a kind,
  // and any other table keeps its html (the rule, below).
  const replica = block.type === "SLIDE" || block.type === "SHEET" || block.type === "TABLE";
  if (block.type === "FIGURE" || (replica && data.kind !== undefined)) {
    return NextResponse.json({ error: t("api.onlyTextBlocksEdited") }, { status: 400 });
  }

  // A blank document is edited through its rich text (SPEC.md §29).
  if (await isRichTextDocument(block.documentId)) {
    if (block.type === "TABLE") return NextResponse.json({ error: t("api.onlyTextBlocksEdited") }, { status: 400 });
    const result = await editRichText(block.documentId, access.user.id, (doc) => {
      let next: typeof doc | null = doc;
      if (data.text !== undefined) next = replaceBlockText(next, blockId, data.text);
      if (next && data.kind !== undefined && data.kind !== "code") next = setBlockKind(next, blockId, data.kind) ?? next;
      return next;
    });
    if (!result.ok) {
      return result.reason === "shared" ? importSharedResponse(t) : NextResponse.json({ error: t("api.blockNotFound") }, { status: 404 });
    }
    return NextResponse.json(await db.block.findUnique({ where: { id: blockId } }));
  }

  const target = data.kind !== undefined ? KIND_TO_BLOCK[data.kind] : null;
  const fromKind = formatKind(block.type, block.html, block.text);
  const kindChanges = data.kind !== undefined && fromKind !== data.kind;
  // Only an edit that cannot corrupt the document (lib/block-takes.ts): a
  // page, a video's player, or a sheet's name keeps its words, and a page,
  // a transcript line, or an equation keeps its kind.
  const shape = await documentShape(block.documentId);
  if (data.text !== undefined && data.text !== block.text && !blockTakes.words(block.type, shape)) {
    return NextResponse.json({ error: t("api.onlyTextBlocksEdited") }, { status: 400 });
  }
  if (kindChanges && !blockTakes.kind(block.type, shape)) {
    return NextResponse.json({ error: t("api.blockKindFixed") }, { status: 400 });
  }
  // A list conversion sent without text re-marks the stored text.
  const text = data.text ?? (kindChanges ? convertedText(block.text, fromKind, data.kind!) : undefined);

  // Format change without a text change: heading level, paragraph, or list kind,
  // recorded as FORMAT. List conversions change the text too and take the path below.
  if (text === undefined || text === block.text) {
    if (!kindChanges || !target) return NextResponse.json(block);
    const [formatted] = await db.$transaction([
      db.block.update({
        where: { id: blockId },
        data: { type: target.type, html: target.html },
      }),
      db.blockEdit.create({
        data: {
          documentId: block.documentId,
          blockId: block.id,
          kind: "FORMAT",
          before: fromKind,
          after: data.kind,
          meta: { from: fromKind, to: data.kind },
          userId: access.user.id,
        },
      }),
    ]);
    await bumpDocument(block.documentId);
    return NextResponse.json(formatted);
  }

  const newText = text;
  // A slide's or a sheet's replica takes the new words in place (SPEC.md
  // §27: its DOM text stays the block's text), a sheet its rows and columns
  // too, and a converted table is drawn anew from its text (§16); a slide
  // whose words are not its words as parsed shows its replica, its picture
  // held.
  let replicaHtml: string | null = null;
  let replicaCut: SheetCut | null = null;
  if (replica) {
    const cut = block.type === "SHEET" ? await cutTakenBack(block, newText) : null;
    const edited = replicaEdit(block.type, block.html ?? "", block.text, newText, cut);
    if ("refused" in edited) return NextResponse.json({ error: t(REPLICA_REFUSAL[edited.refused]) }, { status: 400 });
    replicaHtml = block.type === "SLIDE" ? slidePicture(edited.html, newText, block.originalText ?? block.text) : edited.html;
    replicaCut = edited.cut && JSON.stringify(edited.cut).length <= CUT_MAX ? edited.cut : null;
  }

  // Remap every anchor on this block through the edit, the way Google Docs
  // moves highlights while you type: shift, grow, shrink, or orphan visibly.
  const segments = diffSegments(block.text, newText);
  const [sources, links] = await Promise.all([
    db.source.findMany({ where: { blockId, orphaned: false, layer: null } }),
    db.docLink.findMany({
      where: { OR: [{ fromBlockId: blockId }, { toBlockId: blockId }] },
    }),
  ]);

  const spans = (Array.isArray(block.styles) ? block.styles : []) as unknown as StyleSpan[];
  const nextSpans = spans.flatMap((s) => {
    const r = remapRange(segments, s.start, s.end);
    if (r.orphaned) return []; // the styled words are gone; the style goes with them
    return [{ ...s, start: r.start, end: r.end, quotedText: newText.slice(r.start, r.end) }];
  });

  // Citation spans remap the same way; a citation whose words are gone goes with them.
  type CitationSpan = { start: number; end: number; refId: string; quotedText: string };
  const citations = (Array.isArray(block.citations) ? block.citations : []) as unknown as CitationSpan[];
  const nextCitations = citations.flatMap((c) => {
    const r = remapRange(segments, c.start, c.end);
    if (r.orphaned) return [];
    return [{ ...c, start: r.start, end: r.end, quotedText: newText.slice(r.start, r.end) }];
  });

  const updated = await db.$transaction(async (tx) => {
    const saved = await tx.block.update({
      where: { id: blockId },
      // First edit freezes the original, so edited-vs-original coloring always
      // diffs against the text as parsed.
      // An edit back to the text as parsed makes the block unedited again, so
      // Undo gives it back as it was; a block with no styles keeps none.
      data: {
        text: newText,
        ...(spans.length > 0 ? { styles: nextSpans.length > 0 ? nextSpans : Prisma.DbNull } : {}),
        ...(citations.length > 0 ? { citations: nextCitations } : {}),
        ...(kindChanges && target ? { type: target.type, html: target.html } : {}),
        ...(replicaHtml !== null ? { html: replicaHtml } : {}),
        ...(block.originalText === null ? { originalText: block.text } : newText === block.originalText ? { originalText: null } : {}),
      },
    });
    // The search vector no longer matches the text; the next search re-embeds.
    await tx.$executeRaw`UPDATE "Block" SET "embedding" = NULL WHERE "id" = ${blockId}`;
    await tx.blockEdit.create({
      data: {
        documentId: block.documentId,
        blockId: block.id,
        kind: "TEXT_EDIT",
        before: block.text,
        after: newText,
        ...(replicaCut ? { meta: { cut: replicaCut } } : {}),
        userId: access.user.id,
      },
    });
    if (kindChanges && data.kind !== undefined) {
      await tx.blockEdit.create({
        data: {
          documentId: block.documentId,
          blockId: block.id,
          kind: "FORMAT",
          before: fromKind,
          after: data.kind,
          meta: { from: fromKind, to: data.kind },
          userId: access.user.id,
        },
      });
    }
    // The quote stays the words as quoted (SPEC.md §5): a note's quote and
    // an annotation's words never change under an edit. The words the anchor
    // covers now ride anchoredText, so the ladder still finds the mark.
    for (const src of sources) {
      const r = remapAnchor(segments, newText, { ...src, quotedText: src.anchoredText ?? src.quotedText });
      await tx.source.update({
        where: { id: src.id },
        data: {
          startOffset: r.startOffset,
          endOffset: r.endOffset,
          anchoredText: r.orphaned || r.quotedText === src.quotedText ? null : r.quotedText,
          prefix: r.prefix,
          suffix: r.suffix,
          orphaned: r.orphaned,
        },
      });
    }
    for (const link of links) {
      if (link.fromBlockId === blockId && !link.fromOrphaned) {
        const r = remapAnchor(segments, newText, {
          startOffset: link.startOffset,
          endOffset: link.endOffset,
          quotedText: link.quotedText,
        });
        await tx.docLink.update({
          where: { id: link.id },
          data: {
            startOffset: r.startOffset,
            endOffset: r.endOffset,
            quotedText: r.quotedText,
            prefix: r.prefix,
            suffix: r.suffix,
            fromOrphaned: r.orphaned,
          },
        });
      }
      if (
        link.toBlockId === blockId &&
        !link.toOrphaned &&
        link.toStartOffset !== null &&
        link.toEndOffset !== null &&
        link.toQuotedText !== null
      ) {
        const r = remapAnchor(segments, newText, {
          startOffset: link.toStartOffset,
          endOffset: link.toEndOffset,
          quotedText: link.toQuotedText,
        });
        await tx.docLink.update({
          where: { id: link.id },
          data: {
            toStartOffset: r.startOffset,
            toEndOffset: r.endOffset,
            toQuotedText: r.quotedText,
            toPrefix: r.prefix,
            toSuffix: r.suffix,
            toOrphaned: r.orphaned,
          },
        });
      }
    }
    return saved;
  });
  await bumpDocument(block.documentId);
  // The skeleton rebuilds after the response once more than a tenth of the
  // document has changed (SPEC.md §22); under that the check is all it does.
  after(() => refreshSkeleton(block.documentId, access.user.id).catch(() => {}));
  return NextResponse.json(updated);
}

// Remove a block. Its anchors orphan visibly (SPEC.md §5); the Edits panel can
// restore the block from the recorded text, format, and position.
export async function DELETE(_req: Request, ctx: { params: Promise<{ blockId: string }> }) {
  const t = await serverT();
  const { blockId } = await ctx.params;
  const block = await db.block.findUnique({ where: { id: blockId } });
  if (!block) return NextResponse.json({ error: t("api.blockNotFound") }, { status: 404 });
  const access = await documentAccess(block.documentId, "editor");
  if (access instanceof NextResponse) return access;
  const richText = await isRichTextDocument(block.documentId);
  if ((block.type === "TABLE" && richText) || block.type === "FIGURE" || block.type === "SLIDE" || block.type === "SHEET") {
    return NextResponse.json({ error: t("api.onlyTextBlocksRemoved") }, { status: 400 });
  }

  // A blank document is edited through its rich text (SPEC.md §29).
  if (richText) {
    const result = await editRichText(block.documentId, access.user.id, (doc) => removeBlock(doc, blockId));
    if (!result.ok) {
      return result.reason === "shared" ? importSharedResponse(t) : NextResponse.json({ error: t("api.blockNotFound") }, { status: 404 });
    }
    return NextResponse.json({ ok: true, editId: result.removedEdits[blockId] ?? null });
  }
  // A video's player, a sheet's name, a table other than a converted one,
  // and a handwritten document's last page stay (lib/block-takes.ts).
  if (!blockTakes.removal(block.type, await documentShape(block.documentId))) {
    return NextResponse.json({ error: t(block.type === "PAGE" ? "api.lastPageStays" : "api.onlyTextBlocksRemoved") }, { status: 400 });
  }

  const [, , , , removal] = await db.$transaction([
    db.block.delete({ where: { id: blockId } }),
    db.source.updateMany({ where: { blockId }, data: { orphaned: true } }),
    db.docLink.updateMany({ where: { fromBlockId: blockId }, data: { fromOrphaned: true } }),
    db.docLink.updateMany({ where: { toBlockId: blockId }, data: { toOrphaned: true } }),
    db.blockEdit.create({
      data: {
        documentId: block.documentId,
        blockId: block.id,
        kind: "BLOCK_REMOVE",
        before: block.text,
        // What restore needs to bring the block back whole: a page its
        // number, a transcript line its times and voice, words their styles.
        meta: {
          order: block.order,
          type: block.type,
          html: block.html,
          originalText: block.originalText,
          page: block.page,
          startTime: block.startTime,
          endTime: block.endTime,
          speaker: block.speaker,
          styles: block.styles ?? undefined,
          links: block.links ?? undefined,
          citations: block.citations ?? undefined,
        },
        userId: access.user.id,
      },
    }),
  ]);
  await bumpDocument(block.documentId);
  after(() => refreshSkeleton(block.documentId, access.user.id).catch(() => {}));
  // The removal's id: undo puts the block back through /api/blocks/restore,
  // with its own id, so anchors on it heal instead of orphaning.
  return NextResponse.json({ ok: true, editId: removal.id });
}
