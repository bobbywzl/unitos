"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/components/lang-provider";
import type { OutlineActions } from "@/components/outline/use-outline";

/** The bottom pills (this one and the selection bar) are drawn on the body:
    inside the tray's scroll box a transformed ancestor would carry them off
    screen with the scroll, and the tray's width would squeeze them. Over
    a section's board (z-50), under a note opened on it (z-60). */
export function onBody(node: React.ReactNode): React.ReactNode {
  return typeof document === "undefined" ? null : createPortal(node, document.body);
}

export const BOTTOM_PILL =
  "fixed bottom-[calc(66px+env(safe-area-inset-bottom))] left-1/2 z-[55] flex max-w-[calc(100vw-32px)] -translate-x-1/2 items-center gap-3 rounded-full bg-card px-5 py-2.5 whitespace-nowrap shadow-float md:bottom-6";

// The pill after a merge, a delete, or a reject (SPEC.md §6): what
// happened, and Undo, which puts the notes back as they were. It stays for a
// while after each change, and the newest change takes it. A change that
// did not reach the server says so here. Rendered by the workspace (the
// tray open or folded), the notes full page, and a section's board.
// rejected: the pending note the reader rejected last, and its Undo; only
// the workspace passes it.
export function MergeUndoBar({
  actions,
  rejected = null,
  onUndoReject,
}: {
  actions: OutlineActions;
  rejected?: string | null;
  onUndoReject?: () => void;
}) {
  const t = useT();
  const [error, setError] = useState<string | null>(null);
  const notice = error ?? actions.notice;
  // The newest change wins the pill: each one is newest from the moment it
  // shows until another one shows.
  const [seen, setSeen] = useState<{ merge: unknown; removed: unknown; rejected: unknown; newest: "merge" | "delete" | "reject" | null }>(
    { merge: null, removed: null, rejected: null, newest: null },
  );
  if (seen.merge !== actions.lastMerge || seen.removed !== actions.lastDelete || seen.rejected !== rejected) {
    const newest =
      rejected !== null && rejected !== seen.rejected
        ? "reject"
        : actions.lastDelete !== null && actions.lastDelete !== seen.removed
          ? "delete"
          : actions.lastMerge !== null && actions.lastMerge !== seen.merge
            ? "merge"
            : seen.newest;
    setSeen({ merge: actions.lastMerge, removed: actions.lastDelete, rejected, newest });
  }
  const order = [seen.newest, "reject", "delete", "merge"] as const;
  const shown = order.find(
    (kind) =>
      (kind === "reject" && rejected !== null) ||
      (kind === "delete" && actions.lastDelete !== null) ||
      (kind === "merge" && actions.lastMerge !== null),
  );
  const merge = shown === "merge" ? actions.lastMerge : null;
  const removed = shown === "delete" ? actions.lastDelete : null;
  const reject = shown === "reject" ? rejected : null;

  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(null), 5000);
    return () => clearTimeout(timer);
  }, [error]);

  if (!merge && !removed && !reject && !notice) return null;
  return onBody(
    <div role="status" data-undo-pill="" className={BOTTOM_PILL}>
      {reject ? (
        <>
          <span className="text-[13px] text-sand-600">{t("panes.noteRejected")}</span>
          <button
            onClick={() => onUndoReject?.()}
            data-track="undo-reject"
            data-tip={t("outline.undoRejectTitle")}
            className="rounded-full bg-clay px-3.5 py-1 text-xs font-semibold text-clay-fg hover:bg-clay-600"
          >
            {t("outline.undo")}
          </button>
        </>
      ) : removed ? (
        <>
          <span className="text-[13px] text-sand-600">
            {removed.ids.length === 1 ? t("outline.noteDeleted") : t("outline.notesDeleted", { n: removed.ids.length })}
          </span>
          <button
            onClick={() => actions.undoDelete()}
            data-track="undo-delete"
            data-tip={t("outline.undoDeleteTitle")}
            className="rounded-full bg-clay px-3.5 py-1 text-xs font-semibold text-clay-fg hover:bg-clay-600"
          >
            {t("outline.undo")}
          </button>
          <button
            onClick={() => actions.dismissMerge()}
            data-track="dismiss-delete"
            aria-label={t("common.close")}
            data-tip={t("common.close")}
            className="text-sand-500 hover:text-clay-700"
          >
            ✕
          </button>
        </>
      ) : merge ? (
        <>
          <span className="text-[13px] text-sand-600">{t("outline.mergedNotes", { n: merge.count })}</span>
          {/* Edited since: the undo would refuse, so it is not offered. */}
          {!actions.mergeUndoable ? (
            <span className="text-[13px] text-sand-500">{t("outline.mergeEditedSince")}</span>
          ) : (
            <button
              onClick={() => {
                void actions.undoMerge().then((reason) => {
                  if (reason) setError(reason);
                });
              }}
              data-track="undo-merge"
              data-tip={t("outline.undoMergeTitle")}
              className="rounded-full bg-clay px-3.5 py-1 text-xs font-semibold text-clay-fg hover:bg-clay-600"
            >
              {t("outline.undo")}
            </button>
          )}
          <button
            onClick={() => actions.dismissMerge()}
            data-track="dismiss-merge"
            aria-label={t("common.close")}
            data-tip={t("common.close")}
            className="text-sand-500 hover:text-clay-700"
          >
            ✕
          </button>
        </>
      ) : (
        <>
          <span className="text-[13px] whitespace-normal text-red-500">{notice}</span>
          <button
            onClick={() => {
              setError(null);
              actions.dismissNotice();
            }}
            data-track="dismiss-notice"
            aria-label={t("common.close")}
            data-tip={t("common.close")}
            className="text-sand-500 hover:text-clay-700"
          >
            ✕
          </button>
        </>
      )}
    </div>,
  );
}
