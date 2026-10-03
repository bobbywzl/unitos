// The quote check of the note's assistant (SPEC.md §6): a "> " quote in a
// note is the document's words, and its source points back to them. A
// change the assistant proposes keeps a quote only when its words stand in
// what the model read — the note as it was, the note's sources, the
// document. A quote that does not is taken out of the change, whole, and
// named, so a made-up quote never reaches the note. No server imports.

// Plain text for comparing: curly quotes and dashes made plain, markdown's
// emphasis and a link's address dropped, spaces collapsed, case folded.
function plain(text: string): string {
  return text
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// A quote may skip words: each piece between ellipses must stand.
const ELLIPSIS = /\s*(?:\.\.\.|…|\[\.\.\.\]|\[…\])\s*/;
// A piece this short matches anything: it is not checked on its own.
const MIN_PIECE = 12;

/** The quotes of `content`: each run of "> " lines, with the lines' range. */
function quoteRuns(lines: string[]): { start: number; end: number; text: string }[] {
  const runs: { start: number; end: number; text: string }[] = [];
  let open: { start: number; parts: string[] } | null = null;
  lines.forEach((line, i) => {
    const m = /^\s*>\s?(.*)$/.exec(line);
    if (m) {
      if (!open) open = { start: i, parts: [] };
      open.parts.push(m[1]);
    } else if (open) {
      runs.push({ start: open.start, end: i, text: open.parts.join(" ") });
      open = null;
    }
  });
  const last = open as { start: number; parts: string[] } | null;
  if (last) runs.push({ start: last.start, end: lines.length, text: last.parts.join(" ") });
  return runs;
}

/** `content` with every quote whose words `material` does not hold taken
    out; `removed` names each one, cut to a readable length. */
export function checkNoteQuotes(content: string, material: string[]): { content: string; removed: string[] } {
  const held = plain(material.join("\n"));
  const lines = content.split("\n");
  const drop = new Set<number>();
  const removed: string[] = [];
  for (const run of quoteRuns(lines)) {
    const pieces = plain(run.text)
      .replace(/^"|"$/g, "")
      .split(ELLIPSIS)
      .map((p) => p.trim())
      .filter((p) => p.length >= MIN_PIECE);
    if (pieces.every((p) => held.includes(p))) continue;
    for (let i = run.start; i < run.end; i++) drop.add(i);
    const words = run.text.trim();
    removed.push(words.length > 80 ? `${words.slice(0, 79)}…` : words);
  }
  if (drop.size === 0) return { content, removed };
  const kept = lines.filter((_, i) => !drop.has(i)).join("\n");
  // A gap the quote leaves is one blank line, never two.
  return { content: kept.replace(/\n{3,}/g, "\n\n").trim(), removed };
}
