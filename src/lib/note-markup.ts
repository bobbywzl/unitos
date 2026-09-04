// Live note markup: the note editor shows the note's markdown with the
// formatting applied while the text is edited — bold reads bold, a heading
// line reads large, a color tag colors its text — and the markers stay in the
// text, faded. The editor is a plaintext contentEditable, so this module turns
// the text into HTML runs and nothing else: every character of the text lands
// in a text node exactly once, in order, so the DOM's textContent equals the
// text and caret offsets stay honest (note-editable.ts relies on this).
//
// The grammar is the subset the Markdown component renders (markdown.tsx):
// "# " headings, "- " and "N. " lists, "> " quotes, ``` fences, **bold**,
// *italic*, ~~strike~~, `code`, <u>, the four color tags, [block id] chips,
// and [text](url) links. Anything else is plain text.

export type MarkupRun = { text: string; classes: string[] };

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// Inline tokens. At a position the earliest match wins; at the same index the
// earlier pattern wins (bold before italic). open/close are the marker
// lengths at the two ends; leaf tokens keep no markup inside; whole tokens
// are one run, markers included.
type Inline = {
  re: RegExp;
  cls: (m: RegExpExecArray) => string;
  open: (m: RegExpExecArray) => number;
  close: (m: RegExpExecArray) => number;
  leaf?: boolean;
  whole?: boolean;
};

const fixed = (n: number) => () => n;

const INLINE: Inline[] = [
  { re: /`[^`\n]+`/g, cls: () => "mk-code", open: fixed(1), close: fixed(1), leaf: true },
  { re: /\*\*(?!\s)[^\n]+?(?<!\s)\*\*/g, cls: () => "mk-bold", open: fixed(2), close: fixed(2) },
  { re: /__(?!\s)[^\n]+?(?<!\s)__/g, cls: () => "mk-bold", open: fixed(2), close: fixed(2) },
  { re: /\*(?!\s)[^*\n]+?(?<!\s)\*/g, cls: () => "mk-italic", open: fixed(1), close: fixed(1) },
  {
    re: /(?<![A-Za-z0-9])_(?!\s)[^_\n]+?(?<!\s)_(?![A-Za-z0-9])/g,
    cls: () => "mk-italic",
    open: fixed(1),
    close: fixed(1),
  },
  { re: /~~(?!\s)[^\n]+?(?<!\s)~~/g, cls: () => "mk-strike", open: fixed(2), close: fixed(2) },
  {
    re: /<(u|clay|sage|gold|plum)>[^\n]*?<\/\1>/g,
    cls: (m) => (m[1] === "u" ? "mk-underline" : `text-color-${m[1]}`),
    open: (m) => m[1].length + 2,
    close: (m) => m[1].length + 3,
  },
  { re: /\[block [a-zA-Z0-9]+\]/g, cls: () => "mk-chip", open: fixed(0), close: fixed(0), whole: true },
  {
    // [text](url): the text is the link, the url fades like a marker.
    re: /\[[^\]\n]+\]\([^)\n]*\)/g,
    cls: () => "mk-link",
    open: fixed(1),
    close: (m) => m[0].length - m[0].indexOf("]("),
  },
];

function inline(text: string, classes: string[], runs: MarkupRun[]) {
  let i = 0;
  while (i < text.length) {
    let best: { m: RegExpExecArray; tok: Inline } | null = null;
    for (const tok of INLINE) {
      tok.re.lastIndex = i;
      const m = tok.re.exec(text);
      if (m && (!best || m.index < best.m.index)) best = { m, tok };
    }
    if (!best) {
      runs.push({ text: text.slice(i), classes });
      return;
    }
    const { m, tok } = best;
    if (m.index > i) runs.push({ text: text.slice(i, m.index), classes });
    const whole = m[0];
    const inner = [...classes, tok.cls(m)];
    const mark = [...classes, "mk-mark"];
    if (tok.whole) {
      runs.push({ text: whole, classes: inner });
    } else {
      const open = tok.open(m);
      const close = tok.close(m);
      if (open > 0) runs.push({ text: whole.slice(0, open), classes: mark });
      const body = whole.slice(open, whole.length - close);
      if (tok.leaf) runs.push({ text: body, classes: inner });
      else inline(body, inner, runs);
      if (close > 0) runs.push({ text: whole.slice(whole.length - close), classes: mark });
    }
    i = m.index + whole.length;
  }
}

const HEADING = /^(\s*)(#{1,6})(\s+)/;
const BULLET = /^(\s*)([-*+])(\s+)/;
const NUMBERED = /^(\s*)(\d{1,3}[.)])(\s+)/;
const QUOTE = /^(\s*)(>)(\s?)/;
const FENCE = /^\s*```/;

function line(text: string, inFence: boolean, runs: MarkupRun[]) {
  if (inFence || FENCE.test(text)) {
    runs.push({ text, classes: ["mk-code"] });
    return;
  }
  const heading = HEADING.exec(text);
  if (heading) {
    const cls = `mk-h${Math.min(heading[2].length, 3)}`;
    runs.push({ text: heading[0], classes: [cls, "mk-mark"] });
    inline(text.slice(heading[0].length), [cls], runs);
    return;
  }
  const bullet = BULLET.exec(text) ?? NUMBERED.exec(text);
  if (bullet) {
    runs.push({ text: bullet[1], classes: [] });
    runs.push({ text: bullet[2], classes: ["mk-bullet"] });
    runs.push({ text: bullet[3], classes: [] });
    inline(text.slice(bullet[0].length), [], runs);
    return;
  }
  const quote = QUOTE.exec(text);
  if (quote) {
    runs.push({ text: quote[0], classes: ["mk-quote", "mk-mark"] });
    inline(text.slice(quote[0].length), ["mk-quote"], runs);
    return;
  }
  inline(text, [], runs);
}

/** The runs of one note text: each character once, in order, with its classes. */
export function noteMarkupRuns(text: string): MarkupRun[] {
  const runs: MarkupRun[] = [];
  let inFence = false;
  const lines = text.split("\n");
  lines.forEach((l, i) => {
    const fence = FENCE.test(l);
    line(l, inFence, runs);
    if (fence) inFence = !inFence;
    if (i < lines.length - 1) runs.push({ text: "\n", classes: [] });
  });
  return runs.filter((r) => r.text.length > 0);
}

/** The note text as decorated HTML. textContent of the result equals the text. */
export function noteMarkupHtml(text: string): string {
  let html = "";
  for (const run of noteMarkupRuns(text)) {
    const escaped = escapeHtml(run.text);
    html += run.classes.length > 0 ? `<span class="${run.classes.join(" ")}">${escaped}</span>` : escaped;
  }
  return html;
}
