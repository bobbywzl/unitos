import { JSDOM } from "jsdom";
import { newBlockId, ZWSP, type RichMark, type RichNode } from "@/lib/docs/schema";
import { normalizeText, separateBlocks } from "@/lib/parse/dom-text";

// The converter's tables (lib/docs/import.ts): a TABLE block's html becomes a
// page editor table (SPEC.md §29): its rows, header cells, merged cells, and
// a paragraph for each paragraph of a cell. It reads html with jsdom, so it
// loads with the parse chain only (lib/parse/ingest.ts), never with a route
// module. The inline helpers below are the converter's too: every text run of
// an import is made here, marks in the editor's order.

/** A piece of a line: words with their marks, or an inline node (a line
    break, a page start). */
export type Piece = { text: string; marks: RichMark[] } | { node: RichNode };

// The editor's mark order (components/docs/extensions.ts): Link first (its
// priority is 1000), TextStyle (101), then the marks at the default priority
// in the order the editor lists them, the citation mark after them. A text
// node's marks in this order are the ones the editor writes on its first
// save, so the rows derived from them stay the same.
const MARK_ORDER = ["link", "textStyle", "bold", "code", "italic", "strike", "underline", "subscript", "superscript", "citation"];
const rank = (mark: RichMark) => {
  const at = MARK_ORDER.indexOf(mark.type);
  return at < 0 ? MARK_ORDER.length : at;
};

/** A run's marks as the editor holds them: one of a type, in the editor's
    order. The code mark excludes every other mark: a link or a citation on
    code words keeps the link (the words point somewhere), a size keeps the
    size, and bold, italic, and the rest give way to code. */
export function orderMarks(marks: RichMark[]): RichMark[] {
  const byType = new Map<string, RichMark>();
  for (const mark of marks) if (!byType.has(mark.type)) byType.set(mark.type, mark);
  if (byType.has("code") && byType.size > 1) {
    if (byType.has("link") || byType.has("citation") || byType.has("textStyle")) byType.delete("code");
    else for (const type of [...byType.keys()]) if (type !== "code") byType.delete(type);
  }
  return [...byType.values()].sort((a, b) => rank(a) - rank(b));
}

const sameMarks = (a: RichMark[], b: RichMark[]) => JSON.stringify(a) === JSON.stringify(b);

/** The inline nodes of a line: words beside words with the same marks join,
    a "\n" is a line break, and the zero-width space leaves the words (the
    page editor holds a suggested break with it). */
export function inlineNodes(pieces: Piece[]): RichNode[] {
  const out: RichNode[] = [];
  const pushText = (text: string, marks: RichMark[]) => {
    if (!text) return;
    const last = out.at(-1);
    if (last?.type === "text" && sameMarks(last.marks ?? [], marks)) {
      last.text = `${last.text ?? ""}${text}`;
      return;
    }
    out.push(marks.length > 0 ? { type: "text", text, marks } : { type: "text", text });
  };
  for (const piece of pieces) {
    if ("node" in piece) {
      out.push(piece.node);
      continue;
    }
    const marks = orderMarks(piece.marks);
    piece.text
      .replaceAll(ZWSP, "")
      .split("\n")
      .forEach((part, i) => {
        if (i > 0) out.push({ type: "hardBreak" });
        pushText(part, marks);
      });
  }
  return out;
}

/** A link's address the rich text keeps (lib/docs/schema.ts safeHref): a
    path, a place in the document, or an http(s), mailto, or tel address. */
export function keptHref(value: string | null | undefined): string | null {
  if (!value || value.length > 4000) return null;
  const href = value.trim();
  if (href.startsWith("/") || href.startsWith("#")) return href;
  try {
    return ["http:", "https:", "mailto:", "tel:"].includes(new URL(href).protocol) ? href : null;
  } catch {
    return null;
  }
}

function keptSrc(value: string | null): string | null {
  if (!value || value.length > 4000) return null;
  if (value.startsWith("/api/images/")) return value;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? value : null;
  } catch {
    return null;
  }
}

/** At most `max` characters, never half of a surrogate pair: the database
    refuses JSON that holds half of one. */
export function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const code = text.charCodeAt(max - 1);
  return text.slice(0, code >= 0xd800 && code <= 0xdbff ? max - 1 : max);
}

