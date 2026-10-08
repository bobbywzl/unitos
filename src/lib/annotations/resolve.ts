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
    marks go and the pill reading `message` shows at the press, and Undo (or
    Ctrl+Z) reopens the comment, once the resolve has landed, and paints its
    marks again. onBack: the page takes the comment back after Undo (a
    refresh). The promise settles with the resolve's request. */
export function resolveCommentWithUndo(noteId: string, message: string, onBack?: () => void): Promise<void> {
  const resolved = setCommentResolved(noteId, true);
  postUndoPill({
    message,
    undo: async () => {
      await resolved.catch(() => undefined);
      await setCommentResolved(noteId, false);
      window.dispatchEvent(new CustomEvent("dissect:note-restored", { detail: { noteId } }));
      onBack?.();
    },
  });
  return resolved;
}
