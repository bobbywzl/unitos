"use client";

import { isImeKey } from "@/lib/ime";
import { useT } from "@/components/lang-provider";
import { NoteEditor } from "@/components/outline/note-editor";
import { NoteTitleField, focusBodyEditor, useNoteParts } from "@/components/outline/note-title-field";
import { SaveStateLabel } from "@/components/outline/save-state";
import type { useNoteCompose } from "@/components/outline/use-note-compose";

// A section's composer (SPEC.md §6): a new note being written — the title
// field, then the body's editor, in one card above the section's notes. The
// tray and the notes full page render the same form; the tray's editor
// carries the core tools, the page's the whole bar.
export function NoteComposer({
  compose,
  onRelease,
  full,
  moreHref,
  padding,
}: {
  compose: ReturnType<typeof useNoteCompose>;
  /** Save or Escape is letting the note go: the list takes it as the
      composer closes (use-outline.ts expectComposed). */
  onRelease?: () => void;
  /** The whole bar (the notes full page); false: the core tools (the tray). */
  full: boolean;
  /** With the core bar: where the whole bar is — the notes full page. */
  moreHref?: string;
  /** The card's padding: the tray's or the page's. */
  padding: string;
}) {
  const t = useT();
  const { parts, setTitle, setBody } = useNoteParts(compose.draft, compose.setDraft);
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
      data-note-composer=""
      onSubmit={(e) => {
        e.preventDefault();
        save();
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
          full={full}
          moreHref={moreHref}
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
          {t("common.save")}
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
