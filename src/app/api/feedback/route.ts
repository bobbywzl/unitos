import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { serverT } from "@/lib/i18n/server";
import { parseBody } from "@/lib/validate";

const MAX_PER_DAY = 50;

const MAX_FEEDBACK_IMAGES = 6;
const MAX_FEEDBACK_LINKS = 10;

const createSchema = z.object({
  category: z.enum(["bug", "idea", "other"]),
  message: z.string().min(1).max(4000),
  page: z.string().max(300).optional(),
  // Photos: ids the images route answered with (POST /api/images), uploaded
  // by this account. Links: absolute http(s) URLs.
  images: z.array(z.string().min(1).max(64)).max(MAX_FEEDBACK_IMAGES).optional(),
  links: z
    .array(z.string().trim().url().max(2000).refine((u) => /^https?:\/\//i.test(u), { message: "http(s) only" }))
    .max(MAX_FEEDBACK_LINKS)
    .optional(),
});

// User feedback. Context is captured server-side; the admin inbox triages it.
// The account that files it is recorded, so the admin can reply (SPEC.md §18).
// Signed out, the feedback still lands, with no account to reply to.
export async function POST(req: Request) {
  const t = await serverT();
  const { data, error } = await parseBody(req, createSchema);
  if (error) return error;
  const user = await currentUser();

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recent = await db.feedback.count({ where: { createdAt: { gte: since } } }).catch(() => 0);
  if (recent >= MAX_PER_DAY) {
    return NextResponse.json({ error: t("api.feedbackLimit") }, { status: 429 });
  }

  // Every photo must be one this account uploaded: an id nobody else's
  // feedback can point at.
  const imageIds = [...new Set(data.images ?? [])];
  if (imageIds.length > 0) {
    const owned = await db.imageAsset.count({
      where: { id: { in: imageIds }, userId: user?.id ?? null, documentId: null },
    });
    if (owned !== imageIds.length) {
      return NextResponse.json({ error: t("api.imageNotFound") }, { status: 400 });
    }
  }

  await db.feedback.create({
    data: {
      category: data.category,
      message: data.message,
      images: imageIds,
      links: [...new Set(data.links ?? [])],
      page: data.page ?? null,
      userAgent: (req.headers.get("user-agent") ?? "").slice(0, 300) || null,
      userId: user?.id ?? null,
    },
  });
  return NextResponse.json({ ok: true }, { status: 201 });
}
