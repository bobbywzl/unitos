// The documents this browser reads collapsed (SPEC.md §28), in a cookie so
// the server draws a remembered Collapse in the page itself: the article
// comes up collapsed on the first paint, not seconds later. The newest
// choice first; the oldest fall off past COLLAPSE_MEMORY_MAX. The older
// memory (localStorage `unitos-collapse-<documentId>`) is kept and still
// read: a document remembered only there is added to the cookie on its next
// open.

export const COLLAPSE_COOKIE = "unitos-collapse";
const COLLAPSE_MEMORY_MAX = 40;
const COLLAPSE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** The document ids a cookie value holds. */
export function collapsedDocuments(value: string | undefined | null): Set<string> {
  if (!value) return new Set();
  return new Set(
    decodeURIComponent(value)
      .split(".")
      .filter((id) => /^[A-Za-z0-9_-]{1,64}$/.test(id)),
  );
}

/** Browser only: remember (or forget) that a document reads collapsed. */
export function rememberCollapsedDocument(documentId: string, on: boolean): void {
  if (typeof document === "undefined") return;
  const current = document.cookie
    .split("; ")
    .find((part) => part.startsWith(`${COLLAPSE_COOKIE}=`))
    ?.slice(COLLAPSE_COOKIE.length + 1);
  const ids = [...collapsedDocuments(current)].filter((id) => id !== documentId);
  if (on) ids.unshift(documentId);
  const kept = ids.slice(0, COLLAPSE_MEMORY_MAX);
  document.cookie =
    kept.length > 0
      ? `${COLLAPSE_COOKIE}=${kept.join(".")}; path=/; max-age=${COLLAPSE_COOKIE_MAX_AGE}; samesite=lax`
      : `${COLLAPSE_COOKIE}=; path=/; max-age=0; samesite=lax`;
}
