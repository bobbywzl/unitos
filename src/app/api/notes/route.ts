import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { parseBody } from "@/lib/validate";

const createSchema = z.object({
  sectionId: z.string().min(1),
  content: z.string().min(1).max(50_000),
});

// Manual notes only. Derived notes are created by /api/derive.
export async function POST(req: Request) {
  const { data, error } = await parseBody(req, createSchema);
  if (error) return error;

  const section = await db.section.findUnique({ where: { id: data.sectionId } });
  if (!section) return NextResponse.json({ error: "Section not found" }, { status: 404 });

  const count = await db.note.count({ where: { sectionId: data.sectionId } });
  const note = await db.note.create({
    data: {
      sectionId: data.sectionId,
      content: data.content,
      status: "ACCEPTED",
      order: count,
    },
  });
  return NextResponse.json(note, { status: 201 });
}
