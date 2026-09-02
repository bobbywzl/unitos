import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/admin-auth";
import { db } from "@/lib/db";
import { serverT } from "@/lib/i18n/server";
import { recipientAccounts } from "@/lib/notifications";
import { AdminNav } from "@/components/admin/admin-nav";
import { AdminNotifications, type SentNotification } from "@/components/admin/notifications";

export const dynamic = "force-dynamic";

// Admin: send a notification to accounts (SPEC.md §18) and see every send.
// The account list here is names and emails for picking recipients — the
// admin cannot open or change an account, and nothing on this page writes a
// User row.
export default async function AdminNotificationsPage() {
  if (!(await isAdmin())) redirect("/admin/login");
  const t = await serverT();

  const accounts = (await recipientAccounts()).map((a) => ({
    ...a,
    name: a.name || t("admin.localReader"),
  }));
  const nameOf = new Map(accounts.map((a) => [a.id, a.name]));

  const rows = await db.notification.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { recipients: { select: { userId: true, dismissedAt: true } } },
  });
  const sent: SentNotification[] = rows.map((n) => ({
    id: n.id,
    kind: n.kind,
    title: n.title,
    body: n.body,
    createdAt: n.createdAt.toISOString(),
    recipients: n.recipients.map((r) => nameOf.get(r.userId) ?? r.userId),
    dismissed: n.recipients.filter((r) => r.dismissedAt).length,
  }));

  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <AdminNav active="notifications" />
      <header className="mb-6">
        <h1 className="text-[28px]">{t("admin.notifications")}</h1>
        <p className="text-sm text-sand-600">{t("admin.notificationsDesc")}</p>
      </header>
      <AdminNotifications accounts={accounts} sent={sent} />
    </main>
  );
}
