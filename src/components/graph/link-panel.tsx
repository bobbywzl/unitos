"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { GraphEdgeLink } from "@/lib/types";
import { api } from "@/lib/api";
import { markAccepted } from "@/components/graph/accepted-now";
import { linkPath } from "@/lib/link-scope";
import { useCollab } from "@/components/collab/collab-context";
import { confirmLinkRemoval, linkRemovable } from "@/components/collab/confirm-link-removal";
import { ArrowLeftIcon, CommentIcon, NotesIcon } from "@/components/icons";
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
//
// [panel6] What the reader writes comes first (WALK6-05): under Why this
// link, one row holds Reply, Note on this link and, for an accepted link,
// Remove (WALK6-03); each box opens under the row, then the replies and the
// notes, then the two passages, each folded to about four lines. Remove is
// the reader's Remove: the link is hidden in the project, the panel keeps a
// line "Link removed. History can restore it · Undo" for 10 seconds, and
// History's Restore brings it back later.

// The action row's buttons: 24 px tall under a mouse, 44 under a finger (WALK6-09).
const rowButton =
  "flex min-h-6 items-center gap-1.5 rounded-full border border-line px-2.5 text-[11px] font-semibold text-sand-700 hover:bg-clay-100 hover:text-clay-800 disabled:opacity-40 pointer-coarse:min-h-11 pointer-coarse:px-3.5";

