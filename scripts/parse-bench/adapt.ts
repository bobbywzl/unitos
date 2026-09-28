import { JSDOM } from "jsdom";
import type { DocStyle } from "@/components/docs/extensions";
import { firstFamily, fontStack } from "@/components/docs/fonts";
import { listMarker } from "@/components/docs/toolbar/lists";
import { readStyles, sizeInPt, type NamedStyle } from "@/components/docs/toolbar/styles";
import type { RichMark, RichNode } from "@/lib/docs/schema";
import type { ParsedBlock, TextFont } from "@/lib/parse/types";
import { parseRegion, type Region } from "@/lib/video/types";
import { splitTag } from "./math";
import type { Align, Font, Fonts, RefBlock, Span } from "./model";
import { wordsOf } from "./text";

// The adapters: a parse (parsePdf's title and blocks) and an import (the
// page editor's rich text, richTextFromImport) as the reference model, so one
// set of metrics scores both. Each keeps only the words on the scored pages:
// a block joined across the range's edge keeps the words on its pages in
// range. Each block also keeps where a later page begins inside it (its
// breaks): furniture leaks at those edges.

/** Where a later page begins inside a block: its unit (a list item's index,
    else 0) and the offset in the unit's text. */
export type Break = { unit: number; at: number };
/** A footnote mark in a block: its unit, where its characters are in the
    unit's text, and the id of the footnote it links to. */
export type NoteMark = { unit: number; at: number; end: number; id: string };
export type DocBlock = RefBlock & {
  /** A figure that shows a display equation as an image: the glyph text
      the parse read from it, which the reader draws as its caption. */
  mathImage?: string;
  breaks?: Break[];
  /** A candidate's footnote: the id its marks link to. */
  id?: string;
  marks?: NoteMark[];
  /** A paragraph set as a caption (the parse's caption role), or a contents
      entry (a list or a paragraph whose lines link to headings). */
  role?: "caption" | "contents";
  /** A figure or an equation of a PDF: its page and its region there (percent of the page). */
  at?: { page: number; region: Region };
};
/** A document as the model holds it. `fonts`: a reference's fonts by role;
    a candidate's body font, the size its other roles are measured against. */
export type Doc = { blocks: DocBlock[]; fonts?: Fonts };
export type Pages = [number, number] | undefined;
type Look = Omit<Span, "text">;
type Item = Extract<RefBlock, { kind: "list" }>["items"][number];
type Row = Extract<RefBlock, { kind: "table" }>["rows"][number];

const FLAGS = ["bold", "italic", "underline", "strike", "code", "smallCaps", "sub", "sup"] as const;

/** A unit's spans as they are added: neighbors with one look join, and a
    page break and a footnote mark are kept as offsets. */
class Spans {
  readonly spans: Span[] = [];
  readonly breaks: number[] = [];
  readonly marks: Omit<NoteMark, "unit">[] = [];
  private length = 0;

  /** A footnote mark whose characters (`width` of them) come next. */
  mark(id: string, width: number) {
    this.marks.push({ at: this.length, end: this.length + width, id });
  }

  add(span: Span) {
    if (!span.text && span.latex === undefined) return;
    const last = this.spans.at(-1);
    const same =
      last &&
      last.latex === undefined &&
      span.latex === undefined &&
      last.href === span.href &&
      last.color === span.color &&
      last.highlight === span.highlight &&
      FLAGS.every((f) => last[f] === span[f]);
    if (last && same) last.text += span.text;
    else this.spans.push({ ...span });
    this.length += span.text.length;
  }

  pageBreak() {
    if (this.length > 0 && this.breaks.at(-1) !== this.length) this.breaks.push(this.length);
  }

  get hasText(): boolean {
    return this.spans.some((s) => s.text.trim() !== "" || s.latex !== undefined);
  }
}

function inRangeOf(pages: Pages) {
  return (page: number) => !pages || (page >= pages[0] && page <= pages[1]);
}

// ── Colors and fonts ────────────────────────────────────────────────────────

/** A color's channels from "#rgb", "#rrggbb", or "rgb(…)" ("rgba(…)" with
    no transparency), or null. */
function rgbOf(value: unknown): number[] | null {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(v);
  if (hex) return (hex[1].length === 3 ? [...hex[1]].map((c) => c + c) : (hex[1].match(/../g) ?? [])).map((h) => Number.parseInt(h, 16));
  const fn = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(v);
  if (!fn || (fn[4] !== undefined && Number(fn[4]) === 0)) return null;
  const rgb = [Number(fn[1]), Number(fn[2]), Number(fn[3])];
  return rgb.every((c) => c <= 255) ? rgb : null;
}

const hexOf = (rgb: number[]) => `#${rgb.map((c) => c.toString(16).padStart(2, "0")).join("")}`;

/** The words' color as "#rrggbb"; none for black and near-black (every
    channel at most 0x50: a page's ink such as #202124 or #434343). */
export function inkOf(value: unknown): string | undefined {
  const rgb = rgbOf(value);
  return rgb && !rgb.every((c) => c <= 0x50) ? hexOf(rgb) : undefined;
}

/** A fill behind words as "#rrggbb"; none for white and near-white (every
    channel at least 0xf5: the page's own ground). */
export function fillOf(value: unknown): string | undefined {
  const rgb = rgbOf(value);
  return rgb && !rgb.every((c) => c >= 0xf5) ? hexOf(rgb) : undefined;
}

/** A face's shape as the page editor draws it: the generic family its font
    stack ends with (components/docs/fonts.ts; a face it does not know draws
    sans-serif). */
export function shapeOf(family: string): Font["shape"] {
  const generic = fontStack(family).split(",").at(-1)?.trim();
  return generic === "serif" ? "serif" : generic === "monospace" ? "mono" : "sans";
}

/** The parse's font (lib/parse/types.ts TextFont) in the model's terms. */
function fontOf(font: TextFont | undefined): Font | undefined {
  if (!font || !(font.size > 0)) return undefined;
  const color = inkOf(font.color);
  return { shape: shapeOf(font.family), size: font.size, ...(font.bold ? { bold: true as const } : {}), ...(color ? { color } : {}) };
}

/** A block's alignment from its html's layout tokens (lib/parse/pdf). */
function alignOf(tokens: string[]): Align | undefined {
  return tokens.includes("center") ? "center" : tokens.includes("right") ? "right" : tokens.includes("justify") ? "justify" : undefined;
}

// ── Figures that show math ──────────────────────────────────────────────────

