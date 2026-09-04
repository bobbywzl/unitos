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
// quotes, ``` fences, **bold**, *italic*, ~~strike~~, `code`, <u>, the four
// color tags, [block id] chips, and [text](url) links. Anything else is
// plain text.

export type InlineStyle = "bold" | "italic" | "underline" | "strike" | "code" | TextColor;
export type TextColor = "clay" | "sage" | "gold" | "plum";
export const TEXT_COLORS: readonly TextColor[] = ["clay", "sage", "gold", "plum"];

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
};

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
  | "code";

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
  style: (m: RegExpExecArray) => InlineStyle | "link" | "chip";
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
  return line("p", 0, 0);
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
      if (src < run.src + run.srcLen) return run.chip ? vis : vis + (src - run.src);
      vis += run.text.length;
      if (src === run.src + run.srcLen) return vis;
    }
    return vis;
  }
  return vis;
}

// --- The document HTML the editor shows.

function runHtml(run: Run): string {
  if (run.chip) {
    return `<span class="note-chip" data-block="${escapeHtml(run.chip)}" contenteditable="false">¶</span>`;
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
    else if (line.kind === "p") html += `<p>${inner(line)}</p>`;
    else html += `<${line.kind}>${inner(line)}</${line.kind}>`;
  }
  closeLists(0);
  closeQuote();
  return html;
}
