import { NextResponse } from "next/server";
import { z } from "zod";
import { adminApiGuard } from "@/lib/admin-auth";
import { db } from "@/lib/db";
import { serverT } from "@/lib/i18n/server";
import { feedbackReplyTitle, recipientAccounts } from "@/lib/notifications";
import { parseBody } from "@/lib/validate";

const STATUSES = ["new", "seen", "resolved"] as const;

// The inbox, newest first. Query: status = a comma list of new, seen,
// resolved (default: all); take = at most 2000 rows (default 300); since =
// an ISO date, rows filed at or after it. The feedback pipeline
// (.claude/skills/feedback-pipeline) reads new and seen in bulk this way.
export async function GET(req: Request) {
  const denied = await adminApiGuard();
  if (denied) return denied;
  const params = new URL(req.url).searchParams;
  const statuses = (params.get("status") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is (typeof STATUSES)[number] => (STATUSES as readonly string[]).includes(s));
  const take = Math.min(2000, Math.max(1, Number(params.get("take")) || 300));
  const sinceRaw = params.get("since");
  const since = sinceRaw && !Number.isNaN(Date.parse(sinceRaw)) ? new Date(sinceRaw) : null;
  const feedback = await db.feedback.findMany({
    where: {
      ...(statuses.length > 0 ? { status: { in: statuses } } : {}),
      ...(since ? { createdAt: { gte: since } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take,
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

const replySchema = z.object({
  id: z.string().min(1),
  body: z.string().trim().min(1).max(4000),
});

// Reply: one Notification of kind "feedback" to the account that filed the
// feedback (SPEC.md §18), pointing back at it through feedbackId. Feedback with
// no account — filed signed out, or before accounts were recorded — or with an
// account the recipient list does not know answers 400. Replying to new
// feedback marks it seen.
export async function POST(req: Request) {
  const t = await serverT();
  const denied = await adminApiGuard();
  if (denied) return denied;
  const { data, error } = await parseBody(req, replySchema);
  if (error) return error;

  const feedback = await db.feedback.findUnique({
    where: { id: data.id },
    select: { id: true, userId: true, message: true, status: true },
  });
  if (!feedback) return NextResponse.json({ error: t("api.feedbackNotFound") }, { status: 404 });
  const userId = feedback.userId;
  const known = userId ? (await recipientAccounts()).some((a) => a.id === userId) : false;
  if (!userId || !known) {
    return NextResponse.json({ error: t("api.feedbackNoAccount") }, { status: 400 });
  }

  const notification = await db.notification.create({
    data: {
      kind: "feedback",
      title: feedbackReplyTitle(feedback.message),
      body: data.body,
      feedbackId: feedback.id,
      recipients: { create: { userId } },
    },
    select: { id: true },
  });
  if (feedback.status === "new") {
    await db.feedback.update({ where: { id: feedback.id }, data: { status: "seen" } });
  }
  return NextResponse.json({ ok: true, id: notification.id }, { status: 201 });
}