const CAPTION_RE = /^(?:fig(?:ure)?|table|tab|chart|graph|diagram|image|photo|exhibit|plate|scheme|listing|algorithm|source)\b/i;
const MATH_GLYPH_RE = /[\p{Sm}\p{sc=Greek}\u{1D400}-\u{1D7FF}ℂℍℕℙℚℝℤℱℒ∂∇∞′^_|]/u;

/** Does a figure's text read as a display equation, not a caption or a
    chart's labels: a tenth of its glyphs or more are math, or it ends in an
    equation number? Kept strict: a diagram's labels read as a caption count
    as words (a leak), and any figure where the reference has an equation
    still counts as an equation image. */
export function isMathText(text: string): boolean {
  const t = text.trim();
  if (!t || CAPTION_RE.test(t)) return false;
  const glyphs = [...t.replace(/\s/g, "")];
  const math = glyphs.filter((c) => MATH_GLYPH_RE.test(c)).length;
  return math / glyphs.length >= 0.1 || (math >= 1 && /\(\d{1,3}(?:\.\d{1,3})*[a-z]?\)$/.test(t));
}

/** A display equation from its LaTeX, its printed label (`\tag{…}`) apart. */
function equation(text: string): DocBlock {
  const { latex, label } = splitTag(text.trim());
  return label === null ? { kind: "equation", latex } : { kind: "equation", latex, label };
}

// ── A parse ─────────────────────────────────────────────────────────────────

/** A list line's marker as printed: a bullet glyph, a checkbox, or a
    counter ("1.", "1.2.", "a)", "a).", "(iv)", "[12]", an author-year label
    "[Bil95]", a legal "2.3.1", a number alone or starred: "10", "*15", as
    exercises are numbered), then a space. Only a LIST's lines are read this
    way. */
const MARKER_RE =
  /^(?:[-*•▪◦‣●○■□·∙–—➢❖◆★➔✓✔❏]|[☐☑☒]|\[\d{1,3}\]|\[[A-Za-z][A-Za-z+\-]{0,7}\d{2}(?:\d{2})?[a-z]?\]|\((?:\d{1,3}|[a-zA-Z]|[ivxlcdm]{1,6}|[IVXLCDM]{1,6})\)|(?:\d{1,3}(?:\.\d{1,3})*|[a-zA-Z]|[ivxlcdm]{1,6}|[IVXLCDM]{1,6})(?:[.)]|\)\.)|\d{1,3}(?:\.\d{1,3})+|\*?\d{1,3})(?=\s|$)\s*/;
/** A checklist line's box after its bullet: "- ☐ …", "- [x] …". */
const BOX_RE = /^(?:([☐☑☒])|\[([ xX])\])(?:\s+|$)/;
/** A contents entry's section number, its marker: "2", "2.1", "B", "C.4"
    (lib/parse/pdf/contents.ts reads entries so). An appendix's letter is no
    list counter anywhere else. */
const CONTENTS_MARKER_RE = /^((?:\d{1,2}|[A-Z])(?:\.\d{1,2})*[.)]?)(?:\s+|$)/;

/** The page each offset of a block's text is on. */
function pageLookup(block: ParsedBlock): (offset: number) => number {
  const starts = [{ offset: 0, page: block.page ?? 1 }, ...[...(block.pageStarts ?? [])].sort((a, b) => a.offset - b.offset)];
  return (offset) => {
    let page = starts[0].page;
    for (const s of starts) if (s.offset <= offset) page = s.page;
    return page;
  };
}

/** The spans of block text from `from` to `to`: its style and link spans,
    cut where a page begins, only the words on pages in range. An inline
    formula (a math span) is one span that carries its LaTeX, never cut. A
    footnote reference is a mark that links to its footnote's block. */
function textSpans(block: ParsedBlock, from: number, to: number, pageAt: (o: number) => number, inRange: (p: number) => boolean, into: Spans) {
  const clamp = (n: number) => Math.max(from, Math.min(to, n));
  const cuts = new Set<number>([from, to]);
  for (const s of block.styles ?? []) [s.start, s.end].forEach((n) => cuts.add(clamp(n)));
  for (const l of block.links ?? []) if (l.href) [l.start, l.end].forEach((n) => cuts.add(clamp(n)));
  for (const p of block.pageStarts ?? []) cuts.add(clamp(p.offset));
  const refs = (block.footnoteRefs ?? []).filter((r) => r.start >= from && r.start < to);
  for (const r of refs) cuts.add(r.start);
  const math = (block.math ?? []).filter((m) => m.end > from && m.start < to);
  for (const m of math) [m.start, m.end].forEach((n) => cuts.add(clamp(n)));
  const points = [...cuts].filter((n) => !math.some((m) => n > m.start && n < m.end)).sort((a, b) => a - b);
  let page = pageAt(from);
  for (let k = 0; k + 1 < points.length; k++) {
    const [a, b] = [points[k], points[k + 1]];
    if (a >= b || !inRange(pageAt(a))) continue;
    if (pageAt(a) !== page) {
      page = pageAt(a);
      into.pageBreak();
    }
    for (const r of refs) if (r.start === a) into.mark(`b${r.targetOrder}`, Math.min(r.end, to) - r.start);
    const formula = math.find((m) => m.start <= a && m.end >= b);
    if (formula) {
      into.add({ text: block.text.slice(a, b), latex: formula.latex });
      continue;
    }
    const span: Span = { text: block.text.slice(a, b) };
    for (const s of block.styles ?? []) {
      if (s.start > a || s.end < b) continue;
      const flag = FLAGS.find((f) => f === s.style);
      if (flag) span[flag] = true;
      const color = s.style.startsWith("color:") ? inkOf(s.style.slice("color:".length)) : undefined;
      const fill = s.style.startsWith("highlight:") ? fillOf(s.style.slice("highlight:".length)) : undefined;
      if (color) span.color = color;
      if (fill) span.highlight = fill;
    }
    const href = block.links?.find((l) => l.href && l.start <= a && l.end >= b)?.href;
    if (href) span.href = href;
    into.add(span);
  }
}

function classTokens(html: string | undefined): string[] {
  const m = /^<[a-z][a-z0-9]*\b[^>]*\bclass="([^"]*)"/i.exec(html ?? "");
  return m ? m[1].split(/\s+/).filter(Boolean) : [];
}

function level(value: number): 1 | 2 | 3 | 4 | 5 | 6 {
  return Math.min(6, Math.max(1, Math.round(value) || 2)) as 1 | 2 | 3 | 4 | 5 | 6;
}

let scratch: Document | null = null;

/** A table's html as rows of cells, each cell's words with their bold,
    italic, underline, code, sub, sup, and links; an inline formula (the
    page editor's inline-math html) is a span of its readable characters
    that carries its TeX. */
