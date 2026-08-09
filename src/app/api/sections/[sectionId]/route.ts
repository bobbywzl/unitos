import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { normalizeSectionOrders, movedOrder } from "@/lib/order";
import { parseBody } from "@/lib/validate";

const patchSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  order: z.number().int().min(0).optional(),
  parentId: z.string().min(1).nullable().optional(),
});

export async function PATCH(req: Request, ctx: { params: Promise<{ sectionId: string }> }) {
  const { sectionId } = await ctx.params;
  const { data, error } = await parseBody(req, patchSchema);
  if (error) return error;

  const section = await db.section.findUnique({
    where: { id: sectionId },
    include: { _count: { select: { children: true } } },
  });
  if (!section) return NextResponse.json({ error: "Section not found" }, { status: 404 });

  if (data.parentId !== undefined && data.parentId !== section.parentId) {
    if (data.parentId) {
      if (section._count.children > 0) {
        return NextResponse.json({ error: "Sections nest one level deep" }, { status: 400 });
      }
      const parent = await db.section.findUnique({ where: { id: data.parentId } });
      if (!parent || parent.notebookId !== section.notebookId || parent.id === section.id) {
        return NextResponse.json({ error: "Parent section not found" }, { status: 404 });
      }
      if (parent.parentId) {
        return NextResponse.json({ error: "Sections nest one level deep" }, { status: 400 });
      }
    }
    const siblingCount = await db.section.count({
      where: { notebookId: section.notebookId, parentId: data.parentId },
    });
    await db.section.update({
      where: { id: sectionId },
      data: { parentId: data.parentId, order: siblingCount },
    });
  }

  if (data.title !== undefined) {
    await db.section.update({ where: { id: sectionId }, data: { title: data.title } });
  }

  if (data.order !== undefined) {
    const current = await db.section.findUnique({ where: { id: sectionId } });
    if (current) {
      const siblings = await db.section.findMany({
        where: { notebookId: current.notebookId, parentId: current.parentId },
        orderBy: { order: "asc" },
        select: { id: true },
      });
      const ids = movedOrder(siblings.map((s) => s.id), sectionId, data.order);
      await db.$transaction(
        ids.map((id, i) => db.section.update({ where: { id }, data: { order: i } })),
      );
    }
  }

  await normalizeSectionOrders(section.notebookId);
  const updated = await db.section.findUnique({ where: { id: sectionId } });
  return NextResponse.json(updated);
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ sectionId: string }> }) {
  const { sectionId } = await ctx.params;
  const section = await db.section.findUnique({ where: { id: sectionId } });
  if (!section) return NextResponse.json({ error: "Section not found" }, { status: 404 });
  // Children are promoted to top level (parentId set to null by the default referential action).
  await db.section.delete({ where: { id: sectionId } });
  await normalizeSectionOrders(section.notebookId);
  return NextResponse.json({ ok: true });
}
