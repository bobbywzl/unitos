import { NextResponse } from "next/server";
import { z } from "zod";
import { resetAccount } from "@/lib/account-reset";
import { adminApiGuard } from "@/lib/admin-auth";
import { USER_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { serverT } from "@/lib/i18n/server";
import { parseBody } from "@/lib/validate";

// Deleting a project's PDF and video bytes takes a moment.
export const maxDuration = 120;

// confirm: the account's email as the admin typed it (the local reader's id
// when sign-in is off). The server checks it too, so a stale page can never
// reset the wrong account.
const resetSchema = z.object({
  userId: z.string().min(1).max(100),
  confirm: z.string().trim().min(1).max(320),
});

// Reset one account (lib/account-reset.ts). Answers the counts of what went.
export async function POST(req: Request) {
  const t = await serverT();
  const denied = await adminApiGuard();
  if (denied) return denied;
  const { data, error } = await parseBody(req, resetSchema);
  if (error) return error;

  const user = await db.user.findUnique({ where: { id: data.userId }, select: { email: true } });
  if (!user && data.userId !== USER_ID) {
    return NextResponse.json({ error: t("api.accountNotFound") }, { status: 404 });
  }
  if (data.confirm.toLowerCase() !== (user?.email ?? USER_ID)) {
    return NextResponse.json({ error: t("api.accountConfirmMismatch") }, { status: 400 });
  }

  const counts = await resetAccount(data.userId);
  if (!counts) return NextResponse.json({ error: t("api.accountNotFound") }, { status: 404 });
  return NextResponse.json({ ok: true, ...counts });
}
