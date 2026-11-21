// A suggestion's id is "<author>.<ms>" (SPEC.md §29). These two readers live
// in a module without zod: lib/docs/assistant-suggestions.ts reads them on
// every page through the collab context, and lib/docs/schema.ts, which
// re-exports them, carries the rich text schemas.

/** The account id a suggestion's id ("<account id>.<ms>") names. */
export function suggestionAuthor(id: unknown): string {
  const s = String(id);
  return s.slice(0, Math.max(0, s.lastIndexOf(".")));
}

/** When a suggestion was made (ms since epoch). */
export function suggestionTime(id: unknown): number {
  const s = String(id);
  return Number(s.slice(s.lastIndexOf(".") + 1));
}
