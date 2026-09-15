import { joinNoteParts, splitNote } from "@/lib/note-title";

// Join text (SPEC.md §6): the notes' content put into one note as it is, in
// the order the notes stand in — the note on top first, the note under it
// after. The first note's title is the merged note's title; a later note's
// title stays in the body as a heading over that note's text ("## "), so
// nothing is lost and the note reads as one. Imported by the client (the
// optimistic merge) and the server (the merge route), so both write the same
// note.
export function joinNoteContents(contents: string[]): string {
  const kept = contents.map((c) => c.trim()).filter(Boolean);
  if (kept.length === 0) return "";
  const [first, ...rest] = kept;
  const head = splitNote(first);
  const tail = rest.map((content) => {
    const parts = splitNote(content);
    const body = parts.body.trim();
    if (!parts.title) return body;
    return body ? `## ${parts.title}\n\n${body}` : `## ${parts.title}`;
  });
  const body = [head.body.trim(), ...tail].filter(Boolean).join("\n\n");
  return joinNoteParts(head.title, body);
}
