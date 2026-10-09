"use client";

// Delete a conversation with no ask (SPEC.md §7): the notes' Undo pill takes
// it (postUndoPill, lib/notes/undo-pill.ts: the same 12 s, the same ✕,
// Ctrl+Z presses Undo; the words are outline.conversationDeleted). The
// delete waits for the pill to go without Undo, then runs through
// DELETE /api/notes/:id, which keeps the conversation, its side chats, and
// the comments on its answers for History's Restore. A page with no pill on
// it deletes at once.

import { deleteWithUndo } from "@/lib/deferred-delete";

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
  // keepalive: the pill runs commit when the page closes too; a reload
  // while the pill shows sends it again (lib/deferred-delete.ts).
  return deleteWithUndo({
    url: `/api/notes/${encodeURIComponent(noteId)}`,
    method: "DELETE",
    ids: [noteId],
    message,
    gone,
    back,
    failed,
  });
}
