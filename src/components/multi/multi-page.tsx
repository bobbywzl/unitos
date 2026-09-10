"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useCollab } from "@/components/collab/collab-context";
import { RecommendedLinkList } from "@/components/graph/graph-overlay";
import { ArrowLeftIcon, FilmIcon, GraphIcon } from "@/components/icons";
import { useT } from "@/components/lang-provider";
import { GeneratedList } from "@/components/multi/generated-list";
import { StitchBox } from "@/components/multi/stitch-box";
import { Presence } from "@/components/presence";
import { isImeKey } from "@/lib/ime";
import { clipWords } from "@/lib/markdown-preview";
import type { GraphEdge, GraphNode, MultiUploadView, RecommendedLinkView } from "@/lib/types";

// reactflow loads only when the graph shows — the page bundle stays lean.
const GraphView = dynamic(() => import("@/components/graph/graph-view"), {
  ssr: false,
  loading: () => null,
});

// The multi upload page (SPEC.md §22): three or more members as a graph
// (default) or a list, the generated content beside them, and the Stitch
// assistant at the foot, ready for any command across the members. Two
// members never land here: page.tsx sends them to the reader side by side.

type Tab = "members" | "generated";
type MembersView = "graph" | "list";
const VIEW_STORE = "unitos-multi-view";

function readView(): MembersView {
  try {
    return localStorage.getItem(VIEW_STORE) === "list" ? "list" : "graph";
  } catch {
    return "graph";
  }
}