export function paragraphNode(content: RichNode[], attrs: Record<string, unknown> = {}): RichNode {
  const node: RichNode = { type: "paragraph", attrs: { blockId: newBlockId(), ...attrs } };
  if (content.length > 0) node.content = content;
  return node;
}

// ── A cell's content ────────────────────────────────────────────────────────

type Inline = { text: string; marks: RichMark[] } | { br: true };

const MARK_OF_TAG: Record<string, string> = {
  strong: "bold",
  b: "bold",
  em: "italic",
  i: "italic",
  var: "italic",
  u: "underline",
  ins: "underline",
  code: "code",
  kbd: "code",
  samp: "code",
  tt: "code",
  s: "strike",
  del: "strike",
  strike: "strike",
  sub: "subscript",
  sup: "superscript",
};

// Media a cell draws that the page editor has no node for: no words either
// (the parse's table text leaves them out).
const SKIPPED = new Set(["svg", "video", "iframe", "audio", "source", "script", "style", "caption"]);
const BLOCK_TAGS = new Set([
  "p", "div", "section", "article", "aside", "header", "footer", "blockquote", "figure", "figcaption",
  "h1", "h2", "h3", "h4", "h5", "h6", "dl", "dt", "dd", "hr", "address", "details", "summary",
]);

/** A line's pieces with the page's whitespace rules: runs of white space are
    one space, none at the line's ends or around a line break. */
function collapsed(line: Inline[]): Piece[] {
  const pieces: Piece[] = [];
  let spaced = true;
  const trimEnd = () => {
    const last = pieces.at(-1);
    if (last && "text" in last) last.text = last.text.replace(/ $/, "");
  };
  for (const item of line) {
    if ("br" in item) {
      trimEnd();
      pieces.push({ node: { type: "hardBreak" } });
      spaced = true;
      continue;
    }
    let text = item.text.replaceAll(ZWSP, "").replace(/\s+/g, " ");
    if (spaced) text = text.replace(/^ /, "");
    if (!text) continue;
    spaced = text.endsWith(" ");
    pieces.push({ text, marks: item.marks });
  }
  trimEnd();
  // A line of nothing but line breaks has no words.
  return pieces.some((p) => "text" in p && p.text) ? pieces : [];
}

/** The blocks of a cell (or of a list item inside it): a paragraph for each
    paragraph, a line break for each <br>, lists as lists, a <pre> as a code
    block, an image as an image. */
class CellReader {
  readonly blocks: RichNode[] = [];
  private line: Inline[] = [];

  read(el: Element, marks: RichMark[]) {
    for (const child of el.childNodes) this.node(child, marks);
  }

  flush() {
    const content = inlineNodes(collapsed(this.line));
    this.line = [];
    if (content.length > 0) this.blocks.push(paragraphNode(content));
  }

