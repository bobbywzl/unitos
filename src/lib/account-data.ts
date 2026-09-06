import type { User } from "@prisma/client";
import { db } from "@/lib/db";

// Your data (Settings): every stored field and count about one account, so
// the reader sees what Unitos holds without asking. Read-only; the Privacy
// Policy says where each part goes. The local reader (sign-in off) has no
// account row: its dates are null and it has no sessions.
export type AccountData = {
  passwordSet: boolean;
  createdAt: string | null; // ISO
  lastSeenAt: string | null; // ISO
  sessions: number; // live signed-in sessions
  projects: number;
  documents: number; // distinct documents attached to the account's projects
  notes: number;
  digests: number; // the stored project context the assistant reads
  clicks: number; // click telemetry rows (SPEC.md §7)
  usage: number; // AI calls metered on the account
  feedback: number;
  notifications: number;
};

export async function accountData(user: User, signedIn: boolean): Promise<AccountData> {
  const userId = user.id;
  const [sessions, projects, documents, notes, digests, clicks, usage, feedback, notifications] =
    await Promise.all([
      signedIn ? db.session.count({ where: { userId, expiresAt: { gt: new Date() } } }) : 0,
      db.notebook.count({ where: { userId } }),
      db.document.count({ where: { notebooks: { some: { notebook: { userId } } } } }),
      db.note.count({ where: { section: { notebook: { userId } } } }),
      db.notebookDigest.count({ where: { userId } }),
      db.clickEvent.count({ where: { userId } }),
      db.usageEvent.count({ where: { userId } }),
      db.feedback.count({ where: { userId } }),
      db.notificationRecipient.count({ where: { userId } }),
    ]);
  return {
    passwordSet: Boolean(user.passwordHash),
    createdAt: signedIn ? user.createdAt.toISOString() : null,
    lastSeenAt: signedIn ? user.lastSeenAt.toISOString() : null,
    sessions,
    projects,
    documents,
    notes,
    digests,
    clicks,
    usage,
    feedback,
    notifications,
  };
}
