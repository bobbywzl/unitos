import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { authEnabled, currentUser } from "@/lib/auth";
import { peopleByIds, roleOf } from "@/lib/collab";
import { db } from "@/lib/db";
import { serverT } from "@/lib/i18n/server";
import type { NotebookView, SectionView } from "@/lib/types";
import { ArrowLeftIcon } from "@/components/icons";
import { AccountGuard } from "@/components/account-guard";
import { CollabProvider, type CollabState } from "@/components/collab/collab-context";
import { SyncRefresh } from "@/components/collab/sync-refresh";
import { ExportMenu } from "@/components/export-menu";
import { Outline } from "@/components/outline/outline";

export const dynamic = "force-dynamic";

export default async function NotesPage(props: { params: Promise<{ notebookId: string }> }) {
  const { notebookId } = await props.params;
  const user = await currentUser();
  if (!user) redirect("/signin");
  const notebook = await db.notebook.findUnique({
    where: { id: notebookId },
    include: {
      collaborators: true,
      sections: {
        orderBy: { order: "asc" },
        include: {
          notes: {
            where: { status: { not: "REJECTED" } },
            orderBy: { order: "asc" },
            include: {
              sources: { include: { document: { select: { id: true, title: true } } } },
              replies: { orderBy: { createdAt: "asc" } },
            },
          },
        },
      },
    },
  });
  if (!notebook) notFound();
  const myRole = authEnabled() ? roleOf(notebook, user) : "owner";
  if (!myRole) notFound();
  const t = await serverT();

  const toView = (s: (typeof notebook.sections)[number]): SectionView => ({
    id: s.id,
    title: s.title,
    order: s.order,
    parentId: s.parentId,
    notes: s.notes.map((n) => ({
      id: n.id,
      content: n.content,
      status: n.status,
      derivationType: n.derivationType,
      order: n.order,
      createdById: n.createdById,
      sources: n.sources.map((src) => ({
        id: src.id,
        documentId: src.documentId,
        documentTitle: src.document.title,
        quotedText: src.quotedText,
        orphaned: src.orphaned,
      })),
      replies: n.replies.map((r) => ({
        id: r.id,
        content: r.content,
        userId: r.userId,
        resolvedById: r.resolvedById,
        createdAt: r.createdAt.toISOString(),
      })),
    })),
    children: [],
  });

  const byParent = new Map<string | null, SectionView[]>();
  for (const s of notebook.sections) {
    if (s.hidden) continue; // Annotations section stays out of the outline
    const view = toView(s);
    const list = byParent.get(s.parentId) ?? [];
    list.push(view);
    byParent.set(s.parentId, list);
  }
  const top = byParent.get(null) ?? [];
  for (const s of top) s.children = byParent.get(s.id) ?? [];

  const view: NotebookView = { id: notebook.id, title: notebook.title, sections: top };

  const authorIds = new Set<string>([notebook.userId]);
  for (const section of notebook.sections) {
    for (const n of section.notes) {
      if (n.createdById) authorIds.add(n.createdById);
      for (const r of n.replies) authorIds.add(r.userId);
    }
  }
  const collab: CollabState = {
    authOn: authEnabled(),
    role: myRole,
    canEdit: myRole !== "viewer",
    shared: authEnabled() && notebook.collaborators.length > 0,
    myId: user.id,
    people: await peopleByIds(authorIds),
  };

  return (
    <main className="mx-auto w-[760px] max-w-full px-6 pt-[26px] pb-24">
      <AccountGuard userId={user.id} enabled={authEnabled()} />
      <header className="mb-[34px] flex items-center gap-2">
        <Link
          href="/"
          className="flex items-center gap-2 rounded-full bg-sand-100 py-[7px] pr-4 pl-3 text-[13px] text-sand-700 shadow-soft hover:bg-clay-100 hover:text-clay-800"
        >
          <ArrowLeftIcon size={15} />
          {t("common.works")}
        </Link>
        <div className="ml-auto flex items-center gap-2">
          <Link
            href={`/n/${notebook.id}`}
            className="rounded-full border border-line px-4 py-1.5 text-[13px] text-sand-700 hover:bg-clay-100 hover:text-clay-800"
          >
            {t("outline.reader")}
          </Link>
          <ExportMenu notebookId={notebook.id} />
        </div>
      </header>
      <CollabProvider value={collab}>
        <SyncRefresh notebookId={notebook.id} rev={notebook.rev} />
        <Outline notebook={view} />
      </CollabProvider>
    </main>
  );
}
