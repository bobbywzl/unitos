import { api } from "@/lib/api";
import { postUndoPill } from "@/lib/notes/undo-pill";

/** Resolves or reopens a comment (SPEC.md §29). Resolving unpaints its marks
    at once, as a delete does (reader-interactions.tsx), and paints them
    again when the request fails. */
export async function setCommentResolved(noteId: string, resolved: boolean): Promise<void> {
  const marks = (event: string) => window.dispatchEvent(new CustomEvent(event, { detail: { noteId } }));
  if (resolved) marks("dissect:note-removed");
  try {
    await api(`/api/annotations/${noteId}`, "PATCH", { resolved });
  } catch (err) {
    if (resolved) marks("dissect:note-restored");
    throw err;
  }
}

/** Resolve a comment with the Undo pill a delete shows (SPEC.md §6): the
    marks go at once, the pill reads `message`, and Undo (or Ctrl+Z) reopens
    the comment and paints its marks again. onBack: the page takes the
    comment back after Undo (a refresh). */
export async function resolveCommentWithUndo(noteId: string, message: string, onBack?: () => void): Promise<void> {
  await setCommentResolved(noteId, true);
  postUndoPill({
    message,
    undo: async () => {
      await setCommentResolved(noteId, false);
      window.dispatchEvent(new CustomEvent("dissect:note-restored", { detail: { noteId } }));
      onBack?.();
    },
  });
}
