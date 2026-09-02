import { authEnabled } from "@/lib/auth";
import { USER_ID } from "@/lib/constants";
import { db } from "@/lib/db";

// Notifications (SPEC.md §18): the admin sends, the recipient's dashboard
// shows. This module is the admin's whole view of accounts — id, name, email,
// enough to pick recipients and to name who sent feedback. The admin never
// opens or changes an account.

export type RecipientAccount = { id: string; name: string; email: string };

// The length cap of a notification's title: the send form's, and the cut of a
// reply's title.
export const TITLE_MAX = 200;

// The title of a reply to feedback (kind "feedback"): the feedback's message on
// one line, cut to TITLE_MAX. The dashboard shows the whole message from the
// Feedback row; the title stands in where only the notification is at hand
// (the admin's sent list, a feedback row that is gone).
export function feedbackReplyTitle(message: string): string {
  const line = message.replace(/\s+/g, " ").trim();
  return line.length <= TITLE_MAX ? line : `${line.slice(0, TITLE_MAX - 1)}…`;
}

// Every account a notification can go to: the User rows with sign-in on;
// with sign-in off, the local reader (it has no User row — name "" here, the
// admin page labels it).
export async function recipientAccounts(): Promise<RecipientAccount[]> {
  if (!authEnabled()) return [{ id: USER_ID, name: "", email: "" }];
  return db.user.findMany({
    select: { id: true, name: true, email: true },
    orderBy: { createdAt: "asc" },
  });
}
