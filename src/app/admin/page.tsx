import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/admin-auth";
import { authEnabled } from "@/lib/auth";
import { db } from "@/lib/db";
import { serverT } from "@/lib/i18n/server";
import { recipientAccounts } from "@/lib/notifications";
import { AdminNav } from "@/components/admin/admin-nav";
import { FeedbackInbox } from "@/components/admin/feedback-inbox";

export const dynamic = "force-dynamic";

// Admin: feedback inbox with new → seen → resolved triage (release-edu pattern)
// and Reply, which reaches the account that sent the feedback as a
// notification (SPEC.md §18).
export default async function AdminPage() {
  if (!(await isAdmin())) redirect("/admin/login");
  const t = await serverT();

  const [feedback, accounts] = await Promise.all([
    db.feedback.findMany({
      orderBy: { createdAt: "desc" },
      take: 300,
      include: {
        replies: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            body: true,
            createdAt: true,
            recipients: { select: { dismissedAt: true } },
          },
        },
      },
    }),
    recipientAccounts(),
  ]);
  // The account that sent each feedback, by name. The admin's view of accounts
  // is names and emails (lib/notifications.ts) — enough to reply.
  const nameOf = new Map(accounts.map((a) => [a.id, a.name || t("admin.localReader")]));

  // Status only — values never leave the server. Operator concern, so it lives
  // here, not in reader Settings.
  const services: { label: string; description: string; set: boolean }[] = [
    { label: "ANTHROPIC_API_KEY", description: t("admin.svcAnthropic"), set: Boolean(process.env.ANTHROPIC_API_KEY) },
    { label: "SESSION_SECRET + provider", description: t("admin.svcSignIn"), set: authEnabled() },
    { label: "ADMIN_PASSWORD", description: t("admin.svcAdmin"), set: Boolean(process.env.ADMIN_PASSWORD) },
  ];

  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <AdminNav active="feedback" />
      <section className="mb-8">
        <h2 className="mb-2 text-[11px] font-bold tracking-[0.08em] text-sand-600 uppercase">
          {t("admin.services")}
        </h2>
        <div className="rounded-2xl bg-card px-4 py-2 shadow-soft">
          {services.map((svc) => (
            <div key={svc.label} className="flex items-center justify-between gap-4 py-2">
              <div>
                <div className="font-mono text-sm">{svc.label}</div>
                <div className="text-xs text-sand-600">{svc.description}</div>
              </div>
              <span
                className={`rounded-full px-3 py-0.5 text-xs font-semibold ${
                  svc.set ? "bg-sage-200 text-sage-800" : "bg-sand-200 text-sand-600"
                }`}
              >
                {svc.set ? t("admin.svcSet") : t("admin.svcNotSet")}
              </span>
            </div>
          ))}
          <p className="border-t border-line py-2 text-xs text-sand-600">{t("admin.envHint")}</p>
        </div>
      </section>
      <FeedbackInbox
        items={feedback.map((f) => ({
          id: f.id,
          category: f.category,
          message: f.message,
          page: f.page,
          userAgent: f.userAgent,
          status: f.status,
          createdAt: f.createdAt.toISOString(),
          account: f.userId ? (nameOf.get(f.userId) ?? null) : null,
          replies: f.replies.map((r) => ({
            id: r.id,
            body: r.body,
            createdAt: r.createdAt.toISOString(),
            dismissed: r.recipients.some((x) => x.dismissedAt !== null),
          })),
        }))}
      />
    </main>
  );
}
