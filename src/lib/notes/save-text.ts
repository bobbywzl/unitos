"use client";

import { api, ApiError, clientLang } from "@/lib/api";
import { translate } from "@/lib/i18n/dictionaries";
import { reconcileNoteText } from "@/lib/notes/conflict";

// Saving a note's text from an editor (SPEC.md §6). Every save names the text
// it was made from (base). When the note changed since — the same note saved
// from another tab, or by a collaborator — the route refuses with 409 and the
// stored text; the reader's text is then put together with it
// (lib/notes/conflict.ts) and saved over the stored text it now holds. No
// words of either side are lost; lines both sides changed are kept twice
// under marker lines, and the result says so.

export type SavedText = {
  /** The note's text now: what was sent, or what it was put together into. */
  content: string;
  /** True when the stored text changed since the base: the editor shows `content`. */
  changed: boolean;
  /** True when some lines are kept twice under marker lines. */
  conflict: boolean;
};

const MAX_TRIES = 3;

function storedText(err: unknown): string | null {
  if (!(err instanceof ApiError) || err.status !== 409) return null;
  const detail = err.detail as { current?: { content?: unknown } } | null;
  return typeof detail?.current?.content === "string" ? detail.current.content : null;
}

export function conflictLabels() {
  const lang = clientLang();
  return {
    other: translate(lang, "outline.conflictOther"),
    yours: translate(lang, "outline.conflictYours"),
    end: translate(lang, "outline.conflictEnd"),
  };
}

/** Save `content`, made from `base` (the note's text when the edit began).
    A null base saves over whatever the note holds, as a write always did. */
export async function saveNoteText(noteId: string, content: string, base: string | null): Promise<SavedText> {
  let text = content.trim();
  let from = base === null ? null : base.trim();
  let conflict = false;
  for (let tries = 0; ; tries++) {
    try {
      const saved = await api<{ content?: unknown }>(`/api/notes/${noteId}`, "PATCH", {
        content: text,
        ...(from === null ? {} : { baseContent: from }),
        // The last try puts the texts together on the server, so a busy note
        // never leaves the reader's words unsaved.
        ...(tries >= MAX_TRIES ? { onConflict: "keep" } : {}),
      });
      // The stored text as the route answers it; a queued save answers none.
      if (typeof saved?.content === "string") text = saved.content;
      return { content: text, changed: text !== content.trim(), conflict };
    } catch (err) {
      const stored = storedText(err);
      if (stored === null || from === null || tries >= MAX_TRIES) throw err;
      const together = reconcileNoteText(from, stored.trim(), text, conflictLabels());
      conflict ||= together.conflict;
      text = together.text;
      from = stored.trim();
    }
  }
}
