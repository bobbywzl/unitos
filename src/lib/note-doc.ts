// The DOM half of the note editor's document (the pure half is
// lib/note-markup.ts): reading the edited document back as markdown. The DOM
// is whatever the browser left behind after typing, deleting, pasting, or
// merging blocks, so this walks any of it: block elements become lines
// (headings, list items with their depth, quote lines, paragraphs), inline
// elements become styles, unknown elements are transparent. The editor
// re-renders the markdown it gets, so the DOM is canonical again after
// every edit.
//
// Sentinels: the editor reads the selection by putting one sentinel
// character at each end of it and serializing; the markdown offsets of the
// sentinels are the selection's source offsets. A sentinel in a run's
// leading or trailing whitespace lands outside the run's markers with that
// whitespace; anywhere else it lands inside them.

import { TEXT_COLORS, type InlineStyle } from "@/lib/note-markup";

export const SELECTION_START = "\uE000";
export const SELECTION_END = "\uE001";

const BLOCK_TAGS = new Set([
  "P",
  "DIV",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "UL",
  "OL",
  "LI",
  "BLOCKQUOTE",
  "PRE",
  "SECTION",
  "ARTICLE",
  "HEADER",
  "FOOTER",
  "MAIN",
  "NAV",
  "ASIDE",
  "ADDRESS",
  "FIGURE",
  "FIGCAPTION",
  "TABLE",
  "TBODY",
  "THEAD",
  "TFOOT",
  "TR",
  "TD",
  "TH",
  "DL",
  "DT",
  "DD",
  "HR",
]);

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

function isBlock(node: Node): node is Element {
  return node.nodeType === ELEMENT_NODE && BLOCK_TAGS.has((node as Element).tagName);
}

export type InlineRun = { text: string; styles: InlineStyle[]; href?: string; chip?: string };

// Browsers type a non-breaking space where a plain one would collapse, and
// leave zero-width characters around atoms; the note keeps neither.
function clean(text: string): string {
  return text.replace(/\u00a0/g, " ").replace(/[\u200b\ufeff\r]/g, "");
}

const BOLD_WEIGHT = /^(bold|bolder|[6-9]00)$/;

function collectInline(node: Node, styles: InlineStyle[], href: string | undefined, out: InlineRun[]) {
  if (node.nodeType === TEXT_NODE) {
    const text = clean((node as Text).data);
    if (text) out.push({ text, styles, href });
    return;
  }
  if (node.nodeType !== ELEMENT_NODE) return;
  const el = node as HTMLElement;
  const tag = el.tagName;
  if (tag === "BR") {
    out.push({ text: "\n", styles: [] });
    return;
  }
  const chip = el.getAttribute("data-block");
  if (chip) {
    out.push({ text: "¶", styles, href, chip });
    return;
  }
  const next = [...styles];
  const add = (s: InlineStyle) => {
    if (!next.includes(s)) next.push(s);
  };
  const style = el.style;
  if (tag === "B" || tag === "STRONG" || BOLD_WEIGHT.test(style?.fontWeight ?? "")) add("bold");
  if (tag === "I" || tag === "EM" || style?.fontStyle === "italic") add("italic");
  const decoration = `${style?.textDecorationLine ?? ""} ${style?.textDecoration ?? ""}`;
  if (tag === "U" || decoration.includes("underline")) add("underline");
  if (tag === "S" || tag === "STRIKE" || tag === "DEL" || decoration.includes("line-through")) add("strike");
  if (tag === "CODE" || tag === "KBD" || tag === "SAMP" || tag === "TT") add("code");
  for (const color of TEXT_COLORS) {
    if (el.classList.contains(`text-color-${color}`)) {
      for (const other of TEXT_COLORS) {
        const at = next.indexOf(other);
        if (at !== -1) next.splice(at, 1);
      }
      add(color);
    }
  }
  let link = href;
  const dataHref = el.getAttribute("data-href");
  if (dataHref !== null) link = dataHref;
  else if (tag === "A" && el.getAttribute("href") !== null) link = el.getAttribute("href") ?? undefined;
  for (const child of Array.from(el.childNodes)) collectInline(child, next, link, out);
}

// Markers, outermost first: a color wraps underline wraps strike wraps bold
// wraps italic wraps code. One order, so every serialization nests the same way.
const ORDER: InlineStyle[] = ["clay", "sage", "gold", "plum", "underline", "strike", "bold", "italic", "code"];
const MARKERS: Record<InlineStyle, [string, string]> = {
  bold: ["**", "**"],
  italic: ["*", "*"],
  underline: ["<u>", "</u>"],
  strike: ["~~", "~~"],
  code: ["`", "`"],
  clay: ["<clay>", "</clay>"],
  sage: ["<sage>", "</sage>"],
  gold: ["<gold>", "</gold>"],
  plum: ["<plum>", "</plum>"],
};

