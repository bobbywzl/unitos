import { USER_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { revokeDriveToken } from "@/lib/drive/link";

// Reset an account (the admin accounts page, /admin/accounts): delete
// everything the account holds and put it back at onboarding, so it reads like
// a new account.
//
// Deleted: its projects with everything under them (sections, notes, sources,
// replies, attachments, digest, collaborators, presence, history); the
// documents only its projects held — a document still attached to another
// account's project, or cited by a note in one, stays in the library (the
// document DELETE rule); its profile; its sessions (signed out everywhere);
// its memberships on other accounts' shared projects; its pending email links;
// its Drive link (revoked at Google); its picture, symbol, color, and premium
// flag.
//
// Kept: the account row with its email, name, and password; its usage
// telemetry; the notes, edits, and replies it made in other accounts' projects
// — those are the other project's record.
//
// createdAt and lastSeenAt stamp anew. The welcome splash keys on the account's
// id and createdAt (components/works/welcome-flow.tsx), so the account sees
// the welcome flow and the nudges again.
//
// Sign-in off: the local reader (USER_ID) has no account row; the data reset is
// the same.

export type AccountResetCounts = { projects: number; documents: number; notes: number };

// Null = no such account.
export async function resetAccount(userId: string): Promise<AccountResetCounts | null> {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user && userId !== USER_ID) return null;

  const notebooks = await db.notebook.findMany({
    where: { userId },
    select: {
      id: true,
      documents: { select: { documentId: true } },
      sections: { select: { _count: { select: { notes: true } } } },
    },
  });
  const documentIds = [...new Set(notebooks.flatMap((n) => n.documents.map((d) => d.documentId)))];
  const notes = notebooks.reduce(
    (sum, n) => sum + n.sections.reduce((s, section) => s + section._count.notes, 0),
    0,
  );

  // The projects, with everything under them (cascades).
  await db.notebook.deleteMany({ where: { userId } });

  // The documents only these projects held. One still attached elsewhere, or
  // cited by a note elsewhere, stays in the library.
  const orphaned =
    documentIds.length === 0
      ? []
      : await db.document.findMany({
          where: { id: { in: documentIds }, notebooks: { none: {} }, sources: { none: {} } },
          select: { id: true },
        });
  if (orphaned.length > 0) {
    await db.document.deleteMany({ where: { id: { in: orphaned.map((d) => d.id) } } });
  }

  await db.readerProfile.deleteMany({ where: { userId } });
  await db.notebookDigest.deleteMany({ where: { userId } });
  await db.notebookPresence.deleteMany({ where: { userId } });

  if (user) {
    // Memberships on other accounts' shared projects; those projects refresh.
    const shared = await db.notebookCollaborator.findMany({
      where: { email: user.email },
      select: { notebookId: true },
    });
    if (shared.length > 0) {
      await db.notebookCollaborator.deleteMany({ where: { email: user.email } });
      await db.notebook.updateMany({
        where: { id: { in: shared.map((s) => s.notebookId) } },
        data: { rev: { increment: 1 } },
      });
    }
    await db.session.deleteMany({ where: { userId } });
    await db.emailConfirmation.deleteMany({ where: { email: user.email } });
    if (user.driveRefreshToken) await revokeDriveToken(user.driveRefreshToken);
    const now = new Date();
    await db.user.update({
      where: { id: userId },
      data: {
        picture: "",
        symbol: "",
        color: "",
        premium: false,
        driveRefreshToken: "",
        createdAt: now,
        lastSeenAt: now,
      },
    });
  }

  return { projects: notebooks.length, documents: orphaned.length, notes };
}
