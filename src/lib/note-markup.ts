// The note editor shows the note as the document it renders to — bold reads
// bold, a heading line reads large, a list line carries its bullet — while
// the note itself stays markdown. This module is the pure half of that: it
// parses the markdown into lines of runs, renders those lines as the editor's
// document HTML, and maps offsets between the markdown (source) and the text
// the reader sees (visible). The DOM half — reading the edited document back
// into markdown — is lib/note-doc.ts.
//
// The grammar is the subset the Markdown component renders (markdown.tsx):
// "# " headings, "- " and "N. " lists nested by two-space indents, "> "
// quotes, ``` fences, "| " table rows, **bold**, *italic*, ~~strike~~,
// `code`, <u>, the four color tags, [block id] chips, ![alt](url) images,
// and [text](url) links. Anything else is plain text.
//
// A table row is one line whose cells sit between pipes. The editor shows the
// row as its markdown — the pipes stay visible, in a monospace line, so the
// columns line up — and the rendered note draws the table (markdown.tsx).
//
// A chip and an image are atoms: the whole tag shows as one thing the caret
// steps over, so every offset that walks runs treats them alike (isAtom).

export type InlineStyle = "bold" | "italic" | "underline" | "strike" | "code" | TextColor;
export type TextColor = "clay" | "sage" | "gold" | "plum";
export const TEXT_COLORS: readonly TextColor[] = ["clay", "sage", "gold", "plum"];

/** A dropped image (SPEC.md §16): the url the reader loads it from and the
    alt the markdown carries. */
export type NoteImage = { url: string; alt: string };

export type Run = {
  /** The visible text. */
  text: string;
  styles: InlineStyle[];
  /** Source offset of the run's own text; markers before it are not part of it. */
  src: number;
  /** Source length: the text's length, except a chip, whose whole tag shows as one ¶. */
  srcLen: number;
  /** Lengths of the markers that open right before the run and close right after it. */
  openLen: number;
  closeLen: number;
  href?: string;
  chip?: string;
  image?: NoteImage;
};

/** A chip or an image: one atom, whatever its source length. */
export function isAtom(run: { chip?: string; image?: NoteImage }): boolean {
  return run.chip !== undefined || run.image !== undefined;
}

export type LineKind =
  | "p"
  | "h1"
  | "h2"
  | "h3"
  | "h4"
  | "h5"
  | "h6"
  | "bullet"
  | "numbered"
  | "quote"
  | "code"
  | "table";

export type NoteLine = {
  kind: LineKind;
  /** Leading spaces before a list marker: two per nesting level. */
  indent: number;
  runs: Run[];
  /** Source offsets: the line's first character, its body after the marker, and its end before the newline. */
  src: number;
  bodySrc: number;
  end: number;
};

export function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// Inline tokens. At a position the earliest match wins; at the same index the
// earlier pattern wins (bold before italic). open/close are the marker
// lengths at the two ends.
type Inline = {
  re: RegExp;
  style: (m: RegExpExecArray) => InlineStyle | "link" | "chip" | "image";
  open: (m: RegExpExecArray) => number;
  close: (m: RegExpExecArray) => number;
};

const fixed = (n: number) => () => n;

