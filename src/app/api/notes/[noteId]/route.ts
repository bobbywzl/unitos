import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { sourceInputSchema } from "@/lib/anchors/input";
import { MAX_SEGMENTS, passageSources, resolvePassage } from "@/lib/anchors/passage";
import { layerBlocks } from "@/lib/anchors/layer";
import { bumpNotebook, noteAccess } from "@/lib/collab";
import { db } from "@/lib/db";
import { serverT } from "@/lib/i18n/server";
import { recordNoteEdit } from "@/lib/notes/edits";
import { sourcesLeftByQuotes } from "@/lib/notes/quote-sources";
import { normalizeNoteOrders, movedOrder } from "@/lib/order";
import { parseBody } from "@/lib/validate";

const patchSchema = z.object({
  content: z.string().min(1).max(50_000).optional(),
  // A quote dropped into the note (SPEC.md §6): its anchor, one segment per
  // block of a passage over several. Resolved through the ladder like a
  // source on a new note (/api/notes), and added to the note's sources.
  addSource: z
    .object({
      source: sourceInputSchema,
      segments: z.array(sourceInputSchema.omit({ documentId: true })).min(1).max(MAX_SEGMENTS).optional(),
    })
    .optional(),
  // An annotation dropped into the note (lib/annotation-reference.ts): copies
  // of the annotation's anchors become sources of the note, so the quote the
  // drop landed points back to the reader. The annotation keeps its own.
  copySourcesFrom: z.string().min(1).optional(),
  color: z.enum(["clay", "sage", "gold", "plum"]).optional(), // highlight hue
  order: z.number().int().min(0).optional(),
  sectionId: z.string().min(1).optional(),
  status: z.enum(["PENDING", "ACCEPTED", "REJECTED"]).optional(),
  pinned: z.boolean().optional(),
});

