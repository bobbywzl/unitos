"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { ACCOUNT_HEADER } from "@/lib/constants";
import { clearNoteDraft, confirmNoteDraft, writeNoteDraft } from "@/lib/note-drafts";
import { tabAccount } from "@/lib/tab-account";
import type { SaveState } from "@/components/outline/save-state";

// Auto-save for an open note editor (SPEC.md §6): while the editor is open,
// every edit saves on its own — a debounced PATCH after the last keystroke,
// and a keepalive flush when the window closes or the editor closes — so
// nothing typed is lost. The draft is also written to localStorage with the
// keystroke (lib/note-drafts.ts): the PATCH and the flush are network calls,
// and the local draft is what survives a crash, a power loss, or a lost
// connection between them. It is cleared when the server confirms the same
// content, and replayed on the next load when it is not (use-outline.ts).
// Cancel restores the content from before this edit: the flush sees the
// reverted draft and writes it back over the auto-saved state. The tray card
// and the floating card share this hook; the draft moves between them as
// `initial`.
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
  // The content the server confirmed, and the content whose save failed: the
  // save state at the top of the card reads against the draft (save-state.tsx).
  const [confirmed, setConfirmed] = useState(original.trim());
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return;
    lastSavedRef.current = original;
    originalRef.current = original;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setConfirmed(original.trim());
    setFailed(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  useEffect(() => {
    draftRef.current = draft;
    if (!active || !canEdit) return;
    const trimmed = draft.trim();
    if (!trimmed || trimmed === lastSavedRef.current) return;
    // The local draft first: synchronous, so it is there whatever happens next.
    writeNoteDraft(noteId, draft);
    const timer = setTimeout(() => {
      const before = lastSavedRef.current;
      lastSavedRef.current = trimmed;
      void api(`/api/notes/${noteId}`, "PATCH", { content: trimmed })
        .then(() => {
          confirmNoteDraft(noteId, trimmed);
          setConfirmed(trimmed);
        })
        .catch(() => {
          // Failed quiet save: the next keystroke or the flush retries, and
          // the local draft replays on the next load.
          if (lastSavedRef.current === trimmed) lastSavedRef.current = before;
          setFailed(trimmed);
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
      // The local draft stays: a keepalive request cannot report back, so the
      // next load checks the server and clears or replays it.
      void fetch(`/api/notes/${noteId}`, {
        method: "PATCH",
        keepalive: true,
        headers: {
          "Content-Type": "application/json",
          ...(account ? { [ACCOUNT_HEADER]: account } : {}),
        },
        body: JSON.stringify({ content: trimmed }),
      })
        .then((res) => {
          if (res.ok) confirmNoteDraft(noteId, trimmed);
        })
        .catch(() => {});
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
    // The user gave the edit up: the local draft must not replay it.
    clearNoteDraft(noteId);
    // The server may still hold the auto-saved edit until the flush lands;
    // until then the local draft holds the original, so a lost flush replays it.
    if (lastSavedRef.current !== originalRef.current.trim()) writeNoteDraft(noteId, originalRef.current);
  }

  /** Save: the caller writes `content` itself, so the flush must not write the draft again. */
  function markSaved(content: string) {
    draftRef.current = draft;
    lastSavedRef.current = content;
  }

  /** The caller's own save landed: the local draft holding `content` is done. */
  function confirmSaved(content: string) {
    confirmNoteDraft(noteId, content);
    setConfirmed(content.trim());
  }

  const trimmed = draft.trim();
  const saveState: SaveState =
    !trimmed || trimmed === confirmed ? "saved" : trimmed === failed ? "failed" : "saving";

  return { draft, setDraft, cancel, markSaved, confirmSaved, saveState, getOriginal: () => originalRef.current };
}
