// The note editor shows the note as the document it renders to — bold reads
// bold, a heading line reads large, a list line carries its bullet — while
// the note itself stays markdown. This module is the pure half of that: it
// parses the markdown into lines of runs, renders those lines as the editor's
// document HTML, and maps offsets between the markdown (source) and the text
// the reader sees (visible). The DOM half — reading the edited document back
// into markdown — is lib/note-doc.ts.
//
// The grammar is the subset the Markdown component renders (markdown.tsx):
// "# " headings, "- " (or "* ") bulleted lists, "+ " dash lists, "N. "
// numbered lists, "- [ ] " and "- [x] " checklists — every list nested by
// two-space indents — "> " quotes, ``` fences, **bold**, *italic*,
// ~~strike~~, `code`, <u>, the four color tags, [block id] chips,
// ![alt](url) images, and [text](url) links. Anything else is plain text.
//
// A chip and an image are atoms: the whole tag shows as one thing the caret
// steps over, so every offset that walks runs treats them alike (isAtom).

export type InlineStyle = "bold" | "italic" | "underline" | "strike" | "code" | TextColor;
export type TextColor = "clay" | "sage" | "gold" | "plum";
export const TEXT_COLORS: readonly TextColor[] = ["clay", "sage", "gold", "plum"];

/** A dropped image (SPEC.md §16): the url the reader loads it from and the
    alt the markdown carries. The width the reader set, if any, rides in the
    url ("?w=320", lib/images.ts), so the markdown stays standard. */
export type NoteImage = { url: string; alt: string };

/** The width an image's url carries, or null: the image sizes itself. */
export function imageWidth(url: string): number | null {
  const m = /[?&]w=(\d{2,4})(?:&|$)/.exec(url);
  return m ? Number(m[1]) : null;
}

/** The url with its width set, or cleared when width is null. */
export function withImageWidth(url: string, width: number | null): string {
  const bare = url.replace(/([?&])w=\d+(&|$)/, (_m, lead, tail) => (tail ? lead : "")).replace(/[?&]$/, "");
  if (width === null) return bare;
  return `${bare}${bare.includes("?") ? "&" : "?"}w=${Math.round(width)}`;
}

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
  | "dash"
  | "numbered"
  | "task"
  | "quote"
  | "code";

