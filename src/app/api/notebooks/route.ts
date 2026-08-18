import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { parseBody } from "@/lib/validate";

export async function GET() {
  const notebooks = await db.notebook.findMany({
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { sections: true, documents: true } } },
  });
  return NextResponse.json(notebooks);
}

const createSchema = z.object({
  title: z.string().min(1).max(200),
});

export async function POST(req: Request) {
  const { data, error } = await parseBody(req, createSchema);
  if (error) return error;
  // Every corpus starts with a default Notes section.
  const notebook = await db.notebook.create({
    data: { title: data.title, sections: { create: { title: "Notes", order: 0 } } },
  });
  return NextResponse.json(notebook, { status: 201 });
}