const INLINE: Inline[] = [
  { re: /`[^`\n]+`/g, style: () => "code", open: fixed(1), close: fixed(1) },
  { re: /\*\*(?!\s)[^\n]+?(?<!\s)\*\*/g, style: () => "bold", open: fixed(2), close: fixed(2) },
  { re: /__(?!\s)[^\n]+?(?<!\s)__/g, style: () => "bold", open: fixed(2), close: fixed(2) },
  { re: /\*(?!\s)[^*\n]+?(?<!\s)\*/g, style: () => "italic", open: fixed(1), close: fixed(1) },
  {
    re: /(?<![A-Za-z0-9])_(?!\s)[^_\n]+?(?<!\s)_(?![A-Za-z0-9])/g,
    style: () => "italic",
    open: fixed(1),
    close: fixed(1),
  },
  { re: /~~(?!\s)[^\n]+?(?<!\s)~~/g, style: () => "strike", open: fixed(2), close: fixed(2) },
  {
    re: /<(u|clay|sage|gold|plum)>[^\n]+?<\/\1>/g,
    style: (m) => (m[1] === "u" ? "underline" : (m[1] as TextColor)),
    open: (m) => m[1].length + 2,
    close: (m) => m[1].length + 3,
  },
  { re: /\[block [a-zA-Z0-9]+\]/g, style: () => "chip", open: fixed(0), close: fixed(0) },
  // Before the link pattern: an image is a link with a "!" in front of it.
  { re: /!\[[^\]\n]*\]\([^)\n]*\)/g, style: () => "image", open: fixed(0), close: fixed(0) },
  {
    re: /\[[^\]\n]+\]\([^)\n]*\)/g,
    style: () => "link",
    open: fixed(1),
    close: (m) => m[0].length - m[0].indexOf("]("),
  },
];

function inline(text: string, base: number, styles: InlineStyle[], href: string | undefined, runs: Run[]) {
  let i = 0;
  while (i < text.length) {
    let best: { m: RegExpExecArray; tok: Inline } | null = null;
    for (const tok of INLINE) {
      tok.re.lastIndex = i;
      const m = tok.re.exec(text);
      if (m && (!best || m.index < best.m.index)) best = { m, tok };
    }
    if (!best) {
      runs.push({ text: text.slice(i), styles, src: base + i, srcLen: text.length - i, openLen: 0, closeLen: 0, href });
      return;
    }
    const { m, tok } = best;
    if (m.index > i) {
      runs.push({ text: text.slice(i, m.index), styles, src: base + i, srcLen: m.index - i, openLen: 0, closeLen: 0, href });
    }
    const whole = m[0];
    const at = base + m.index;
    const style = tok.style(m);
    const first = runs.length;
    if (style === "chip") {
      runs.push({ text: "¶", styles, src: at, srcLen: whole.length, openLen: 0, closeLen: 0, href, chip: whole.slice(7, -1) });
    } else if (style === "image") {
      const parts = /^!\[([^\]\n]*)\]\(([^)\n]*)\)$/.exec(whole);
      runs.push({
        text: "¶",
        styles,
        src: at,
        srcLen: whole.length,
        openLen: 0,
        closeLen: 0,
        href,
        image: { alt: parts?.[1] ?? "", url: parts?.[2] ?? "" },
      });
    } else {
      const open = tok.open(m);
      const close = tok.close(m);
      const body = whole.slice(open, whole.length - close);
      if (style === "link") {
        inline(body, at + open, styles, whole.slice(open + body.length + 2, -1), runs);
      } else if (style === "code") {
        runs.push({ text: body, styles: [...styles, "code"], src: at + open, srcLen: body.length, openLen: 0, closeLen: 0, href });
      } else {
        inline(body, at + open, [...styles, style], href, runs);
      }
      // The body's first and last runs carry this token's markers.
      if (runs.length > first) {
        runs[first].openLen += open;
        runs[runs.length - 1].closeLen += close;
      }
    }
    i = m.index + whole.length;
  }
}

// A marker is the sign and one space — a lone "-" is text until the space
// is typed — and any further spaces stay in the text, so a space typed at
// the start of an item survives the round trip.
const HEADING = /^(\s*)(#{1,6})(\s)/;
const BULLET = /^(\s*)([-*+])(\s)/;
const NUMBERED = /^(\s*)(\d{1,3}[.)])(\s)/;
const QUOTE = /^(\s*)(>)(\s?)/;
const FENCE = /^\s*```/;
// A table row: the line opens with a pipe. The separator row ("| --- |") is a
// table row too.
export const TABLE_ROW = /^\s*\|/;

function parseLine(raw: string, src: number, inFence: boolean): NoteLine {
  const end = src + raw.length;
  const line = (kind: LineKind, indent: number, markerLength: number): NoteLine => {
    const bodySrc = src + markerLength;
    const runs: Run[] = [];
    inline(raw.slice(markerLength), bodySrc, [], undefined, runs);
    return { kind, indent, runs, src, bodySrc, end };
  };
  if (inFence || FENCE.test(raw)) {
    const runs: Run[] = raw ? [{ text: raw, styles: [], src, srcLen: raw.length, openLen: 0, closeLen: 0 }] : [];
    return { kind: "code", indent: 0, runs, src, bodySrc: src, end };
  }
  const heading = HEADING.exec(raw);
  if (heading) return line(`h${heading[2].length}` as LineKind, 0, heading[0].length);
  const bullet = BULLET.exec(raw);
  if (bullet) return line("bullet", bullet[1].length, bullet[0].length);
  const numbered = NUMBERED.exec(raw);
  if (numbered) return line("numbered", numbered[1].length, numbered[0].length);
  const quote = QUOTE.exec(raw);
  if (quote) return line("quote", 0, quote[0].length);
  if (TABLE_ROW.test(raw)) return line("table", 0, 0);
  return line("p", 0, 0);
}

// --- Tables.

/** The cells of a table row line: the text between its pipes. An empty array when the line is no table row. */
export function tableCells(line: string): string[] {
  if (!TABLE_ROW.test(line)) return [];
  const trimmed = line.trim();
  const inner = trimmed.slice(1, trimmed.endsWith("|") && trimmed.length > 1 ? -1 : undefined);
  return inner.split("|");
}

/** An empty table row with `cols` cells. */
export function emptyTableRow(cols: number): string {
  return `|${"  |".repeat(Math.max(1, cols))}`;
}

const TABLE_COLUMNS = 2;
const TABLE_ROWS = 2;

/** The table the bar's table button inserts: a header row, its separator, and empty rows. */
export function tableTemplate(): string {
  const row = emptyTableRow(TABLE_COLUMNS);
  const separator = `|${" --- |".repeat(TABLE_COLUMNS)}`;
  return [row, separator, ...Array.from({ length: TABLE_ROWS }, () => row)].join("\n");
}

/** The line the caret is on: its start and end source offsets, and its text. */
export function lineBounds(text: string, caret: number): { start: number; end: number; line: string } {
  const start = text.lastIndexOf("\n", Math.max(0, caret - 1)) + 1;
  const endIdx = text.indexOf("\n", caret);
  const end = endIdx === -1 ? text.length : endIdx;
  return { start, end, line: text.slice(start, end) };
}

/** Insert the table template at the caret, on lines of its own: a blank line
    before it when the caret's line has text, and a blank line after it. The
    caret lands in the first cell. */
export function insertTable(text: string, s: number, e: number): { value: string; start: number; end: number } {
  const before = text.slice(0, s);
  const after = text.slice(e);
  const lead = before === "" || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
  const trail = after === "" || after.startsWith("\n\n") ? "" : after.startsWith("\n") ? "\n" : "\n\n";
  const value = before + lead + tableTemplate() + trail + after;
  const caret = before.length + lead.length + 2;
  return { value, start: caret, end: caret };
}

/** Tab in a table row: the caret moves to the next cell, or back to the
    previous one. Past the last cell of the last row a new row is added.
    Null when the caret is not in a table row. */
export function stepTableCell(
  text: string,
  caret: number,
  back: boolean,
): { value: string; start: number; end: number } | null {
  const { start, end, line } = lineBounds(text, caret);
  if (!TABLE_ROW.test(line)) return null;
  // The pipes' offsets in the line; the cells sit between them.
  const pipes: number[] = [];
  for (let i = 0; i < line.length; i++) if (line[i] === "|") pipes.push(i);
  if (pipes.length < 2) return null;
  const at = caret - start;
  const cellIndex = pipes.findIndex((p, i) => at > p && (i === pipes.length - 1 || at <= pipes[i + 1]));
  // Inside cell k: between pipes[k] and pipes[k + 1]. Before the first pipe or after the last: the row's edge.
  const cell = cellIndex === -1 ? (at <= pipes[0] ? -1 : pipes.length - 1) : cellIndex;
  const lastCell = pipes.length - 2;
  const cellAt = (i: number) => start + pipes[i] + 1 + (line[pipes[i] + 1] === " " ? 1 : 0);
  if (back) {
    if (cell > 0) return caretPatch(text, cellAt(Math.min(cell - 1, lastCell)));
    // The first cell: the last cell of the row above, when that is a table row.
    if (start === 0) return caretPatch(text, cellAt(0));
    const above = lineBounds(text, start - 1);
    if (!TABLE_ROW.test(above.line)) return caretPatch(text, cellAt(0));
    const pipesAbove = [...above.line].flatMap((ch, i) => (ch === "|" ? [i] : []));
    if (pipesAbove.length < 2) return caretPatch(text, cellAt(0));
    const p = pipesAbove[pipesAbove.length - 2];
    return caretPatch(text, above.start + p + 1 + (above.line[p + 1] === " " ? 1 : 0));
  }
  if (cell < lastCell) return caretPatch(text, cellAt(cell + 1));
  // The last cell: the first cell of the row below, or a new row.
  if (end < text.length) {
    const below = lineBounds(text, end + 1);
    if (TABLE_ROW.test(below.line)) {
      const first = below.line.indexOf("|");
      return caretPatch(text, below.start + first + 1 + (below.line[first + 1] === " " ? 1 : 0));
    }
  }
  const row = emptyTableRow(pipes.length - 1);
  const value = text.slice(0, end) + "\n" + row + text.slice(end);
  const c = end + 1 + 2;
  return { value, start: c, end: c };
}

function caretPatch(text: string, caret: number): { value: string; start: number; end: number } {
  return { value: text, start: caret, end: caret };
}

/** The note's lines: one per newline, with their runs and source offsets. */
export function parseNote(text: string): NoteLine[] {
  const lines: NoteLine[] = [];
  let pos = 0;
  let inFence = false;
  for (const raw of text.split("\n")) {
    lines.push(parseLine(raw, pos, inFence));
    if (FENCE.test(raw)) inFence = !inFence;
    pos += raw.length + 1;
  }
  return lines;
}

function visibleLength(line: NoteLine): number {
  let n = 0;
  for (const run of line.runs) n += run.text.length;
  return n;
}

/** The text the reader sees: the lines' visible text, joined by newlines. */
export function visibleText(lines: NoteLine[]): string {
  return lines.map((l) => l.runs.map((r) => r.text).join("")).join("\n");
}

/** A source offset as a visible offset. Inside a marker: the marker's spot. */
export function visibleOffset(lines: NoteLine[], src: number): number {
  let vis = 0;
  for (const line of lines) {
    if (src > line.end) {
      vis += visibleLength(line) + 1;
      continue;
    }
    for (const run of line.runs) {
      if (src <= run.src) return vis;
      if (src < run.src + run.srcLen) return isAtom(run) ? vis : vis + (src - run.src);
      vis += run.text.length;
      if (src === run.src + run.srcLen) return vis;
    }
    return vis;
  }
  return vis;
}

/** A visible offset as a source offset. At a run boundary: the end of the run before it. */
export function sourceOffset(lines: NoteLine[], vis: number): number {
  let at = 0;
  for (const line of lines) {
    const len = visibleLength(line);
    if (vis > at + len) {
      at += len + 1;
      continue;
    }
    const d = vis - at;
    if (line.runs.length === 0) return line.bodySrc;
    let acc = 0;
    for (const run of line.runs) {
      if (d <= acc + run.text.length) {
        const inRun = d - acc;
        if (isAtom(run)) return inRun === 0 ? run.src : run.src + run.srcLen;
        return run.src + inRun;
      }
      acc += run.text.length;
    }
    return line.end;
  }
  return lines.length > 0 ? lines[lines.length - 1].end : 0;
}

/** Visible offset where a line's text starts. */
export function lineVisibleStart(lines: NoteLine[], index: number): number {
  let at = 0;
  for (let i = 0; i < index; i++) at += visibleLength(lines[i]) + 1;
  return at;
}

// --- The document HTML the editor shows.

function runHtml(run: Run): string {
  if (run.chip) {
    return `<span class="note-chip" data-block="${escapeHtml(run.chip)}" contenteditable="false">¶</span>`;
  }
  if (run.image) {
    const url = escapeHtml(run.image.url);
    const alt = escapeHtml(run.image.alt);
    return `<img class="note-image" data-image="${url}" data-alt="${alt}" src="${url}" alt="${alt}" contenteditable="false">`;
  }
  let html = escapeHtml(run.text);
  // The tags the Markdown component renders, so the prose classes style both alike.
  if (run.styles.includes("code")) html = `<code>${html}</code>`;
  if (run.styles.includes("italic")) html = `<em>${html}</em>`;
  if (run.styles.includes("bold")) html = `<strong>${html}</strong>`;
  if (run.styles.includes("strike")) html = `<del>${html}</del>`;
  if (run.styles.includes("underline")) html = `<u>${html}</u>`;
  const color = run.styles.find((s): s is TextColor => (TEXT_COLORS as readonly string[]).includes(s));
  if (color) html = `<span class="text-color-${color}">${html}</span>`;
  if (run.href !== undefined) html = `<span class="note-link" data-href="${escapeHtml(run.href)}">${html}</span>`;
  return html;
}

// An empty line keeps a <br>, so it has a height and can hold the caret.
function inner(line: NoteLine): string {
  return line.runs.map(runHtml).join("") || "<br>";
}

/** The lines as document HTML: headings, nested lists, quotes, code lines, paragraphs. */
export function noteDocHtml(lines: NoteLine[]): string {
  let html = "";
  const lists: { tag: "ul" | "ol"; level: number }[] = [];
  const closeLists = (downTo: number) => {
    while (lists.length > downTo) html += `</li></${lists.pop()!.tag}>`;
  };
  let quote = false;
  const closeQuote = () => {
    if (quote) html += "</blockquote>";
    quote = false;
  };
  for (const line of lines) {
    if (line.kind === "bullet" || line.kind === "numbered") {
      closeQuote();
      const tag = line.kind === "bullet" ? "ul" : "ol";
      // Nesting follows the indent, one level per two spaces, never skipping a level.
      const level = Math.min(Math.floor(line.indent / 2), lists.length);
      while (lists.length > 0) {
        const top = lists[lists.length - 1];
        if (top.level > level || (top.level === level && top.tag !== tag)) closeLists(lists.length - 1);
        else break;
      }
      const top = lists[lists.length - 1];
      if (top && top.level === level) {
        html += `</li><li>${inner(line)}`;
      } else {
        html += `<${tag}><li>${inner(line)}`;
        lists.push({ tag, level });
      }
      continue;
    }
    closeLists(0);
    if (line.kind === "quote") {
      if (!quote) html += "<blockquote>";
      quote = true;
      html += `<p>${inner(line)}</p>`;
      continue;
    }
    closeQuote();
    if (line.kind === "code") html += `<p class="note-code">${inner(line)}</p>`;
    else if (line.kind === "table") html += `<p class="note-table">${inner(line)}</p>`;
    else if (line.kind === "p") html += `<p>${inner(line)}</p>`;
    else html += `<${line.kind}>${inner(line)}</${line.kind}>`;
  }
  closeLists(0);
  closeQuote();
  return html;
}
