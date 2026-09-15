import { joinNoteParts, splitNote } from "@/lib/note-title";

// Join text (SPEC.md §6): the notes' content put into one note as it is, in
// the order the notes stand in — the note on top first, the note under it
// after. The first note's title is the merged note's title. Every later
// note's text comes in under a subtitle — the note's title, or `label` when
// it has none — written as a level-six heading ("###### "), which the note
// draws small and dimmed, above a rule: the reader sees where each merged
// note begins, and deletes the line like any other when the seam is not
// wanted. Imported by the client (the optimistic merge) and the server (the
// merge route), so both write the same note.
export function joinNoteContents(contents: string[], label = "Merged note"): string {
  const kept = contents.map((c) => c.trim()).filter(Boolean);
  if (kept.length === 0) return "";
  const [first, ...rest] = kept;
  const head = splitNote(first);
  const tail = rest.map((content) => {
    const parts = splitNote(content);
    const body = parts.body.trim();
    const subtitle = `###### ${(parts.title || label).replace(/\s+/g, " ").trim()}`;
    return body ? `${subtitle}\n\n${body}` : subtitle;
  });
  const body = [head.body.trim(), ...tail].filter(Boolean).join("\n\n");
  return joinNoteParts(head.title, body);
}
