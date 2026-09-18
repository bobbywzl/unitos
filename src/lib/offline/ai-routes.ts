// The routes that need a model (SPEC.md §17): every one of them stays
// unavailable offline, for every account, and a call answers with the plain
// message. Read by the client's api() and by the service worker (public/sw.js
// keeps its own copy of the pattern: it cannot import). Not here: the notes,
// sections, replies, blocks, and annotations routes, which queue offline, and
// the upload routes, which the document bar queues as a file.
export const AI_ROUTE = new RegExp(
  "^/api/(" +
    [
      "derive",
      "assistant(/.*)?",
      "notes/gist",
      "notes/voice",
      "documents/[^/]+/(glossary|translate|convert|reparse|transcribe|finish|article|figure|speakers)",
      "multi(/.*)?",
      "notebooks/[^/]+/(connect|stitch)",
      "drive/import",
    ].join("|") +
    ")$",
);

/** True for a call that needs a model: an AI route, or Merge with AI. */
export function isAiCall(path: string, body?: unknown): boolean {
  const pathname = path.split("?")[0];
  if (AI_ROUTE.test(pathname)) return true;
  if (pathname === "/api/notes/merge") {
    return typeof body === "object" && body !== null && (body as { mode?: unknown }).mode === "ai";
  }
  return false;
}
