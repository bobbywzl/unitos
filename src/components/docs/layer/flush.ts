// A document's typing is saved before a caller outside its pane reads its
// words on the server (the voice command), or keeps them as a version
// (Version history, SPEC.md §29).

/** A pane's save: true, or nothing, once the stored copy holds the pane's
    text; false when the text could not be saved (offline, refused). */
type Flush = () => Promise<boolean | void>;

const flushes = new Map<string, Set<Flush>>();

/** Register a pane's save for its document; returns the unregister. */
export function registerDocumentFlush(documentId: string, flush: Flush): () => void {
  const set = flushes.get(documentId) ?? new Set();
  flushes.set(documentId, set.add(flush));
  return () => set.delete(flush);
}

/** Save the typing waiting in every page editor that shows the document.
    True when the server holds every pane's text; false when one could not
    be saved, so a caller that must keep the text (Restore this version)
    stops. */
export async function flushDocument(documentId: string): Promise<boolean> {
  const results = await Promise.all([...(flushes.get(documentId) ?? [])].map((flush) => flush().catch(() => false)));
  return results.every((saved) => saved !== false);
}