function htmlRows(html: string): { rows: Row[]; caption: Span[] | null; font?: Font } | null {
  scratch ??= new JSDOM("<!doctype html><body></body>").window.document;
  const host = scratch.createElement("div");
  host.innerHTML = html;
  const table = host.querySelector("table");
  if (!table) return null;
  const read = (node: Node, look: Look, into: Spans) => {
    if (node.nodeType === 3) return into.add({ ...look, text: node.textContent ?? "" });
    if (node.nodeType !== 1) return;
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    if (el.classList.contains("cell-gap") || tag === "script" || tag === "style") return;
    if (tag === "br") return into.add({ ...look, text: "\n" });
    const latex = el.getAttribute("data-type") === "inline-math" ? el.getAttribute("data-latex") : null;
    if (latex) return into.add({ text: el.textContent ?? "", latex });
    const next: Look = { ...look };
    if (tag === "strong" || tag === "b") next.bold = true;
    if (tag === "em" || tag === "i") next.italic = true;
    if (tag === "u") next.underline = true;
    if (tag === "s" || tag === "strike" || tag === "del") next.strike = true;
    // A span's own color, fill, and small caps (a Word table's colored words; a
    // table caption's html from tables.ts).
    const style = (el as HTMLElement).style;
    const color = style ? inkOf(style.color) : undefined;
    const fill = style ? fillOf(style.backgroundColor) : undefined;
    if (color) next.color = color;
    if (fill) next.highlight = fill;
    if (style?.fontVariant === "small-caps") next.smallCaps = true;
    if (tag === "sub") next.sub = true;
    if (tag === "sup") next.sup = true;
    if (tag === "code" || tag === "kbd" || tag === "tt" || tag === "samp") next.code = true;
    const href = tag === "a" ? el.getAttribute("href") : null;
    if (href) next.href = href;
    for (const child of el.childNodes) read(child, next, into);
    if (/^(p|div|li|h[1-6])$/.test(tag)) into.add({ ...look, text: " " });
  };
  const rows: Row[] = [...table.querySelectorAll("tr")]
    .filter((tr) => tr.closest("table") === table)
    .map((tr) => ({
      cells: [...tr.children]
        .filter((c) => /^(td|th)$/i.test(c.tagName))
        .map((c) => {
          const into = new Spans();
          read(c, {}, into);
          const cell: Row["cells"][number] = { spans: into.spans };
          if (c.tagName.toLowerCase() === "th") cell.header = true;
          const colspan = Number(c.getAttribute("colspan") ?? 1);
          const rowspan = Number(c.getAttribute("rowspan") ?? 1);
          if (colspan > 1) cell.colspan = colspan;
          if (rowspan > 1) cell.rowspan = rowspan;
          return cell;
        }),
    }));
  const captionEl = table.querySelector("caption");
  let caption: Span[] | null = null;
  let font: Font | undefined;
  if (captionEl) {
    const into = new Spans();
    read(captionEl, {}, into);
    caption = into.hasText ? into.spans : null;
    // The caption's face and size ride on its span (the parse's
    // attachTableCaptions, tables.ts); it is bold when most of its
    // characters are.
    const look = (captionEl.querySelector("span[style]") as HTMLElement | null)?.style;
    const size = parseFloat(look?.fontSize ?? "");
    const chars = (caption ?? []).reduce((n, s) => n + s.text.length, 0);
    const bold = (caption ?? []).filter((s) => s.bold).reduce((n, s) => n + s.text.length, 0) * 2 > chars;
    if (look?.fontFamily && size > 0) font = { shape: shapeOf(look.fontFamily), size, ...(bold ? { bold: true as const } : {}) };
  }
  return { rows, caption, ...(font ? { font } : {}) };
}

function parseList(block: ParsedBlock, pageAt: (o: number) => number, inRange: (p: number) => boolean, contents: boolean): DocBlock | null {
  const items: Item[] = [];
  const breaks: Break[] = [];
  const marks: NoteMark[] = [];
  let from = 0;
  for (const line of block.text.split("\n")) {
    const start = from;
    from += line.length + 1;
    const indent = /^ */.exec(line)?.[0].length ?? 0;
    const m = (contents ? CONTENTS_MARKER_RE : MARKER_RE).exec(line.slice(indent));
    let marker = m?.[0].trim() ?? "";
    let cut = indent + (m?.[0].length ?? 0);
    const box = !marker || /^[-*•]$/.test(marker) ? BOX_RE.exec(line.slice(cut)) : null;
    if (box) {
      marker = box[1] ?? (box[2] === " " ? "☐" : "☑");
      cut += box[0].length;
    }
    const into = new Spans();
    textSpans(block, start + cut, start + line.length, pageAt, inRange, into);
    if (!into.hasText) continue;
    const item: Item = { depth: Math.floor(indent / 2), marker, spans: into.spans };
    if (/^[☐☑☒]$/.test(marker)) item.checked = marker !== "☐";
    for (const at of into.breaks) breaks.push({ unit: items.length, at });
    for (const m of into.marks) marks.push({ unit: items.length, ...m });
    items.push(item);
  }
  if (items.length === 0) return null;
  return { kind: "list", items, ...(breaks.length > 0 ? { breaks } : {}), ...(marks.length > 0 ? { marks } : {}) };
}

function parseTable(block: ParsedBlock, pageAt: (o: number) => number, inRange: (p: number) => boolean): DocBlock | null {
  const lines = block.text.split("\n");
  const fromHtml = block.html ? htmlRows(block.html) : null;
  const rows: Row[] = fromHtml?.rows ?? lines.map((line) => ({ cells: line.split("\t").map((cell) => ({ spans: cell ? [{ text: cell }] : [] })) }));
  // A line of the text is a row, the caption's line first when the text
  // holds one: row r is on the page its line begins on, and the caption on
  // its own line's page.
  const lineStarts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    lineStarts.push(offset);
    offset += line.length + 1;
  }
  const captionLine = fromHtml?.caption && lines.length === rows.length + 1 ? 1 : 0;
  const onPage = (line: number) => inRange(pageAt(lineStarts[Math.min(line, lineStarts.length - 1)] ?? 0));
  const kept = rows.filter((_, r) => onPage(r + captionLine));
  if (!kept.some((row) => row.cells.some((cell) => cell.spans.some((s) => s.text.trim() || s.latex !== undefined)))) return null;
  const caption = fromHtml?.caption && (captionLine === 0 || onPage(0)) ? { caption: fromHtml.caption, ...(fromHtml.font ? { font: fromHtml.font } : {}) } : {};
  // Footnote references in cells: a tab ends a cell; a mark's unit is its
  // cell's place among the kept rows' cells.
  const marks: NoteMark[] = [];
  for (const ref of block.footnoteRefs ?? []) {
    const line = block.text.slice(0, ref.start).split("\n").length - 1;
    const lineStart = lineStarts[line] ?? 0;
    const before = block.text.slice(lineStart, ref.start);
    const cellStart = lineStart + before.lastIndexOf("\t") + 1;
    const mark = { at: ref.start - cellStart, end: ref.end - cellStart, id: `b${ref.targetOrder}` };
    if (line < captionLine) {
      if ("caption" in caption) marks.push({ unit: -1, ...mark });
      continue;
    }
    const row = rows[line - captionLine];
    const slot = before.split("\t").length - 1;
    if (!row || !kept.includes(row) || slot >= row.cells.length) continue;
    const unit = kept.slice(0, kept.indexOf(row)).reduce((n, r) => n + r.cells.length, 0) + slot;
    marks.push({ unit, ...mark });
  }
  return { kind: "table", ...caption, rows: kept, ...(marks.length > 0 ? { marks } : {}) };
}

