import { JSDOM } from "jsdom";
import { listPreset } from "@/components/docs/toolbar/lists";
import type { RichMark, RichNode } from "@/lib/docs/schema";
import type { ParsedBlock } from "@/lib/parse/types";
import type { RefBlock, Span } from "./model";

// The adapters: a parse (parsePdf's title and blocks) and an import (the
// page editor's rich text, richTextFromImport) as the reference model, so one
// set of metrics scores both. Each keeps only the words on the scored pages:
// a block joined across the range's edge keeps the words on its pages in
// range. Each block also keeps where a later page begins inside it (its
// breaks): furniture leaks at those edges.

/** Where a later page begins inside a block: its unit (a list item's index,
    else 0) and the offset in the unit's text. */
export type Break = { unit: number; at: number };
export type DocBlock = RefBlock & {
  /** A figure that shows a display equation as an image: the glyph text
      the parse read from it, which the reader draws as its caption. */
  mathImage?: string;
  breaks?: Break[];
};
export type Doc = { blocks: DocBlock[] };
export type Pages = [number, number] | undefined;
type Look = Omit<Span, "text">;
type Item = Extract<RefBlock, { kind: "list" }>["items"][number];
type Row = Extract<RefBlock, { kind: "table" }>["rows"][number];

const FLAGS = ["bold", "italic", "underline", "code", "smallCaps"] as const;

/** A unit's spans as they are added: neighbors with one look join, and a
    page break is kept as an offset. */
class Spans {
  readonly spans: Span[] = [];
  readonly breaks: number[] = [];
  private length = 0;

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

// ── A parse ─────────────────────────────────────────────────────────────────

/** A list line's marker as printed: a bullet glyph, a checkbox, or a
    counter ("1.", "1.2.", "a)", "(iv)", "[12]"), then a space. */
const MARKER_RE =
  /^(?:[-*•▪◦‣●○■□·∙–—➢❖◆★➔✓✔❏]|[☐☑☒]|\[\d{1,3}\]|\((?:\d{1,3}|[a-zA-Z]|[ivxlcdm]{1,6}|[IVXLCDM]{1,6})\)|(?:\d{1,3}(?:\.\d{1,3})*|[a-zA-Z]|[ivxlcdm]{1,6}|[IVXLCDM]{1,6})[.)])(?=\s|$)\s*/;

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
    cut where a page begins, only the words on pages in range. */
