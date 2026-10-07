// Where the reader was on the graph (WALK2-07), per project, in this tab:
// the open side list, the expanded link, the Notes list's section and its
// open note, and the provenance switch. The graph writes it as the reader
// moves, keeps it when the reader leaves for a document (so Back finds the
// same view), and drops it on an explicit close (✕, Escape). A view convenience only: losing it (a
// private window, cleared storage) loses no work.

export type GraphKeep = {
  list?: string | null;
  linkId?: string | null;
  sectionId?: string | null;
  noteId?: string | null;
  /** The provenance switch (WALK3-13). */
  provenance?: boolean;
};

const KEY = (notebookId: string) => `unitos-graph-view:${notebookId}`;
// A view older than this is a different visit: the graph opens fresh.
const FRESH_MS = 30 * 60 * 1000;

export function readGraphKeep(notebookId: string | undefined): GraphKeep {
  if (!notebookId || typeof window === "undefined") return {};
  try {
    const raw = window.sessionStorage.getItem(KEY(notebookId));
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const { at, ...keep } = parsed as GraphKeep & { at?: unknown };
    if (typeof at !== "number" || Date.now() - at > FRESH_MS) return {};
    const str = (v: unknown) => (typeof v === "string" ? v : null);
    return {
      list: str(keep.list),
      linkId: str(keep.linkId),
      sectionId: str(keep.sectionId),
      noteId: str(keep.noteId),
      provenance: keep.provenance === true,
    };
  } catch {
    return {};
  }
}

export function writeGraphKeep(notebookId: string | undefined, patch: GraphKeep): void {
  if (!notebookId || typeof window === "undefined") return;
  try {
    const next = { ...readGraphKeep(notebookId), ...patch, at: Date.now() };
    window.sessionStorage.setItem(KEY(notebookId), JSON.stringify(next));
  } catch {
    /* storage off: Back opens the graph fresh */
  }
}

export function clearGraphKeep(notebookId: string | undefined): void {
  if (!notebookId || typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(KEY(notebookId));
  } catch {
    /* storage off */
  }
}
