// A blank document's typing is saved before anything stores an anchor on it
// or reads its words on the server (SPEC.md §29): the reader pane that shows
// the page editor registers how to save it, and a caller outside the pane —
// the voice command in the notes tray — awaits it first. No editor library
// here.

const flushes = new Map<string, Set<() => Promise<void>>>();

/** Register a pane's save for its document; returns the unregister. */
export function registerDocumentFlush(documentId: string, flush: () => Promise<void>): () => void {
  let set = flushes.get(documentId);
  if (!set) flushes.set(documentId, (set = new Set()));
  set.add(flush);
  return () => {
    set.delete(flush);
    if (set.size === 0 && flushes.get(documentId) === set) flushes.delete(documentId);
  };
}

/** Save the typing waiting in every page editor that shows the document. A
    failed save still lets the caller go on: the server re-finds the anchor
    by its quote. */
export async function flushDocument(documentId: string | null | undefined): Promise<void> {
  const set = documentId ? flushes.get(documentId) : undefined;
  if (!set) return;
  await Promise.all([...set].map((flush) => flush().catch(() => {})));
}
