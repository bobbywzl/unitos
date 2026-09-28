import { JSDOM } from "jsdom";
import { listPreset } from "@/components/docs/toolbar/lists";
import type { RichMark, RichNode } from "@/lib/docs/schema";
import type { ParsedBlock } from "@/lib/parse/types";
import { parseRegion, type Region } from "@/lib/video/types";
import { splitTag } from "./math";
import type { RefBlock, Span } from "./model";
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
export type Doc = { blocks: DocBlock[] };
export type Pages = [number, number] | undefined;
type Look = Omit<Span, "text">;
type Item = Extract<RefBlock, { kind: "list" }>["items"][number];
type Row = Extract<RefBlock, { kind: "table" }>["rows"][number];

const FLAGS = ["bold", "italic", "underline", "code", "smallCaps", "sub", "sup"] as const;

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
    const same = last && last.latex === undefined && span.latex === undefined && last.href === span.href && FLAGS.every((f) => last[f] === span[f]);
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
      const flag = FLAGS.find((f) => f === s.style);
      if (flag && s.start <= a && s.end >= b) span[flag] = true;
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
    italic, code, and links. */
function htmlRows(html: string): { rows: Row[]; caption: Span[] | null } | null {
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
    const next: Look = { ...look };
    if (tag === "strong" || tag === "b") next.bold = true;
    if (tag === "em" || tag === "i") next.italic = true;
    if (tag === "u") next.underline = true;
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
  if (captionEl) {
    const into = new Spans();
    read(captionEl, {}, into);
    caption = into.hasText ? into.spans : null;
  }
  return { rows, caption };
}

function parseList(block: ParsedBlock, pageAt: (o: number) => number, inRange: (p: number) => boolean): DocBlock | null {
  const items: Item[] = [];
  const breaks: Break[] = [];
  const marks: NoteMark[] = [];
  let from = 0;
  for (const line of block.text.split("\n")) {
    const start = from;
    from += line.length + 1;
    const indent = /^ */.exec(line)?.[0].length ?? 0;
    const m = MARKER_RE.exec(line.slice(indent));
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
  // Row r is text line r: it is on the page its line begins on.
  const lineStarts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    lineStarts.push(offset);
    offset += line.length + 1;
  }
  const kept = rows.filter((_, r) => inRange(pageAt(lineStarts[Math.min(r, lineStarts.length - 1)] ?? 0)));
  if (!kept.some((row) => row.cells.some((cell) => cell.spans.some((s) => s.text.trim())))) return null;
  // Footnote references in cells: a line of the text is a row (the caption's
  // line first, when the text holds one) and a tab ends a cell; a mark's unit
  // is its cell's place among the kept rows' cells.
  const marks: NoteMark[] = [];
  const captionLine = fromHtml?.caption && lines.length === rows.length + 1 ? 1 : 0;
  for (const ref of block.footnoteRefs ?? []) {
    const line = block.text.slice(0, ref.start).split("\n").length - 1;
    const lineStart = lineStarts[line] ?? 0;
    const before = block.text.slice(lineStart, ref.start);
    const cellStart = lineStart + before.lastIndexOf("\t") + 1;
    const mark = { at: ref.start - cellStart, end: ref.end - cellStart, id: `b${ref.targetOrder}` };
    if (line < captionLine) {
      marks.push({ unit: -1, ...mark });
      continue;
    }
    const row = rows[line - captionLine];
    const slot = before.split("\t").length - 1;
    if (!row || !kept.includes(row) || slot >= row.cells.length) continue;
    const unit = kept.slice(0, kept.indexOf(row)).reduce((n, r) => n + r.cells.length, 0) + slot;
    marks.push({ unit, ...mark });
  }
  return { kind: "table", ...(fromHtml?.caption ? { caption: fromHtml.caption } : {}), rows: kept, ...(marks.length > 0 ? { marks } : {}) };
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
  if (block.footnote) {
    // A footnote's text opens with its label, which the model keeps apart.
    const label = block.footnote.label;
    const from = label && text.startsWith(label) ? label.length + (/^\s*/.exec(text.slice(label.length))?.[0].length ?? 0) : 0;
    const into = spansOf(from);
    return into.hasText ? { kind: "footnote", label, spans: into.spans, id: `b${index}`, ...breaks(into) } : null;
  }
  switch (block.type) {
    case "HEADING": {
      const into = spansOf();
      const n = Number(/^<h([1-6])/i.exec(block.html ?? "")?.[1] ?? 2);
      return into.hasText ? { kind: "heading", level: level(n), spans: into.spans, ...breaks(into) } : null;
    }
    case "LIST": {
      const list = parseList(block, pageAt, inRange);
      // A contents list: its class, or lines that link to headings (the converter's test).
      const contents = /\bclass="[^"]*\bcontents\b/.test(block.html ?? "") || (block.links ?? []).some((l) => l.targetOrder !== undefined);
      return list && contents ? { ...list, role: "contents" } : list;
    }
    case "TABLE":
      return parseTable(block, pageAt, inRange);
    case "EQUATION":
      return whole && text.trim() ? { ...equation(text), ...at } : null;
    case "FIGURE": {
      if (!whole) return null;
      if (isMathText(text)) return { kind: "figure", mathImage: text.trim(), ...at };
      const into = spansOf();
      return into.hasText ? { kind: "figure", caption: into.spans, ...at } : { kind: "figure", ...at };
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
      const tokens = classTokens(block.html);
      if (tokens.includes("quote")) return { kind: "quote", spans: into.spans, ...breaks(into) };
      const align = tokens.includes("center") ? "center" : tokens.includes("right") ? "right" : undefined;
      const indent = tokens.includes("indent-first") ? "first" : tokens.includes("indent-hanging") ? "hanging" : tokens.includes("indent-block") ? "block" : undefined;
      return {
        kind: "paragraph",
        spans: into.spans,
        ...(align ? { align } : {}),
        ...(indent ? { indent } : {}),
        ...(tokens.includes("caption") ? { role: "caption" as const } : {}),
        ...breaks(into),
      };
    }
  }
}

