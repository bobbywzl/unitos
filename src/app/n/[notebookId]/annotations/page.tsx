import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { annotationKind } from "@/lib/annotations/kind";
import { authEnabled, currentUser } from "@/lib/auth";
import { billingLinks } from "@/lib/billing/switch";
import { peopleByIds, roleOf } from "@/lib/collab";
import { conversationTurns } from "@/lib/conversation";
import { db } from "@/lib/db";
import { serverT } from "@/lib/i18n/server";
import { accountTier } from "@/lib/tiers";
import type { AnnotationItem, ReplyView, SectionView } from "@/lib/types";
import { AccountGuard } from "@/components/account-guard";
import { ActiveTimeClock } from "@/components/active-time-clock";
import { CollabProvider, type CollabState } from "@/components/collab/collab-context";
import { SyncRefresh } from "@/components/collab/sync-refresh";
import { ArrowLeftIcon } from "@/components/icons";
import { AnnotationsFullPage, type AnnotationGroup } from "@/components/panels/annotations-full-page";

export const dynamic = "force-dynamic";

// The annotations full page (SPEC.md §6): every annotation of the project —
// the notes of the hidden Annotations section — grouped by the document its
// first anchor is in, in attach order, a detached document's after them,
// then Project for the sidebar assistant's conversations, anchored nowhere.
// Within a document the cards stand in reading order: the anchor's block,
// then its offset, or its time in a media document. A side chat stays out,
// as everywhere but its chat box.
export default async function AnnotationsPage(props: { params: Promise<{ notebookId: string }> }) {
  const { notebookId } = await props.params;
  const user = await currentUser();
  if (!user) redirect("/signin");
  const notebook = await db.notebook.findUnique({
    where: { id: notebookId },
    include: {
      collaborators: true,
      documents: {
        orderBy: { document: { createdAt: "asc" } },
        include: { document: { select: { id: true, title: true, video: { select: { id: true } } } } },
      },
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

  const toReplyViews = (
    replies: { id: string; content: string; userId: string; resolvedById: string | null; createdAt: Date }[],
  ): ReplyView[] =>
    replies.map((r) => ({
      id: r.id,
      content: r.content,
      userId: r.userId,
      resolvedById: r.resolvedById,
      createdAt: r.createdAt.toISOString(),
    }));

  // The sections with their notes, for the menu's pickers (annotation-menu.tsx).
  const toView = (s: (typeof notebook.sections)[number]): SectionView => ({
    id: s.id,
    title: s.title,
    order: s.order,
    parentId: s.parentId,
    notes: s.notes.map((n) => ({
      id: n.id,
      content: n.content,
      gist: n.gist,
      status: n.status,
      derivationType: n.derivationType,
      pinned: n.pinned,
      order: n.order,
      createdById: n.createdById,
      updatedAt: n.updatedAt.toISOString(),
      documentId: n.documentId,
      sources: n.sources.map((src) => ({
        id: src.id,
        documentId: src.documentId,
        documentTitle: src.document.title,
        quotedText: src.quotedText,
        orphaned: src.orphaned,
      })),
      replies: toReplyViews(n.replies),
    })),
    children: [],
  });
  const byParent = new Map<string | null, SectionView[]>();
  for (const s of notebook.sections) {
    if (s.hidden) continue;
    const list = byParent.get(s.parentId) ?? [];
    list.push(toView(s));
    byParent.set(s.parentId, list);
  }
  const sections = byParent.get(null) ?? [];
  for (const s of sections) s.children = byParent.get(s.id) ?? [];

  // Reading order within a document: the anchor's block, then its offset.
  const attachedIds = notebook.documents.map((nd) => nd.document.id);
  const blockOrder = new Map(
    (
      await db.block.findMany({
        where: { documentId: { in: attachedIds } },
        select: { id: true, order: true },
      })
    ).map((b) => [b.id, b.order]),
  );

  type Placed = { item: AnnotationItem; block: number; at: number; created: number };
  const placed = new Map<string, Placed[]>();
  const titles = new Map(notebook.documents.map((nd) => [nd.document.id, nd.document.title]));
  const project: Placed[] = [];
  const authorIds = new Set<string>([notebook.userId]);
  for (const section of notebook.sections) {
    if (!section.hidden) continue;
    for (const n of section.notes) {
      if (n.sideChatOfId) continue;
      if (n.createdById) authorIds.add(n.createdById);
      for (const r of n.replies) authorIds.add(r.userId);
      const source = n.sources[0] ?? null;
      const created = n.createdAt.getTime();
      if (!source) {
        // The sidebar assistant's own conversation: anchored nowhere.
        const sidebar = n.derivationType === "SYNTHESIS";
        if (!sidebar || (!n.content.trim() && n.replies.length === 0)) continue;
        project.push({
          created,
          block: 0,
          at: 0,
          item: {
            id: n.id,
            kind: "assistant",
            content: n.content,
            gist: n.gist,
            color: n.color,
            sourceId: null,
            quotedText: null,
            orphaned: false,
            figureLabel: null,
            layer: null,
            createdById: n.createdById,
            replies: toReplyViews(n.replies),
            conversation: conversationTurns(n),
          },
        });
        continue;
      }
      if (!titles.has(source.documentId)) titles.set(source.documentId, source.document.title);
      const list = placed.get(source.documentId) ?? [];
      list.push({
        created,
        block: blockOrder.get(source.blockId) ?? Number.MAX_SAFE_INTEGER,
        at: source.startTime ?? source.startOffset,
        item: {
          id: n.id,
          kind: annotationKind(n),
          content: n.content,
          gist: n.gist,
          color: n.color,
          sourceId: source.id,
          quotedText: source.quotedText,
          orphaned: source.orphaned,
          figureLabel: null,
          layer: source.layer === "core" ? "core" : null,
          createdById: n.createdById,
          replies: toReplyViews(n.replies),
          conversation: conversationTurns(n),
        },
      });
      placed.set(source.documentId, list);
    }
  }
  const inOrder = (list: Placed[]) =>
    [...list].sort((a, b) => a.block - b.block || a.at - b.at || a.created - b.created).map((p) => p.item);
  // Attached documents first, in attach order; a detached document's
  // annotations after them; the project's last.
  const detached = [...placed.keys()].filter((id) => !attachedIds.includes(id));
  const groups: AnnotationGroup[] = [
    ...notebook.documents
      .filter((nd) => placed.has(nd.document.id))
      .map((nd) => ({
        documentId: nd.document.id,
        title: nd.document.title,
        media: nd.document.video !== null,
        items: inOrder(placed.get(nd.document.id) ?? []),
      })),
    ...detached.map((id) => ({
      documentId: id,
      title: titles.get(id) ?? "",
      media: false,
      items: inOrder(placed.get(id) ?? []),
    })),
    ...(project.length > 0
      ? [{ documentId: null, title: t("panels.projectGroup"), media: false, items: [...project].sort((a, b) => b.created - a.created).map((p) => p.item) }]
      : []),
  ];

  const tier = accountTier(user, authEnabled());
  const collab: CollabState = {
    authOn: authEnabled(),
    role: myRole,
    canEdit: myRole !== "viewer",
    shared: authEnabled() && notebook.collaborators.length > 0,
    myId: user.id,
    people: await peopleByIds(authorIds),
    tier,
    trialEndsAt: user.trialEndsAt?.toISOString() ?? null,
    premium: tier !== "expired",
    ultra: tier === "ultra",
    billing: await billingLinks(),
  };

  return (
    <main className="mx-auto w-full max-w-[760px] px-6 pt-[26px] pb-24">
      <AccountGuard userId={user.id} enabled={authEnabled()} />
      <ActiveTimeClock enabled={authEnabled()} />
      <header className="mb-[34px] flex items-center gap-2">
        <Link
          href="/"
          className="flex items-center gap-2 rounded-full bg-sand-100 py-[7px] pr-4 pl-3 text-[13px] text-sand-700 shadow-soft hover:bg-clay-100 hover:text-clay-800"
        >
          <ArrowLeftIcon size={15} />
          {t("common.works")}
        </Link>
        <span className="ml-2 truncate text-[13px] text-sand-600">{notebook.title}</span>
        <div className="ml-auto flex items-center gap-2">
          <Link
            href={`/n/${notebook.id}`}
            className="rounded-full border border-line px-4 py-1.5 text-[13px] text-sand-700 hover:bg-clay-100 hover:text-clay-800"
          >
            {t("outline.reader")}
          </Link>
        </div>
      </header>
      <CollabProvider value={collab}>
        <SyncRefresh notebookId={notebook.id} rev={notebook.rev} />
        <AnnotationsFullPage notebookId={notebook.id} groups={groups} sections={sections} />
      </CollabProvider>
    </main>
  );
}