export type NoteLine = {
  kind: LineKind;
  /** Leading spaces before a list marker: two per nesting level. */
  indent: number;
  /** A task line: whether its box is ticked. */
  checked?: boolean;
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
// A checklist item: a bullet sign, a space, the box, a space. Before BULLET,
// which would read the box as the item's text.
const TASK = /^(\s*)([-*+])(\s)\[([ xX])\](\s)/;
const BULLET = /^(\s*)([-*+])(\s)/;
const NUMBERED = /^(\s*)(\d{1,3}[.)])(\s)/;
const QUOTE = /^(\s*)(>)(\s?)/;
const FENCE = /^\s*```/;

function parseLine(raw: string, src: number, inFence: boolean): NoteLine {
  const end = src + raw.length;
  const line = (kind: LineKind, indent: number, markerLength: number, checked?: boolean): NoteLine => {
    const bodySrc = src + markerLength;
    const runs: Run[] = [];
    inline(raw.slice(markerLength), bodySrc, [], undefined, runs);
    return checked === undefined ? { kind, indent, runs, src, bodySrc, end } : { kind, indent, checked, runs, src, bodySrc, end };
  };
  if (inFence || FENCE.test(raw)) {
    const runs: Run[] = raw ? [{ text: raw, styles: [], src, srcLen: raw.length, openLen: 0, closeLen: 0 }] : [];
    return { kind: "code", indent: 0, runs, src, bodySrc: src, end };
  }
  const heading = HEADING.exec(raw);
  if (heading) return line(`h${heading[2].length}` as LineKind, 0, heading[0].length);
  const task = TASK.exec(raw);
  if (task) return line("task", task[1].length, task[0].length, task[4] !== " ");
  const bullet = BULLET.exec(raw);
  if (bullet) return line(bullet[2] === "+" ? "dash" : "bullet", bullet[1].length, bullet[0].length);
  const numbered = NUMBERED.exec(raw);
  if (numbered) return line("numbered", numbered[1].length, numbered[0].length);
  const quote = QUOTE.exec(raw);
  if (quote) return line("quote", 0, quote[0].length);
  return line("p", 0, 0);
}

/** The kinds that nest by indent and continue on Enter. */
export function isListKind(kind: LineKind): boolean {
  return kind === "bullet" || kind === "dash" || kind === "numbered" || kind === "task";
}

/** The note with one task line's box ticked or cleared. lineIndex counts the
    note's lines from 0; a line that is no task is left alone. */
export function setTaskChecked(text: string, lineIndex: number, checked: boolean): string {
  const lines = text.split("\n");
  const raw = lines[lineIndex];
  if (raw === undefined) return text;
  const task = TASK.exec(raw);
  if (!task) return text;
  const box = task[1].length + task[2].length + task[3].length + 1;
  lines[lineIndex] = `${raw.slice(0, box)}${checked ? "x" : " "}${raw.slice(box + 1)}`;
  return lines.join("\n");
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
    const width = imageWidth(run.image.url);
    // The figure is the atom: the image, and at its corner the handle that
    // sets its width (lib/note-editable.ts). The width rides in the url.
    const style = width === null ? "" : ` style="width:${width}px"`;
    return `<span class="note-figure" data-image="${url}" data-alt="${alt}" contenteditable="false"><img class="note-image" src="${url}" alt="${alt}"${style}><span class="note-resize" aria-hidden="true"></span></span>`;
  }
  let html = escapeHtml(run.text);
  // The tags the Markdown component renders, so the prose classes style both alike.
  if (run.styles.includes("code")) html = `<code>${html}</code>`;
  if (run.styles.includes("italic")) html = `<em>${html}</em>`;
  if (run.styles.includes("bold")) html = `<strong>${html}</strong>`;
  if (run.styles.includes("strike")) html = `<del>${html}</del>`;
  if (run.styles.includes("underline")) html = `<u>${html}</u>`;
  // The innermost color paints: the same rule the reader applies when it reads
  // nested color spans back (lib/note-doc.ts), so a round trip keeps it.
  const color = [...run.styles].reverse().find((s): s is TextColor => (TEXT_COLORS as readonly string[]).includes(s));
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
  // One list per kind: a bulleted list, a dash list, a numbered list, and a
  // checklist are four lists, so a dash item after a bullet starts its own.
  const lists: { kind: LineKind; tag: "ul" | "ol"; level: number }[] = [];
  const closeLists = (downTo: number) => {
    while (lists.length > downTo) html += `</li></${lists.pop()!.tag}>`;
  };
  let quote = false;
  const closeQuote = () => {
    if (quote) html += "</blockquote>";
    quote = false;
  };
  const item = (line: NoteLine) =>
    line.kind === "task"
      ? `<li class="note-task"${line.checked ? ' data-checked=""' : ""}><span class="note-box" contenteditable="false"></span>${inner(line)}`
      : `<li>${inner(line)}`;
  for (const line of lines) {
    if (isListKind(line.kind)) {
      closeQuote();
      const tag = line.kind === "numbered" ? "ol" : "ul";
      // Nesting follows the indent, one level per two spaces, never skipping a level.
      const level = Math.min(Math.floor(line.indent / 2), lists.length);
      while (lists.length > 0) {
        const top = lists[lists.length - 1];
        if (top.level > level || (top.level === level && top.kind !== line.kind)) closeLists(lists.length - 1);
        else break;
      }
      const top = lists[lists.length - 1];
      if (top && top.level === level) {
        html += `</li>${item(line)}`;
      } else {
        const cls = line.kind === "dash" ? ' class="note-dash"' : line.kind === "task" ? ' class="note-tasks"' : "";
        html += `<${tag}${cls}>${item(line)}`;
        lists.push({ kind: line.kind, tag, level });
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