function textSpans(block: ParsedBlock, from: number, to: number, pageAt: (o: number) => number, inRange: (p: number) => boolean, into: Spans) {
  const clamp = (n: number) => Math.max(from, Math.min(to, n));
  const cuts = new Set<number>([from, to]);
  for (const s of block.styles ?? []) [s.start, s.end].forEach((n) => cuts.add(clamp(n)));
  for (const l of block.links ?? []) if (l.href) [l.start, l.end].forEach((n) => cuts.add(clamp(n)));
  for (const p of block.pageStarts ?? []) cuts.add(clamp(p.offset));
  const points = [...cuts].sort((a, b) => a - b);
  let page = pageAt(from);
  for (let k = 0; k + 1 < points.length; k++) {
    const [a, b] = [points[k], points[k + 1]];
    if (a >= b || !inRange(pageAt(a))) continue;
    if (pageAt(a) !== page) {
      page = pageAt(a);
      into.pageBreak();
    }
    const span: Span = { text: block.text.slice(a, b) };
    for (const s of block.styles ?? []) if (s.start <= a && s.end >= b) span[s.style] = true;
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
  let from = 0;
  for (const line of block.text.split("\n")) {
    const start = from;
    from += line.length + 1;
    const indent = /^ */.exec(line)?.[0].length ?? 0;
    const m = MARKER_RE.exec(line.slice(indent));
    const into = new Spans();
    textSpans(block, start + indent + (m?.[0].length ?? 0), start + line.length, pageAt, inRange, into);
    if (!into.hasText) continue;
    const marker = m?.[0].trim() ?? "";
    const item: Item = { depth: Math.floor(indent / 2), marker, spans: into.spans };
    if (/^[☐☑☒]$/.test(marker)) item.checked = marker !== "☐";
    for (const at of into.breaks) breaks.push({ unit: items.length, at });
    items.push(item);
  }
  if (items.length === 0) return null;
  return breaks.length > 0 ? { kind: "list", items, breaks } : { kind: "list", items };
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
  return fromHtml?.caption ? { kind: "table", caption: fromHtml.caption, rows: kept } : { kind: "table", rows: kept };
}

function parseBlock(block: ParsedBlock, inRange: (p: number) => boolean): DocBlock | null {
  const pageAt = pageLookup(block);
  const whole = inRange(block.page ?? 1);
  const text = block.text;
  const spansOf = () => {
    const into = new Spans();
    textSpans(block, 0, text.length, pageAt, inRange, into);
    return into;
  };
  const breaks = (into: Spans) => (into.breaks.length > 0 ? { breaks: into.breaks.map((at) => ({ unit: 0, at })) } : {});
  switch (block.type) {
    case "HEADING": {
      const into = spansOf();
      const n = Number(/^<h([1-6])/i.exec(block.html ?? "")?.[1] ?? 2);
      return into.hasText ? { kind: "heading", level: level(n), spans: into.spans, ...breaks(into) } : null;
    }
    case "LIST":
      return parseList(block, pageAt, inRange);
    case "TABLE":
      return parseTable(block, pageAt, inRange);
    case "EQUATION":
      return whole && text.trim() ? { kind: "equation", latex: text.trim() } : null;
    case "FIGURE": {
      if (!whole) return null;
      if (isMathText(text)) return { kind: "figure", mathImage: text.trim() };
      const into = spansOf();
      return into.hasText ? { kind: "figure", caption: into.spans } : { kind: "figure" };
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
      return { kind: "paragraph", spans: into.spans, ...(align ? { align } : {}), ...breaks(into) };
    }
  }
}

/** A parse as the reference model, cut to the scored pages. The title the
    parse found (it drops the heading it came from) is the first block. */
export function fromParse(parsed: { title: string | null; blocks: ParsedBlock[] }, pages?: Pages): Doc {
  const inRange = inRangeOf(pages);
  const blocks: DocBlock[] = [];
  if (parsed.title?.trim() && inRange(1)) blocks.push({ kind: "title", spans: [{ text: parsed.title }] });
  for (const block of parsed.blocks) {
    const out = parseBlock(block, inRange);
    if (out) blocks.push(out);
  }
  return { blocks };
}

// ── An import ───────────────────────────────────────────────────────────────

const LISTS = new Set(["bulletList", "orderedList", "taskList"]);
const CHIPS = new Set(["dateChip", "personChip", "fileChip", "dropdownChip"]);

function lookOf(marks: RichMark[] | undefined): Look {
  const look: Look = {};
  for (const mark of marks ?? []) {
    if (mark.type === "bold" || mark.type === "italic" || mark.type === "underline" || mark.type === "code") look[mark.type] = true;
    if (mark.type === "link" && typeof mark.attrs?.href === "string") look.href = mark.attrs.href;
  }
  return look;
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
  if ("nested" in glyph) return `${n}.`;
  const counter =
    glyph.counter === "decimal" ? String(n)
    : glyph.counter === "decimal-leading-zero" ? String(n).padStart(2, "0")
    : glyph.counter === "lower-alpha" ? String.fromCharCode(96 + Math.min(26, Math.max(1, n)))
    : glyph.counter === "upper-alpha" ? String.fromCharCode(64 + Math.min(26, Math.max(1, n)))
    : glyph.counter === "lower-roman" ? roman(n)
    : roman(n).toUpperCase();
  return `${glyph.before}${counter}${glyph.after}`;
}

class ImportReader {
  readonly blocks: DocBlock[] = [];
  private page = 1;
  private readonly inRange: (p: number) => boolean;

  constructor(pages: Pages) {
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
    this.blocks.push(block);
  }

  node(node: RichNode, quoted: boolean) {
    if (typeof node.attrs?.pageStart === "number") this.page = node.attrs.pageStart;
    switch (node.type) {
      case "paragraph":
      case "heading": {
        const into = new Spans();
        this.inline(node, into);
        if (!into.hasText) return;
        if (node.type === "heading") return this.push({ kind: "heading", level: level(Number(node.attrs?.level)), spans: into.spans }, into);
        if (node.attrs?.docStyle === "title") return this.push({ kind: "title", spans: into.spans }, into);
        if (quoted) return this.push({ kind: "quote", spans: into.spans }, into);
        const align = node.attrs?.textAlign === "center" || node.attrs?.textAlign === "right" ? node.attrs.textAlign : undefined;
        return this.push({ kind: "paragraph", spans: into.spans, ...(align ? { align } : {}) }, into);
      }
      case "bulletList":
      case "orderedList":
      case "taskList":
        return this.list(node);
      case "table":
        return this.table(node);
      case "blockMath":
        if (this.here()) this.push({ kind: "equation", latex: String(node.attrs?.latex ?? "") });
        return;
      case "figure": {
        if (!this.here()) return;
        const caption = typeof node.attrs?.caption === "string" ? node.attrs.caption : "";
        if (isMathText(caption)) return this.push({ kind: "figure", mathImage: caption.trim() });
        return this.push(caption.trim() ? { kind: "figure", caption: [{ text: caption }] } : { kind: "figure" });
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
      case "footnote": {
        const into = new Spans();
        this.words(node, into);
        if (into.hasText) this.push({ kind: "footnote", label: String(node.attrs?.label ?? ""), spans: into.spans });
        return;
      }
      default:
        for (const child of node.content ?? []) this.node(child, quoted || node.type === "blockquote");
    }
  }

  private list(node: RichNode) {
    const items: Item[] = [];
    const breaks: Break[] = [];
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
          items.push(list.type === "taskList" ? { depth, marker, spans: into.spans, checked } : { depth, marker, spans: into.spans });
        }
        for (const sub of nested) visit(sub, depth + 1);
      });
    };
    visit(node, 0);
    if (items.length > 0) this.blocks.push(breaks.length > 0 ? { kind: "list", items, breaks } : { kind: "list", items });
  }

  private table(node: RichNode) {
    const rows: Row[] = [];
    for (const tr of node.content ?? []) {
      const cells: Row["cells"] = [];
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
      }
      // A row whose words are all on pages out of range is not scored.
      if (cells.some((c) => c.spans.some((s) => s.text.trim())) || this.here()) rows.push({ cells });
    }
    if (rows.some((row) => row.cells.some((c) => c.spans.some((s) => s.text.trim())))) this.blocks.push({ kind: "table", rows });
  }
}

/** An import's rich text as the reference model, cut to the scored pages. */
export function fromImport(doc: RichNode, pages?: Pages): Doc {
  const reader = new ImportReader(pages);
  for (const node of doc.content ?? []) reader.node(node, false);
  return { blocks: reader.blocks };
}
