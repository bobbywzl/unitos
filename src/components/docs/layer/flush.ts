// A blank document's typing is saved before a caller outside its pane — the
// voice command — reads its words on the server (SPEC.md §29).

const flushes = new Map<string, Set<() => Promise<void>>>();

/** Register a pane's save for its document; returns the unregister. */
export function registerDocumentFlush(documentId: string, flush: () => Promise<void>): () => void {
  const set = flushes.get(documentId) ?? new Set();
  flushes.set(documentId, set.add(flush));
  return () => set.delete(flush);
}

/** Save the typing waiting in every page editor that shows the document. */
export async function flushDocument(documentId: string): Promise<void> {
  await Promise.all([...(flushes.get(documentId) ?? [])].map((flush) => flush().catch(() => {})));
}
