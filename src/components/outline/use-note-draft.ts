"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { ACCOUNT_HEADER } from "@/lib/constants";
import { tabAccount } from "@/lib/tab-account";

// Auto-save for an open note editor (SPEC.md §6): while the editor is open,
// every edit saves on its own — a debounced PATCH after the last keystroke,
// and a keepalive flush when the window closes or the editor closes — so
// nothing typed is lost. Cancel restores the content from before this edit:
// the flush sees the reverted draft and writes it back over the auto-saved
// state. The tray card and the floating card share this hook; the draft
// moves between them as `initial`.
export function useNoteDraft({
  noteId,
  original,
  initial,
  active,
  canEdit,
}: {
  noteId: string;
  /** The content before this edit — what Cancel restores. Read when the editor opens. */
  original: string;
  /** The draft the editor opens with. */
  initial: string;
  /** True while the editor is open. */
  active: boolean;
  canEdit: boolean;
}) {
  const [draft, setDraft] = useState(initial);
  const draftRef = useRef(draft);
  const lastSavedRef = useRef(original);
  // Kept from the moment the editor opens: a sync refresh mid-edit replaces
  // the note's content with the auto-saved draft, and Cancel must still
  // restore what was there before.
  const originalRef = useRef(original);

  useEffect(() => {
    if (!active) return;
    lastSavedRef.current = original;
    originalRef.current = original;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  useEffect(() => {
    draftRef.current = draft;
    if (!active || !canEdit) return;
    const trimmed = draft.trim();
    if (!trimmed || trimmed === lastSavedRef.current) return;
    const timer = setTimeout(() => {
      const before = lastSavedRef.current;
      lastSavedRef.current = trimmed;
      void api(`/api/notes/${noteId}`, "PATCH", { content: trimmed }).catch(() => {
        // Failed quiet save: the next keystroke or the flush retries.
        if (lastSavedRef.current === trimmed) lastSavedRef.current = before;
      });
    }, 900);
    return () => clearTimeout(timer);
  }, [draft, active, canEdit, noteId]);

  useEffect(() => {
    if (!active || !canEdit) return;
    const flush = () => {
      const trimmed = draftRef.current.trim();
      if (!trimmed || trimmed === lastSavedRef.current) return;
      lastSavedRef.current = trimmed;
      const account = tabAccount();
      void fetch(`/api/notes/${noteId}`, {
        method: "PATCH",
        keepalive: true,
        headers: {
          "Content-Type": "application/json",
          ...(account ? { [ACCOUNT_HEADER]: account } : {}),
        },
        body: JSON.stringify({ content: trimmed }),
      }).catch(() => {});
    };
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("beforeunload", flush);
      flush();
    };
  }, [active, canEdit, noteId]);

  /** Cancel: the draft goes back to the original; the flush writes it back. */
  function cancel() {
    draftRef.current = originalRef.current;
    setDraft(originalRef.current);
  }

  /** Save: the caller writes `content` itself, so the flush must not write the draft again. */
  function markSaved(content: string) {
    draftRef.current = draft;
    lastSavedRef.current = content;
  }

  return { draft, setDraft, cancel, markSaved, getOriginal: () => originalRef.current };
}
