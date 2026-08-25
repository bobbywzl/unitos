import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/admin-auth";
import { db } from "@/lib/db";
import { ensureAllDigests } from "@/lib/digest/ensure";
import { serverT } from "@/lib/i18n/server";
import { AdminNav } from "@/components/admin/admin-nav";
import { DigestStore } from "@/components/admin/digest-store";

export const dynamic = "force-dynamic";

// Admin: the digest store — what the assistant reads (SPEC.md §7). Per user:
// every corpus, every document, and every annotation, note, and distillation
// under it. Loading the page brings every digest current.
export default async function AdminDigestPage() {
  if (!(await isAdmin())) redirect("/admin/login");

  const t = await serverT();
  const [rows, users] = await Promise.all([ensureAllDigests(), db.user.findMany()]);
  const accounts = Object.fromEntries(
    users.map((u) => [u.id, { email: u.email, name: u.name, picture: u.picture }]),
  );

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <AdminNav active="digest" />
      <header className="mb-6">
        <h1 className="text-[28px]">{t("admin.digest")}</h1>
        <p className="text-sm text-sand-600">{t("admin.digestDesc")}</p>
      </header>
      <DigestStore rows={rows} accounts={accounts} />
    </main>
  );
}