  private node(node: Node, marks: RichMark[]) {
    if (node.nodeType === 3) {
      this.line.push({ text: node.textContent ?? "", marks });
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    if (SKIPPED.has(tag) || el.classList.contains("cell-gap")) return;
    if (tag === "br") {
      this.line.push({ br: true });
      return;
    }
    if (tag === "img") {
      const image = imageNode(el);
      if (image) {
        this.flush();
        this.blocks.push(image);
      }
      return;
    }
    if (tag === "ul" || tag === "ol") {
      this.flush();
      const list = listNode(el, marks);
      if (list) this.blocks.push(list);
      return;
    }
    if (tag === "pre") {
      this.flush();
      const text = (el.textContent ?? "").replaceAll(ZWSP, "").trimEnd();
      if (text) this.blocks.push({ type: "codeBlock", attrs: { blockId: newBlockId() }, content: [{ type: "text", text }] });
      return;
    }
    if (tag === "table" || tag === "tr" || tag === "td" || tag === "th" || tag === "li") {
      // A table inside a cell is not a data table (the parse walks those):
      // each of its cells is a paragraph.
      this.flush();
      this.read(el, marks);
      this.flush();
      return;
    }
    if (BLOCK_TAGS.has(tag)) {
      this.flush();
      this.read(el, marks);
      this.flush();
      return;
    }
    const markType = MARK_OF_TAG[tag];
    if (markType) {
      this.read(el, [...marks, { type: markType }]);
      return;
    }
    if (tag === "a") {
      const href = keptHref(el.getAttribute("href"));
      this.read(el, href ? [...marks, { type: "link", attrs: { href } }] : marks);
      return;
    }
    this.read(el, marks);
  }
}

function imageNode(el: Element): RichNode | null {
  const src = keptSrc(el.getAttribute("src"));
  if (!src) return null;
  const attrs: Record<string, unknown> = { src, alt: clip(el.getAttribute("alt") ?? "", 2000), blockId: newBlockId() };
  const width = Number(el.getAttribute("width"));
  const height = Number(el.getAttribute("height"));
  if (Number.isInteger(width) && width > 0 && width <= 4000) attrs.width = width;
  if (Number.isInteger(height) && height > 0 && height <= 4000) attrs.height = height;
  return { type: "image", attrs };
}

/** A list inside a cell: a list item's first block is a paragraph, as the
    editor's list item needs. */
function listNode(el: Element, marks: RichMark[]): RichNode | null {
  const ordered = el.tagName.toLowerCase() === "ol";
  const items: RichNode[] = [];
  for (const li of el.children) {
    if (li.tagName.toLowerCase() !== "li") continue;
    const reader = new CellReader();
    reader.read(li, marks);
    reader.flush();
    const content = reader.blocks;
    if (content[0]?.type !== "paragraph") content.unshift(paragraphNode([]));
    items.push({ type: "listItem", content });
  }
  if (items.length === 0) return null;
  const start = Number(el.getAttribute("start"));
  const attrs = ordered && Number.isInteger(start) && start !== 1 && start >= 0 && start < 100_000 ? { start } : null;
  return { type: ordered ? "orderedList" : "bulletList", ...(attrs ? { attrs } : {}), content: items };
}

function cellBlocks(cell: Element): RichNode[] {
  // A space at every block boundary, as the parse's table text reads it
  // (lib/parse/dom-text.ts), so a cell's words are the parse's words.
  const clone = cell.cloneNode(true) as Element;
  separateBlocks(clone);
  const reader = new CellReader();
  reader.read(clone, []);
  reader.flush();
  return reader.blocks.length > 0 ? reader.blocks : [paragraphNode([])];
}

// ── The table ───────────────────────────────────────────────────────────────

export type ImportTable = {
  /** A <caption> the table carries, drawn as a caption above the table. */
  caption: string | null;
  table: RichNode;
  /** The first paragraph of each row, in the order of the parse's text rows:
      where a page that begins at the row puts its page start. */
  rowStarts: (RichNode | null)[];
};

let shared: Document | null = null;

function scratchDocument(): Document {
  shared ??= new JSDOM("<!doctype html><body></body>").window.document;
  return shared;
}

type GridCell = { node: RichNode; col: number };

/** The rows as the editor's table map reads them (prosemirror-tables): each
    cell in the first free column, a merged cell never over another, a
    rowspan never past the last row, and every row as wide as the table, an
    empty cell filling each place a row leaves open. The editor then has
    nothing to fix when it opens the table. */
function gridRows(rows: { cells: { node: RichNode; colspan: number; rowspan: number }[] }[]): GridCell[][] {
  const taken: boolean[][] = rows.map(() => []);
  const free = (r: number, c: number) => !taken[r]?.[c];
  const out: GridCell[][] = rows.map(() => []);
  let width = 0;
  rows.forEach((row, r) => {
    let col = 0;
    for (const cell of row.cells) {
      while (!free(r, col)) col++;
      let colspan = cell.colspan;
      let rowspan = Math.min(cell.rowspan, rows.length - r);
      const clear = (rs: number, cs: number) => {
        for (let dr = 0; dr < rs; dr++) for (let dc = 0; dc < cs; dc++) if (!free(r + dr, col + dc)) return false;
        return true;
      };
      while (colspan > 1 && !clear(1, colspan)) colspan--;
      while (rowspan > 1 && !clear(rowspan, colspan)) rowspan--;
      for (let dr = 0; dr < rowspan; dr++) for (let dc = 0; dc < colspan; dc++) taken[r + dr][col + dc] = true;
      const attrs: Record<string, unknown> = {};
      if (colspan > 1) attrs.colspan = colspan;
      if (rowspan > 1) attrs.rowspan = rowspan;
      const node = Object.keys(attrs).length > 0 ? { ...cell.node, attrs } : cell.node;
      out[r].push({ node, col });
      col += colspan;
      width = Math.max(width, col);
    }
  });
  out.forEach((cells, r) => {
    for (let c = 0; c < width; c++) {
      if (free(r, c)) {
        taken[r][c] = true;
        cells.push({ node: { type: "tableCell", content: [paragraphNode([])] }, col: c });
      }
    }
  });
  return out;
}

// ── Column widths ───────────────────────────────────────────────────────────
// The page editor lays a table out at fixed column widths (docs.css), an
// equal share each when no width is set: a wide label column then breaks its
// words letter by letter beside narrow number columns. Each column takes a
// width from its words instead, as a browser sizes a table: its longest word
// is as narrow as it may get, its longest line as wide as it wants to be.

// Arial's advance widths (thousandths of an em) for the printable ASCII
// characters, space to tilde: the page's Normal text face.
const ARIAL = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556,
  556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556,
  556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];
