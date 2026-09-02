import { authEnabled } from "@/lib/auth";
import { USER_ID } from "@/lib/constants";
import { db } from "@/lib/db";

// Notifications (SPEC.md §18): the admin sends, the recipient's dashboard
// shows. This module is the admin's whole view of accounts — id, name, email,
// enough to pick recipients. The admin never opens or changes an account.

export type RecipientAccount = { id: string; name: string; email: string };

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
