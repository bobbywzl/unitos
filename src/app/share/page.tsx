import Link from "next/link";
import { redirect } from "next/navigation";
import { authEnabled, currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { serverT } from "@/lib/i18n/server";
import { Logo } from "@/components/logo";
import { ShareAdd, type SharePayload } from "@/components/share-add";

export const dynamic = "force-dynamic";

// The share landing page: /share/target staged what another app shared and
// redirected here; the reader picks the project and ingestion runs.
export default async function SharePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await currentUser();
  if (authEnabled() && !user) redirect("/signin");
  const t = await serverT();
  const params = await searchParams;
  const one = (key: string) => {
    const value = params[key];
    return typeof value === "string" ? value : undefined;
  };

  let payload: SharePayload | null = null;
  const uploadId = one("u");
  const url = one("url");
  if (uploadId && /^[a-zA-Z0-9-]{8,64}$/.test(uploadId)) {
    payload = {
      kind: "file",
      uploadId,
      filename: one("name") || "document.pdf",
      fileKind: one("k") === "video" ? "video" : "pdf",
    };
  } else if (url && /^https?:\/\//.test(url)) {
    payload = { kind: "url", url };
  }

  // The projects this account can add to: its own, plus those shared as editor.
  const own = await db.notebook.findMany({
    where: authEnabled() && user ? { userId: user.id } : undefined,
    orderBy: { updatedAt: "desc" },
    select: { id: true, title: true },
  });
  const shared =
    authEnabled() && user
      ? await db.notebookCollaborator.findMany({
          where: { email: user.email, role: "EDITOR" },
          select: { notebook: { select: { id: true, title: true, updatedAt: true } } },
        })
      : [];
  const projects = [
    ...own,
    ...shared
      .sort((a, b) => b.notebook.updatedAt.getTime() - a.notebook.updatedAt.getTime())
      .map((r) => ({ id: r.notebook.id, title: r.notebook.title })),
  ];

  return (
    <main className="mx-auto flex w-full max-w-[560px] flex-col gap-6 px-6 pt-[26px] pb-16">
      <header className="flex items-center gap-3">
        <Logo size={38} className="text-clay" />
        <span className="font-display text-[21px]">{t("common.appName")}</span>
      </header>
      <h1 className="text-[30px]">{t("works.shareAddTitle")}</h1>
      {payload === null ? (
        <p className="text-sm text-sand-600">{t("works.shareAddNothing")}</p>
      ) : projects.length === 0 ? (
        <p className="text-sm text-sand-600">{t("works.shareAddNoProjects")}</p>
      ) : (
        <ShareAdd projects={projects} payload={payload} />
      )}
      <Link href="/" className="text-sm text-clay hover:text-clay-600">
        {t("works.shareAddGoHome")}
      </Link>
    </main>
  );
}
