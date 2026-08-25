import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { serverT } from "@/lib/i18n/server";
import { parseBody } from "@/lib/validate";

const MAX_PER_DAY = 50;

const createSchema = z.object({
  category: z.enum(["bug", "idea", "other"]),
  message: z.string().min(1).max(4000),
  page: z.string().max(300).optional(),
});

// User feedback. Context is captured server-side; the admin inbox triages it.
export async function POST(req: Request) {
  const t = await serverT();
  const { data, error } = await parseBody(req, createSchema);
  if (error) return error;

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recent = await db.feedback.count({ where: { createdAt: { gte: since } } }).catch(() => 0);
  if (recent >= MAX_PER_DAY) {
    return NextResponse.json({ error: t("api.feedbackLimit") }, { status: 429 });
  }

  await db.feedback.create({
    data: {
      category: data.category,
      message: data.message,
      page: data.page ?? null,
      userAgent: (req.headers.get("user-agent") ?? "").slice(0, 300) || null,
    },
  });
  return NextResponse.json({ ok: true }, { status: 201 });
}