function parseBlock(block: ParsedBlock, index: number, inRange: (p: number) => boolean): DocBlock | null {
  const pageAt = pageLookup(block);
  const whole = inRange(block.page ?? 1);
  const text = block.text;
  const spansOf = (from = 0) => {
    const into = new Spans();
    textSpans(block, from, text.length, pageAt, inRange, into);
    return into;
  };
  // A one-unit block's page breaks and footnote marks.
  const breaks = (into: Spans) => ({
    ...(into.breaks.length > 0 ? { breaks: into.breaks.map((at) => ({ unit: 0, at })) } : {}),
    ...(into.marks.length > 0 ? { marks: into.marks.map((m) => ({ unit: 0, ...m })) } : {}),
  });
  const at = block.region && block.page ? { at: { page: block.page, region: block.region } } : {};
  // The look most of the block's characters take (lib/parse/pdf, R2's fonts).
  const face = fontOf(block.font);
  const font = face ? { font: face } : {};
  const tokens = classTokens(block.html);
  const align = alignOf(tokens);
  if (block.footnote) {
    // A footnote's text opens with its label, which the model keeps apart.
    const label = block.footnote.label;
    const from = label && text.startsWith(label) ? label.length + (/^\s*/.exec(text.slice(label.length))?.[0].length ?? 0) : 0;
    const into = spansOf(from);
    return into.hasText ? { kind: "footnote", label, spans: into.spans, id: `b${index}`, ...font, ...breaks(into) } : null;
  }
  switch (block.type) {
    case "HEADING": {
      const into = spansOf();
      const n = Number(/^<h([1-6])/i.exec(block.html ?? "")?.[1] ?? 2);
      return into.hasText ? { kind: "heading", level: level(n), spans: into.spans, ...(align ? { align } : {}), ...font, ...breaks(into) } : null;
    }
    case "LIST": {
      // A contents list: its class, or lines that link to headings (the converter's test).
      const contents = /\bclass="[^"]*\bcontents\b/.test(block.html ?? "") || (block.links ?? []).some((l) => l.targetOrder !== undefined);
      const list = parseList(block, pageAt, inRange, contents);
      return list ? { ...list, ...font, ...(contents ? { role: "contents" as const } : {}) } : null;
    }
    case "TABLE":
      return parseTable(block, pageAt, inRange);
    case "EQUATION":
      return whole && text.trim() ? { ...equation(text), ...at } : null;
    case "FIGURE": {
      if (!whole) return null;
      if (isMathText(text)) return { kind: "figure", mathImage: text.trim(), ...at };
      const into = spansOf();
      return into.hasText ? { kind: "figure", caption: into.spans, ...font, ...at } : { kind: "figure", ...at };
    }
    case "CODE": {
      const into = spansOf();
      const code = into.spans.map((s) => s.text).join("");
      return code.trim() ? { kind: "code", text: code } : null;
    }
    case "SEPARATOR":
      return whole ? { kind: "separator" } : null;
    default: {
      const into = spansOf();
      if (!into.hasText) return null;
      if (tokens.includes("quote")) return { kind: "quote", spans: into.spans, ...breaks(into) };
      const indent = tokens.includes("indent-first") ? "first" : tokens.includes("indent-hanging") ? "hanging" : tokens.includes("indent-block") ? "block" : undefined;
      return {
        kind: "paragraph",
        spans: into.spans,
        ...(align ? { align } : {}),
        ...(indent ? { indent } : {}),
        ...(tokens.includes("caption") ? { role: "caption" as const } : {}),
        ...font,
        ...breaks(into),
      };
    }
  }
}

/** A parse as the reference model, cut to the scored pages. The title the
    parse found (it drops the heading it came from) is the first block. */
export function fromParse(
  parsed: { title: string | null; blocks: ParsedBlock[]; bodyFont?: TextFont; titleFont?: TextFont; titleAlign?: "center" | "right" },
  pages?: Pages,
): Doc {
  const inRange = inRangeOf(pages);
  const blocks: DocBlock[] = [];
  if (parsed.title?.trim() && inRange(1)) {
    const font = fontOf(parsed.titleFont);
    blocks.push({ kind: "title", spans: [{ text: parsed.title }], ...(parsed.titleAlign ? { align: parsed.titleAlign } : {}), ...(font ? { font } : {}) });
  }
  parsed.blocks.forEach((block, index) => {
    const out = parseBlock(block, index, inRange);
    if (out) blocks.push(out);
  });
  const body = fontOf(parsed.bodyFont);
  return body ? { blocks, fonts: { body } } : { blocks };
}

// ── An import ───────────────────────────────────────────────────────────────

const LISTS = new Set(["bulletList", "orderedList", "taskList"]);
const CHIPS = new Set(["dateChip", "personChip", "fileChip", "dropdownChip"]);
/** The page editor's indent step, in points (components/docs/extensions.ts). */
const INDENT_PT = 36;

function lookOf(marks: RichMark[] | undefined): Look {
  const look: Look = {};
  for (const mark of marks ?? []) {
    if (mark.type === "bold" || mark.type === "italic" || mark.type === "underline" || mark.type === "strike" || mark.type === "code") look[mark.type] = true;
    if (mark.type === "subscript") look.sub = true;
    if (mark.type === "superscript") look.sup = true;
    if (mark.type === "smallCaps" || (mark.type === "textStyle" && String(mark.attrs?.fontVariant ?? "").includes("small-caps"))) look.smallCaps = true;
    if (mark.type === "link" && typeof mark.attrs?.href === "string") look.href = mark.attrs.href;
    if (mark.type === "textStyle") {
      const color = inkOf(mark.attrs?.color);
      const fill = fillOf(mark.attrs?.backgroundColor);
      if (color) look.color = color;
      if (fill) look.highlight = fill;
    }
  }
  return look;
}