export function MultiPage({
  multi,
  graph,
}: {
  multi: MultiUploadView;
  graph: { nodes: GraphNode[]; edges: GraphEdge[]; recommended: RecommendedLinkView[] };
}) {
  const t = useT();
  const router = useRouter();
  const { canEdit } = useCollab();
  const [tab, setTab] = useState<Tab>("members");
  const [view, setView] = useState<MembersView>("graph");
  const [listOpen, setListOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(multi.title);
  // The remembered view, read after hydration: localStorage is client-only.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setView(readView());
  }, []);
  function chooseView(next: MembersView) {
    setView(next);
    try {
      localStorage.setItem(VIEW_STORE, next);
    } catch {
      // Storage can be unavailable; the choice then lives in memory only.
    }
  }

  async function rename() {
    const title = draft.trim();
    setRenaming(false);
    if (!title || title === multi.title) {
      setDraft(multi.title);
      return;
    }
    await api(`/api/multi/${multi.id}`, "PATCH", { title });
    router.refresh();
  }

  async function remove() {
    if (!confirm(t("multi.confirmDelete"))) return;
    await api(`/api/multi/${multi.id}`, "DELETE");
    router.push(`/n/${multi.notebookId}`);
    router.refresh();
  }

  const docHref = (documentId: string) => `/n/${multi.notebookId}?doc=${documentId}&multi=${multi.id}`;
  const linkCountOf = (documentId: string) =>
    graph.edges
      .filter((e) => e.a === documentId || e.b === documentId)
      .reduce((sum, e) => sum + e.accepted + e.recommended, 0);
  const totalLinks = graph.edges.reduce((sum, e) => sum + e.accepted + e.recommended, 0);

  const tabButton = (key: Tab, label: string) => (
    <button
      role="tab"
      aria-selected={tab === key}
      onClick={() => setTab(key)}
      data-track={`multi-tab:${key}`}
      className={`rounded-full px-3.5 py-1.5 text-[12.5px] whitespace-nowrap ${
        tab === key ? "bg-card font-semibold text-clay-800 shadow-soft" : "text-sand-600 hover:text-clay-800"
      }`}
    >
      {label}
    </button>
  );
  const viewButton = (key: MembersView, label: string, title: string) => (
    <button
      onClick={() => chooseView(key)}
      data-track={`multi-view:${key}`}
      aria-pressed={view === key}
      data-tip={title}
      className={`rounded-full px-3 py-1 text-[12px] ${
        view === key ? "bg-clay text-clay-fg" : "bg-sand-100 text-sand-700 hover:bg-clay-100"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div data-track-surface="topbar" className="content-in flex h-screen flex-col bg-paper">
      <header className="flex min-w-0 items-center gap-3 border-b border-line px-5 py-3">
        <Link
          href={`/n/${multi.notebookId}`}
          data-track="multi-back"
          aria-label={t("multi.backToProject")}
          data-tip={t("multi.backToProject")}
          className="flex size-[38px] shrink-0 items-center justify-center rounded-full text-sand-700 hover:bg-clay-100 hover:text-clay-800"
        >
          <ArrowLeftIcon size={18} />
        </Link>
        <span className="shrink-0 rounded-full bg-sand-100 px-2.5 py-1 text-[11px] font-semibold text-sand-600">
          {t("multi.multiUpload")}
        </span>
        {renaming ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => void rename()}
            onKeyDown={(e) => {
              if (isImeKey(e)) return;
              if (e.key === "Enter") void rename();
              if (e.key === "Escape") {
                setDraft(multi.title);
                setRenaming(false);
              }
            }}
            aria-label={t("multi.renameTitle")}
            className="min-w-0 flex-1 rounded-full bg-sand-100 px-4 py-1.5 font-display text-[17px] outline-none"
          />
        ) : (
          <button
            onClick={() => canEdit && setRenaming(true)}
            data-track="multi-rename"
            data-tip={canEdit ? t("multi.renameTitle") : undefined}
            className="min-w-0 flex-1 truncate text-left font-display text-[17px] text-ink"
          >
            {multi.title}
          </button>
        )}
        <span className="shrink-0 text-[12px] text-sand-600">
          {t("multi.memberCount", { n: multi.members.length })} ·{" "}
          {t(totalLinks === 1 ? "multi.linkCount1" : "multi.linkCountN", { n: totalLinks })}
        </span>
        <div role="tablist" className="flex shrink-0 gap-1 rounded-full bg-sand-100 p-1">
          {tabButton("members", t("multi.members"))}
          {tabButton("generated", `${t("multi.generated")} · ${multi.generated.length}`)}
        </div>
        {canEdit && (
          <button
            onClick={() => void remove()}
            data-track="multi-delete"
            aria-label={t("multi.delete")}
            data-tip={t("multi.deleteTitle")}
            className="shrink-0 rounded-full px-3 py-1.5 text-[12px] text-sand-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950"
          >
            {t("multi.delete")}
          </button>
        )}
      </header>

      <div className="relative min-h-0 flex-1">
        {tab === "members" ? (
          <>
            <div className="absolute top-3 left-3 z-10 flex items-center gap-1.5 rounded-full border border-line bg-card/95 p-1 shadow-soft backdrop-blur-md">
              {viewButton("graph", t("multi.viewGraph"), t("multi.viewGraphTitle"))}
              {viewButton("list", t("multi.viewList"), t("multi.viewListTitle"))}
            </div>
            {graph.recommended.length > 0 && (
              <button
                onClick={() => setListOpen((open) => !open)}
                data-track="multi-recommended-links"
                aria-expanded={listOpen}
                className="absolute top-3 right-3 z-10 flex items-center gap-1.5 rounded-full border border-dashed border-clay-300 bg-card/95 px-3.5 py-1.5 text-[12px] font-semibold text-sand-700 shadow-soft backdrop-blur-md hover:bg-clay-100 hover:text-clay-800"
              >
                <GraphIcon size={13} />
                {listOpen
                  ? t("multi.recommendedLinksClose")
                  : t("multi.recommendedLinksOpen", { n: graph.recommended.length })}
              </button>
            )}
            {view === "graph" ? (
              <GraphView
                notebookId={multi.notebookId}
                activeDocumentId={null}
                nodes={graph.nodes}
                edges={graph.edges}
                onOpenDocument={() => {}}
                docHref={docHref}
              />
            ) : (
              <div className="h-full overflow-y-auto px-5 pt-16 pb-6">
                <ul className="mx-auto flex max-w-[760px] flex-col gap-2">
                  {multi.members.map((m) => (
                    <li key={m.id} className="flex items-center gap-3 rounded-2xl border border-line bg-card px-4 py-3 shadow-soft">
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-sand-100 text-[11px] font-semibold tabular-nums text-sand-600">
                        {m.order + 1}
                      </span>
                      <button
                        onClick={() => router.push(docHref(m.id))}
                        data-track="multi-member-open"
                        data-tip={t("multi.openMember")}
                        className="min-w-0 flex-1 text-left"
                      >
                        <span className="flex items-center gap-1.5 truncate text-[14px] font-semibold text-sand-800 hover:text-clay-800">
                          {m.hasVideo && <FilmIcon size={13} className="shrink-0 text-sand-500" />}
                          {clipWords(m.title, 80)}
                        </span>
                        <span className="mt-0.5 block truncate text-[11px] text-sand-500">
                          {t("multi.blockCount", { n: m.blockCount })} ·{" "}
                          {t(linkCountOf(m.id) === 1 ? "multi.linkCount1" : "multi.linkCountN", {
                            n: linkCountOf(m.id),
                          })}
                          {m.sourceUrl ? ` · ${m.sourceUrl}` : ""}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <Presence show={listOpen} exit="menu">
            {listOpen && (
              <RecommendedLinkList
                notebookId={multi.notebookId}
                links={graph.recommended}
                onOpenDocument={() => setListOpen(false)}
              />
            )}
            </Presence>
          </>
        ) : (
          <div className="h-full overflow-y-auto px-5 py-6">
            <div className="mx-auto max-w-[760px]">
              <GeneratedList notebookId={multi.notebookId} multiId={multi.id} generated={multi.generated} />
            </div>
          </div>
        )}
      </div>

      {/* The Stitch assistant, front and center under the members (SPEC.md §22). */}
      <div className="shrink-0 border-t border-line bg-paper px-5 py-3">
        <div className="mx-auto max-w-[860px]">
          <StitchBox notebookId={multi.notebookId} multiId={multi.id} />
        </div>
      </div>
    </div>
  );
}
