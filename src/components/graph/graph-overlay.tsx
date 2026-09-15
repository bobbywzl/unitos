"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { GraphEdge, GraphNode, RecommendedLinkView } from "@/lib/types";
import { api } from "@/lib/api";
import { useCollab } from "@/components/collab/collab-context";
import { AuthorChip } from "@/components/collab/person-badge";
import { ReplyThread } from "@/components/collab/reply-thread";
import { SparkleIcon, UnlinkIcon } from "@/components/icons";
import { useT } from "@/components/lang-provider";
import { Presence } from "@/components/presence";
import { LinkDetail } from "@/components/graph/link-detail";

// reactflow loads only when the graph opens — the workspace bundle stays lean.
const GraphView = dynamic(() => import("@/components/graph/graph-view"), {
  ssr: false,
  loading: () => null,
});

// Full-screen overlay over the workspace: the corpus as a connected whole.
// Recommended links live here too (SPEC.md §13): a folded list beside the
// canvas holds every recommended link of the project — the reason, both
// quotes, Accept and Dismiss — since the dashed curves are theirs.
export function GraphOverlay({
  notebookId,
  activeDocumentId,
  nodes,
  edges,
  recommended,
  linkScansLeft,
  onClose,
}: {
  notebookId: string;
  activeDocumentId: string | null;
  nodes: GraphNode[];
  edges: GraphEdge[];
  recommended: RecommendedLinkView[];
  /** Runs of Recommend links this account has left this month. */
  linkScansLeft: number;
  onClose: () => void;
}) {
  const t = useT();
  const router = useRouter();
  const { canEdit } = useCollab();
  const [listOpen, setListOpen] = useState(false);
  // Recommend links (SPEC.md §13): the scan the reader asks for. It reads
  // every document of the project whole against the others, so it runs only
  // here and only a few times a month; the button says how many are left.
  const [scanning, setScanning] = useState(false);
  const [scanLeft, setScanLeft] = useState(linkScansLeft);
  const [scanNotice, setScanNotice] = useState<string | null>(null);
  const scanAbort = useRef<AbortController | null>(null);

  async function scan() {
    if (scanning || scanLeft <= 0) return;
    setScanning(true);
    setScanNotice(null);
    const controller = new AbortController();
    scanAbort.current = controller;
    try {
      const result = await api<{ linkCount: number; documentsLeft: number; runsLeft: number }>(
        `/api/notebooks/${notebookId}/connect`,
        "POST",
        {},
        { signal: controller.signal },
      );
      setScanLeft(result.runsLeft);
      setScanNotice(
        result.linkCount === 0
          ? t("panes.recommendScanNone")
          : result.documentsLeft > 0
            ? t("panes.recommendScanPartial", { n: result.linkCount, left: result.documentsLeft })
            : t("panes.recommendScanDone", { n: result.linkCount }),
      );
      if (result.linkCount > 0) {
        setListOpen(true);
        router.refresh();
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        setScanNotice(err instanceof Error ? err.message : t("common.requestFailed"));
      }
    } finally {
      if (scanAbort.current === controller) scanAbort.current = null;
      setScanning(false);
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <div data-track-surface="sidebar" className="graph-overlay-in fixed inset-0 z-50 flex flex-col bg-paper">
      <div className="flex items-center gap-3 border-b border-line px-5 py-3">
        <span className="font-display text-[18px]">{t("panes.graph")}</span>
        <span className="mr-auto text-[13px] text-sand-600">
          {t("panes.graphCounts", {
            docs: nodes.length,
            links: edges.reduce((sum, e) => sum + e.accepted + e.recommended, 0),
          })}
        </span>
        {canEdit && nodes.length >= 2 && (
          <button
            onClick={() => void scan()}
            data-track="graph-recommend-links"
            disabled={scanning || scanLeft <= 0}
            data-tip={
              scanLeft > 0
                ? t("panes.recommendScanTitle", { left: scanLeft })
                : t("panes.recommendScanSpentTitle")
            }
            className="ml-auto flex items-center gap-1.5 rounded-full border border-line px-3.5 py-1.5 text-[13px] text-sand-700 hover:bg-clay-100 hover:text-clay-800 disabled:opacity-40"
          >
            <SparkleIcon size={13} />
            {scanning ? t("panes.recommendScanRunning") : t("panes.recommendScan")}
            <span className="rounded-full bg-sand-200 px-1.5 text-[11px] font-semibold tabular-nums text-sand-700">
              {scanLeft}
            </span>
          </button>
        )}
        <button
          onClick={() => setListOpen((v) => !v)}
          data-track="graph-recommended-links"
          aria-expanded={listOpen}
          data-tip={t("panes.recommendedLinksToggleTitle")}
          className={`flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[13px] hover:bg-clay-100 hover:text-clay-800 ${
            listOpen
              ? "border-line bg-clay-100 text-clay-800"
              : recommended.length > 0
                ? "border-dashed border-clay-400 text-clay-800"
                : "border-line text-sand-600"
          }`}
        >
          <UnlinkIcon size={13} />
          {t("panes.recommendedLinks")}
          <span className="rounded-full bg-sand-200 px-1.5 text-[11px] font-semibold tabular-nums text-sand-700">
            {recommended.length}
          </span>
        </button>
        <button
          onClick={onClose}
          data-track="graph-close"
          aria-label={t("common.close")}
          data-tip={t("common.close")}
          className="flex size-8 items-center justify-center rounded-full text-sand-500 hover:bg-clay-100 hover:text-clay-700"
        >
          ✕
        </button>
      </div>
      {scanNotice && (
        <p className="border-b border-line px-5 py-2 text-xs text-sand-600">{scanNotice}</p>
      )}
      <div className="relative min-h-0 flex-1">
        {nodes.length < 2 ? (
          <p className="flex h-full items-center justify-center px-8 text-center text-sm text-sand-600">
            {t("panes.graphEmpty")}
          </p>
        ) : (
          <GraphView
            notebookId={notebookId}
            activeDocumentId={activeDocumentId}
            nodes={nodes}
            edges={edges}
            onOpenDocument={onClose}
          />
        )}
        <Presence show={listOpen} exit="menu">
        {listOpen && (
          <RecommendedLinkList notebookId={notebookId} links={recommended} onOpenDocument={onClose} />
        )}
        </Presence>
      </div>
    </div>
  );
}

// The folded list: every recommended link of the project, newest first. A
// click on a link expands it: why the AI made it, and the passage at each
// end, with a button that opens the reader there. A link becomes real on
// Accept; Dismiss deletes it without a history entry — it never was one.
// Both refresh the page, so the curves redraw.
export function RecommendedLinkList({
  notebookId,
  links,
  onOpenDocument,
}: {
  notebookId: string;
  links: RecommendedLinkView[];
  onOpenDocument: () => void;
}) {
  const t = useT();
  const router = useRouter();
  const { canEdit } = useCollab();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  async function mutate(id: string, run: () => Promise<unknown>) {
    if (busyId) return;
    setBusyId(id);
    setErrorText(null);
    try {
      await run();
      router.refresh();
    } catch (err) {
      setErrorText(err instanceof Error ? err.message : t("common.requestFailed"));
    } finally {
      setBusyId(null);
    }
  }

  function openDocument(documentId: string, linkId: string) {
    router.push(`/n/${notebookId}?doc=${documentId}&link=${linkId}`);
    onOpenDocument();
  }

  const quoteChip =
    "max-w-full truncate rounded-full bg-sand-200 px-2.5 py-0.5 text-left text-[11px] font-semibold text-sand-700 hover:bg-clay-100 hover:text-clay-800";

  return (
    <aside
      data-track-surface="sidebar"
      className="menu-in absolute top-3 right-3 bottom-3 z-10 flex w-[400px] max-w-[calc(100vw-24px)] flex-col gap-2.5 overflow-y-auto rounded-[20px] border border-line bg-card/95 p-4 shadow-float backdrop-blur-md"
    >
      <p className="text-[11px] text-sand-500">{t("panes.recommendedLinksDesc")}</p>
      {errorText && <p className="text-[13px] text-red-600">{errorText}</p>}
      {links.length === 0 && (
        <p className="text-[13px] text-sand-600">{t("panes.recommendedLinksEmpty")}</p>
      )}
      {links.map((l) => {
        const open = openId === l.id;
        return (
        <div key={l.id} className="rounded-2xl border border-dashed border-clay-300 bg-card p-3.5 shadow-soft">
          <button
            onClick={() => setOpenId(open ? null : l.id)}
            data-track="graph-link-expand"
            data-tip={t(open ? "panes.linkCollapse" : "panes.linkExpand")}
            aria-expanded={open}
            className="block w-full rounded-lg text-left hover:bg-clay-100/60"
          >
            <p className="text-[12.5px] leading-snug font-semibold">{l.reason ?? t("panes.linkNoReason")}</p>
            {!open && (
              <p className="mt-1.5 line-clamp-2 border-l-2 border-clay-300 pl-2 text-xs text-sand-600">
                {l.quotedText}
              </p>
            )}
            {!open && l.toQuotedText && (
              <p className="mt-1 line-clamp-2 border-l-2 border-sand-300 pl-2 text-xs text-sand-500">
                {l.toQuotedText}
              </p>
            )}
          </button>
          {open && (
            <div className="mt-2">
              <LinkDetail link={l} onOpen={(documentId) => openDocument(documentId, l.id)} />
            </div>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {!open && (
              <>
                <button
                  onClick={() => openDocument(l.fromDocumentId, l.id)}
                  data-track="graph-link-open"
                  data-tip={t("panes.openLinkEnd", { title: l.fromTitle })}
                  className={quoteChip}
                >
                  {l.fromTitle}
                </button>
                <span className="text-[11px] text-sand-500">⇄</span>
                <button
                  onClick={() => openDocument(l.toDocumentId, l.id)}
                  data-track="graph-link-open"
                  data-tip={t("panes.openLinkEnd", { title: l.toTitle })}
                  className={quoteChip}
                >
                  {l.toTitle}
                </button>
              </>
            )}
            <AuthorChip createdById={l.createdById} nameless />
            {canEdit && (
              <span className="ml-auto flex items-center gap-2">
                <button
                  onClick={() =>
                    void mutate(l.id, () => api(`/api/links/${l.id}`, "PATCH", { accept: true }))
                  }
                  data-track="link-accept"
                  disabled={busyId !== null}
                  data-tip={t("panes.acceptLinkTitle")}
                  className="rounded-full bg-sage-600 px-3 py-1 text-[11px] font-semibold text-sage-fg hover:bg-sage-700 disabled:opacity-40"
                >
                  {t("panes.acceptLink")}
                </button>
                <button
                  onClick={() => void mutate(l.id, () => api(`/api/links/${l.id}`, "DELETE"))}
                  data-track="link-dismiss"
                  disabled={busyId !== null}
                  data-tip={t("panes.dismissLinkTitle")}
                  className="rounded-full border border-line px-2.5 py-1 text-[11px] text-sand-700 hover:bg-clay-100 hover:text-clay-800 disabled:opacity-40"
                >
                  {t("panes.dismissLink")}
                </button>
              </span>
            )}
          </div>
          <ReplyThread target={{ docLinkId: l.id }} replies={l.replies} />
        </div>
        );
      })}
    </aside>
  );
}