/** The page editor's own sizes where its CSS sets one (components/docs/css):
    footnotes at 10 pt; a PDF figure's caption at 0.8rem, in gray. */
const FOOTNOTE_PT = 10;
const FIGURE_CAPTION: Omit<Font, "shape"> = { size: 9.6, color: "#666666" };

/** An alignment the page editor draws: a paragraph's own, else its named style's. */
function alignValue(value: unknown): Align | undefined {
  return value === "center" || value === "right" || value === "justify" ? value : undefined;
}

/** A caption's label and number: "Fig. 3.", "Figure 2:", "Table IV", "表 1". */
const CAPTION_LABEL_RE = /^\s*(?:fig(?:ure)?\.?|table|tab\.|scheme|chart|exhibit|plate|図表?|表)\s*[\dIVXLivxl]+/i;

/** A paragraph this long is the body's: the front matter's lines are shorter. */
const BODY_CHARS = 200;

/** A note symbol the converter set as an inline formula ("\\dagger"). */
const NOTE_SYMBOLS: Record<string, string> = { "\\dagger": "†", "\\ddagger": "‡", "\\S": "§", "\\P": "¶", "\\|": "‖", "\\parallel": "∥", "\\star": "⋆", "\\ast": "∗", "*": "*" };

/** A footnote the converter could not link to its mark: a paragraph set
    in one small size throughout that opens with its label raised ("² Two of
    the top ten…"), as the parse view reads it, or with a note symbol on the
    line ("* All costs are in U.S. dollars.", a table's note under MMWR's
    tables; the converter may set the symbol as an inline formula). Only
    once the body has begun (ImportReader.begun), or right under a table: an
    affiliation under the authors opens with a raised number in a small size
    too. */
