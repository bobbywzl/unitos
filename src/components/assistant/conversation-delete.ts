"use client";

// Delete a conversation with no ask (SPEC.md §7): the notes' Undo pill takes
// it (postUndoPill, lib/notes/undo-pill.ts: the same 12 s, the same ✕,
// Ctrl+Z presses Undo; the words are outline.conversationDeleted). The
// delete waits for the pill to go without Undo, then runs through
// DELETE /api/notes/:id, which keeps the conversation, its side chats, and
// the comments on its answers for History's Restore. A page with no pill on
// it deletes at once.

import { postUndoPill } from "@/lib/notes/undo-pill";

/** Delete the conversation note `noteId` once the pill goes without Undo.
    gone: the conversation leaves the screen now; back: Undo puts it back;
    failed: the delete did not land, and the conversation is back (the
    technical reason goes to the console). */
export function deleteConversationWithUndo({
  noteId,
  message,
  gone,
  back,
  failed,
}: {
  noteId: string;
  message: string;
  gone: () => void;
  back: () => void;
  failed: () => void;
}): boolean {
  gone();
  return postUndoPill({
    message,
    undo: back,
    // keepalive: the pill runs commit when the page closes too.
    commit: async () => {
      try {
        const res = await fetch(`/api/notes/${encodeURIComponent(noteId)}`, { method: "DELETE", keepalive: true });
        if (res.ok || res.status === 404) return;
        const json = (await res.json().catch(() => null)) as { error?: string } | null;
        console.error("conversation delete", res.status, json?.error);
        back();
        failed();
      } catch (err) {
        console.error("conversation delete", err);
        back();
        failed();
      }
    },
  });
}
