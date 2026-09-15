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
  full,
  moreHref,
  padding,
}: {
  compose: ReturnType<typeof useNoteCompose>;
  /** The whole bar (the notes full page); false: the core tools (the tray). */
  full: boolean;
  /** With the core bar: where the whole bar is — the notes full page. */
  moreHref?: string;
  /** The card's padding: the tray's or the page's. */
  padding: string;
}) {
  const t = useT();
  const { parts, setTitle, setBody } = useNoteParts(compose.draft, compose.setDraft);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void compose.save();
      }}
    >
      {/* The save state at the top of the composer (SPEC.md §6). */}
      <div className="mb-1 flex min-h-4 justify-end">
        <SaveStateLabel state={compose.saveState} />
      </div>
      <div data-note-editing="" className={`rounded-2xl bg-card shadow-soft ${padding}`}>
        <NoteTitleField
          value={parts.title}
          onChange={setTitle}
          onEnter={() => focusBodyEditor(document.activeElement as HTMLElement | null)}
          onEscape={compose.escape}
          autoFocus
        />
        <NoteEditor
          className="mt-1.5"
          value={parts.body}
          onChange={setBody}
          onKeyDown={(e) => {
            if (isImeKey(e)) return;
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.currentTarget.closest("form")?.requestSubmit();
            if (e.key === "Escape") compose.escape();
          }}
          placeholder={t("outline.writeNotePlaceholder")}
          full={full}
          moreHref={moreHref}
          autoFocus={false}
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
