import { NextResponse } from "next/server";
import { z } from "zod";
import { authEnabled, currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { serverT } from "@/lib/i18n/server";
import { parseBody } from "@/lib/validate";

export async function GET() {
  const t = await serverT();
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: t("api.signInRequired") }, { status: 401 });
  const notebooks = await db.notebook.findMany({
    where: authEnabled() ? { userId: user.id } : undefined,
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { sections: true, documents: true } } },
  });
  return NextResponse.json(notebooks);
}

const createSchema = z.object({
  title: z.string().min(1).max(200),
});

export async function POST(req: Request) {
  const t = await serverT();
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: t("api.signInRequired") }, { status: 401 });
  const { data, error } = await parseBody(req, createSchema);
  if (error) return error;
  // Every corpus starts with a default Notes section.
  const notebook = await db.notebook.create({
    data: { title: data.title, userId: user.id, sections: { create: { title: "Notes", order: 0 } } },
  });
  return NextResponse.json(notebook, { status: 201 });
}
