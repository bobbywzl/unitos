// A note has a title and a body (SPEC.md §6). The title is the note's first
// line when that line is a level-one heading — "# Title" — and the body is
// everything after it. The note stays one markdown string (Note.content), so
// everything that reads a note's content — export, the digest, the prompts,
// search — reads the title as the heading it is, and a note written before
// titles existed whose first line is a heading has a title already. A note
// whose first line is anything else has no title.
//
// Imported by the client (the card, the editors) and the server (the merge),
// so the two never disagree on where a title ends.

export type NoteParts = { title: string; body: string };

// "# " and at least one character that is not a space: "# " alone is text.
const TITLE_LINE = /^#[ \t]+(\S.*)$/;

/** The note's title and body. No title: title "" and the whole content as the body. */
export function splitNote(content: string): NoteParts {
  const nl = content.indexOf("\n");
  const first = nl === -1 ? content : content.slice(0, nl);
  const m = TITLE_LINE.exec(first);
  if (!m) return { title: "", body: content };
  const rest = nl === -1 ? "" : content.slice(nl + 1);
  // The one blank line between the title and the body is the separator, not
  // a line of the body.
  return { title: m[1].trim(), body: rest.startsWith("\n") ? rest.slice(1) : rest };
}

/** The note's title alone; "" when it has none. */
export function noteTitle(content: string): string {
  return splitNote(content).title;
}

/** The title and the body as one note. An empty title leaves the body as it
    is; a title stands on its own line, a blank line before the body. */
export function joinNoteParts(title: string, body: string): string {
  const line = title.replace(/\s+/g, " ").trim();
  if (!line) return body;
  return body.trim() === "" ? `# ${line}` : `# ${line}\n\n${body}`;
}

/** The note with markdown added at the end of its body, on its own line: a
    dropped image, a dropped link. */
export function appendToBody(content: string, markdown: string): string {
  const parts = splitNote(content);
  const base = parts.body.replace(/\s+$/, "");
  return joinNoteParts(parts.title, base ? `${base}\n\n${markdown}` : markdown);
}

/** The line of the note a line of its body is on: the title and its blank
    line come before the body. */
export function bodyLineOffset(content: string): number {
  const parts = splitNote(content);
  return content.split("\n").length - parts.body.split("\n").length;
}

/** The draft an editor opens with. On a quote note (only "> " lines) a fresh
    line is added, so the caret starts underneath the quote and additions
    land there. */
export function editDraft(content: string): string {
  const lines = content.split("\n");
  const quoteOnly = lines.length > 0 && lines.every((l) => l.trim() === "" || l.startsWith(">"));
  return quoteOnly ? `${content}\n\n` : content;
}
