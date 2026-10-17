"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/components/lang-provider";
import { useModKey } from "@/components/outline/note-editor";
import type { OutlineActions } from "@/components/outline/use-outline";
import { usePostedUndo } from "@/lib/notes/undo-pill";

/** The bottom pills (this one and the selection bar) are drawn on the body:
    inside the tray's scroll box a transformed ancestor would carry them off
    screen with the scroll, and the tray's width would squeeze them. Over
    a section's board (z-50), under a note opened on it (z-60). */
export function onBody(node: React.ReactNode): React.ReactNode {
  return typeof document === "undefined" ? null : createPortal(node, document.body);
}

export const BOTTOM_PILL =
  "fixed bottom-[calc(66px+env(safe-area-inset-bottom))] left-1/2 z-[55] flex max-w-[calc(100vw-32px)] -translate-x-1/2 items-center gap-3 rounded-full bg-card px-5 py-2.5 whitespace-nowrap shadow-float md:bottom-6";

// The pill's Undo and ✕: a finger gets 36px for each (SPEC.md §6).
const UNDO_BUTTON =
  "shrink-0 rounded-full bg-clay px-3.5 py-1 text-xs font-semibold text-clay-fg hover:bg-clay-600 pointer-coarse:py-2.5";
const CLOSE_BUTTON =
  "shrink-0 text-sand-500 hover:text-clay-700 pointer-coarse:flex pointer-coarse:size-9 pointer-coarse:items-center pointer-coarse:justify-center";

// The pill after a merge, a delete (of notes or a section), a reject, or an editor's Cancel (SPEC.md §6): what
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
  const [seen, setSeen] = useState<{
    merge: unknown;
    removed: unknown;
    rejected: unknown;
    canceled: unknown;
    section: unknown;
    posted: unknown;
    newest: "merge" | "delete" | "reject" | "cancel" | "section" | "posted" | null;
  }>({ merge: null, removed: null, rejected: null, canceled: null, section: null, posted: null, newest: null });
  if (
    seen.merge !== actions.lastMerge ||
    seen.removed !== actions.lastDelete ||
    seen.rejected !== rejected ||
    seen.canceled !== actions.lastCancel ||
    seen.section !== actions.lastSectionDelete ||
    seen.posted !== actions.posted
  ) {
    const newest =
      rejected !== null && rejected !== seen.rejected
        ? "reject"
        : actions.posted !== null && actions.posted !== seen.posted
          ? "posted"
        : actions.lastCancel !== null && actions.lastCancel !== seen.canceled
          ? "cancel"
          : actions.lastSectionDelete !== null && actions.lastSectionDelete !== seen.section
            ? "section"
            : actions.lastDelete !== null && actions.lastDelete !== seen.removed
              ? "delete"
              : actions.lastMerge !== null && actions.lastMerge !== seen.merge
                ? "merge"
                : seen.newest;
    setSeen({
      merge: actions.lastMerge,
      removed: actions.lastDelete,
      rejected,
      canceled: actions.lastCancel,
      section: actions.lastSectionDelete,
      posted: actions.posted,
      newest,
    });
  }
  const order = [seen.newest, "reject", "posted", "cancel", "section", "delete", "merge"] as const;
  const shown = order.find(
    (kind) =>
      (kind === "reject" && rejected !== null) ||
      (kind === "posted" && actions.posted !== null) ||
      (kind === "cancel" && actions.lastCancel !== null) ||
      (kind === "section" && actions.lastSectionDelete !== null) ||
      (kind === "delete" && actions.lastDelete !== null) ||
      (kind === "merge" && actions.lastMerge !== null),
  );
  const merge = shown === "merge" ? actions.lastMerge : null;
  const removed = shown === "delete" ? actions.lastDelete : null;
  const reject = shown === "reject" ? rejected : null;
  const canceled = shown === "cancel" ? actions.lastCancel : null;
  const section = shown === "section" ? actions.lastSectionDelete : null;
  const posted = shown === "posted" ? actions.posted : null;

  // Ctrl+Z (⌘Z on a Mac) outside a text box presses the pill's Undo, so a
  // keyboard reader reaches it without walking to it. The article's own
  // history answers first when it has a step (reader-interactions.tsx).
  const mod = useModKey();
  const undo: (() => void) | null = reject
    ? () => onUndoReject?.()
    : posted
      ? () => actions.undoPosted()
      : canceled
      ? () => actions.undoCancel()
      : section
        ? () => void actions.undoSectionDelete()
        : removed
          ? () => actions.undoDelete()
          : merge && actions.mergeUndoable
            ? () => {
                void actions.undoMerge().then((reason) => {
                  if (reason) setError(reason);
                });
              }
            : null;
  useUndoKey(undo);
  const keyTip = (title: string) => `${title}\n${mod}+Z`;

  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(null), 5000);
    return () => clearTimeout(timer);
  }, [error]);

  if (!merge && !removed && !reject && !canceled && !section && !posted && !notice) return null;
  return onBody(
    <div role="status" data-undo-pill="" className={BOTTOM_PILL}>
      {reject ? (
        <>
          <span className="text-[13px] text-sand-600">{t("panes.noteRejected")}</span>
          <button
            onClick={() => onUndoReject?.()}
            data-track="undo-reject"
            data-tip={keyTip(t("outline.undoRejectTitle"))}
            className={UNDO_BUTTON}
          >
            {t("outline.undo")}
          </button>
          <button
            onClick={() => actions.dismissMerge()}
            data-track="dismiss-reject"
            aria-label={t("common.close")}
            data-tip={t("common.close")}
            className={CLOSE_BUTTON}
          >
            ✕
          </button>
        </>
      ) : posted ? (
        <UndoRow
          message={posted.message}
          onUndo={() => actions.undoPosted()}
          onDismiss={() => actions.dismissMerge()}
          undoTip={keyTip(t("outline.undoPostedTitle"))}
        />
      ) : canceled ? (
        <>
          {/* Cancel put the note back; Undo gives the typed words back. */}
          <span className="text-[13px] text-sand-600">{t("outline.editCanceled")}</span>
          <button
            onClick={() => actions.undoCancel()}
            data-track="undo-cancel"
            data-tip={keyTip(t("outline.undoCancelTitle"))}
            className={UNDO_BUTTON}
          >
            {t("outline.undo")}
          </button>
          <button
            onClick={() => actions.dismissMerge()}
            data-track="dismiss-cancel"
            aria-label={t("common.close")}
            data-tip={t("common.close")}
            className={CLOSE_BUTTON}
          >
            ✕
          </button>
        </>
      ) : section ? (
        <>
          {/* The section left with its notes; History keeps it whole, and
              Undo is History's Restore. */}
          {/* What went: the section by its title, cut short so the count
              of its notes always shows. */}
          <span className="max-w-[60vw] truncate text-[13px] text-sand-600">
            {section.count === 0
              ? t("outline.sectionDeleted", { title: clip(section.title) })
              : section.count === 1
                ? t("outline.sectionDeletedOneNote", { title: clip(section.title) })
                : t("outline.sectionDeletedNotes", { title: clip(section.title), n: section.count })}
          </span>
          <button
            onClick={() => void actions.undoSectionDelete()}
            data-track="undo-section-delete"
            data-tip={keyTip(t("outline.undoSectionDeleteTitle"))}
            className={UNDO_BUTTON}
          >
            {t("outline.undo")}
          </button>
          <button
            onClick={() => actions.dismissMerge()}
            data-track="dismiss-section-delete"
            aria-label={t("common.close")}
            data-tip={t("common.close")}
            className={CLOSE_BUTTON}
          >
            ✕
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
            data-tip={keyTip(t("outline.undoDeleteTitle"))}
            className={UNDO_BUTTON}
          >
            {t("outline.undo")}
          </button>
          <button
            onClick={() => actions.dismissMerge()}
            data-track="dismiss-delete"
            aria-label={t("common.close")}
            data-tip={t("common.close")}
            className={CLOSE_BUTTON}
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
              data-tip={keyTip(t("outline.undoMergeTitle"))}
              className={UNDO_BUTTON}
            >
              {t("outline.undo")}
            </button>
          )}
          <button
            onClick={() => actions.dismissMerge()}
            data-track="dismiss-merge"
            aria-label={t("common.close")}
            data-tip={t("common.close")}
            className={CLOSE_BUTTON}
          >
            ✕
          </button>
        </>
      ) : (
        <>
          {/* A failure in red; news (words kept as a new note, a quote
              without its source) in the pill's own color. */}
          <span
            className={`text-[13px] whitespace-normal ${error !== null || actions.noticeFailed ? "text-red-500" : "text-sand-700"}`}
          >
            {notice}
          </span>
          <button
            onClick={() => {
              setError(null);
              actions.dismissNotice();
            }}
            data-track="dismiss-notice"
            aria-label={t("common.close")}
            data-tip={t("common.close")}
            className={CLOSE_BUTTON}
          >
            ✕
          </button>
        </>
      )}
    </div>,
  );
}

