"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { clearDirty, markDirty } from "@/lib/save-state";
import { ACCOUNT_HEADER } from "@/lib/constants";
import { clearNoteDraft, confirmNoteDraft, noteDraftBase, readNoteDraft, writeNoteDraft } from "@/lib/note-drafts";
import { reconcileNoteText } from "@/lib/notes/conflict";
import { conflictLabels, saveNoteText, type SavedText } from "@/lib/notes/save-text";
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
//
// Every save names the text it was made from (lib/notes/save-text.ts): the
// note's text when the editor opened, then the text each save left. The
// same note saved meanwhile from another tab or by a collaborator is put
// together with the reader's text, never saved over; the editor then shows
// the text as it was saved, and the save state says both versions were
// kept when some lines are kept twice. One save at a time per editor, so
// each save is made from the text the one before it left.
//
// A merge reads the notes as they are stored, and an open editor may hold
// words the auto-save has not sent yet. So every open editor registers
// itself here, and the merge (use-outline.ts) flushes the drafts of the
// notes it joins before it runs, then puts the merged text into the target's
// editor, saved and ready to keep editing (SPEC.md §6).
type DraftHandle = {
  /** Save the draft now, when it differs from what was saved last. */
  flush: () => Promise<void>;
  /** Put `content` into the editor as its saved draft. */
  replace: (content: string) => void;
  /** Save `content` now, made from the text the editor's last save left. */
  save: (content: string) => Promise<SavedText>;
};
const openDrafts = new Map<string, DraftHandle>();

// Notes whose words went to a new note (lib/notes/gone.ts). The note's card
// keeps its key (use-outline.ts noteKey), so its open editor goes on as the
// new note's editor. Where a new editor opens in its place instead, the keys
// typed in between — after the server answered, before the new editor
// opened — are in the old editor alone: as it closes, it puts its text into
// the new note's local draft, which the new editor opens on, and clears its
// own. Either way nothing goes to the gone note, and no key typed is lost.
const handedOff = new Map<string, string>();
// The old editor's text exactly as it stood, by the new note: the local
// draft keeps words, and this keeps the space typed last too, which a draft
// equal to the note's text but for spaces would not bring back.
const handedText = new Map<string, string>();

/** The editor of `from` gives way to the editor of `to` (use-outline.ts). */
export function handOffNoteDraft(from: string, to: string) {
  if (openDrafts.has(from)) handedOff.set(from, to);
}

/** Save the open drafts of these notes, so a merge reads what is on screen. */
export async function flushNoteDrafts(noteIds: string[]): Promise<void> {
  await Promise.all(noteIds.map((id) => openDrafts.get(id)?.flush()));
}

/** Put `content` into the note's open editor, as saved: the merged text takes
    the draft's place. Nothing happens when the note has no open editor. */
export function replaceNoteDraft(noteId: string, content: string) {
  openDrafts.get(noteId)?.replace(content);
}

/** The save of the note's open editor, made from the text it opened on;
    null when the note has no open editor. */
