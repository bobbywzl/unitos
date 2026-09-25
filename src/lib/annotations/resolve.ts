import { api } from "@/lib/api";

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
