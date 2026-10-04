// A new note's id, chosen in the browser before its create leaves (SPEC.md
// §6): a draft or the offline queue holds it from the first moment, so a
// create sent twice — a reload while the first was on its way, a queue that
// replays — names the same note, and the note route answers the second with
// the note the first one made. Shaped like the ids the database makes.
export function newNoteId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return "c" + Array.from(bytes, (b) => (b % 36).toString(36)).join("");
}
