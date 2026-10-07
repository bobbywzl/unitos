// [ui5] WALK5-14: one "Saved" line at a time on the graph. A save that shows
// its own line (the new note dock, Note on this link, Stitch's Save as note)
// says so; the dock's and the link panel's earlier line gives way. Stitch's
// line stays: it is part of the answer in the transcript. A view convenience:
// the note is saved either way.

export type SavedLineFrom = "gather" | "link" | "stitch";

const EVENT = "unitos:graph-saved-line";

export function announceSavedLine(from: SavedLineFrom): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<SavedLineFrom>(EVENT, { detail: from }));
}

/** Calls onOther when another surface shows its saved line. */
export function onOtherSavedLine(from: SavedLineFrom, onOther: () => void): () => void {
  const listener = (e: Event) => {
    if (e instanceof CustomEvent && e.detail !== from) onOther();
  };
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
