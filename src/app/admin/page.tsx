import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/admin-auth";
import { db } from "@/lib/db";
import { AdminNav } from "@/components/admin/admin-nav";
import { FeedbackInbox } from "@/components/admin/feedback-inbox";

export const dynamic = "force-dynamic";

// Admin: feedback inbox with new → seen → resolved triage (release-edu pattern).
export default async function AdminPage() {
  if (!(await isAdmin())) redirect("/admin/login");

  const feedback = await db.feedback.findMany({
    orderBy: { createdAt: "desc" },
    take: 300,
  });

  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <AdminNav active="feedback" />
      <FeedbackInbox
        items={feedback.map((f) => ({
          id: f.id,
          category: f.category,
          message: f.message,
          page: f.page,
          userAgent: f.userAgent,
          status: f.status,
          createdAt: f.createdAt.toISOString(),
        }))}
      />
    </main>
  );
}