const PX_PER_PT = 96 / 72;
const BODY_PT = 11;
/** The smallest size a table's text takes to fit its longest words. */
const SMALLEST_PT = 8;
/** A cell's room past its words: 5 pt of padding a side, the grid line, and
    a little slack for a measure that is an estimate. */
const CELL_EXTRA_PX = 10 * PX_PER_PT + 1 + 4;
/** The narrowest column (the table's cellMinWidth, components/docs/extensions.ts). */
const MIN_COLUMN_PX = 32;
/** A list line's indent in a cell (docs.css). */
const LIST_INDENT_PX = 36 * PX_PER_PT;

/** One character's width in ems: Arial's for ASCII, a full em for a wide
    (CJK) character, an average letter's for the rest. */
function charEm(ch: string): number {
  const c = ch.codePointAt(0) ?? 0;
  if (c >= 32 && c <= 126) return ARIAL[c - 32] / 1000;
  if ((c >= 0x1100 && c <= 0x11ff) || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7af) || (c >= 0xf900 && c <= 0xfaff) || (c >= 0xfe30 && c <= 0xfe4f) || (c >= 0xff00 && c <= 0xff60)) {
    return 1;
  }
  return 0.556;
}

/** What a cell's content needs at the body size: its longest word and its
    longest line, in px of words, and the px of what does not scale with
    the text (a list's indent, an image). */
type Need = { word: number; line: number; fixedMin: number; fixedLine: number };

function cellNeed(cell: RichNode): Need {
  const need: Need = { word: 0, line: 0, fixedMin: 0, fixedLine: 0 };
  const bold = cell.type === "tableHeader";
  const block = (node: RichNode, indent: number) => {
    if (node.type === "image") {
      const width = typeof node.attrs?.width === "number" ? node.attrs.width : 100;
      need.fixedLine = Math.max(need.fixedLine, indent + width);
      return;
    }
    if (node.type === "paragraph" || node.type === "codeBlock") {
      const mono = node.type === "codeBlock";
      let word = 0;
      let line = 0;
      const end = () => {
        need.word = Math.max(need.word, word);
        need.line = Math.max(need.line, line);
        word = 0;
        line = 0;
      };
      for (const child of node.content ?? []) {
        if (child.type === "hardBreak") {
          end();
          continue;
        }
        const heavy = bold || (child.marks ?? []).some((m) => m.type === "bold");
        for (const ch of child.text ?? "") {
          if (ch === "\n") {
            end();
            continue;
          }
          const px = (mono ? 0.6 : charEm(ch)) * BODY_PT * PX_PER_PT * (heavy ? 1.1 : 1);
          line += px;
          if (/\s/.test(ch)) {
            need.word = Math.max(need.word, word);
            word = 0;
          } else {
            word += px;
          }
        }
      }
      end();
      need.fixedMin = Math.max(need.fixedMin, indent);
      need.fixedLine = Math.max(need.fixedLine, indent);
      return;
    }
    const nested = node.type === "bulletList" || node.type === "orderedList" || node.type === "taskList";
    for (const child of node.content ?? []) block(child, nested ? indent + LIST_INDENT_PX : indent);
  };
  for (const child of cell.content ?? []) block(child, 0);
  return need;
}