const LEAD_WS = /^\s*/;
const TRAIL_WS = /\s*$/;
const ALL_WS = /^\s*$/;

type Mark = { ch: string; pos: number };

/** A run's text without its sentinels, and where each sentinel was. */
function splitMarks(text: string): { clean: string; marks: Mark[] } {
  const marks: Mark[] = [];
  let clean = "";
  for (const ch of text) {
    if (ch === SELECTION_START || ch === SELECTION_END) marks.push({ ch, pos: clean.length });
    else clean += ch;
  }
  return { clean, marks };
}

/** A segment of the clean text (starting at `start`) with the sentinels whose position falls in [lo, hi] put back. */
function withMarks(segment: string, start: number, marks: Mark[], lo: number, hi: number): string {
  let out = "";
  let cursor = 0;
  for (const mark of marks) {
    if (mark.pos < lo || mark.pos > hi) continue;
    const at = mark.pos - start;
    out += segment.slice(cursor, at) + mark.ch;
    cursor = at;
  }
  return out + segment.slice(cursor);
}

function sameStyles(a: InlineStyle[], b: InlineStyle[]): boolean {
  return a.length === b.length && a.every((s) => b.includes(s));
}

/** Inline runs as one markdown string; a "\n" run stays a newline. */
export function inlineMarkdown(runs: InlineRun[]): string {
  return emitInline(runs);
}

function emitInline(runs: InlineRun[]): string {
  // Adjacent runs with the same styles are one run: the browser splits text
  // nodes freely, and split markers would not parse back.
  const merged: InlineRun[] = [];
  for (const run of runs) {
    if (!run.text) continue;
    const last = merged[merged.length - 1];
    if (
      last &&
      !last.chip &&
      !run.chip &&
      last.text !== "\n" &&
      run.text !== "\n" &&
      last.href === run.href &&
      sameStyles(last.styles, run.styles)
    ) {
      last.text += run.text;
    } else {
      merged.push({ ...run, styles: [...run.styles] });
    }
  }
  // A block's trailing <br> keeps an empty line's height; it is no line break.
  if (merged.length > 0 && merged[merged.length - 1].text === "\n") merged.pop();

  const keysOf = (run: InlineRun): string[] => {
    const keys: string[] = [];
    if (run.href !== undefined) keys.push(`link:${run.href}`);
    for (const s of ORDER) if (run.styles.includes(s)) keys.push(s);
    return keys;
  };
  // Italic inside bold takes underscores: "**a _b_**" parses, "**a *b***" does not.
  const marker = (key: string, keys: string[], side: 0 | 1) => {
    if (key.startsWith("link:")) return side === 0 ? "[" : `](${key.slice(5)})`;
    if (key === "italic" && keys.includes("bold")) return "_";
    return MARKERS[key as InlineStyle][side];
  };

  let out = "";
  let open: string[] = [];
  // Trailing whitespace waits until the next boundary, so a closing marker
  // hugs the word: "**a** b", never "**a **b".
  let pendingWs = "";
  const closeAll = () => {
    for (let i = open.length - 1; i >= 0; i--) out += marker(open[i], open, 1);
    open = [];
  };
  for (const run of merged) {
    if (run.text === "\n") {
      closeAll();
      out += `${pendingWs}\n`;
      pendingWs = "";
      continue;
    }
    const raw = run.chip ? `[block ${run.chip}]` : run.text;
    const { clean: text, marks } = splitMarks(raw);
    if (ALL_WS.test(text) && !run.styles.includes("code")) {
      pendingWs += raw;
      continue;
    }
    let keys = keysOf(run);
    if (keys.includes("code") && text.includes("`")) keys = keys.filter((k) => k !== "code");
    // Code keeps its spaces inside the backticks; every other marker hugs the word.
    const lead = keys.includes("code") ? "" : LEAD_WS.exec(text)![0];
    const trail = keys.includes("code") ? "" : TRAIL_WS.exec(text)![0];
    const coreEnd = text.length - trail.length;
    const core = text.slice(lead.length, coreEnd);
    let common = 0;
    while (common < open.length && common < keys.length && open[common] === keys[common]) common++;
    for (let i = open.length - 1; i >= common; i--) out += marker(open[i], open, 1);
    out += pendingWs + withMarks(lead, 0, marks, 0, lead.length - 1);
    for (let i = common; i < keys.length; i++) out += marker(keys[i], keys, 0);
    open = keys;
    out += withMarks(core, lead.length, marks, lead.length, coreEnd);
    pendingWs = withMarks(trail, coreEnd, marks, coreEnd + 1, Infinity);
  }
  closeAll();
  return out + pendingWs;
}

function inlineLines(el: Element): string[] {
  const buffer: InlineRun[] = [];
  for (const child of Array.from(el.childNodes)) collectInline(child, [], undefined, buffer);
  return emitInline(buffer).split("\n");
}

