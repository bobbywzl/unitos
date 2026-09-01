import Link from "next/link";
import { redirect } from "next/navigation";
import { authEnabled, currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { serverT } from "@/lib/i18n/server";
import { Logo } from "@/components/logo";
import { AccountGuard } from "@/components/account-guard";
import { WelcomeFlow } from "@/components/works/welcome-flow";
import { WorksShelf, type WorkItem } from "@/components/works/works-shelf";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await currentUser();
  if (!user) redirect("/signin");
  const t = await serverT();
  const workInclude = {
    // Hidden sections (Annotations) stay out of the count, so the tag on a work
    // matches the number of sections its outline shows.
    _count: {
      select: {
        sections: { where: { hidden: false } },
        documents: true,
        collaborators: true,
      },
    },
    // The pending queue carries to the front door (design 2a).
    sections: { select: { _count: { select: { notes: { where: { status: "PENDING" as const } } } } } },
  };
  const works = await db.notebook.findMany({
    // With sign-in on, the shelf is the signed-in reader's corpora.
    where: authEnabled() ? { userId: user.id } : undefined,
    orderBy: { updatedAt: "desc" },
    include: workInclude,
  });

  // Corpora shared with this account, with their owners' names.
  const collabRows = authEnabled()
    ? await db.notebookCollaborator.findMany({
        where: { email: user.email },
        select: { role: true, notebook: { include: workInclude } },
      })
    : [];
  collabRows.sort(
    (a, b) => b.notebook.updatedAt.getTime() - a.notebook.updatedAt.getTime(),
  );
  const owners = await db.user.findMany({
    where: { id: { in: [...new Set(collabRows.map((r) => r.notebook.userId))] } },
    select: { id: true, name: true },
  });
  const ownerById = new Map(owners.map((o) => [o.id, o.name]));

  const toItem = (
    w: (typeof works)[number],
    shared?: { ownerName: string; role: "editor" | "viewer" },
  ): WorkItem => ({
    id: w.id,
    title: w.title,
    sectionCount: w._count.sections,
    documentCount: w._count.documents,
    collaboratorCount: w._count.collaborators,
    pendingCount: w.sections.reduce((sum, s) => sum + s._count.notes, 0),
    updatedAt: w.updatedAt.toISOString(),
    shared,
  });

  return (
    <main className="mx-auto w-full max-w-[1080px] px-6 pb-16 sm:px-16">
      <AccountGuard userId={user.id} enabled={authEnabled()} />
      <header className="flex items-center gap-3 pt-[26px]">
        <Logo size={38} className="text-clay" />
        <span className="font-display text-[21px]">{t("common.appName")}</span>
        {authEnabled() && (
          <Link href="/settings" className="ml-auto flex items-center gap-2">
            {user.picture ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={user.picture} alt="" className="size-7 rounded-full object-cover" />
            ) : (
              <span className="flex size-7 items-center justify-center rounded-full bg-clay-100 text-xs font-semibold text-clay-800">
                {user.name[0]?.toUpperCase()}
              </span>
            )}
            <span className="max-w-[200px] truncate text-xs text-sand-600">{user.email}</span>
          </Link>
        )}
        <Link
          href="/settings"
          aria-label={t("common.settings")}
          className={`flex size-[38px] items-center justify-center rounded-full text-sand-600 hover:bg-clay-100 hover:text-clay-800 ${authEnabled() ? "" : "ml-auto"}`}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </Link>
      </header>

      <div className="pt-16">
        <WelcomeFlow firstWork={works.length === 0 && collabRows.length === 0} />
        <WorksShelf
          works={works.map((w) => toItem(w))}
          sharedWorks={collabRows.map((r) =>
            toItem(r.notebook, {
              ownerName: ownerById.get(r.notebook.userId) ?? "?",
              role: r.role === "EDITOR" ? "editor" : "viewer",
            }),
          )}
          myEmail={user.email}
        />
      </div>
    </main>
  );
}
