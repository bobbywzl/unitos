"use client";

import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import type { GraphEdgeLink } from "@/lib/types";
import { api } from "@/lib/api";
import { linkPath } from "@/lib/link-scope";
import { useCollab } from "@/components/collab/collab-context";
import { confirmLinkRemoval, linkRemovable } from "@/components/collab/confirm-link-removal";
import { ArrowLeftIcon } from "@/components/icons";
import { useT } from "@/components/lang-provider";
import { LinkDetail } from "@/components/graph/link-detail";
import { LinkNoteComposer } from "@/components/graph/link-note-composer";
import { LinkReplies } from "@/components/graph/link-replies";
import { LinkNotes } from "@/components/graph/graph-notes";

// An expanded link, in the side panel at full height (SPEC.md §13; WALK2-05):
// the two documents, why the link was made, each end's passage with Open in
// reader, the link's replies, the notes on the link (WALK3-03), and Note on
// this link. A click on a link in a
// curve's list or in the Links list opens it here; the curve stays pinned
// and lit on the canvas, and nothing covers its two ends. A recommended link
// keeps Accept and Dismiss.

export function LinkPanel({
  link,
  onBack,
  backLabel,
  onClose,
  onOpenDocument,
}: {
  link: GraphEdgeLink;
  /** Back to the list the link was opened from: Links, the Notes list, or the node card. */
  onBack?: () => void;
  /** The back arrow's label; default "Back to Links". */
  backLabel?: string;
  onClose: () => void;
  /** The reader opened a document from the panel (the URL already moved). */
  onOpenDocument: () => void;
}) {
  const t = useT();
  const router = useRouter();
  const { canEdit } = useCollab();
  const { notebookId } = useParams<{ notebookId?: string }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [decided, setDecided] = useState<"accepted" | "dismissed" | null>(null);
  const loop = link.fromDocumentId === link.toDocumentId;

  async function decide(accept: boolean) {
    if (busy) return;
    if (!accept && !confirmLinkRemoval(t, link.replies?.length ?? 0, "dismiss")) return;
    setBusy(true);
    setError(null);
    try {
      if (accept) await api(linkPath(link.id, notebookId), "PATCH", { accept: true });
      else await api(linkPath(link.id, notebookId), "DELETE");
      setDecided(accept ? "accepted" : "dismissed");
      router.refresh();
      if (!accept) onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.requestFailed"));
    } finally {
      setBusy(false);
    }
  }

  // pb-24: a long thread scrolls its last controls (Send, Save) clear of the
  // Feedback button at the bottom right.
  return (
    <aside
      data-track-surface="graph-link-panel"
      data-graph-side-list="link"
      data-graph-link-panel={link.id}
      id="graph-list-link"
      tabIndex={-1}
      aria-label={t("panes.graphLinkPanel")}
      className="menu-in absolute top-3 right-3 bottom-3 z-10 flex w-[400px] max-w-[calc(100vw-24px)] flex-col gap-2.5 overflow-y-auto rounded-[20px] border border-line bg-card/95 p-4 pb-24 shadow-float outline-none backdrop-blur-md max-[999px]:bottom-16 max-[999px]:pb-4"
    >
      <div className="flex items-start gap-2">
        {onBack && (
          <button
            onClick={onBack}
            data-track="graph-link-panel-back"
            aria-label={backLabel ?? t("panes.graphLinksBack")}
            data-tip={backLabel ?? t("panes.graphLinksBack")}
            className="-mt-1 -ml-1 flex size-7 shrink-0 items-center justify-center rounded-full text-sand-500 hover:bg-clay-100 hover:text-clay-700"
          >
            <ArrowLeftIcon size={15} />
          </button>
        )}
        <p className="min-w-0 flex-1 text-[11px] font-bold tracking-[0.06em] text-sand-600 uppercase">
          {loop
            ? t("panes.graphLinksLoopTitle", { title: link.fromTitle })
            : t("panes.graphLinksPairTitle", { a: link.fromTitle, b: link.toTitle })}
        </p>
        <button
          onClick={onClose}
          data-track="graph-link-panel-close"
          aria-label={t("common.close")}
          data-tip={t("common.close")}
          className="-mt-1 -mr-1 flex size-7 shrink-0 items-center justify-center rounded-full text-sand-500 hover:bg-clay-100 hover:text-clay-700"
        >
          ✕
        </button>
      </div>
      {link.recommended && decided !== "accepted" && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="rounded-full border border-dashed border-clay-300 px-2 text-[10.5px] font-semibold text-clay-700">
            {t("panes.graphLinkRecommended")}
          </span>
          {canEdit && !link.crossAccount?.outside && (
            <span className="ml-auto flex items-center gap-1.5">
              <button
                onClick={() => void decide(true)}
                data-track="link-accept"
                disabled={busy}
                data-tip={t("panes.acceptLinkTitle")}
                className="rounded-full bg-sage-600 px-3 py-0.5 text-[11px] font-semibold text-sage-fg hover:bg-sage-700 disabled:opacity-40"
              >
                {t("panes.acceptLink")}
              </button>
              {linkRemovable(link.crossAccount) && (
                <button
                  onClick={() => void decide(false)}
                  data-track="link-dismiss"
                  disabled={busy}
                  data-tip={t("panes.dismissLinkTitle")}
                  className="rounded-full border border-line px-2.5 py-0.5 text-[11px] text-sand-700 hover:bg-clay-100 hover:text-clay-800 disabled:opacity-40"
                >
                  {t("panes.dismissLink")}
                </button>
              )}
            </span>
          )}
        </div>
      )}
      {error && <p className="text-[12px] text-red-600">{error}</p>}
      <LinkDetail
        link={link}
        onOpen={(documentId) => {
          router.push(`/n/${notebookId}?doc=${documentId}&link=${link.id}`);
          onOpenDocument();
        }}
      />
      <LinkReplies link={link} />
      <LinkNotes link={link} />
      <LinkNoteComposer linkId={link.id} />
    </aside>
  );
}
