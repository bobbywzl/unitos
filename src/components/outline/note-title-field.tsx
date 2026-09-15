"use client";

import { useState } from "react";
import { isImeKey } from "@/lib/ime";
import { joinNoteParts, splitNote, type NoteParts } from "@/lib/note-title";
import { useT } from "@/components/lang-provider";

/** The draft as an editor holds it (SPEC.md §6): the title field and the
    body's editor each edit their own part, and the draft is the two joined.
    A draft set from outside — Cancel restoring it, a merge landing, the
    keyboard queue opening it — is split again; the parts' own edits are not,
    so a heading typed at the top of the body stays in the body until the
    editor closes. Adjust-during-render: `joined` is the draft the parts
    were last joined into, so a draft that differs came from outside. */
export function useNoteParts(draft: string, setDraft: (next: string) => void) {
  const [parts, setParts] = useState<NoteParts>(() => splitNote(draft));
  const [joined, setJoined] = useState(draft);
  if (draft !== joined) {
    setJoined(draft);
    setParts(splitNote(draft));
  }
  function setTitle(title: string) {
    const next = joinNoteParts(title, parts.body);
    setJoined(next);
    setParts({ title, body: parts.body });
    setDraft(next);
  }
  function setBody(body: string) {
    const next = joinNoteParts(parts.title, body);
    setJoined(next);
    setParts({ title: parts.title, body });
    setDraft(next);
  }
  return { parts, setTitle, setBody };
}

// The title field of a note being edited (SPEC.md §6): one line above the
// body's editor, the same look as the title row of the rendered note. Enter
// moves to the body; the title itself never holds a line break.
export function NoteTitleField({
  value,
  onChange,
  onEnter,
  onEscape,
  autoFocus,
  className,
}: {
  value: string;
  onChange: (title: string) => void;
  /** Enter: the caret moves on to the body. */
  onEnter?: () => void;
  onEscape?: () => void;
  autoFocus?: boolean;
  className?: string;
}) {
  const t = useT();
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (isImeKey(e)) return;
        if (e.key === "Enter") {
          e.preventDefault();
          onEnter?.();
        }
        if (e.key === "Escape") onEscape?.();
      }}
      placeholder={t("outline.titlePlaceholder")}
      aria-label={t("outline.noteTitleLabel")}
      autoFocus={autoFocus}
      data-no-drag
      className={`note-title-input ${className ?? ""}`}
    />
  );
}

/** The body's editor under a title field: where Enter in the title goes. */
export function focusBodyEditor(from: HTMLElement | null) {
  const card = from?.closest<HTMLElement>("[data-note-editing]");
  card?.querySelector<HTMLElement>("[contenteditable]")?.focus();
}
