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

function tableNode(rows: { cells: { node: RichNode; colspan: number; rowspan: number }[]; pinned: boolean }[]): {
  table: RichNode;
  rowStarts: (RichNode | null)[];
} | null {
  const grid = gridRows(rows);
  if (!grid.some((cells) => cells.length > 0)) return null;
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

/** A TABLE block's html as a page editor table; null when it holds no row. */
export function tableFromHtml(html: string): ImportTable | null {
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
  const built = tableNode(rows);
  if (!built) return null;
  const captionEl = [...table.children].find((c) => c.tagName.toLowerCase() === "caption");
  const caption = captionEl ? normalizeText(captionEl.textContent ?? "").replaceAll(ZWSP, "") : "";
  return { caption: caption || null, ...built };
}

/** A table from the parse's grid text (cells by tab, rows by line): for a
    TABLE block without html, or html that holds no row. Null when the text
    is empty. */
export function tableFromText(text: string): ImportTable | null {
  if (!text.trim()) return null;
  const rows = text.split("\n").map((line) => ({
    cells: line.split("\t").map((cell) => ({
      node: { type: "tableCell", content: [paragraphNode(inlineNodes([{ text: normalizeText(cell), marks: [] }]))] },
      colspan: 1,
      rowspan: 1,
    })),
    pinned: false,
  }));
  const built = tableNode(rows);
  return built ? { caption: null, ...built } : null;
}
