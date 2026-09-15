import { db } from "@/lib/db";

// The block list (SPEC.md §2): blocked emails, one row each. Every sign-in
// door (lib/auth.ts: signIn, passwordLogin, startEmailConfirmation,
// startPasswordReset, resetPassword; api/auth/test-login) reads
// emailBlocked before it mints a session or sends a link. Block deletes the
// account's sessions and pending email links, so the account is signed out
// at once and no link in an inbox still works; currentUser needs no check
// per request. The list keys on the email, so an email with no account yet
// can be blocked, and a reset account stays blocked.

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function emailBlocked(email: string): Promise<boolean> {
  const row = await db.blockedEmail.findUnique({
    where: { email: normalizeEmail(email) },
    select: { email: true },
  });
  return row !== null;
}

// Every blocked email, oldest block first.
export async function blockedEmails(): Promise<string[]> {
  const rows = await db.blockedEmail.findMany({
    orderBy: { createdAt: "asc" },
    select: { email: true },
  });
  return rows.map((r) => r.email);
}

// Block one email: add the row, sign the account out everywhere, and drop
// its pending sign-in and reset links. Blocking a blocked email is a no-op.
export async function blockEmail(email: string): Promise<void> {
  const key = normalizeEmail(email);
  await db.blockedEmail.upsert({ where: { email: key }, create: { email: key }, update: {} });
  const user = await db.user.findUnique({ where: { email: key }, select: { id: true } });
  if (user) await db.session.deleteMany({ where: { userId: user.id } });
  await db.emailConfirmation.deleteMany({ where: { email: key } });
}

// Unblock one email: remove the row. The email can sign in again; the
// account, if one exists, is as it was. Unblocking an unblocked email is a
// no-op.
export async function unblockEmail(email: string): Promise<void> {
  await db.blockedEmail.deleteMany({ where: { email: normalizeEmail(email) } });
}