export function LinkPanel({
  link,
  onBack,
  backLabel,
  onClose,
  onOpenDocument,
  onRemoved,
}: {
  link: GraphEdgeLink;
  /** Back to the list the link was opened from: Links, the Notes list, the node card, or Documents. */
  onBack?: () => void;
  /** The back arrow's label; default "Back to Links". */
  backLabel?: string;
  onClose: () => void;
  /** The reader opened a document from the panel (the URL already moved). */
  onOpenDocument: () => void;
  /** [panel6] Remove hid the link: the overlay keeps the panel up on this
      copy of it, for the Undo line. null: Undo brought it back. */
  onRemoved?: (link: GraphEdgeLink | null) => void;
}) {
  const t = useT();
  const router = useRouter();
  const { canEdit, authOn, myId, people } = useCollab();
  const { notebookId } = useParams<{ notebookId?: string }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [decided, setDecided] = useState<"accepted" | "dismissed" | null>(null);
  const loop = link.fromDocumentId === link.toDocumentId;
  // [panel6] The action row's Reply and Note on this link open their boxes.
  const [replyRequest, setReplyRequest] = useState(0);
  const [noteRequest, setNoteRequest] = useState(0);
  const noteOpener = useRef<HTMLButtonElement>(null);
  // As ReplyThread: with sign-in off, Reply shows only on a thread that has replies.
  const canReply = canEdit && !link.crossAccount?.outside && (authOn || (link.replies?.length ?? 0) > 0);
  const accepted = !link.recommended || decided === "accepted";
  const canRemove = canEdit && accepted && !link.provenance && linkRemovable(link.crossAccount);
  // Remove (WALK6-03): "removed" while Undo is offered, "gone" after.
  const [removed, setRemoved] = useState<"undo" | "gone" | null>(null);
  const removeEdit = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (removed !== "undo") return;
    const timer = setTimeout(() => setRemoved("gone"), 10_000);
    return () => clearTimeout(timer);
  }, [removed]);

  async function remove() {
    if (busy) return;
    const replies = link.replies ?? [];
    const madeBy = link.createdById && link.createdById !== myId ? people[link.createdById]?.name : undefined;
    // The reader's own link with only their own replies goes at once: Undo is there (WALK6-08).
    const othersReplied = replies.some((r) => r.userId !== myId);
    if (!confirmLinkRemoval(t, replies.length, "remove", madeBy, othersReplied)) return;
    setBusy(true);
    setError(null);
    try {
      // Offline the removal waits in the queue: Undo comes once the server has hidden the link.
      const result = await api<{ queued?: true; editId?: string }>(linkPath(link.id, notebookId), "DELETE");
      removeEdit.current = result.editId;
      setRemoved(result.queued ? "gone" : "undo");
      onRemoved?.(link);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.requestFailed"));
    } finally {
      setBusy(false);
    }
  }
  async function undoRemove() {
    if (busy || !notebookId) return;
    setBusy(true);
    setError(null);
    try {
      // Undo names its Remove: another editor's later removal stays (REV7-06).
      const edit = removeEdit.current ? `&edit=${encodeURIComponent(removeEdit.current)}` : "";
      await api(`/api/links/${encodeURIComponent(link.id)}/hidden?notebookId=${encodeURIComponent(notebookId)}${edit}`, "DELETE");
      setRemoved(null);
      onRemoved?.(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.requestFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function decide(accept: boolean) {
    if (busy) return;
    if (!accept && !confirmLinkRemoval(t, link.replies?.length ?? 0, "dismiss")) return;
    setBusy(true);
    setError(null);
    try {
      if (accept) {
        await api(linkPath(link.id, notebookId), "PATCH", { accept: true });
        markAccepted(link.id); // the header counts it at once (WALK4-15)
      } else await api(linkPath(link.id, notebookId), "DELETE");
      setDecided(accept ? "accepted" : "dismissed");
      router.refresh();
      if (!accept) onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.requestFailed"));
    } finally {
      setBusy(false);
    }
  }

  // [lists7] WALK7-03: as tall as what it holds, like the node card.
  return (
    <aside
      data-track-surface="graph-link-panel"
      data-graph-side-list="link"
      data-graph-link-panel={link.id}
      id="graph-list-link"
      tabIndex={-1}
      aria-label={t("panes.graphLinkPanel")}
      className="menu-in absolute top-3 right-3 z-10 flex max-h-[calc(100%-24px)] w-[400px] max-w-[calc(100vw-24px)] flex-col gap-2.5 overflow-y-auto rounded-[20px] border border-line bg-card/95 p-4 shadow-float outline-none backdrop-blur-md max-[999px]:max-h-[calc(100%-76px)]"
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
                className="min-h-6 rounded-full bg-sage-600 px-3 py-0.5 text-[11px] font-semibold text-sage-fg hover:bg-sage-700 disabled:opacity-40 pointer-coarse:min-h-11 pointer-coarse:px-4"
              >
                {t("panes.acceptLink")}
              </button>
              {linkRemovable(link.crossAccount) && (
                <button
                  onClick={() => void decide(false)}
                  data-track="link-dismiss"
                  disabled={busy}
                  data-tip={t("panes.dismissLinkTitle")}
                  className="min-h-6 rounded-full border border-line px-2.5 py-0.5 text-[11px] text-sand-700 hover:bg-clay-100 hover:text-clay-800 disabled:opacity-40 pointer-coarse:min-h-11 pointer-coarse:px-4"
                >
                  {t("panes.dismissLink")}
                </button>
              )}
            </span>
          )}
        </div>
      )}
      {error && <p className="text-[12px] text-red-600">{error}</p>}
      {removed ? (
        <p role="status" data-link-removed={link.id} className="text-[12.5px] text-sand-700">
          {t("panels.linkRemoved")}
          {removed === "undo" && (
            <>
              {" "}
              <button
                onClick={() => void undoRemove()}
                disabled={busy}
                data-track="graph-link-remove-undo"
                className="font-semibold text-clay-700 underline-offset-2 hover:underline disabled:opacity-50 pointer-coarse:min-h-11"
              >
                {t("panels.linkRemovedUndo")}
              </button>
            </>
          )}
        </p>
      ) : (
        <>
          <div>
            <p className="text-[10.5px] font-bold tracking-[0.06em] text-sand-500 uppercase">{t("panes.linkWhy")}</p>
            <p className="mt-0.5 text-[12.5px] leading-snug text-ink">{link.reason ?? t("panes.linkNoReason")}</p>
          </div>
          {(canReply || canEdit) && (
            <div data-graph-link-actions className="flex flex-wrap items-center gap-1.5">
              {canReply && (
                <button
                  onClick={() => setReplyRequest((n) => n + 1)}
                  data-track="reply"
                  data-tip={t("common.replyTitle")}
                  className={rowButton}
                >
                  <CommentIcon size={11} />
                  {t("common.reply")}
                </button>
              )}
              {canEdit && (
                <button
                  ref={noteOpener}
                  onClick={() => setNoteRequest((n) => n + 1)}
                  data-track="graph-link-note"
                  data-tip={t("graphNotes.noteOnLinkTitle")}
                  className={`${rowButton} hover:bg-sage-100 hover:text-sage-800`}
                >
                  <NotesIcon size={11} />
                  {t("graphNotes.noteOnLink")}
                </button>
              )}
              {canRemove && (
                <button
                  onClick={() => void remove()}
                  disabled={busy}
                  data-track="graph-link-remove"
                  data-tip={t("panels.removeLinkTitle")}
                  className={`${rowButton} ml-auto text-red-600 hover:bg-red-50 hover:text-red-700`}
                >
                  {t("common.remove")}
                </button>
              )}
            </div>
          )}
          <LinkNoteComposer linkId={link.id} openRequest={noteRequest} opener={noteOpener} />
          <LinkReplies link={link} openRequest={canReply ? replyRequest : undefined} />
          <LinkNotes link={link} />
          <LinkDetail
            link={link}
            showReason={false}
            onOpen={(documentId) => {
              router.push(`/n/${notebookId}?doc=${documentId}&link=${link.id}`);
              onOpenDocument();
            }}
          />
        </>
      )}
    </aside>
  );
}