/** A column's narrowest and widest width at a text size of `scale` times
    the body size. */
function spanWidths(need: Need, scale: number): { min: number; max: number } {
  return {
    min: Math.max(MIN_COLUMN_PX, need.word * scale + need.fixedMin + CELL_EXTRA_PX),
    max: Math.max(MIN_COLUMN_PX, need.line * scale + need.fixedLine + CELL_EXTRA_PX, need.word * scale + need.fixedMin + CELL_EXTRA_PX),
  };
}

/** Each column's narrowest and widest width: a cell over one column sets
    its column's; a merged cell adds what its columns lack, shared evenly. */
function columnWidths(grid: GridCell[][], width: number, needs: Map<RichNode, Need>, scale: number) {
  const min = new Array<number>(width).fill(MIN_COLUMN_PX);
  const max = new Array<number>(width).fill(MIN_COLUMN_PX);
  const spans = (cell: GridCell) => Number(cell.node.attrs?.colspan ?? 1);
  const cells = grid.flat();
  for (const cell of cells.filter((c) => spans(c) === 1)) {
    const w = spanWidths(needs.get(cell.node) as Need, scale);
    min[cell.col] = Math.max(min[cell.col], w.min);
    max[cell.col] = Math.max(max[cell.col], w.max);
  }
  for (const cell of cells.filter((c) => spans(c) > 1)) {
    const w = spanWidths(needs.get(cell.node) as Need, scale);
    const cols = Array.from({ length: spans(cell) }, (_, k) => cell.col + k).filter((c) => c < width);
    for (const [list, wanted] of [
      [min, w.min],
      [max, w.max],
    ] as const) {
      const lack = wanted - cols.reduce((sum, c) => sum + list[c], 0);
      if (lack > 0) for (const c of cols) list[c] += lack / cols.length;
    }
  }
  for (let c = 0; c < width; c++) max[c] = Math.max(max[c], min[c]);
  return { min, max };
}

/** The columns' widths in px for a text column `room` px wide, and the
    table's text size: the widths the words want when they fit; else each
    column past its longest word shares the room by how much more it wants;
    and when even the longest words do not fit, the text smaller, down to
    SMALLEST_PT, the way a paper sets a table smaller than its body. */
function layoutColumns(grid: GridCell[][], width: number, room: number): { widths: number[]; pt: number } {
  const needs = new Map(grid.flat().map((cell) => [cell.node, cellNeed(cell.node)]));
  const sum = (list: number[]) => list.reduce((a, b) => a + b, 0);
  let pt = BODY_PT;
  let { min, max } = columnWidths(grid, width, needs, 1);
  while (sum(min) > room && pt > SMALLEST_PT) {
    pt -= 0.5;
    ({ min, max } = columnWidths(grid, width, needs, pt / BODY_PT));
  }
  let widths: number[];
  if (sum(max) <= room) widths = max;
  else if (sum(min) >= room) widths = min.map((w) => (w * room) / sum(min));
  else {
    const share = (room - sum(min)) / (sum(max) - sum(min));
    widths = min.map((w, c) => w + (max[c] - w) * share);
  }
  return { widths: widths.map((w) => Math.max(MIN_COLUMN_PX, Math.floor(w))), pt };
}

/** Every text run of a table at a text size. */
function sized(node: RichNode, size: string): RichNode {
  if (node.type === "text") {
    const marks = orderMarks([...(node.marks ?? []).filter((m) => m.type !== "textStyle"), { type: "textStyle", attrs: { fontSize: size } }]);
    return { ...node, marks };
  }
  return node.content ? { ...node, content: node.content.map((child) => sized(child, size)) } : node;
}