export function openDraftSave(noteId: string): ((content: string) => Promise<SavedText>) | null {
  return openDrafts.get(noteId)?.save ?? null;
}

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
  // The saved text that kept two versions of some lines: the save state says
  // so until the reader's next save.
  const [both, setBoth] = useState<string | null>(null);
  // The text the next save is made from: the note's text when the editor
  // opened, then the text each save left (lib/notes/save-text.ts).
  const baseRef = useRef(original.trim());
  // The note's text as the server had it when the editor opened: the
  // sources of the quotes the sitting removed go when it closes, read
  // against this text (SPEC.md §6). Until then every save keeps them, so a
  // quote deleted and brought back (Ctrl+Z, Cancel) keeps its source.
  const openedRef = useRef(original.trim());
  // The text of the save on its way, if any: the closing flush is made from it.
  const sendingRef = useRef<string | null>(null);
  // The saves of this editor, one after another.
  const chainRef = useRef<Promise<unknown>>(Promise.resolve());
  // The text of the last save that waits in the offline queue: the save
  // state reads Waiting to sync, not Saved, until the queue syncs.
  const [queued, setQueued] = useState<string | null>(null);
  // Words a local draft kept that the server never confirmed, put into the
  // editor as it opens: until the editor shows them, no keystroke writes
  // the local draft, so the kept words are never written over.
  const adoptingRef = useRef<string | null>(null);

  useEffect(() => {
    if (!active) return;
    lastSavedRef.current = original;
    originalRef.current = original;
    baseRef.current = original.trim();
    openedRef.current = original.trim();
    adoptingRef.current = null;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setConfirmed(original.trim());
    setFailed(null);
    setBoth(null);
    setQueued(null);
    // The editor of a gone note gave way to this one (handOffNoteDraft): the
    // same text, spaces and all, when it holds no word the note lacks.
    const handed = handedText.get(noteId);
    handedText.delete(noteId);
    if (canEdit && handed !== undefined && handed.trim() === original.trim()) {
      draftRef.current = handed;
      setDraft(handed);
      return;
    }
    // A local draft that holds words the server never confirmed (a save that
    // failed, then a reload): the editor opens on those words, marked Not
    // saved, and saves them made from the text they were made from — never
    // the note's old text with the words gone (SPEC.md §6). The notes show
    // the same words on the card (use-outline.ts).
    const kept = readNoteDraft(noteId);
    if (canEdit && kept && kept.base !== undefined && kept.content.trim() && kept.content.trim() !== kept.base.trim()) {
      // The note's text as the server has it: the card shows the kept words
      // in its place, so the draft's base stands for it then.
      const stored = original.trim() === kept.content.trim() ? kept.base : original;
      const base = (noteDraftBase(kept, stored) ?? stored).trim();
      lastSavedRef.current = base;
      baseRef.current = base;
      openedRef.current = base;
      originalRef.current = kept.content;
      setConfirmed(base);
      setFailed(kept.content.trim());
      adoptingRef.current = kept.content;
      draftRef.current = kept.content;
      setDraft(kept.content);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  /** Save `trimmed` after the saves before it; the editor takes the saved text. */
  const save = useCallback(
    (trimmed: string): Promise<SavedText> => {
      const run = chainRef.current.then(async () => {
        sendingRef.current = trimmed;
        try {
          const saved = await saveNoteText(noteId, trimmed, baseRef.current, { keepSources: true });
          baseRef.current = saved.content;
          setQueued(saved.queued ? saved.content : null);
          confirmNoteDraft(noteId, trimmed);
          confirmNoteDraft(noteId, saved.content);
          // Words typed since stay in the local draft, made from this save now.
          const local = readNoteDraft(noteId);
          if (local) writeNoteDraft(noteId, local.content, saved.content);
          if (saved.changed) {
            // The note changed elsewhere: the editor shows the text as saved,
            // with what the reader typed since put on top of it.
            const typed = draftRef.current;
            const next =
              typed.trim() === trimmed ? saved.content : reconcileNoteText(trimmed, saved.content, typed.trim(), conflictLabels()).text;
            if (lastSavedRef.current === trimmed) lastSavedRef.current = saved.content;
            draftRef.current = next;
            setDraft(next);
          }
          setConfirmed(saved.content);
          setBoth(saved.conflict ? saved.content : null);
          return saved;
        } finally {
          sendingRef.current = null;
        }
      });
      chainRef.current = run.catch(() => {});
      return run;
    },
    [noteId],
  );

  useEffect(() => {
    draftRef.current = draft;
    if (!active || !canEdit) return;
    if (adoptingRef.current !== null) {
      if (draft.trim() !== adoptingRef.current.trim()) return;
      adoptingRef.current = null;
    }
    const trimmed = draft.trim();
    if (!trimmed || trimmed === lastSavedRef.current) return;
    // The local draft first: synchronous, so it is there whatever happens next.
    writeNoteDraft(noteId, draft, baseRef.current, sendingRef.current);
    // The save indicator reads Saving… from the keystroke; the save itself
    // counts from the moment it starts.
    markDirty(noteId);
    const timer = setTimeout(() => {
      clearDirty(noteId);
      const before = lastSavedRef.current;
      lastSavedRef.current = trimmed;
      void save(trimmed).catch(() => {
          // Failed quiet save: the next keystroke or the flush retries, and
          // the local draft replays on the next load.
          if (lastSavedRef.current === trimmed) lastSavedRef.current = before;
          setFailed(trimmed);
        });
    }, 900);
    return () => {
      clearTimeout(timer);
      clearDirty(noteId);
    };
  }, [draft, active, canEdit, noteId, save]);

  useEffect(() => {
    if (!active || !canEdit) return;
    const handle: DraftHandle = {
      async flush() {
        const trimmed = draftRef.current.trim();
        if (!trimmed || trimmed === lastSavedRef.current) return;
        const before = lastSavedRef.current;
        lastSavedRef.current = trimmed;
        try {
          await save(trimmed);
        } catch (err) {
          if (lastSavedRef.current === trimmed) lastSavedRef.current = before;
          setFailed(trimmed);
          throw err;
        }
      },
      replace(content) {
        draftRef.current = content;
        lastSavedRef.current = content.trim();
        baseRef.current = content.trim();
        setDraft(content);
        confirmNoteDraft(noteId, content.trim());
        setConfirmed(content.trim());
        setFailed(null);
      },
      save,
    };
    openDrafts.set(noteId, handle);
    return () => {
      if (openDrafts.get(noteId) === handle) openDrafts.delete(noteId);
    };
  }, [active, canEdit, noteId, save]);

  useEffect(() => {
    if (!active || !canEdit) return;
    // The same editor goes on for the new note (its card kept its key): its
    // text is the one on screen, and nothing waits to be handed to it.
    handedText.delete(noteId);
    const send = (body: Record<string, unknown>, confirm: string | null) => {
      const account = tabAccount();
      // The local draft stays: a keepalive request cannot report back, so the
      // next load checks the server and clears or replays it.
      return fetch(`/api/notes/${noteId}`, {
        method: "PATCH",
        keepalive: true,
        headers: {
          "Content-Type": "application/json",
          ...(account ? { [ACCOUNT_HEADER]: account } : {}),
        },
        body: JSON.stringify(body),
      })
        .then((res) => {
          if (res.ok && confirm !== null) confirmNoteDraft(noteId, confirm);
        })
        .catch(() => {});
    };
    // The window closes: the words go now. With no save on its way, the
    // sources of the quotes the sitting removed go in the same write; with
    // one on its way they stay (a source kept is never a loss).
    const flush = () => {
      const trimmed = draftRef.current.trim();
      const idle = sendingRef.current === null;
      const prune = idle && lastSavedRef.current.trim() !== openedRef.current ? { pruneSourcesFrom: openedRef.current } : {};
      if (!trimmed || trimmed === lastSavedRef.current) {
        if ("pruneSourcesFrom" in prune) void send(prune, null);
        return;
      }
      lastSavedRef.current = trimmed;
      // Made from the save on its way, else the last one; the tab is going
      // away and cannot read a 409, so the route puts the texts together.
      void send(
        { content: trimmed, baseContent: sendingRef.current ?? baseRef.current, onConflict: "keep", keepSources: true, ...prune },
        trimmed,
      );
    };
    // The editor closes: the last words save after the saves before them,
    // and the sources of the quotes the sitting removed go with them.
    const close = () => {
      const trimmed = draftRef.current.trim();
      const typed = Boolean(trimmed) && trimmed !== lastSavedRef.current;
      if (typed) lastSavedRef.current = trimmed;
      else if (lastSavedRef.current.trim() === openedRef.current) return;
      const opened = openedRef.current;
      void chainRef.current.then(() =>
        send(
          typed
            ? { content: trimmed, baseContent: baseRef.current, onConflict: "keep", pruneSourcesFrom: opened }
            : { pruneSourcesFrom: opened },
          typed ? trimmed : null,
        ),
      );
    };
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("beforeunload", flush);
      const to = handedOff.get(noteId);
      if (to !== undefined) {
        handedOff.delete(noteId);
        const text = draftRef.current;
        const target = readNoteDraft(to);
        if (text.trim()) {
          writeNoteDraft(to, text, target?.base ?? lastSavedRef.current);
          handedText.set(to, text);
        }
        clearNoteDraft(noteId);
        return;
      }
      close();
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
    if (lastSavedRef.current !== originalRef.current.trim()) writeNoteDraft(noteId, originalRef.current, baseRef.current);
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
    !trimmed || trimmed === confirmed
      ? trimmed && trimmed === both
        ? "both"
        : trimmed && trimmed === queued
          ? "offline"
          : "saved"
      : trimmed === failed
        ? "failed"
        : "saving";

  return { draft, setDraft, cancel, markSaved, confirmSaved, saveState, getOriginal: () => originalRef.current };
}
