"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { ACCOUNT_HEADER } from "@/lib/constants";
import { isImeKey } from "@/lib/ime";
import { tabAccount } from "@/lib/tab-account";
import { useT } from "@/components/lang-provider";
import { NoteEditor } from "@/components/outline/note-editor";
import type { OutlineActions } from "@/components/outline/use-outline";

// The composer under a section's "+ note": a new note's editor. It auto-saves
// like an open note's editor (use-note-draft.ts, SPEC.md §6): the first
// typing creates the note, a debounced PATCH after the last keystroke keeps
// it current, and a keepalive flush when the window closes or the composer
// closes writes what is left — so nothing typed is lost. While the composer
// owns the note the section hides the note's card (onOwn), so the note shows
// once, in the composer. Save closes the composer and the card takes over;
// Cancel and Esc delete the note, as they undo an edit on an open note.
export function NoteComposer({
  sectionId,
  actions,
  onOwn,
  onClose,
  className,
}: {
  sectionId: string;
  actions: OutlineActions;
  /** The note the composer created and owns; null when it owns none. */
  onOwn: (noteId: string | null) => void;
  onClose: () => void;
  /** Classes on the editor card: the tray's and the notes full page's paddings differ. */
  className: string;
}) {
  const t = useT();
  const [draft, setDraft] = useState("");
  const draftRef = useRef("");
  const noteIdRef = useRef<string | null>(null);
  // The create in flight: a second save waits for it instead of creating twice.
  const creatingRef = useRef<Promise<string | null> | null>(null);
  const lastSavedRef = useRef("");
  const onOwnRef = useRef(onOwn);
  useEffect(() => {
    onOwnRef.current = onOwn;
  }, [onOwn]);

  /** Write the content: create the note on the first save, PATCH after. Resolves to the note id, null when the write failed. */
  function persist(content: string): Promise<string | null> {
    const before = lastSavedRef.current;
    lastSavedRef.current = content;
    const fail = () => {
      // Failed quiet save: the next keystroke or the flush retries.
      if (lastSavedRef.current === content) lastSavedRef.current = before;
      return null;
    };
    if (noteIdRef.current) {
      const id = noteIdRef.current;
      return api(`/api/notes/${id}`, "PATCH", { content })
        .then(() => id)
        .catch(fail);
    }
    if (creatingRef.current) {
      return creatingRef.current.then((id) =>
        id
          ? api(`/api/notes/${id}`, "PATCH", { content })
              .then(() => id)
              .catch(fail)
          : fail(),
      );
    }
    const create = api<{ id: string }>("/api/notes", "POST", { sectionId, content })
      .then((note) => {
        noteIdRef.current = note.id;
        onOwnRef.current(note.id);
        return note.id;
      })
      .catch(fail)
      .finally(() => {
        creatingRef.current = null;
      });
    creatingRef.current = create;
    return create;
  }

  // A debounced save after the last keystroke.
  useEffect(() => {
    draftRef.current = draft;
    const trimmed = draft.trim();
    if (!trimmed || trimmed === lastSavedRef.current) return;
    const timer = setTimeout(() => void persist(trimmed), 900);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  // The flush: what is typed and not yet saved goes out with a keepalive
  // request when the window closes or the composer unmounts.
  useEffect(() => {
    const flush = () => {
      const trimmed = draftRef.current.trim();
      if (!trimmed || trimmed === lastSavedRef.current || creatingRef.current) return;
      lastSavedRef.current = trimmed;
      const account = tabAccount();
      const id = noteIdRef.current;
      void fetch(id ? `/api/notes/${id}` : "/api/notes", {
        method: id ? "PATCH" : "POST",
        keepalive: true,
        headers: {
          "Content-Type": "application/json",
          ...(account ? { [ACCOUNT_HEADER]: account } : {}),
        },
        body: JSON.stringify(id ? { content: trimmed } : { sectionId, content: trimmed }),
      }).catch(() => {});
    };
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("beforeunload", flush);
      flush();
      // The composer is gone: the card shows the note from here.
      onOwnRef.current(null);
    };
  }, [sectionId]);

  /** Save: the final content is written, the composer closes, the card takes over. */
  async function save() {
    const trimmed = draft.trim();
    if (!trimmed) {
      await cancel();
      return;
    }
    if (creatingRef.current) await creatingRef.current;
    lastSavedRef.current = trimmed;
    const id = noteIdRef.current;
    onClose();
    if (id) await actions.saveNote(id, trimmed);
    else await actions.addNote(sectionId, trimmed);
  }

  /** Cancel: the note the composer created goes, with everything typed. */
  async function cancel() {
    if (creatingRef.current) await creatingRef.current;
    const id = noteIdRef.current;
    draftRef.current = "";
    lastSavedRef.current = "";
    noteIdRef.current = null;
    onClose();
    if (id) await actions.deleteNote(id);
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <NoteEditor
        className={className}
        value={draft}
        onChange={setDraft}
        onKeyDown={(e) => {
          if (isImeKey(e)) return;
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.currentTarget.closest("form")?.requestSubmit();
          if (e.key === "Escape") void cancel();
        }}
        placeholder={t("outline.writeNotePlaceholder")}
      />
      <div className="mt-2 flex gap-2">
        <button
          type="submit"
          data-track="note-compose-save"
          className="rounded-full bg-sage-600 px-3.5 py-1 text-xs font-semibold text-sage-fg hover:bg-sage-700"
        >
          {t("common.save")}
        </button>
        <button
          type="button"
          onClick={() => void cancel()}
          data-track="note-compose-cancel"
          className="rounded-full border border-line px-3 py-1 text-xs text-sand-700 hover:bg-clay-100 hover:text-clay-800"
        >
          {t("common.cancel")}
        </button>
      </div>
    </form>
  );
}
