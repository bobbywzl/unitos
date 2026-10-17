"use client";

import { useEffect, useRef } from "react";
import { isImeKey } from "@/lib/ime";
import { useT } from "@/components/lang-provider";
import { NoteEditor } from "@/components/outline/note-editor";
import { NoteTitleField, focusBodyEditor, useNoteParts } from "@/components/outline/note-title-field";
import { SaveStateLabel } from "@/components/outline/save-state";
import type { useNoteCompose } from "@/components/outline/use-note-compose";

// The last input before a composer opened: a key or a press (pointer).
let lastInput: "key" | "pointer" = "pointer";
if (typeof window !== "undefined") {
  window.addEventListener("keydown", () => (lastInput = "key"), true);
  window.addEventListener("pointerdown", () => (lastInput = "pointer"), true);
}

// A section's composer (SPEC.md §6): a new note being written — the title
// field, then the body's editor, in one card above the section's notes. The
// tray and the notes full page render the same form, with the one editor
// bar (note-editor.tsx).
export function NoteComposer({
  compose,
  onRelease,
  padding,
}: {
  compose: ReturnType<typeof useNoteCompose>;
  /** Save or Escape is letting the note go: the list takes it as the
      composer closes (use-outline.ts expectComposed). */
  onRelease?: () => void;
  /** The card's padding: the tray's or the page's. */
  padding: string;
}) {
  const t = useT();
  const { parts, setTitle, setBody } = useNoteParts(compose.draft, compose.setDraft);
  // The composer closes with the caret in it (Done, Escape, Cancel): when
  // a key opened it, the focus goes back to the section's + Note, not to
  // the top of the page. When a press opened it, the focus goes to the
  // page: a key typed after the close never presses + Note.
  const formRef = useRef<HTMLFormElement>(null);
  const focusedRef = useRef(false);
  useEffect(() => {
    if (lastInput !== "key") return;
    const scopes: HTMLElement[] = [];
    for (let el = formRef.current?.parentElement ?? null; el && scopes.length < 6; el = el.parentElement) scopes.push(el);
    return () => {
      if (!focusedRef.current) return;
      requestAnimationFrame(() => {
        if (document.activeElement && document.activeElement !== document.body) return;
        for (const scope of scopes) {
          if (!scope.isConnected) continue;
          const add = scope.querySelector<HTMLElement>('[data-track="section-add-note"], [data-track="edited-add-note"]');
          if (add) {
            add.focus({ preventScroll: true });
            return;
          }
        }
      });
    };
  }, []);
  // Save on an empty composer is Cancel: there is nothing to keep.
  function save() {
    if (!compose.draft.trim()) {
      void compose.cancel();
      return;
    }
    onRelease?.();
    void compose.save();
  }
  function escape() {
    if (compose.draft.trim()) onRelease?.();
    compose.escape();
  }
  return (
    <form
      ref={formRef}
      data-note-composer=""
      onFocus={() => {
        focusedRef.current = true;
      }}
      onBlur={(e) => {
        const to = e.relatedTarget as Node | null;
        if (to) {
          if (!e.currentTarget.contains(to)) focusedRef.current = false;
          return;
        }
        // Focus to nowhere: the reader clicked away, or the composer is
        // going (then the form is gone, and the flag stays for the close).
        queueMicrotask(() => {
          const form = formRef.current;
          if (form?.isConnected && !form.contains(document.activeElement)) focusedRef.current = false;
        });
      }}
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      // Escape on Done, Cancel, or a button of the editor's bar closes the
      // composer as Escape in the text does (the text's fields call
      // escape themselves; an open menu keeps its own Escape).
      onKeyDown={(e) => {
        if (e.key !== "Escape" || e.defaultPrevented || isImeKey(e)) return;
        if (!(e.target as HTMLElement).closest("button")) return;
        e.preventDefault();
        escape();
      }}
    >
      {/* The save state at the top of the composer (SPEC.md §6). */}
      <div className="mb-1 flex min-h-4 justify-end">
        <SaveStateLabel state={compose.saveState} />
      </div>
      <div data-note-editing="" className={`rounded-2xl bg-card shadow-soft ${padding}`}>
        <NoteEditor
          value={parts.body}
          onChange={setBody}
          onKeyDown={(e) => {
            if (isImeKey(e)) return;
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.currentTarget.closest("form")?.requestSubmit();
            if (e.key === "Escape") escape();
          }}
          placeholder={t("outline.writeNotePlaceholder")}
          autoFocus={false}
          onQuoteDrop={compose.attachQuote}
          title={
            <NoteTitleField
              value={parts.title}
              onChange={setTitle}
              onEnter={() => focusBodyEditor(document.activeElement as HTMLElement | null)}
              onEscape={escape}
              autoFocus
            />
          }
        />
      </div>
      <div className="mt-2 flex gap-2">
        <button
          type="submit"
          data-track="note-compose-save"
          className="rounded-full bg-sage-600 px-3.5 py-1 text-xs font-semibold text-sage-fg hover:bg-sage-700"
        >
          {/* Done, as in the note's editor: the note saves as it is typed. */}
          {t("common.done")}
        </button>
        <button
          type="button"
          onClick={() => void compose.cancel()}
          data-track="note-compose-cancel"
          className="rounded-full border border-line px-3 py-1 text-xs text-sand-700 hover:bg-clay-100 hover:text-clay-800"
        >
          {t("common.cancel")}
        </button>
      </div>
    </form>
  );
}

/** Put the caret back in the composer under `root`: its title field when
    the title is empty, else the end of the body. */
export function focusComposer(root: HTMLElement | null) {
  const form = root?.querySelector<HTMLElement>("[data-note-composer]");
  const title = form?.querySelector<HTMLInputElement>("input.note-title-input");
  if (title && !title.value.trim()) {
    title.focus();
    return;
  }
  const body = form?.querySelector<HTMLElement>("[contenteditable]");
  if (!body) {
    title?.focus();
    return;
  }
  body.focus();
  const range = document.createRange();
  range.selectNodeContents(body);
  range.collapse(false);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}