function tableNode(
  rows: { cells: { node: RichNode; colspan: number; rowspan: number }[]; pinned: boolean }[],
  room: number,
): {
  table: RichNode;
  rowStarts: (RichNode | null)[];
} | null {
  const laid = gridRows(rows);
  if (!laid.some((cells) => cells.length > 0)) return null;
  // Each cell takes its columns' widths (colwidth, one per column it spans):
  // every cell of a column the same, so the editor's table map finds nothing
  // to fix.
  const width = Math.max(...laid.map((cells) => cells.reduce((end, c) => Math.max(end, c.col + Number(c.node.attrs?.colspan ?? 1)), 0)));
  const { widths, pt } = layoutColumns(laid, width, room);
  const grid = laid.map((cells) =>
    cells.map((cell): GridCell => {
      const span = Number(cell.node.attrs?.colspan ?? 1);
      const node: RichNode = { ...cell.node, attrs: { ...cell.node.attrs, colwidth: widths.slice(cell.col, cell.col + span) } };
      return { node: pt < BODY_PT ? sized(node, `${pt}pt`) : node, col: cell.col };
    }),
  );
  // Header rows repeat above the rows under them; a table of header rows
  // alone has nothing to repeat above.
  const pinAll = rows.every((row) => row.pinned);
  const rowStarts = grid.map((cells) => cells[0]?.node.content?.find((n) => n.type === "paragraph") ?? null);
  const content = grid.map((cells, r): RichNode => {
    // A row the rows above fill whole has no cell of its own.
    const row: RichNode = cells.length > 0 ? { type: "tableRow", content: cells.map((c) => c.node) } : { type: "tableRow" };
    if (rows[r].pinned && !pinAll) row.attrs = { pinned: true };
    return row;
  });
  return { table: { type: "table", content }, rowStarts };
}

const spanOf = (el: Element, name: string, max: number) => {
  const n = Number(el.getAttribute(name) ?? "1");
  // rowspan="0" runs to the table's end.
  if (name === "rowspan" && n === 0) return max;
  return Number.isInteger(n) && n >= 1 ? Math.min(n, max) : 1;
};

/** A TABLE block's html as a page editor table, its columns fitted to a
    text column `room` px wide; null when it holds no row. */
export function tableFromHtml(html: string, room: number): ImportTable | null {
  const host = scratchDocument().createElement("div");
  host.innerHTML = html;
  const table = host.querySelector("table");
  if (!table) return null;
  const trs = [...table.querySelectorAll("tr")].filter((tr) => tr.closest("table") === table);
  if (trs.length === 0) return null;
  const cellsOf = (tr: Element) => [...tr.children].filter((c) => /^(td|th)$/i.test(c.tagName));
  // A colspan past the most cells a row holds ("99" for a row the width of
  // the table) spans the table, never columns no row fills.
  const widest = Math.max(1, ...trs.map((tr) => cellsOf(tr).length));
  // Header rows (<thead>) that open the table repeat on every page the
  // table runs on, as Google Docs' pinned header rows do.
  let pinning = true;
  const rows = trs.map((tr) => {
    pinning = pinning && tr.parentElement?.tagName.toLowerCase() === "thead";
    const cells = cellsOf(tr).map((cell) => ({
      node: { type: cell.tagName.toLowerCase() === "th" ? "tableHeader" : "tableCell", content: cellBlocks(cell) },
      colspan: spanOf(cell, "colspan", widest),
      rowspan: spanOf(cell, "rowspan", trs.length),
    }));
    return { cells, pinned: pinning };
  });
  const built = tableNode(rows, room);
  if (!built) return null;
  const captionEl = [...table.children].find((c) => c.tagName.toLowerCase() === "caption");
  const caption = captionEl ? normalizeText(captionEl.textContent ?? "").replaceAll(ZWSP, "") : "";
  return { caption: caption || null, ...built };
}

/** A table from the parse's grid text (cells by tab, rows by line): for a
    TABLE block without html, or html that holds no row. Null when the text
    is empty. */
export function tableFromText(text: string, room: number): ImportTable | null {
  if (!text.trim()) return null;
  const rows = text.split("\n").map((line) => ({
    cells: line.split("\t").map((cell) => ({
      node: { type: "tableCell", content: [paragraphNode(inlineNodes([{ text: normalizeText(cell), marks: [] }]))] },
      colspan: 1,
      rowspan: 1,
    })),
    pinned: false,
  }));
  const built = tableNode(rows, room);
  return built ? { caption: null, ...built } : null;
}