/** What went, Undo, and ✕: the row of a posted delete. */
function UndoRow({
  message,
  onUndo,
  onDismiss,
  undoTip,
}: {
  message: string;
  onUndo: () => void;
  onDismiss: () => void;
  undoTip: string;
}) {
  const t = useT();
  return (
    <>
      <span className="text-[13px] text-sand-600">{message}</span>
      <button
        onClick={onUndo}
        data-track="undo-posted"
        data-tip={undoTip}
        className={UNDO_BUTTON}
      >
        {t("outline.undo")}
      </button>
      <button
        onClick={onDismiss}
        data-track="dismiss-posted"
        aria-label={t("common.close")}
        data-tip={t("common.close")}
        className={CLOSE_BUTTON}
      >
        ✕
      </button>
    </>
  );
}

/** Ctrl+Z (⌘Z on a Mac) outside a text box presses Undo while `undo` is set. */
function useUndoKey(undo: (() => void) | null) {
  const undoRef = useRef(undo);
  useEffect(() => {
    undoRef.current = undo;
  });
  const offered = undo !== null;
  useEffect(() => {
    if (!offered) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || !(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== "z") return;
      const active = document.activeElement as HTMLElement | null;
      if (active && (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement || active.isContentEditable)) return;
      e.preventDefault();
      undoRef.current?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [offered]);
}

/** The pill on a page without the notes (the annotations full page): a
    delete posted to it (lib/notes/undo-pill.ts) shows here, with Undo, ✕,
    and Ctrl+Z, as it does under the notes. */
export function PostedUndoPill() {
  const t = useT();
  const mod = useModKey();
  const { posted, undoPosted, settlePosted } = usePostedUndo();
  useUndoKey(posted ? undoPosted : null);
  if (!posted) return null;
  return onBody(
    <div role="status" data-undo-pill="" className={BOTTOM_PILL}>
      <UndoRow
        message={posted.message}
        onUndo={undoPosted}
        onDismiss={settlePosted}
        undoTip={`${t("outline.undoPostedTitle")}\n${mod}+Z`}
      />
    </div>,
  );
}

/** A title cut to the pill's room: 20 characters, then an ellipsis. */
function clip(title: string): string {
  const chars = [...title];
  return chars.length > 20 ? `${chars.slice(0, 19).join("").trimEnd()}…` : title;
}
