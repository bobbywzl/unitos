"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useT } from "@/components/lang-provider";
import { DuplicateDocumentError, duplicateOf, type DuplicateMatch } from "@/lib/documents/duplicate-answer";
import { isImeKey } from "@/lib/ime";

// The ask before a repeat add (SPEC.md §15): the account already has a
// document with this file or this source. Every add is its own document, so
// Add again makes a second one, parsed again; Open the one I have opens the
// first match; Cancel adds nothing. One ask for every add path: the upload
// box shows it in place of its progress, the document bar, the share page,
// and the offline queue (QueueSync) show it as a dialog.

export type DuplicateChoice = "again" | "open" | "cancel";

/** A 409 that names a repeat add: the documents it names; else null. The
    answer's body is read from a clone, so the caller can still read it. */
export async function readDuplicate(res: Response): Promise<DuplicateMatch[] | null> {
  if (res.status !== 409) return null;
  return duplicateOf(await res.clone().json().catch(() => null));
}

/** Throws the ask when an answer or a stream's last line names a repeat add. */
export function throwIfDuplicate(body: unknown, fallback: string): void {
  const documents = duplicateOf(body);
  if (documents) {
    const message = (body as { error?: unknown }).error;
    throw new DuplicateDocumentError(typeof message === "string" ? message : fallback, documents);
  }
}

/** The ask's words and buttons. In the upload box (`inBox`) the box's
    heading says the ask's title and its ✕ is Cancel, so neither repeats. */
export function DuplicateAsk({
  documents,
  onChoose,
  inBox = false,
}: {
  documents: DuplicateMatch[];
  onChoose: (choice: DuplicateChoice) => void;
  inBox?: boolean;
}) {
  const t = useT();
  const first = documents[0];
  const project = first.notebookTitle !== null ? `“${first.notebookTitle}”` : t("panes.duplicateInLibrary");
  const where =
    documents.length > 1
      ? t("panes.duplicateWhereMore", { title: first.title, project, n: documents.length - 1 })
      : t("panes.duplicateWhere", { title: first.title, project });
  return (
    <div className="flex flex-col gap-3" data-duplicate-ask>
      {!inBox && (
        <h2 id="duplicate-ask-title" className="font-display text-[17px] text-sand-900">
          {t("panes.duplicateTitle")}
        </h2>
      )}
      <p className="text-[13px] leading-relaxed text-sand-700">
        {where} {t("panes.duplicateAsk")}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => onChoose("again")}
          data-track="duplicate-add-again"
          className="rounded-full bg-clay px-5 py-2 text-xs font-semibold text-clay-fg hover:bg-clay-600"
        >
          {t("panes.duplicateAddAgain")}
        </button>
        <button
          onClick={() => onChoose("open")}
          data-track="duplicate-open"
          className="rounded-full bg-sand-100 px-4 py-2 text-xs font-semibold text-sand-800 hover:bg-clay-100 hover:text-clay-800"
        >
          {t("panes.duplicateOpen")}
        </button>
        {!inBox && (
          <button
            onClick={() => onChoose("cancel")}
            data-track="duplicate-cancel"
            className="ml-auto rounded-full px-3.5 py-1.5 text-xs text-sand-600 hover:bg-clay-100 hover:text-clay-800"
          >
            {t("common.cancel")}
          </button>
        )}
      </div>
    </div>
  );
}

/** The ask as a dialog over the page. Escape and a click outside are Cancel. */
export function DuplicateAskDialog({
  documents,
  onChoose,
}: {
  documents: DuplicateMatch[];
  onChoose: (choice: DuplicateChoice) => void;
}) {
  const choose = useRef(onChoose);
  useEffect(() => {
    choose.current = onChoose;
  }, [onChoose]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || isImeKey(e)) return;
      e.stopPropagation();
      choose.current("cancel");
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
  return (
    <div
      className="dialog-in fixed inset-0 z-[60] flex items-center justify-center bg-ink/30 p-4"
      onClick={() => onChoose("cancel")}
      role="dialog"
      aria-modal
      aria-labelledby="duplicate-ask-title"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[440px] max-w-full rounded-[24px] bg-card p-5 shadow-float"
      >
        <DuplicateAsk documents={documents} onChoose={onChoose} />
      </div>
    </div>
  );
}

/** The ask as a promise: `ask(documents)` shows the dialog and resolves
    with the reader's choice; `dialog` goes in the caller's tree. */
export function useDuplicateAsk(): { ask: (documents: DuplicateMatch[]) => Promise<DuplicateChoice>; dialog: ReactNode } {
  const [open, setOpen] = useState<{ documents: DuplicateMatch[]; resolve: (choice: DuplicateChoice) => void } | null>(
    null,
  );
  const ask = useCallback(
    (documents: DuplicateMatch[]) =>
      new Promise<DuplicateChoice>((resolve) => {
        setOpen({
          documents,
          resolve: (choice) => {
            setOpen(null);
            resolve(choice);
          },
        });
      }),
    [],
  );
  const dialog = open ? <DuplicateAskDialog documents={open.documents} onChoose={open.resolve} /> : null;
  return { ask, dialog };
}
