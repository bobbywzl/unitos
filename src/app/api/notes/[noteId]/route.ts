import { NextResponse } from "next/server";
import { z } from "zod";
import { clearNoteEmbedding, ensureNoteEmbeddings } from "@/lib/assistant/embeddings";
import { db } from "@/lib/db";
import { normalizeNoteOrders, movedOrder } from "@/lib/order";
import { parseBody } from "@/lib/validate";

const patchSchema = z.object({
  content: z.string().min(1).max(50_000).optional(),
  order: z.number().int().min(0).optional(),
  sectionId: z.string().min(1).optional(),
  status: z.enum(["PENDING", "ACCEPTED", "REJECTED"]).optional(),
});

export async function PATCH(req: Request, ctx: { params: Promise<{ noteId: string }> }) {
  const { noteId } = await ctx.params;
  const { data, error } = await parseBody(req, patchSchema);
  if (error) return error;

  const note = await db.note.findUnique({ where: { id: noteId } });
  if (!note) return NextResponse.json({ error: "Note not found" }, { status: 404 });

  const fromSectionId = note.sectionId;

  if (data.sectionId && data.sectionId !== note.sectionId) {
    const target = await db.section.findUnique({ where: { id: data.sectionId } });
    if (!target) return NextResponse.json({ error: "Section not found" }, { status: 404 });
    const count = await db.note.count({ where: { sectionId: data.sectionId } });
    await db.note.update({
      where: { id: noteId },
      data: { sectionId: data.sectionId, order: count },
    });
  }

  if (data.content !== undefined || data.status !== undefined) {
    await db.note.update({
      where: { id: noteId },
      data: {
        ...(data.content !== undefined ? { content: data.content } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
      },
    });
    // Embeddings track accepted content: edits invalidate, accepts backfill (SPEC.md §2).
    if (data.content !== undefined) await clearNoteEmbedding(noteId);
    if (data.status === "ACCEPTED" || data.content !== undefined) {
      void ensureNoteEmbeddings().catch(() => {});
    }
  }

  if (data.order !== undefined) {
    const current = await db.note.findUnique({ where: { id: noteId } });
    if (current) {
      const siblings = await db.note.findMany({
        where: { sectionId: current.sectionId },
        orderBy: { order: "asc" },
        select: { id: true },
      });
      const ids = movedOrder(siblings.map((n) => n.id), noteId, data.order);
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
  return NextResponse.json(updated);
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ noteId: string }> }) {
  const { noteId } = await ctx.params;
  const note = await db.note.delete({ where: { id: noteId } }).catch(() => null);
  if (!note) return NextResponse.json({ error: "Note not found" }, { status: 404 });
  await normalizeNoteOrders(note.sectionId);
  return NextResponse.json({ ok: true });
}
