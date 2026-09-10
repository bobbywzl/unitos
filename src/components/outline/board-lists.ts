// The drag board's list ids on the notes full page (SPEC.md §6). One list per
// section's notes, one per section's children, and one for the root sections;
// the board hands a list id back on a drop, and parseListId says which list it
// names. A note dropped in a notes list of another section moves there.
export const notesList = (sectionId: string) => `notes:${sectionId}`;
export const sectionsList = (parentId: string | null) => `sections:${parentId ?? ""}`;
export const SECTIONS_LIST = sectionsList(null);

export function parseListId(listId: string): {
  kind: "notes" | "sections";
  parentId: string | null;
} {
  const cut = listId.indexOf(":");
  const kind = listId.slice(0, cut) === "notes" ? "notes" : "sections";
  const parentId = listId.slice(cut + 1);
  return { kind, parentId: parentId === "" ? null : parentId };
}

/** Where a dragged note lands in its section's own list of notes. `beforeId`
    is the note the board says it landed before — null = the end of the list.
    The section's list holds notes the tray's list does not (the pending ones,
    the one a composer owns), so the index is counted here, not by the board.
    Moving a note down inside one list takes one place off: the note leaves
    its own place before it lands. Null: the drop lands nowhere. */
export function dropIndex(
  notes: { id: string }[],
  itemId: string,
  beforeId: string | null,
  sameSection: boolean,
): number | null {
  let index = beforeId === null ? notes.length : notes.findIndex((n) => n.id === beforeId);
  if (index === -1) return null;
  if (sameSection) {
    const from = notes.findIndex((n) => n.id === itemId);
    if (from === -1) return null;
    if (from < index) index -= 1;
  }
  return index;
}
