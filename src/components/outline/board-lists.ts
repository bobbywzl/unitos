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