function unlinkedNote(node: RichNode): { label: string; rest: RichNode } | null {
  const content = node.content ?? [];
  // Page starts before the label stay with the words.
  const at = content.findIndex((c) => c.type !== "pageStart");
  const first = content[at];
  if (!content.every((c) => c.type !== "text" || c.marks?.some((m) => m.type === "textStyle" && m.attrs?.fontSize))) return null;
  const after = (from: number) => {
    const next = content[from];
    return next?.type === "text" ? [{ ...next, text: (next.text ?? "").trimStart() }, ...content.slice(from + 1)] : content.slice(from);
  };
  if (first?.type === "inlineMath") {
    const label = NOTE_SYMBOLS[String(first.attrs?.latex ?? "").trim()];
    return label && content.some((c) => c.type === "text" && c.text?.trim()) ? { label, rest: { ...node, content: [...content.slice(0, at), ...after(at + 1)] } } : null;
  }
  if (first?.type !== "text") return null;
  const text = first.text ?? "";
  if (first.marks?.some((m) => m.type === "superscript")) {
    const label = text.trim();
    if (!/^(?:\d{1,3}|[*∗†‡§¶‖∥⋆#]{1,4})$/.test(label)) return null;
    return { label, rest: { ...node, content: [...content.slice(0, at), ...after(at + 1)] } };
  }
  const symbol = /^([*∗†‡§¶‖∥⋆])\1?(?=\s)/.exec(text);
  if (!symbol) return null;
  const rest = text.slice(symbol[0].length).trimStart();
  return { label: symbol[0], rest: { ...node, content: [...content.slice(0, at), ...(rest ? [{ ...first, text: rest }] : []), ...content.slice(at + 1)] } };
}

/** A paragraph set the way the converter sets a table's caption
    (lib/docs/import.ts table(), SPEC.md §30): centered, every run given its
    size (9 pt, which is the body's own size on a page set in 9 pt). It is
    the caption only right before its table (ImportReader.settle). */
function isCaption(node: RichNode): boolean {
  const runs = (node.content ?? []).filter((c) => c.type === "text");
  const sized = (c: RichNode) => sizeInPt(c.marks?.find((m) => m.type === "textStyle")?.attrs?.fontSize) !== null;
  return node.attrs?.textAlign === "center" && runs.length > 0 && runs.every(sized);
}

/** A paragraph's indentation from the page editor's attributes: a first
    line set in, set out (hanging), or the whole paragraph set in. */
function indentOf(attrs: Record<string, unknown> | undefined): "first" | "hanging" | "block" | undefined {
  const first = Number(attrs?.indentFirstLine ?? 0) || 0;
  const left = Number(attrs?.indentLeft ?? 0) || 0;
  return first > 0 ? "first" : first < 0 ? "hanging" : left > 0 ? "block" : undefined;
}

class ImportReader {
  readonly blocks: DocBlock[] = [];
  private page = 1;
  /** The body has begun: a paragraph of BODY_CHARS or more is placed (past the title, the authors, and their affiliations). */
  private begun = false;
  private readonly inRange: (p: number) => boolean;
  /** Each footnote's number as the page editor draws it (1, 2, … in the
      order of the references) and the page its reference stands on: the
      footnotes sit at the document's end, their words on that page. */
  private readonly notes = new Map<string, { n: number; page: number }>();
  /** Paragraphs taken for contents entries because they read like headings: kept only in runs of three. */
  readonly headingLike = new Set<DocBlock>();
  /** A contents entry's depth: its left indent in the page editor's steps. */
  readonly entryDepth = new Map<DocBlock, number>();

  /** `labels`: the page's own mark for a footnote id, where a reference
      gives it (printedLabels); `headings`: the words of every heading of the
      document, on any page (a contents entry reads like one). */
  constructor(
    pages: Pages,
    private readonly styles: Record<DocStyle, NamedStyle>,
    private readonly labels = new Map<string, string>(),
    private readonly headings = new Set<string>(),
  ) {
    this.inRange = inRangeOf(pages);
  }

  /** A text node's font as the page editor draws it: its named style (the
      document's own, SPEC.md §29) under the textStyle marks most of its
      characters carry, and bold where most of them are. `size`: the size
      the page editor's CSS sets instead of the style's (a footnote's). */
  faceOf(node: RichNode, style: DocStyle, size?: number): Font {
    const named = this.styles[style];
    const family = named.font ?? this.styles.normal.font ?? "Arial";
    const tally = { family: new Map<string, number>(), size: new Map<number, number>(), color: new Map<string, number>(), bold: 0, total: 0 };
    const add = <K>(map: Map<K, number>, key: K, n: number) => map.set(key, (map.get(key) ?? 0) + n);
    const visit = (n: RichNode) => {
      if (n.type === "text") {
        const w = (n.text ?? "").length;
        const attrs = n.marks?.find((m) => m.type === "textStyle")?.attrs;
        add(tally.family, firstFamily(typeof attrs?.fontFamily === "string" ? attrs.fontFamily : null) ?? family, w);
        add(tally.size, sizeInPt(attrs?.fontSize) ?? size ?? named.size, w);
        add(tally.color, inkOf(attrs?.color ?? named.color) ?? "", w);
        if (named.bold || n.marks?.some((m) => m.type === "bold")) tally.bold += w;
        tally.total += w;
      }
      for (const child of n.content ?? []) visit(child);
    };
    visit(node);
    const most = <K>(map: Map<K, number>, fallback: K): K => [...map].sort((a, b) => b[1] - a[1])[0]?.[0] ?? fallback;
    const color = most(tally.color, inkOf(named.color) ?? "");
    const bold = tally.total > 0 ? tally.bold * 2 > tally.total : named.bold;
    return { shape: shapeOf(most(tally.family, family)), size: most(tally.size, size ?? named.size), ...(bold ? { bold: true as const } : {}), ...(color ? { color } : {}) };
  }

  /** A block's alignment as drawn: its own, else its named style's. */
  private alignOf(node: RichNode, style: DocStyle): Align | undefined {
    return alignValue(node.attrs?.textAlign) ?? alignValue(this.styles[style].align);
  }

  private here(): boolean {
    return this.inRange(this.page);
  }

  /** A node's inline content into spans, following its page starts. */
  private inline(node: RichNode, into: Spans) {
    for (const child of node.content ?? []) {
      if (child.type === "pageStart") {
        const page = child.attrs?.page;
        if (typeof page === "number" && page !== this.page) {
          this.page = page;
          into.pageBreak();
        }
      } else if (child.type === "text") {
        if (this.here()) into.add({ ...lookOf(child.marks), text: child.text ?? "" });
      } else if (child.type === "hardBreak") {
        if (this.here()) into.add({ text: "\n" });
      } else if (child.type === "inlineMath") {
        if (this.here()) into.add({ text: "", latex: String(child.attrs?.latex ?? "") });
      } else if (child.type === "footnoteReference") {
        // The number the page editor draws, raised, and a mark that links it.
        const id = String(child.attrs?.footnoteId ?? "");
        let note = this.notes.get(id);
        if (!note) this.notes.set(id, (note = { n: this.notes.size + 1, page: this.page }));
        if (this.here()) {
          const text = this.labels.get(id) ?? String(note.n);
          into.mark(id, text.length);
          into.add({ text, sup: true });
        }
      } else if (CHIPS.has(child.type)) {
        if (this.here() && typeof child.attrs?.label === "string") into.add({ text: child.attrs.label });
      } else {
        this.inline(child, into);
      }
    }
  }

  /** A container's words (a cell, a list item's later blocks): its
      paragraphs one after another, a line break between. */
  private words(node: RichNode, into: Spans) {
    (node.content ?? []).forEach((child, i) => {
      if (i > 0) into.add({ text: "\n" });
      if (child.type === "paragraph" || child.type === "heading" || child.type === "codeBlock") this.inline(child, into);
      else this.words(child, into);
    });
  }

  /** A caption-set paragraph right before a table is the table's caption
      when table() takes it (a caption's label, or a size under the body's).
      Elsewhere it is a caption only when it opens with a caption's label
      ("Fig. 3.", "Table 2:", a figure's caption the converter could not
      attach); else it is a paragraph (a centered small line under a title). */
  settle() {
    const last = this.blocks.at(-1);
    if (last?.kind === "paragraph" && last.role === "caption" && !CAPTION_LABEL_RE.test(last.spans.map((span) => span.text).join(""))) delete last.role;
  }

  private push(block: DocBlock, into?: Spans) {
    this.settle();
    if (block.kind === "paragraph" && block.spans.reduce((n, span) => n + span.text.length, 0) >= BODY_CHARS) this.begun = true;
    if (into && into.breaks.length > 0) block.breaks = into.breaks.map((at) => ({ unit: 0, at }));
    if (into && into.marks.length > 0) block.marks = into.marks.map((m) => ({ unit: 0, ...m }));
    this.blocks.push(block);
  }

  /** A footnote, on the page of its reference, numbered as drawn. */
  private footnote(node: RichNode) {
    const id = String(node.attrs?.footnoteId ?? "");
    const note = this.notes.get(id);
    const page = this.page;
    if (note) this.page = note.page;
    const into = new Spans();
    this.words(node, into);
    this.page = page;
    const font = this.faceOf(node, "normal", FOOTNOTE_PT);
    if (into.hasText) this.push({ kind: "footnote", label: this.labels.get(id) ?? (note ? String(note.n) : ""), spans: into.spans, id, font }, into);
  }

  node(node: RichNode, quoted: boolean) {
    if (typeof node.attrs?.pageStart === "number") this.page = node.attrs.pageStart;
    switch (node.type) {
      case "paragraph":
      case "heading": {
        // A table's note stands right under the table, wherever the body stands.
        const note = node.type === "paragraph" && (this.begun || this.blocks.at(-1)?.kind === "table") ? unlinkedNote(node) : null;
        if (note) {
          const into = new Spans();
          this.inline(note.rest, into);
          if (into.hasText) this.push({ kind: "footnote", label: note.label, spans: into.spans, font: this.faceOf(note.rest, "normal") }, into);
          return;
        }
        const into = new Spans();
        this.inline(node, into);
        if (!into.hasText) return;
        const heading = node.type === "heading" ? level(Number(node.attrs?.level)) : null;
        const style: DocStyle = heading ? `h${heading}` : node.attrs?.docStyle === "title" ? "title" : node.attrs?.docStyle === "subtitle" ? "subtitle" : "normal";
        const align = this.alignOf(node, style);
        const drawn = { ...(align ? { align } : {}), font: this.faceOf(node, style) };
        if (heading) return this.push({ kind: "heading", level: heading, spans: into.spans, ...drawn }, into);
        if (style === "title") return this.push({ kind: "title", spans: into.spans, ...drawn }, into);
        if (quoted) return this.push({ kind: "quote", spans: into.spans }, into);
        const indent = indentOf(node.attrs);
        // A contents entry: a paragraph that links to a heading, or one of
        // three or more in a row that read like headings, page numbers aside
        // (a contents list the converter could not link; a running head that
        // leaks reads like a heading too, but alone).
        const words = wordsOf(into.spans.map((span) => span.text).join("")).map((w) => w.w);
        const linked = into.spans.some((span) => span.href?.startsWith("#heading="));
        const like = this.headings.has(words.join(" ")) || (/^\d+$/.test(words.at(-1) ?? "") && this.headings.has(words.slice(0, -1).join(" ")));
        const role = linked || like ? ("contents" as const) : isCaption(node) ? ("caption" as const) : undefined;
        const block: DocBlock = { kind: "paragraph", spans: into.spans, ...(indent ? { indent } : {}), ...(role ? { role } : {}), ...drawn };
        if (like && !linked) this.headingLike.add(block);
        if (linked || like) this.entryDepth.set(block, Math.max(0, Math.round((Number(node.attrs?.indentLeft ?? 0) || 0) / INDENT_PT)));
        return this.push(block, into);
      }
      case "bulletList":
      case "orderedList":
      case "taskList":
        return this.list(node);
      case "table":
        return this.table(node);
      case "blockMath":
        if (this.here()) this.push(equation(String(node.attrs?.latex ?? "")));
        return;
      case "figure": {
        if (!this.here()) return;
        const caption = typeof node.attrs?.caption === "string" ? node.attrs.caption : "";
        // The converter keeps a PDF figure's page and region (a JSON string): the glyph check reads them.
        const region = typeof node.attrs?.region === "string" ? parseRegion(JSON.parse(node.attrs.region)) : null;
        const at = region && typeof node.attrs?.page === "number" ? { at: { page: node.attrs.page, region } } : {};
        if (isMathText(caption)) return this.push({ kind: "figure", mathImage: caption.trim(), ...at });
        const font: Font = { shape: shapeOf(this.styles.normal.font ?? "Arial"), ...FIGURE_CAPTION };
        return this.push(caption.trim() ? { kind: "figure", caption: [{ text: caption }], font, ...at } : { kind: "figure", ...at });
      }
      case "image":
        if (this.here()) this.push({ kind: "figure" });
        return;
      case "codeBlock": {
        const into = new Spans();
        this.inline(node, into);
        const code = into.spans.map((s) => s.text).join("");
        if (code.trim()) this.push({ kind: "code", text: code });
        return;
      }
      case "horizontalRule":
        if (this.here()) this.push({ kind: "separator" });
        return;
      case "footnotes":
        for (const child of node.content ?? []) this.footnote(child);
        return;
      case "footnote":
        return this.footnote(node);
      default:
        for (const child of node.content ?? []) this.node(child, quoted || node.type === "blockquote");
    }
  }

  /** A list's items, by depth. An item's first block is its words; a later
      paragraph or heading in it is drawn as its own block, with its own
      alignment (a centered label under an item's fill-in line), so it is
      read as its own block between two lists, and the items after it keep
      their depth. The item's other later blocks join its words. */
  private list(node: RichNode) {
    const font = this.faceOf(node, "normal");
    let items: Item[] = [];
    let breaks: Break[] = [];
    let marks: NoteMark[] = [];
    const flush = () => {
      if (items.length > 0) this.settle();
      if (items.length > 0) this.blocks.push({ kind: "list", items, font, ...(breaks.length > 0 ? { breaks } : {}), ...(marks.length > 0 ? { marks } : {}) });
      [items, breaks, marks] = [[], [], []];
    };
    const own = (child: RichNode) => child.type === "paragraph" || child.type === "heading";
    // Each line's number at each level, from the outermost list down: the
    // page editor draws a numbered line's marker from them and the outermost
    // list's level formats (listMarker).
    const visit = (list: RichNode, depth: number, above: number[]) => {
      const start = Number(list.attrs?.start ?? 1) || 1;
      (list.content ?? []).forEach((item, index) => {
        const numbers = [...above, start + index];
        const children = item.content ?? [];
        const lead = children.findIndex((child) => !LISTS.has(child.type));
        const into = new Spans();
        children.forEach((child, k) => {
          if (LISTS.has(child.type) || (k > lead && own(child))) return;
          if (k > lead) into.add({ text: " " });
          if (child.type === "paragraph") this.inline(child, into);
          else this.words(child, into);
        });
        if (into.hasText) {
          const checked = item.attrs?.checked === true;
          const marker =
            list.type === "taskList" ? (checked ? "☑" : "☐") : list.type === "orderedList" ? listMarker(node, numbers) : "•";
          for (const at of into.breaks) breaks.push({ unit: items.length, at });
          for (const m of into.marks) marks.push({ unit: items.length, ...m });
          items.push(list.type === "taskList" ? { depth, marker, spans: into.spans, checked } : { depth, marker, spans: into.spans });
        }
        children.forEach((child, k) => {
          if (LISTS.has(child.type)) visit(child, depth + 1, numbers);
          else if (k > lead && own(child)) {
            flush();
            this.node(child, false);
          }
        });
      });
    };
    visit(node, 0, []);
    flush();
  }

  private table(node: RichNode) {
    const rows: Row[] = [];
    // Footnote marks by the cell's place among the table's cells.
    const marks: NoteMark[] = [];
    let index = 0;
    for (const tr of node.content ?? []) {
      const cells: Row["cells"] = [];
      const rowMarks: Omit<NoteMark, "unit">[][] = [];
      for (const cell of tr.content ?? []) {
        const into = new Spans();
        this.words(cell, into);
        const out: Row["cells"][number] = { spans: into.spans };
        if (cell.type === "tableHeader") out.header = true;
        const colspan = Number(cell.attrs?.colspan ?? 1);
        const rowspan = Number(cell.attrs?.rowspan ?? 1);
        if (colspan > 1) out.colspan = colspan;
        if (rowspan > 1) out.rowspan = rowspan;
        cells.push(out);
        rowMarks.push(into.marks);
      }
      // A row whose words are all on pages out of range is not scored.
      if (cells.some((c) => c.spans.some((s) => s.text.trim() || s.latex !== undefined)) || this.here()) {
        rows.push({ cells });
        for (const list of rowMarks) {
          for (const m of list) marks.push({ unit: index, ...m });
          index++;
        }
      }
    }
    // A table of formulas holds no words, but it is a table.
    if (!rows.some((row) => row.cells.some((c) => c.spans.some((s) => s.text.trim() || s.latex !== undefined)))) return;
    // The converter sets a table's caption as a caption paragraph right before it.
    // The line right before is the table's caption when it opens with a
    // caption's label or is set smaller than the body (the converter's 9 pt);
    // a centered line in the body's size or larger ("(In millions…)" over a
    // statement) is a paragraph.
    const before = this.blocks.at(-1);
    const labeled = (b: DocBlock) => b.kind === "paragraph" && CAPTION_LABEL_RE.test(b.spans.map((span) => span.text).join(""));
    const smaller = (b: DocBlock) => b.kind === "paragraph" && b.font !== undefined && b.font.size < this.styles.normal.size;
    const caption = before?.kind === "paragraph" && before.role === "caption" && (labeled(before) || smaller(before)) ? before : null;
    if (before?.kind === "paragraph" && before.role === "caption" && !caption) delete before.role;
    if (caption) {
      this.blocks.pop();
      for (const m of caption.marks ?? []) marks.push({ ...m, unit: -1 });
    }
    this.blocks.push({ kind: "table", ...(caption ? { caption: caption.spans, ...(caption.font ? { font: caption.font } : {}) } : {}), rows, ...(marks.length > 0 ? { marks } : {}) });
  }
}

/** An import's rich text as the reference model, cut to the scored pages.
    `printed`: the reference's footnotes, whose marks the import's take. */
export function fromImport(doc: RichNode, pages?: Pages, printed?: PrintedNote[]): Doc {
  const headings = new Set<string>();
  const textOf = (node: RichNode): string => (node.type === "text" ? (node.text ?? "") : (node.content ?? []).map(textOf).join(""));
  const visit = (node: RichNode) => {
    if (node.type === "heading") headings.add(wordsOf(textOf(node)).map((w) => w.w).join(" "));
    else for (const child of node.content ?? []) visit(child);
  };
  visit(doc);
  headings.delete("");
  const styles = readStyles({ attrs: doc.attrs ?? {} });
  const reader = new ImportReader(pages, styles, printed ? printedLabels(doc, printed) : undefined, headings);
  for (const node of doc.content ?? []) reader.node(node, false);
  reader.settle();
  const blocks = reader.blocks;
  for (let i = 0; i < blocks.length; ) {
    let j = i;
    while (j < blocks.length && blocks[j].role === "contents") j++;
    if (j - i < 3) for (let k = i; k < j; k++) if (reader.headingLike.has(blocks[k])) delete blocks[k].role;
    i = Math.max(j, i + 1);
  }
  return { blocks: contentsLists(blocks, reader.entryDepth), fonts: { body: reader.faceOf({ type: "paragraph" }, "normal") } };
}

/** The converter writes a contents list as one paragraph per entry, each a
    link to its heading (SPEC.md §30): a run of entries reads as the list it
    stands for, each entry an item, its section number the marker, its
    indent the depth. */
function contentsLists(blocks: DocBlock[], depths: Map<DocBlock, number>): DocBlock[] {
  const out: DocBlock[] = [];
  for (let i = 0; i < blocks.length; ) {
    if (blocks[i].kind !== "paragraph" || blocks[i].role !== "contents") {
      out.push(blocks[i++]);
      continue;
    }
    const items: Item[] = [];
    const breaks: Break[] = [];
    const marks: NoteMark[] = [];
    for (; i < blocks.length && blocks[i].kind === "paragraph" && blocks[i].role === "contents"; i++) {
      const entry = blocks[i] as Extract<DocBlock, { kind: "paragraph" }>;
      const m = CONTENTS_MARKER_RE.exec(entry.spans.map((s) => s.text).join(""));
      const cut = m?.[0].length ?? 0;
      const unit = items.length;
      items.push({ depth: depths.get(entry) ?? 0, marker: m?.[1] ?? "", spans: dropChars(entry.spans, cut) });
      for (const b of entry.breaks ?? []) if (b.at > cut) breaks.push({ unit, at: b.at - cut });
      for (const x of entry.marks ?? []) if (x.at >= cut) marks.push({ ...x, unit, at: x.at - cut, end: x.end - cut });
    }
    const font = blocks[i - 1]?.kind === "paragraph" ? (blocks[i - 1] as Extract<DocBlock, { kind: "paragraph" }>).font : undefined;
    out.push({ kind: "list", role: "contents", items, ...(font ? { font } : {}), ...(breaks.length > 0 ? { breaks } : {}), ...(marks.length > 0 ? { marks } : {}) });
  }
  return out;
}

/** Spans without their first `n` characters. */
function dropChars(spans: Span[], n: number): Span[] {
  const out: Span[] = [];
  let rest = n;
  for (const span of spans) {
    if (rest >= span.text.length && span.latex === undefined) {
      rest -= span.text.length;
      continue;
    }
    out.push(rest > 0 ? { ...span, text: span.text.slice(rest) } : span);
    rest = 0;
  }
  return out;
}

/** A reference footnote: its label and its words. */
export type PrintedNote = { label: string; words: string[] };

/** The reference's footnotes, a note the page prints with no mark among
    them (label ""): the page editor numbers every footnote, and a number
    where the page prints none is no word of the page. */
export function printedNotes(blocks: RefBlock[]): PrintedNote[] {
  return blocks.flatMap((b) => (b.kind === "footnote" ? [{ label: b.label.trim(), words: wordsOf(b.spans.map((s) => s.text).join("")).map((w) => w.w) }] : []));
}

/** The page's own marks for an import's footnotes. The page editor numbers
    footnotes 1, 2, … in the order of their references, where the page
    prints "∗" or "¶¶", or a number the editor's order shifts (2411.19946's
    "∗" note takes 1, so the page's 1 draws as 2 and "RI1" as "RI2"): a
    rendering, not the parse's error. Each footnote takes the label of the
    reference footnote whose words it shares most, half of them or more. */
function printedLabels(doc: RichNode, printed: PrintedNote[]): Map<string, string> {
  const textOf = (node: RichNode): string => (node.type === "text" ? (node.text ?? "") : (node.content ?? []).map(textOf).join(" "));
  const notes: { id: string; words: string[] }[] = [];
  const visit = (node: RichNode) => {
    if (node.type === "footnote" && typeof node.attrs?.footnoteId === "string") notes.push({ id: node.attrs.footnoteId, words: wordsOf(textOf(node)).map((w) => w.w) });
    else for (const child of node.content ?? []) visit(child);
  };
  visit(doc);
  const f1 = (a: string[], b: string[]) => {
    const bag = new Map<string, number>();
    for (const w of a) bag.set(w, (bag.get(w) ?? 0) + 1);
    let shared = 0;
    for (const w of b) {
      const n = bag.get(w) ?? 0;
      if (n > 0) {
        shared++;
        bag.set(w, n - 1);
      }
    }
    return a.length + b.length > 0 ? (2 * shared) / (a.length + b.length) : 0;
  };
  const pairs = notes.flatMap((note) => printed.map((ref, r) => ({ id: note.id, r, score: f1(note.words, ref.words) }))).filter((p) => p.score >= 0.5);
  pairs.sort((a, b) => b.score - a.score);
  const labels = new Map<string, string>();
  const used = new Set<number>();
  for (const p of pairs) {
    if (labels.has(p.id) || used.has(p.r)) continue;
    labels.set(p.id, printed[p.r].label);
    used.add(p.r);
  }
  return labels;
}