function hasBlockChild(el: Element): boolean {
  return Array.from(el.childNodes).some(isBlock);
}

function listItem(li: Element, tag: "ul" | "ol", index: number, depth: number, prefix: string, lines: string[]) {
  const marker = "  ".repeat(depth) + (tag === "ul" ? "- " : `${index}. `);
  const buffer: InlineRun[] = [];
  const nested: Element[] = [];
  for (const child of Array.from(li.childNodes)) {
    if (child.nodeType === ELEMENT_NODE && ((child as Element).tagName === "UL" || (child as Element).tagName === "OL")) {
      nested.push(child as Element);
    } else {
      collectInline(child, [], undefined, buffer);
    }
  }
  // An item is one line: a break inside it (pasted) becomes a space.
  lines.push(prefix + marker + emitInline(buffer).replace(/\s*\n\s*/g, " "));
  for (const list of nested) walkList(list, depth + 1, prefix, lines);
}

function walkList(list: Element, depth: number, prefix: string, lines: string[]) {
  const tag = list.tagName === "OL" ? "ol" : "ul";
  let index = 0;
  for (const child of Array.from(list.children)) {
    if (child.tagName === "UL" || child.tagName === "OL") {
      walkList(child, depth + 1, prefix, lines);
      continue;
    }
    index += 1;
    listItem(child, tag, index, depth, prefix, lines);
  }
}

function blockElement(el: Element, prefix: string, lines: string[]) {
  const tag = el.tagName;
  if (tag === "UL" || tag === "OL") {
    walkList(el, 0, prefix, lines);
    return;
  }
  if (tag === "LI") {
    listItem(el, "ul", 1, 0, prefix, lines);
    return;
  }
  if (tag === "BLOCKQUOTE") {
    walkBlocks(el, `${prefix}> `, lines);
    return;
  }
  const heading = /^H([1-6])$/.exec(tag);
  if (heading) {
    for (const line of inlineLines(el)) lines.push(`${prefix}${"#".repeat(Number(heading[1]))} ${line}`);
    return;
  }
  if (tag === "PRE") {
    for (const line of clean(el.textContent ?? "").replace(/\n$/, "").split("\n")) lines.push(prefix + line);
    return;
  }
  if (hasBlockChild(el)) {
    walkBlocks(el, prefix, lines);
    return;
  }
  for (const line of inlineLines(el)) lines.push(prefix + line);
}

function walkBlocks(container: Node, prefix: string, lines: string[]) {
  let buffer: InlineRun[] = [];
  const flush = () => {
    if (buffer.length === 0) return;
    const md = emitInline(buffer);
    buffer = [];
    // Whitespace between blocks (pasted HTML's indentation) is no line.
    if (md.includes("\n") && ALL_WS.test(md)) return;
    for (const line of md.split("\n")) lines.push(prefix + line);
  };
  for (const child of Array.from(container.childNodes)) {
    if (isBlock(child)) {
      flush();
      blockElement(child, prefix, lines);
    } else {
      collectInline(child, [], undefined, buffer);
    }
  }
  flush();
}

/** The editor's document as markdown. */
export function serializeNoteDoc(root: Node): string {
  const lines: string[] = [];
  walkBlocks(root, "", lines);
  if (lines.length === 0) lines.push("");
  return lines.join("\n");
}

// --- The canonical document's lines and leaves, for placing the caret.

const LINE_SELECTOR = "p, h1, h2, h3, h4, h5, h6, li";

/** The document's line elements in order: paragraphs, headings, quote lines, list items. */
export function lineElements(root: ParentNode): Element[] {
  return Array.from(root.querySelectorAll(LINE_SELECTOR));
}

/** A line's own leaves in order: text nodes and chips, nested lists left out. */
export function ownLeaves(line: Element): (Text | Element)[] {
  const leaves: (Text | Element)[] = [];
  const walk = (node: Node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === TEXT_NODE) leaves.push(child as Text);
      else if (child.nodeType === ELEMENT_NODE) {
        const el = child as Element;
        if (el.tagName === "UL" || el.tagName === "OL") continue;
        if (el.hasAttribute("data-block")) leaves.push(el);
        else walk(el);
      }
    }
  };
  walk(line);
  return leaves;
}

/** Visible length of a leaf: a chip is one ¶. */
export function leafLength(leaf: Text | Element): number {
  return leaf.nodeType === TEXT_NODE ? (leaf as Text).data.length : 1;
}

/** The text the reader sees in the canonical document: lines joined by newlines. */
export function visibleTextOfDoc(root: ParentNode): string {
  return lineElements(root)
    .map((line) =>
      ownLeaves(line)
        .map((leaf) => (leaf.nodeType === TEXT_NODE ? (leaf as Text).data : "¶"))
        .join(""),
    )
    .join("\n");
}
