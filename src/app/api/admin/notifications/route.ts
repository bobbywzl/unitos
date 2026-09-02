import { NextResponse } from "next/server";
import { z } from "zod";
import { adminApiGuard } from "@/lib/admin-auth";
import { db } from "@/lib/db";
import { serverT } from "@/lib/i18n/server";
import { recipientAccounts, TITLE_MAX } from "@/lib/notifications";
import { parseBody } from "@/lib/validate";

// Admin notifications (SPEC.md §18). Send writes Notification and
// NotificationRecipient rows, Delete removes them — nothing here reads a
// session or writes a User row. The admin cannot open or change an account.

const MAX_CHOSEN = 1000;

const sendSchema = z.object({
  // The composed kinds. "feedback" comes only from Reply in the feedback inbox
  // (POST /api/admin/feedback), which fills the recipient itself.
  kind: z.enum(["update", "account"]),
  title: z.string().trim().min(1).max(TITLE_MAX),
  body: z.string().trim().min(1).max(4000),
  // "all" = every account; else the chosen account ids.
  recipients: z.union([z.literal("all"), z.array(z.string().min(1)).min(1).max(MAX_CHOSEN)]),
});

// Send: one Notification, one NotificationRecipient per recipient. Ids not in
// the account list drop; none left = 400.
export async function POST(req: Request) {
  const t = await serverT();
  const denied = await adminApiGuard();
  if (denied) return denied;
  const { data, error } = await parseBody(req, sendSchema);
  if (error) return error;

  const known = (await recipientAccounts()).map((a) => a.id);
  const chosen = new Set(data.recipients === "all" ? known : data.recipients);
  const ids = known.filter((id) => chosen.has(id));
  if (ids.length === 0) {
    return NextResponse.json({ error: t("api.notificationNoRecipients") }, { status: 400 });
  }

  const notification = await db.notification.create({
    data: {
      kind: data.kind,
      title: data.title,
      body: data.body,
      recipients: { createMany: { data: ids.map((userId) => ({ userId })) } },
    },
    select: { id: true },
  });
  return NextResponse.json({ ok: true, id: notification.id, sent: ids.length }, { status: 201 });
}

const deleteSchema = z.object({ id: z.string().min(1) });

// Delete one send for every recipient, open and dismissed alike.
export async function DELETE(req: Request) {
  const t = await serverT();
  const denied = await adminApiGuard();
  if (denied) return denied;
  const { data, error } = await parseBody(req, deleteSchema);
  if (error) return error;
  const deleted = await db.notification.delete({ where: { id: data.id } }).catch(() => null);
  if (!deleted) {
    return NextResponse.json({ error: t("api.notificationNotFound") }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