/** A parse as the reference model, cut to the scored pages. The title the
    parse found (it drops the heading it came from) is the first block. */
export function fromParse(parsed: { title: string | null; blocks: ParsedBlock[] }, pages?: Pages): Doc {
  const inRange = inRangeOf(pages);
  const blocks: DocBlock[] = [];
  if (parsed.title?.trim() && inRange(1)) blocks.push({ kind: "title", spans: [{ text: parsed.title }] });
  parsed.blocks.forEach((block, index) => {
    const out = parseBlock(block, index, inRange);
    if (out) blocks.push(out);
  });
  return { blocks };
}

// ── An import ───────────────────────────────────────────────────────────────

const LISTS = new Set(["bulletList", "orderedList", "taskList"]);
const CHIPS = new Set(["dateChip", "personChip", "fileChip", "dropdownChip"]);

function lookOf(marks: RichMark[] | undefined): Look {
  const look: Look = {};
  for (const mark of marks ?? []) {
    if (mark.type === "bold" || mark.type === "italic" || mark.type === "underline" || mark.type === "code") look[mark.type] = true;
    if (mark.type === "subscript") look.sub = true;
    if (mark.type === "superscript") look.sup = true;
    if (mark.type === "smallCaps" || (mark.type === "textStyle" && String(mark.attrs?.fontVariant ?? "").includes("small-caps"))) look.smallCaps = true;
    if (mark.type === "link" && typeof mark.attrs?.href === "string") look.href = mark.attrs.href;
  }
  return look;
}

/** A footnote the converter could not link to its mark: a paragraph set
    in one small size throughout that opens with its label raised ("² Two of
    the top ten…"), as the parse view reads it. */
