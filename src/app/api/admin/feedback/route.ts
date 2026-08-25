import { NextResponse } from "next/server";
import { z } from "zod";
import { adminApiGuard } from "@/lib/admin-auth";
import { db } from "@/lib/db";
import { serverT } from "@/lib/i18n/server";
import { parseBody } from "@/lib/validate";

export async function GET() {
  const denied = await adminApiGuard();
  if (denied) return denied;
  const feedback = await db.feedback.findMany({
    orderBy: { createdAt: "desc" },
    take: 300,
  });
  return NextResponse.json(feedback);
}

const patchSchema = z.object({
  id: z.string().min(1),
  status: z.enum(["new", "seen", "resolved"]),
});

// Triage: new → seen → resolved.
export async function PATCH(req: Request) {
  const t = await serverT();
  const denied = await adminApiGuard();
  if (denied) return denied;
  const { data, error } = await parseBody(req, patchSchema);
  if (error) return error;
  const updated = await db.feedback
    .update({ where: { id: data.id }, data: { status: data.status } })
    .catch(() => null);
  if (!updated) return NextResponse.json({ error: t("api.feedbackNotFound") }, { status: 404 });
  return NextResponse.json(updated);
}
