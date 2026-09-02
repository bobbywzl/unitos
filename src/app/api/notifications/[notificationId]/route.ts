import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { serverT } from "@/lib/i18n/server";
import { parseBody } from "@/lib/validate";

const patchSchema = z.object({ dismissed: z.literal(true) });

// Dismiss: the recipient takes the notification off their dashboard
// (SPEC.md §18). Only the recipient can; another account's notification
// answers 404. The row stays, so the admin's dismissed count holds.
export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ notificationId: string }> },
) {
  const t = await serverT();
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: t("api.signInRequired") }, { status: 401 });
  const { notificationId } = await ctx.params;
  const { error } = await parseBody(req, patchSchema);
  if (error) return error;

  const updated = await db.notificationRecipient.updateMany({
    where: { notificationId, userId: user.id },
    data: { dismissedAt: new Date() },
  });
  if (updated.count === 0) {
    return NextResponse.json({ error: t("api.notificationNotFound") }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