function unlinkedNote(node: RichNode): { label: string; rest: RichNode } | null {
  const content = node.content ?? [];
  // Page starts before the label stay with the words.
  const at = content.findIndex((c) => c.type !== "pageStart");
  const first = content[at];
  if (first?.type !== "text" || !first.marks?.some((m) => m.type === "superscript")) return null;
  const label = (first.text ?? "").trim();
  if (!/^(?:\d{1,3}|[*∗†‡§¶‖#]{1,4})$/.test(label)) return null;
  if (!content.every((c) => c.type !== "text" || c.marks?.some((m) => m.type === "textStyle" && m.attrs?.fontSize))) return null;
  const next = content[at + 1];
  const after = next?.type === "text" ? [{ ...next, text: (next.text ?? "").trimStart() }, ...content.slice(at + 2)] : content.slice(at + 1);
  return { label, rest: { ...node, content: [...content.slice(0, at), ...after] } };
}

/** A paragraph's indentation from the page editor's attributes: a first
    line set in, set out (hanging), or the whole paragraph set in. */
function indentOf(attrs: Record<string, unknown> | undefined): "first" | "hanging" | "block" | undefined {
  const first = Number(attrs?.indentFirstLine ?? 0) || 0;
  const left = Number(attrs?.indentLeft ?? 0) || 0;
  return first > 0 ? "first" : first < 0 ? "hanging" : left > 0 ? "block" : undefined;
}

function roman(n: number): string {
  const table: [number, string][] = [[1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"], [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]];
  let out = "";
  let rest = Math.max(1, n);
  for (const [value, letters] of table) {
    while (rest >= value) {
      out += letters;
      rest -= value;
    }
  }
  return out;
}

/** The marker the page editor draws for item `n` of an ordered list at
    `depth`, the outermost list's preset giving each level's counter. */
function orderedMarker(style: unknown, depth: number, n: number): string {
  const glyph = listPreset(true, style).levels[Math.min(depth, 8)];
  if ("bullet" in glyph) return "•";
  // A legal level ("%0.%1.") prints the numbers above its own: one here.
  const [before, ...rest] = glyph.format.split(/%[0-8]/);
  if (rest.length !== 1) return `${n}.`;
  const counter =
    glyph.counter === "decimal" ? String(n)
    : glyph.counter === "decimal-leading-zero" ? String(n).padStart(2, "0")
    : glyph.counter === "lower-alpha" ? String.fromCharCode(96 + Math.min(26, Math.max(1, n)))
    : glyph.counter === "upper-alpha" ? String.fromCharCode(64 + Math.min(26, Math.max(1, n)))
    : glyph.counter === "lower-roman" ? roman(n)
    : roman(n).toUpperCase();
  return `${before}${counter}${rest[0]}`;
}

class ImportReader {
  readonly blocks: DocBlock[] = [];
  private page = 1;
  private readonly inRange: (p: number) => boolean;
  /** Each footnote's number as the page editor draws it (1, 2, … in the
      order of the references) and the page its reference stands on: the
      footnotes sit at the document's end, their words on that page. */
  private readonly notes = new Map<string, { n: number; page: number }>();
  /** Paragraphs taken for contents entries because they read like headings: kept only in runs of three. */
  readonly headingLike = new Set<DocBlock>();

  /** `labels`: the page's own mark for a footnote id, where a reference
      gives it (printedLabels); `headings`: the words of every heading of the
      document, on any page (a contents entry reads like one). */
  constructor(
    pages: Pages,
    private readonly labels = new Map<string, string>(),
    private readonly headings = new Set<string>(),
  ) {
    this.inRange = inRangeOf(pages);
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

  private push(block: DocBlock, into?: Spans) {
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
    if (into.hasText) this.push({ kind: "footnote", label: this.labels.get(id) ?? (note ? String(note.n) : ""), spans: into.spans, id }, into);
  }

  node(node: RichNode, quoted: boolean) {
    if (typeof node.attrs?.pageStart === "number") this.page = node.attrs.pageStart;
    switch (node.type) {
      case "paragraph":
      case "heading": {
        const note = node.type === "paragraph" ? unlinkedNote(node) : null;
        if (note) {
          const into = new Spans();
          this.inline(note.rest, into);
          if (into.hasText) this.push({ kind: "footnote", label: note.label, spans: into.spans }, into);
          return;
        }
        const into = new Spans();
        this.inline(node, into);
        if (!into.hasText) return;
        if (node.type === "heading") return this.push({ kind: "heading", level: level(Number(node.attrs?.level)), spans: into.spans }, into);
        if (node.attrs?.docStyle === "title") return this.push({ kind: "title", spans: into.spans }, into);
        if (quoted) return this.push({ kind: "quote", spans: into.spans }, into);
        const align = node.attrs?.textAlign === "center" || node.attrs?.textAlign === "right" ? node.attrs.textAlign : undefined;
        const indent = indentOf(node.attrs);
        // A contents entry: a paragraph that links to a heading, or one of
        // three or more in a row that read like headings, page numbers aside
        // (a contents list the converter could not link; a running head that
        // leaks reads like a heading too, but alone).
        const words = wordsOf(into.spans.map((span) => span.text).join("")).map((w) => w.w);
        const linked = into.spans.some((span) => span.href?.startsWith("#heading="));
        const like = this.headings.has(words.join(" ")) || (/^\d+$/.test(words.at(-1) ?? "") && this.headings.has(words.slice(0, -1).join(" ")));
        const block: DocBlock = { kind: "paragraph", spans: into.spans, ...(align ? { align } : {}), ...(indent ? { indent } : {}), ...(linked || like ? { role: "contents" as const } : {}) };
        if (like && !linked) this.headingLike.add(block);
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
        return this.push(caption.trim() ? { kind: "figure", caption: [{ text: caption }], ...at } : { kind: "figure", ...at });
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

  private list(node: RichNode) {
    const items: Item[] = [];
    const breaks: Break[] = [];
    const marks: NoteMark[] = [];
    const style = node.type === "orderedList" ? node.attrs?.listStyle : null;
    const visit = (list: RichNode, depth: number) => {
      const start = Number(list.attrs?.start ?? 1) || 1;
      (list.content ?? []).forEach((item, index) => {
        const into = new Spans();
        const nested: RichNode[] = [];
        let first = true;
        for (const child of item.content ?? []) {
          if (LISTS.has(child.type)) {
            nested.push(child);
            continue;
          }
          if (!first) into.add({ text: " " });
          first = false;
          if (child.type === "paragraph") this.inline(child, into);
          else this.words(child, into);
        }
        if (into.hasText) {
          const checked = item.attrs?.checked === true;
          const marker =
            list.type === "taskList" ? (checked ? "☑" : "☐") : list.type === "orderedList" ? orderedMarker(style, depth, start + index) : "•";
          for (const at of into.breaks) breaks.push({ unit: items.length, at });
          for (const m of into.marks) marks.push({ unit: items.length, ...m });
          items.push(list.type === "taskList" ? { depth, marker, spans: into.spans, checked } : { depth, marker, spans: into.spans });
        }
        for (const sub of nested) visit(sub, depth + 1);
      });
    };
    visit(node, 0);
    if (items.length > 0) this.blocks.push({ kind: "list", items, ...(breaks.length > 0 ? { breaks } : {}), ...(marks.length > 0 ? { marks } : {}) });
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
      if (cells.some((c) => c.spans.some((s) => s.text.trim())) || this.here()) {
        rows.push({ cells });
        for (const list of rowMarks) {
          for (const m of list) marks.push({ unit: index, ...m });
          index++;
        }
      }
    }
    if (rows.some((row) => row.cells.some((c) => c.spans.some((s) => s.text.trim())))) this.blocks.push({ kind: "table", rows, ...(marks.length > 0 ? { marks } : {}) });
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
  const reader = new ImportReader(pages, printed ? printedLabels(doc, printed) : undefined, headings);
  for (const node of doc.content ?? []) reader.node(node, false);
  const blocks = reader.blocks;
  for (let i = 0; i < blocks.length; ) {
    let j = i;
    while (j < blocks.length && blocks[j].role === "contents") j++;
    if (j - i < 3) for (let k = i; k < j; k++) if (reader.headingLike.has(blocks[k])) delete blocks[k].role;
    i = Math.max(j, i + 1);
  }
  return { blocks };
}

/** A reference footnote: its label and its words. */
export type PrintedNote = { label: string; words: string[] };

export function printedNotes(blocks: RefBlock[]): PrintedNote[] {
  return blocks.flatMap((b) => (b.kind === "footnote" && b.label.trim() ? [{ label: b.label.trim(), words: wordsOf(b.spans.map((s) => s.text).join("")).map((w) => w.w) }] : []));
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