export async function PATCH(req: Request, ctx: { params: Promise<{ noteId: string }> }) {
  const t = await serverT();
  const { noteId } = await ctx.params;
  const { data, error } = await parseBody(req, patchSchema);
  if (error) return error;

  const note = await db.note.findUnique({ where: { id: noteId } });
  if (!note) return NextResponse.json({ error: t("api.noteNotFound") }, { status: 404 });
  const access = await noteAccess(noteId, "editor");
  if (access instanceof NextResponse) return access;

  const fromSectionId = note.sectionId;

  if (data.addSource) {
    const { source, segments } = data.addSource;
    if (source.endOffset <= source.startOffset) {
      return NextResponse.json({ error: t("api.anchorOffsetsInvalid") }, { status: 400 });
    }
    const layer = source.layer ?? null;
    const passage = resolvePassage(await layerBlocks(source.documentId, layer), source, segments);
    if (passage.length === 0) {
      return NextResponse.json({ error: t("api.anchorNotResolvedInDocument") }, { status: 400 });
    }
    await db.source.createMany({
      data: passageSources(source.documentId, passage, layer).map((row) => ({ ...row, noteId })),
    });
  }

  if (data.copySourcesFrom) {
    const [annotation, own] = await Promise.all([
      db.note.findUnique({
        where: { id: data.copySourcesFrom },
        include: { sources: true, section: { select: { hidden: true, notebookId: true } } },
      }),
      db.section.findUnique({ where: { id: note.sectionId }, select: { notebookId: true } }),
    ]);
    if (!annotation || !annotation.section.hidden || annotation.section.notebookId !== own?.notebookId) {
      return NextResponse.json({ error: t("api.noteNotFound") }, { status: 404 });
    }
    // An anchor the note already holds is not copied twice.
    const held = await db.source.findMany({
      where: { noteId },
      select: { blockId: true, startOffset: true, endOffset: true },
    });
    const keys = new Set(held.map((s) => `${s.blockId}:${s.startOffset}:${s.endOffset}`));
    const rows = annotation.sources
      .filter((s) => !keys.has(`${s.blockId}:${s.startOffset}:${s.endOffset}`))
      .map((s) => ({
        noteId,
        documentId: s.documentId,
        blockId: s.blockId,
        startOffset: s.startOffset,
        endOffset: s.endOffset,
        quotedText: s.quotedText,
        prefix: s.prefix,
        suffix: s.suffix,
        orphaned: s.orphaned,
        layer: s.layer,
        startTime: s.startTime,
        endTime: s.endTime,
        ...(s.region === null ? {} : { region: s.region as Prisma.InputJsonValue }),
      }));
    if (rows.length > 0) await db.source.createMany({ data: rows });
  }

  if (data.sectionId && data.sectionId !== note.sectionId) {
    const target = await db.section.findUnique({ where: { id: data.sectionId } });
    if (!target) return NextResponse.json({ error: t("api.sectionNotFound") }, { status: 404 });
    const count = await db.note.count({ where: { sectionId: data.sectionId } });
    await db.note.update({
      where: { id: noteId },
      data: { sectionId: data.sectionId, order: count },
    });
  }

  if (
    data.content !== undefined ||
    data.status !== undefined ||
    data.color !== undefined ||
    data.pinned !== undefined
  ) {
    await db.note.update({
      where: { id: noteId },
      data: {
        // A content edit clears the gist; the next collapsed render asks for a
        // new one (SPEC.md §6).
        ...(data.content !== undefined ? { content: data.content, gist: null } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.color !== undefined ? { color: data.color } : {}),
        ...(data.pinned !== undefined ? { pinned: data.pinned } : {}),
      },
    });
    // A changed text is the note's history (SPEC.md §12).
    if (data.content !== undefined && data.content !== note.content) {
      await recordNoteEdit(noteId, access.user.id || null, data.content);
      // A quote deleted from the note takes its source with it: the mark in
      // the reader no longer points at a note that lost the words (SPEC.md §6).
      const sources = await db.source.findMany({ where: { noteId }, select: { id: true, quotedText: true } });
      const left = sourcesLeftByQuotes(note.content, data.content, sources);
      if (left.length > 0) await db.source.deleteMany({ where: { id: { in: left }, noteId } });
    }
  }

  // Pinning moves the note to the top of its section; unpinning leaves it in place.
  const targetOrder = data.order ?? (data.pinned === true ? 0 : undefined);
  if (targetOrder !== undefined) {
    const current = await db.note.findUnique({ where: { id: noteId } });
    if (current) {
      const siblings = await db.note.findMany({
        where: { sectionId: current.sectionId },
        orderBy: { order: "asc" },
        select: { id: true },
      });
      const ids = movedOrder(siblings.map((n) => n.id), noteId, targetOrder);
      await db.$transaction(
        ids.map((id, i) => db.note.update({ where: { id }, data: { order: i } })),
      );
    }
  }

  await normalizeNoteOrders(fromSectionId);
  const updated = await db.note.findUnique({ where: { id: noteId } });
  if (updated && updated.sectionId !== fromSectionId) {
    await normalizeNoteOrders(updated.sectionId);
  }
  const section = await db.section.findUnique({
    where: { id: updated?.sectionId ?? fromSectionId },
    select: { notebookId: true },
  });
  if (section) await bumpNotebook(section.notebookId);
  return NextResponse.json(updated);
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ noteId: string }> }) {
  const t = await serverT();
  const { noteId } = await ctx.params;
  const access = await noteAccess(noteId, "editor");
  if (access instanceof NextResponse) return access;
  const note = await db.note.delete({ where: { id: noteId } }).catch(() => null);
  if (!note) return NextResponse.json({ error: t("api.noteNotFound") }, { status: 404 });
  await normalizeNoteOrders(note.sectionId);
  const section = await db.section.findUnique({
    where: { id: note.sectionId },
    select: { notebookId: true, title: true },
  });
  if (section) {
    // Deletions are corpus history (SPEC.md §12): the History panel shows who
    // removed what.
    await db.notebookEvent.create({
      data: {
        notebookId: section.notebookId,
        userId: access.user.id,
        kind: "NOTE_REMOVE",
        content: note.content.slice(0, 500),
        meta: { sectionTitle: section.title },
      },
    });
    await bumpNotebook(section.notebookId);
  }
  return NextResponse.json({ ok: true });
}
