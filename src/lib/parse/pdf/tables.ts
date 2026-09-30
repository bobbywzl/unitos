// Tables of text alone: which lines form a table run (findTableRuns, before
// segmentation), and the rows and columns a run makes (tableFromRun). And
// what every table shares: the cells of a line, a TABLE segment's html
// (ruled.ts builds the tables a page's rules draw with them).

import { geom, lineMathShare, median } from "@/lib/parse/pdf/geometry";
import { sameFlags } from "@/lib/parse/pdf/glyphs";
import { ATTACH_PUNCT_RE } from "@/lib/parse/pdf/lines";
import { isGlyphMarker, readMarker } from "@/lib/parse/pdf/markers";
import { firstPageOf } from "@/lib/parse/pdf/merge";
import { mathSpans } from "@/lib/parse/pdf/math/zones";
import { TextBuilder, boldShare, escapeHtml, isMonoLine, joinGroup, lineEndHyphen, spansFromRuns } from "@/lib/parse/pdf/text";
import type { Cell, Item, Line, PageContext, Run, Segment } from "@/lib/parse/pdf/types";

// ── Tables ──────────────────────────────────────────────────────────────────

// A color the html may carry: the drawing's #rrggbb, nothing else.
const HEX_RE = /^#[0-9a-f]{6}$/i;
// A face the html may carry: a plain font name, as the page editor names it.
const FACE_RE = /^[A-Za-z0-9][A-Za-z0-9 -]{0,39}$/;

// A paragraph of a cell that holds more than one, over the cell's text
// (which joins them with a space), and how its lines sit in the cell:
// centered, flush right, or set in from the cell's left edge (points).
export type CellParagraph = { start: number; end: number; align?: "center" | "right"; indent?: number };
// fill: the cell's shading (#rrggbb); valign: where its words sit in a row
// taller than they are (at the top when unset).
export type TableCell = { text: string; runs: Run[]; colspan?: number; rowspan?: number; paragraphs?: CellParagraph[]; fill?: string; valign?: "middle" | "bottom" };
// height: a ruled row's height on the page, in points, where the page
// sets it taller than its words (a form's field row, a signature row).
export type TableRow = { cells: TableCell[]; height?: number };
// What a table keeps of the page's look: its words' size and each column's
// width on the page, in points (the import sets the table at that size and
// its columns in those proportions: an empty form column keeps its width),
// and a ruled table's cell padding, top, right, bottom, and left, in points
// (the html's data-cell-padding, as a Word table's cell margins).
export type TableLook = { size: number; columns: number[]; padding?: [number, number, number, number] };

function clusterColumns(lines: Line[]): number[] {
  const xs = lines.flatMap((l) => l.cells.map((c) => c.x)).sort((a, b) => a - b);
  const columns: number[] = [];
  for (const x of xs) {
    const last = columns[columns.length - 1];
    if (last === undefined || x - last > 9) columns.push(x);
  }
  return columns;
}

// Column separators as x positions no text crosses. A coverage scan instead of
// x-start clustering: right-aligned number columns start at a different x on
// every row, but nothing ever crosses the gutter between columns. A
// separator sits in the middle of its gutter, or of the widest stretch of it
// the lines of `heads` leave open: a column head wider than its values
// reaches into the gutter (MMWR p. 21's Table 3 cut "(95% CI)" off its head
// at the gutter's middle).
export function columnSeparators(run: Line[], heads: Line[] = []): number[] {
  const minX = Math.min(...run.map((l) => l.x));
  const maxX = Math.max(...run.map((l) => l.xEnd));
  const step = 2;
  const n = Math.max(1, Math.ceil((maxX - minX) / step));
  const crossings = new Array<number>(n).fill(0);
  const leftOf = new Array<number>(n).fill(0);
  const rightOf = new Array<number>(n).fill(0);
  for (const line of run) {
    for (let s = 0; s < n; s++) {
      const x = minX + s * step;
      let crosses = false;
      let left = false;
      let right = false;
      for (const item of line.items) {
        if (item.x < x && item.x + item.w > x) crosses = true;
        if (item.x + item.w <= x + 1) left = true;
        if (item.x >= x - 1) right = true;
      }
      if (crosses) crossings[s]++;
      if (left) leftOf[s]++;
      if (right) rightOf[s]++;
    }
  }
  const allowed = Math.max(0, Math.floor(run.length * 0.08));
  // A column needs text on both sides in a few lines only: a label column
  // whose labels sit on their own baselines fills one line in four.
  const need = Math.max(2, Math.ceil(run.length * 0.15));
  const separators: number[] = [];
  let bandStart: number | null = null;
  for (let s = 0; s <= n; s++) {
    const open =
      s < n && crossings[s] <= allowed && leftOf[s] >= need && rightOf[s] >= need;
    if (open && bandStart === null) bandStart = s;
    if (!open && bandStart !== null) {
      const width = (s - bandStart) * step;
      if (width >= 5) separators.push(openMiddle(minX + bandStart * step, minX + s * step, heads));
      bandStart = null;
    }
  }
  return separators;
}

// The middle of the widest stretch of a gutter from a to b that no item of
// the lines crosses, 2 pt wide at the least; else the gutter's middle.
function openMiddle(a: number, b: number, lines: Line[]): number {
  const taken = lines
    .flatMap((l) => l.items.map((it) => ({ x1: it.x, x2: it.x + it.w })))
    .filter((r) => r.x2 > a && r.x1 < b)
    .sort((p, q) => p.x1 - q.x1);
  if (taken.length === 0) return (a + b) / 2;
  let best: { x1: number; x2: number } | null = null;
  let from = a;
  for (const r of [...taken, { x1: b, x2: b }]) {
    if (r.x1 - from >= 2 && (!best || r.x1 - from > best.x2 - best.x1)) best = { x1: from, x2: r.x1 };
    from = Math.max(from, r.x2);
  }
  return best ? (best.x1 + best.x2) / 2 : (a + b) / 2;
}

// A currency sign set apart from its amount (a statement's dollar signs in
// a column of their own) is the amount's: the separators after a column
// that holds signs and nothing else go (the 10-K's income statement, p.
// 54, read seven columns for its labels and three years).
const CURRENCY_RE = /^[$€£¥]$/;
export function withoutSignColumns(lines: Line[], separators: number[]): number[] {
  const cells = lines.map((l) => cellsBySeparators(l, separators));
  return separators.filter((_, c) => {
    const texts = cells.map((row) => row[c]?.text.trim() ?? "");
    return !(texts.some((t) => CURRENCY_RE.test(t)) && texts.every((t) => t === "" || CURRENCY_RE.test(t)));
  });
}

// Items joined into one cell's text and style runs, a space where the gap
// between two items reads as one.
function cellOfItems(items: Item[], size: number): Cell {
  const cell: Cell = { x: items[0]?.x ?? 0, text: "", runs: [] };
  let prevEnd: number | null = null;
  for (const item of items) {
    const gap = prevEnd === null ? 0 : item.x - prevEnd;
    if (prevEnd !== null && gap > size * 0.12 && !cell.text.endsWith(" ")) {
      const attach = ATTACH_PUNCT_RE.test(item.str) && gap < size * 0.7;
      if (!attach) cell.text += " ";
    }
    const start = cell.text.length;
    cell.text += item.str;
    const last = cell.runs[cell.runs.length - 1];
    if (last && sameFlags(last, item) && start - last.end <= 1) {
      last.end = cell.text.length;
    } else {
      // A cell keeps its formulas and its look, as a line does (lines.ts).
      cell.runs.push({
        start,
        end: cell.text.length,
        bold: item.bold,
        italic: item.italic,
        mono: item.mono,
        smallCaps: item.smallCaps,
        href: item.href,
        sup: item.sup,
        sub: item.sub,
        zone: item.zone,
        look: item.look,
      });
    }
    prevEnd = item.x + item.w;
  }
  return cell;
}

// Split one line's items at the separators. Items are pdf.js chunks, so a cell
// boundary nearly always falls between items; assignment is by item center.
export function cellsBySeparators(line: Line, separators: number[]): Cell[] {
  const buckets: Item[][] = Array.from({ length: separators.length + 1 }, () => []);
  for (const item of line.items) buckets[columnAt(item.x + item.w / 2, separators)].push(item);
  return buckets.map((bucket) => (bucket.length === 0 ? { x: 0, text: "", runs: [] } : cellOfItems(bucket, line.size)));
}

export function columnAt(x: number, separators: number[]): number {
  let idx = 0;
  while (idx < separators.length && x > separators[idx]) idx++;
  return idx;
}

// A cell's words [from, to) as html: each run with its styles, each inline
// formula that passed its check the page editor's inline equation over its
// readable characters (the converter reads its TeX; the reader shows the
// characters, and the DOM text stays the cell's text).
function wordsHtml(text: string, runs: Run[], math: { start: number; end: number; latex: string }[], from: number, to: number): string {
  const bounds = new Set<number>([from, to]);
  for (const r of [...runs, ...math]) {
    bounds.add(Math.max(from, Math.min(r.start, to)));
    bounds.add(Math.max(from, Math.min(r.end, to)));
  }
  const points = [...bounds].sort((a, b) => a - b);
  let html = "";
  for (let i = 0; i < points.length - 1; i++) {
    const [a, b] = [points[i], points[i + 1]];
    if (a === b) continue;
    const formula = math.find((m) => m.start <= a && m.end >= b);
    if (formula) {
      if (a === formula.start) html += `<span data-type="inline-math" data-latex="${escapeHtml(formula.latex).replace(/"/g, "&quot;")}">${escapeHtml(text.slice(formula.start, formula.end))}</span>`;
      continue;
    }
    const covering = runs.filter((r) => r.start <= a && r.end >= b);
    const look = covering.find((r) => r.look)?.look;
    let wrapped = escapeHtml(text.slice(a, b));
    // A raised or lowered run (a note mark, a unit's power) keeps its place.
    if (covering.some((r) => r.sup)) wrapped = `<sup>${wrapped}</sup>`;
    else if (covering.some((r) => r.sub)) wrapped = `<sub>${wrapped}</sub>`;
    if (covering.some((r) => r.mono)) wrapped = `<code>${wrapped}</code>`;
    if (covering.some((r) => r.italic)) wrapped = `<em>${wrapped}</em>`;
    if (covering.some((r) => r.bold)) wrapped = `<strong>${wrapped}</strong>`;
    if (look?.underline) wrapped = `<u>${wrapped}</u>`;
    if (look?.strike) wrapped = `<s>${wrapped}</s>`;
    const paint = [
      look?.color && HEX_RE.test(look.color) ? `color:${look.color}` : "",
      look?.highlight && HEX_RE.test(look.highlight) ? `background-color:${look.highlight}` : "",
      covering.some((r) => r.smallCaps) ? "font-variant:small-caps" : "",
    ].filter(Boolean);
    if (paint.length > 0) wrapped = `<span style="${paint.join(";")}">${wrapped}</span>`;
    html += wrapped;
  }
  return html;
}

// A cell's html: its words, or its paragraphs, each a <p> with its
// alignment or indent, the space between two in a cell gap.
function cellHtml(cell: TableCell): string {
  if (cell.text.length === 0) return "";
  // A formula a paragraph break cuts stays words.
  const paragraphs = cell.paragraphs ?? [{ start: 0, end: cell.text.length }];
  const math = mathSpans(cell.text, cell.runs).filter((m) => paragraphs.some((p) => p.start <= m.start && m.end <= p.end));
  if (!cell.paragraphs) return wordsHtml(cell.text, cell.runs, math, 0, cell.text.length);
  return cell.paragraphs
    .map((p, k) => {
      const style = p.align ? `text-align:${p.align}` : p.indent ? `margin-left:${p.indent}pt` : "";
      const attrs = `${p.indent && !p.align ? ` data-indent-left="${p.indent}"` : ""}${style ? ` style="${style}"` : ""}`;
      return `${k > 0 ? '<span class="cell-gap"> </span>' : ""}<p${attrs}>${wordsHtml(cell.text, cell.runs, math, p.start, p.end)}</p>`;
    })
    .join("");
}

// Text appended to a cell: a space between its lines, and a line-end
// hyphen decided as in a paragraph: the typesetter's goes ("predic-" over
// "tion"), a compound's stays.
function appendToCell(target: TableCell, part: { text: string; runs: Run[] }) {
  if (part.text.length === 0) return;
  const builder = new TextBuilder();
  builder.append({ text: target.text, runs: target.runs }, "");
  const drop = lineEndHyphen(target.text, part.text) === "drop";
  if (drop) builder.dropTrailingChar();
  builder.append(part, target.text.length > 0 && !drop ? " " : "");
  target.text = builder.text;
  target.runs = builder.runs;
}

// Fragmented figure text, not a real table: mostly tiny cells. Rows that
// fill every column, three or more, are a table's, however short their
// cells (Grinstead–Snell's Table 3.3: "0 1", "1 1", "2 2").
function isFragmented(rows: TableRow[]): boolean {
  const flat = rows.flatMap((r) => r.cells.map((c) => c.text.trim()).filter((t) => t.length > 0));
  const shortCells = flat.filter((c) => c.length <= 2).length;
  const full = rows.filter((r) => r.cells.every((c) => c.text.trim().length > 0)).length;
  return flat.length > 0 && shortCells / flat.length > 0.6 && !(full >= 3 && full * 5 >= rows.length * 4);
}

// The TABLE segment for rows of cells, the first headerRows of them header
// rows. A header cell keeps its bold runs: the words are bold on the page,
// and the import and the benchmark read bold from <strong>, not from <th>.
// Every cell ends with an invisible separator (tab between cells, newline
// between rows) so the table's DOM text equals block text exactly — text
// anchors inside tables depend on this (SPEC.md §5). A merged cell is one
// cell of its row, as the html draws it.
export function tableSegment(
  rows: TableRow[],
  headerRows: number,
  page: number,
  where: Pick<Segment, "box" | "lineSize" | "mathShare">,
  look?: TableLook,
): Segment {
  const points = (n: number) => Math.round(n * 10) / 10;
  // A row's height rides on its first cell of one row, as that cell's
  // height (a cell's height is its row's least height). A <tr> carries no
  // attribute: merge.ts joins a table's rows across a page break by "<tr>".
  const rowHtml = (row: TableRow, tag: "td" | "th", rowIdx: number) => {
    const tall = row.height !== undefined && row.height > 0 && row.height < 2000 ? row.cells.findIndex((c) => (c.rowspan ?? 1) === 1) : -1;
    return `<tr>${row.cells
      .map((c, cellIdx) => {
        const last = cellIdx === row.cells.length - 1;
        const gap = last
          ? rowIdx === rows.length - 1
            ? ""
            : '<span class="cell-gap">\n</span>'
          : '<span class="cell-gap">\t</span>';
        const spans = `${(c.colspan ?? 1) > 1 ? ` colspan="${c.colspan}"` : ""}${(c.rowspan ?? 1) > 1 ? ` rowspan="${c.rowspan}"` : ""}`;
        const style = [
          ...(c.fill && HEX_RE.test(c.fill) ? [`background-color:${c.fill}`] : []),
          ...(cellIdx === tall ? [`height:${points(row.height ?? 0)}pt`] : []),
          ...(c.valign ? [`vertical-align:${c.valign}`] : []),
        ];
        return `<${tag}${spans}${style.length > 0 ? ` style="${style.join(";")}"` : ""}>${cellHtml(c)}${gap}</${tag}>`;
      })
      .join("")}</tr>`;
  };
  const padding = look?.padding?.every((v) => v >= 0 && v < 100) ? ` data-cell-padding="${look.padding.map(points).join(" ")}"` : "";
  const html =
    (look ? `<table style="font-size:${points(look.size)}pt"${padding}>` : "<table>") +
    (look ? `<colgroup>${look.columns.map((w) => `<col style="width:${points(w)}pt">`).join("")}</colgroup>` : "") +
    (headerRows > 0 ? `<thead>${rows.slice(0, headerRows).map((r, i) => rowHtml(r, "th", i)).join("")}</thead>` : "") +
    `<tbody>${rows.slice(headerRows).map((r, i) => rowHtml(r, "td", headerRows + i)).join("")}</tbody>` +
    "</table>";
  const text = rows.map((r) => r.cells.map((c) => c.text).join("\t")).join("\n");
  return { type: "TABLE", text, html, page, ...where };
}

// A table's caption opens with its label and a mark after the number:
// "Table 2:", "TABLE 1.", "Table II.", "Table A1 –" ("Table 3 shows …" is
// a sentence).
const TABLE_CAPTION_RE = /^(?:table|tab\.)\s*(?:\d+|[A-Z]\d+|[IVXL]+)\s*[.:|–—-]/i;

/** A table's caption joins its table: a paragraph that opens with a
    table's label, right over the table on its first page or right under it
    on its last, is the table's <caption>, and the table's text opens with
    the caption's line, as a Word table's does (lib/parse/docx.ts). A
    caption under its table keeps its side (BELOW_CAPTION): the import draws
    it under the table. A caption between two tables is the table's on the
    side the document sets its captions, the side its captions take where a
    table stands on one side of them only: CVPR sets a caption under its
    table, IEEE over it (arXiv 2411.19946 p. 6 read each caption over the
    table after it). A sub-table's caption ("(a) Number of patches.") joins
    its grid the same way, on a page whose table caption joined its table.
    The benchmark reads a caption as its table's (the captions stood apart
    as paragraphs: real-mmwr-7301 p. 3's import read no caption). Runs
    after the joins across pages: a table continued on the next page joins
    its rows first. */
export function attachTableCaptions(segments: Segment[]): Segment[] {
  const taken = new Set<Segment>();
  // The table right under (below) or right over a caption at k, on the
  // caption's page: the one a caption under a table or over it would join.
  // through: past sub-table captions, as the side's count reads a caption
  // under a group of sub-tables (arXiv 2411.19946's "Table 4." under "(e)
  // Comparison …" and its grid).
  const tableBy = (k: number, below: boolean, through = false): Segment | undefined => {
    let j = k;
    do j += below ? -1 : 1;
    while (segments[j] && (taken.has(segments[j]) || (through && isSubCaption(segments[j]))));
    const table = segments[j];
    if (table?.type !== "TABLE" || !table.html) return undefined;
    const page = below ? (table.breaks?.at(-1)?.page ?? firstPageOf(table)) : firstPageOf(table);
    return page === segments[k].page ? table : undefined;
  };
  // A table's caption so far, when it is its link alone (ruled.ts): the
  // caption's words join it.
  const linkOnly = (table: Segment) => /^<table[^>]*><caption[^>]*>/.test(table.html ?? "") && LINK_LINE_RE.test(table.text.slice(0, table.text.indexOf("\n")));
  const open = (table: Segment | undefined): table is Segment => table !== undefined && (!table.html?.includes("<caption") || linkOnly(table));
  const labeled = segments.flatMap((s, k) => (isCaption(s) ? [k] : []));
  let over = 0;
  let under = 0;
  for (const k of labeled) {
    const [below, above] = [tableBy(k, true, true), tableBy(k, false, true)];
    if (below && !above) under++;
    if (above && !below) over++;
  }
  const side = under > over ? "below" : over > under ? "above" : null;
  // Captions on the document's side first, then the other side's captions
  // of the tables none took; with no side, the table a caption stands
  // nearer to.
  const join = (captions: number[]) => {
    for (const k of captions) {
      if (taken.has(segments[k])) continue;
      const [below, above] = [tableBy(k, true), tableBy(k, false)];
      const table = side === "below" ? below : side === "above" ? above : below && above ? nearer(segments[k], below, above) : (below ?? above);
      if (open(table)) captionOf(table, segments[k], table === below, taken);
    }
    if (!side) return;
    for (const k of captions) {
      const table = taken.has(segments[k]) ? undefined : tableBy(k, side === "above");
      if (open(table)) captionOf(table, segments[k], side === "above", taken);
    }
  };
  join(labeled);
  const pages = new Set([...taken].map((s) => s.page));
  join(segments.flatMap((s, k) => (pages.has(s.page) && isSubCaption(s) ? [k] : [])));
  // A table with no caption takes one the paragraph over it kept as its
  // last line.
  segments.forEach((table, i) => {
    const before = segments[i - 1];
    if (table.type !== "TABLE" || !table.html || !open(table) || !before || taken.has(before)) return;
    const kept = captionLine(before, firstPageOf(table));
    if (kept) captionOf(table, kept, false, taken);
  });
  return segments.filter((s) => !taken.has(s));
}

/** A caption set under its table: the table's <caption> opens with this. */
export const BELOW_CAPTION = '<caption style="caption-side: bottom">';

// Of two tables, the one a caption between them stands nearer to on the
// page: the one under it, where their places are not known.
function nearer(caption: Segment, below: Segment, above: Segment): Segment {
  const [a, b, c] = [below.box, above.box, caption.box];
  if (!a || !b || !c || firstPageOf(below) !== caption.page) return above;
  const [up, down] = [a.y1 - c.y2, c.y1 - b.y2];
  return up >= -2 && down >= -2 && up < down ? below : above;
}

// A sub-table's caption: a letter in parentheses, then its words ("(a)
// Number of patches. Ablation on …").
const SUB_CAPTION_RE = /^\([a-h]\)\s+\S/;
function isSubCaption(s: Segment): boolean {
  return s.type === "PARAGRAPH" && !s.footnote && s.text.length <= 600 && SUB_CAPTION_RE.test(s.text.trim());
}

// A caption's words join its table: a paragraph (taken off the segments)
// or a line a paragraph kept. below: the caption stands under the table.
function captionOf(table: Segment, caption: Segment | { text: string; runs: Run[] }, below: boolean, taken: Set<Segment>) {
  if ("type" in caption) taken.add(caption);
  // The caption is one line of the table's text: its breaks are spaces.
  const runs = caption.runs ?? [];
  const text = caption.text.replace(/[\t\n]/g, " ");
  const math = mathSpans(text, runs);
  const words = wordsHtml(text, runs, math, 0, text.length);
  // The caption's words keep the face and the size the page sets them in:
  // the import draws the caption at that size when it is under 9 pt
  // (arXiv 2503.22874 sets its captions in 8 pt under a 9 pt body).
  const size = sizeOf(runs) ?? ("type" in caption ? caption.lineSize : undefined);
  const face = spansFromRuns(text, runs).font?.family;
  const look = [
    size && Number.isFinite(size) && size > 0 && size <= 72 ? `font-size:${Math.round(size * 2) / 2}pt` : "",
    face && FACE_RE.test(face) ? `font-family:${face}` : "",
  ].filter(Boolean);
  const sized = look.length > 0 ? `<span style="${look.join(";")}">${words}</span>` : words;
  const html = table.html ?? "";
  if (/^<table[^>]*><caption/.test(html)) {
    // The link a table's caption held alone (ruled.ts): the words go before
    // it, on the words' side.
    table.html = html.replace(/^(<table[^>]*>)<caption[^>]*>/, `$1${below ? BELOW_CAPTION : "<caption>"}${sized} `);
    table.text = `${text} ${table.text}`;
    table.breaks = table.breaks?.map((b) => ({ ...b, offset: b.offset + text.length + 1 }));
  } else captionTable(table, text, sized, below);
  // The caption's formulas, where the table's text opens with them.
  if (math.length > 0) table.math = math;
}

// A link alone on its line: a URL or a DOI.
export const LINK_LINE_RE = /^(?:https?:\/\/|doi:\s*|www\.)\S+$/i;

/** The table's caption: its text opens with the caption's line, its html
    with the caption (the words' html, then the line's gap). below: the
    caption stands under the table (BELOW_CAPTION). */
export function captionTable(table: Segment, text: string, html: string, below = false) {
  table.html = table.html?.replace(/^<table[^>]*>/, (open) => `${open}${below ? BELOW_CAPTION : "<caption>"}${html}<span class="cell-gap">\n</span></caption>`);
  table.text = `${text}\n${table.text}`;
  table.breaks = table.breaks?.map((b) => ({ ...b, offset: b.offset + text.length + 1 }));
}

// The size most of a run of text's characters are set in (Look.size; small
// capitals at their capitals' size: synth-paper-html's caption titles are
// small capitals drawn 5 pt).
function sizeOf(runs: Run[]): number | undefined {
  const count = new Map<number, number>();
  for (const r of runs) {
    if (!r.look) continue;
    const size = r.look.capitals ?? r.look.size;
    count.set(size, (count.get(size) ?? 0) + r.end - r.start);
  }
  return [...count].sort((a, b) => b[1] - a[1])[0]?.[0];
}

// IEEE sets "TABLE I" on a line of its own over the title in capitals: no
// mark after the number (synth-paper-html's "TABLE I RESULTS ON THE
// LONG-DOCUMENT BENCHMARKS").
const IEEE_CAPTION_RE = /^TABLE\s+(?:\d+|[IVXL]+)\s+\p{Lu}/u;

function isCaption(s: Segment): boolean {
  const text = s.text.trim();
  return s.type === "PARAGRAPH" && !s.footnote && s.text.length <= 1200 && (TABLE_CAPTION_RE.test(text) || IEEE_CAPTION_RE.test(text));
}

// A caption the paragraph above a table kept as its last line, on the
// table's page, taken off the paragraph (LibreOffice's Math Guide p. 59:
// "Table 4: Relation commands" read as one paragraph with the sentence
// above it).
function captionLine(s: Segment, page: number): { text: string; runs: Run[] } | null {
  const at = s.text.lastIndexOf("\n");
  if (s.type !== "PARAGRAPH" || s.footnote || s.html || at <= 0) return null;
  const tail = s.text.slice(at + 1);
  const breaks = s.breaks ?? [];
  if (tail.length > 300 || !TABLE_CAPTION_RE.test(tail.trim()) || breaks.some((b) => b.offset > at)) return null;
  if ((breaks.at(-1)?.page ?? s.page) !== page) return null;
  const runs = s.runs ?? [];
  s.text = s.text.slice(0, at);
  s.runs = runs.filter((r) => r.start < at).map((r) => ({ ...r, end: Math.min(r.end, at) }));
  return { text: tail, runs: runs.filter((r) => r.end > at + 1).map((r) => ({ ...r, start: Math.max(0, r.start - at - 1), end: r.end - at - 1 })) };
}

// Leading rows whose words are bold: the header rows (never every row). A
// bold row in a color under a head in the page's ink is the body's (a
// slide's green "Yes" rows under its black heads: gslides-oer-5rs p. 17).
export function boldHeaderRows(rows: TableRow[]): number {
  const colored = (row: TableRow) => {
    const runs = row.cells.flatMap((c) => c.runs);
    const length = runs.reduce((sum, r) => sum + r.end - r.start, 0);
    return length > 0 && runs.reduce((sum, r) => sum + (r.look?.color ? r.end - r.start : 0), 0) * 2 > length;
  };
  let n = 0;
  while (n < rows.length - 1) {
    const cells = rows[n].cells;
    const length = cells.reduce((sum, c) => sum + c.text.length, 0);
    if (length === 0 || boldShare(cells.flatMap((c) => c.runs), length) <= 0.5) break;
    if (n > 0 && colored(rows[n]) && !colored(rows[0])) break;
    n++;
  }
  return n;
}

// A cell of a value: an amount, a share, or a count ("$ 2,174", "(357)",
// "21.0 %", "-£2,000").
export const NUMERIC_CELL_RE = /^[-−–]?[$€£¥]?\s*\(?[-−–]?[\d.,]+\)?\s*%?$/;

// Row starts in a run of lines split into cells. Rows come from the run's
// vertical rhythm: with two gap sizes present, the small gap is a wrapped
// cell line and the large one a row break; with one gap size, every line is
// its own row.
function rowStartsOf(run: Line[], cellsOf: Cell[][], leading: number): number[] {
  const size = median(run.map((l) => l.size));
  const floor = size * 0.75; // below this, same visual band (badge baselines)
  const wrapCeiling = leading * size * 1.15; // a wrapped cell line sits at text leading
  const gaps = run
    .slice(1)
    .map((l, k) => run[k].y - l.y)
    .filter((g) => g > floor);
  const small = gaps.filter((g) => g <= wrapCeiling);
  const large = gaps.filter((g) => g > wrapCeiling);
  const rowGapThreshold =
    small.length > 0 && large.length > 0
      ? (Math.max(...small) + Math.min(...large)) / 2
      : large.length > 0
        ? wrapCeiling
        : 0; // all gaps at text leading: every line is its own row

  // Row anchors: lines that carry a first-column cell, minus wraps of the
  // previous first-column cell (a first-column-only line one leading below
  // it). When some anchor sits right under a line with no first-column cell
  // — labels vertically centered beside taller cells, a header cell wrapped
  // beside its column headers — the vertical rhythm misleads: rows then come
  // from the anchors, split at the widest gap between consecutive anchors.
  const hasFirst = cellsOf.map((cells) => cells[0].text.length > 0);
  const anchors: number[] = [];
  let lastFirst = -1;
  // A statement's labels: a group's name ends in a colon, and a label that
  // wraps sets its values on its last line.
  const valued = (k: number) => cellsOf[k].slice(1).some((c) => c.text.length > 0);
  const colon = (k: number) => cellsOf[k][0].text.trim().endsWith(":");
  run.forEach((line, k) => {
    if (!hasFirst[k]) return;
    // A wrap: only the first column continues, or the first cell starts
    // lowercase ("Concealing" / "uncertainty know" — both columns wrapped).
    // A line of the first column alone opens a row under a group's name, or
    // under a row with its values when it names a group or its values come
    // on its next line (the 10-K's statement of comprehensive income, p. 55,
    // read two rows as one at each such line).
    const firstOnly = cellsOf[k].every((cell, idx) => idx === 0 || cell.text.length === 0);
    const valuesNext = k + 1 < run.length && /^\p{Ll}/u.test(cellsOf[k + 1][0].text) && valued(k + 1);
    const opens = lastFirst >= 0 && (colon(lastFirst) || (valued(lastFirst) && (colon(k) || valuesNext)));
    const continues = (firstOnly && !opens) || /^[a-z]/.test(cellsOf[k][0].text);
    const wrap =
      continues &&
      lastFirst >= 0 &&
      run[lastFirst].y - line.y <= Math.max(run[lastFirst].size, line.size) * leading * 1.35;
    lastFirst = k;
    if (!wrap) anchors.push(k);
  });
  const anchorRows =
    anchors.length >= 2 && anchors.some((k) => k > 0 && !hasFirst[k - 1]);
  const gapAt = (m: number) => run[m - 1].y - run[m].y;
  const rowStarts: number[] = [0];
  // The first anchor's other cells hold values, under head lines with no
  // first column: the head lines are head rows, a row for each line that
  // fills other columns than the line above it ("Year Ended December 31,"
  // over the years over the amounts: the 10-K's OI&E statement, p. 78, read
  // its heads into its first row).
  const filled = (k: number) => cellsOf[k].map((c) => (c.text.length > 0 ? "1" : "0")).join("");
  const values = anchors.length > 0 && cellsOf[anchors[0]].slice(1).some((c) => c.text) && cellsOf[anchors[0]].slice(1).every((c) => !c.text || NUMERIC_CELL_RE.test(c.text.trim()));
  if (anchorRows && values && anchors[0] > 0) {
    for (let m = 1; m < anchors[0]; m++) if (filled(m) !== filled(m - 1)) rowStarts.push(m);
    rowStarts.push(anchors[0]);
  }
  if (anchorRows) {
    // Lines above the first anchor: their own row when one gap stands out.
    if (anchors[0] > 1 && !values) {
      let widest = 1;
      let smallest = Infinity;
      for (let m = 1; m <= anchors[0]; m++) {
        if (gapAt(m) >= gapAt(widest)) widest = m;
        smallest = Math.min(smallest, gapAt(m));
      }
      if (gapAt(widest) > smallest * 1.3 && widest <= anchors[0]) rowStarts.push(widest);
    }
    for (let a = 0; a + 1 < anchors.length; a++) {
      let widest = anchors[a] + 1;
      for (let m = anchors[a] + 1; m <= anchors[a + 1]; m++) {
        if (gapAt(m) >= gapAt(widest)) widest = m;
      }
      rowStarts.push(widest);
    }
  } else {
    // A line with a first-column label of its own is a row whatever the
    // rhythm says: a statement sets its rows 14 pt apart and its groups 28
    // pt apart, and the rhythm read every group as one row of wrapped cells
    // (census class 3: Apple's statement of operations). Labels and values
    // are short: cells as long as a line of prose are prose (a chart's
    // labels beside a column of text), which the rhythm reads.
    const short = (texts: string[]) => median(texts.map((t) => t.length)) <= 30;
    const labels =
      short(anchors.map((k) => cellsOf[k][0].text)) &&
      short(anchors.flatMap((k) => cellsOf[k].slice(1).map((c) => c.text).filter((t) => t.length > 0)));
    run.forEach((line, k) => {
      if (k === 0) return;
      const gap = gapAt(k);
      if ((labels && anchors.includes(k)) || (rowGapThreshold > 0 ? gap > rowGapThreshold : gap > floor)) rowStarts.push(k);
    });
  }
  return rowStarts;
}

// Lines split into cells, gathered into rows at the row starts.
export function rowsOf(cellsOf: Cell[][], rowStarts: number[], columnCount: number): TableRow[] {
  const rows: TableRow[] = [];
  cellsOf.forEach((cells, k) => {
    if (rowStarts.includes(k) || rows.length === 0) {
      rows.push({ cells: Array.from({ length: columnCount }, () => ({ text: "", runs: [] })) });
    }
    const row = rows[rows.length - 1];
    cells.forEach((cell, idx) => appendToCell(row.cells[idx], cell));
  });
  return rows;
}

// A run's columns: the gutters its lines leave open. The lines over its
// first line with words in its first column are heads, a head over
// several columns among them ("Year Ended December 31," over a
// statement's years, "As of December 31, 2023" over its assets and
// liabilities): they part no gutter (the 10-K's OI&E statement read two
// years as one column, p. 78). A line in the first column starts at the
// table's left edge, or left of the first gutter every line leaves open:
// a column of numbers set flush right starts its short ones further in
// (Grinstead–Snell's Table 3.3 read its rows over "10" as heads, and the
// table as a paragraph).
function runSeparators(run: Line[]): number[] {
  const left = Math.min(...run.map((l) => l.x));
  const gutter = columnSeparators(run)[0];
  const first = Math.max(0, run.findIndex((l) => l.x <= left + 3 || (gutter !== undefined && l.x < gutter)));
  // A group's label among rows of three cells or more, from the table's left
  // edge (and a value at its end), crosses the gutters the rows leave open:
  // the rows alone part the columns (arXiv 2609.29669's "§3.1 Policy /
  // manipulation suites" joined Table 3's Benchmark and Year columns).
  const body = run.slice(first);
  const rows = body.filter((l) => !isGroupLabel(l, left));
  const scan = rows.filter((l) => l.cells.length >= 3).length >= 2 ? rows : body;
  return withoutSignColumns(run, columnSeparators(scan, run.slice(0, first)));
}

// A group's label: one phrase from the table's left edge, and at most a
// short value in a cell after it.
function isGroupLabel(line: Line, left: number): boolean {
  return line.x <= left + 3 && line.cells.length <= 2 && (line.cells.length === 1 || line.cells[1].text.trim().length <= 12);
}

// One table out of a run of gap-aligned lines. Columns come from the coverage
// scan; rows from the run's rhythm (rowStartsOf).
export function tableFromRun(run: Line[], leading: number): Segment {
  const separators = runSeparators(run);
  const columnCount = separators.length + 1;
  const page = run[0].page;
  // No gutter runs the whole way down when the wide gaps sit at a different
  // x on every line (an author line's names over an affiliation line). One
  // column is no table: the lines are a paragraph (import compare loop
  // finding: a paper's authors read as a two-row table).
  if (columnCount < 2) {
    const { text, runs } = joinGroup(run);
    return { type: "PARAGRAPH", text, page, runs, ...geom(run) };
  }
  const cellsOf = run.map((line) => cellsBySeparators(line, separators));
  const rows = rowsOf(cellsOf, rowStartsOf(run, cellsOf, leading), columnCount);
  if (isFragmented(rows)) {
    const builder = new TextBuilder();
    for (const line of run) builder.append({ text: line.text.replace(/\t/g, " "), runs: line.runs }, " ");
    return { type: "FIGURE", text: builder.text, page, runs: builder.runs, ...geom(run) };
  }
  const headerRows = rows.length > 1 && boldHeaderRows(rows) > 0 ? 1 : 0;
  const edges = [Math.min(...run.map((l) => l.x)), ...separators, Math.max(...run.map((l) => l.xEnd))];
  const look = { size: Math.round(median(run.map((l) => l.size)) * 2) / 2, columns: edges.slice(1).map((x, k) => x - edges[k]) };
  return tableSegment(rows, headerRows, page, geom(run), look);
}

// ── Tables of text alone ────────────────────────────────────────────────────

// A label line: a short label at the page's left edge, then the entry's title
// at the content column — "18:00  Check in", "2019  Engineer at X". Not a
// table row: the lines under it are the entry's body (import compare loop
// finding: a timeline read as tables and indented lists).
export function isLabelLine(line: Line, ctx: PageContext): boolean {
  if (ctx.labelColumn === null || line.cells.length !== 2) return false;
  const [label, body] = line.cells;
  return (
    line.x <= ctx.pageMinX + 4 &&
    label.text.length <= 12 &&
    Math.abs(body.x - ctx.labelColumn) < 3
  );
}

// A first-column cell on its own baseline: a single-cell line left of the
// run's second column — a row label vertically centered beside a taller cell,
// a header cell wrapped beside its column headers (import compare loop
// finding: such tables shattered into paragraphs).
function isLeftOnly(line: Line, columns: number[]): boolean {
  return (
    columns.length >= 2 &&
    line.cells.length === 1 &&
    line.xEnd < columns[1] - 4 &&
    line.x <= columns[0] + 8 &&
    line.text.length < 60
  );
}

function isAlignedLine(line: Line, columns: number[]): boolean {
  return columns.some((c, idx) => idx > 0 && Math.abs(line.x - c) < 12);
}

// Every cell of the line starts at one of the columns: the line is a row of
// the table those columns came from, whatever else it looks like.
function sitsInColumns(line: Line, columns: number[]): boolean {
  return (
    line.cells.length >= 2 &&
    line.cells.every((cell) => columns.some((c) => Math.abs(cell.x - c) < 12))
  );
}

// A row whose cells fused into one: the gap between two of them is too narrow
// to read as a separator, so the line carries one cell — but an item still
// starts at one of the run's later columns, where the next cell begins.
// tableFromRun re-splits every line of a run against the run's own columns, so
// a fused row read back into the run comes out as the row it is (import
// compare loop finding: a row whose first column nearly filled its column fell
// out of the table as a paragraph, taking the header with it).
function isFusedRowLine(line: Line, columns: number[]): boolean {
  return (
    line.cells.length === 1 &&
    columns.length >= 2 &&
    Math.abs(line.x - columns[0]) < 12 &&
    line.items.some((item) => columns.some((c, idx) => idx > 0 && Math.abs(item.x - c) < 3))
  );
}

// A two-cell line that is a table row with a wrapped first column: the page
// carries a line of three or more cells whose first and last columns are this
// line's two. A label line ("2008  Watchtower deployed …") has no such row.
export function isWrappedRowLine(line: Line, lines: Line[]): boolean {
  return lines.some(
    (row) =>
      row.cells.length >= 3 &&
      Math.abs(row.cells[0].x - line.cells[0].x) < 6 &&
      Math.abs(row.cells[row.cells.length - 1].x - line.cells[1].x) < 6,
  );
}

// A figure's caption line is no table cell: a caption at a column's foot
// beside the other column's lines read as a row of them (Nature
// Communications 55977 p. 4: "Fig. 3 | Comparison of theory and
// experiment" beside the right column).
const FIGURE_CAPTION_RE = /^(?:fig\.|figure)\s*\d+[a-z]?\s*[.:|]/i;
const holdsCaption = (line: Line) => line.cells.some((c) => FIGURE_CAPTION_RE.test(c.text.trim()));

// A cell of prose: six words or more.
const proseCell = (text: string) => text.split(/\s+/).filter((w) => /\p{L}{2}/u.test(w)).length >= 6;

// Lines whose cells hold prose: two prose cells side by side on half of
// them or more (two columns of text), or on a scan's text layer a prose
// cell on half of them or more (text beside a drawing's labels).
export function isProseColumns(lines: Line[], ocr: boolean): boolean {
  const prose = lines.filter((l) => l.cells.filter((c) => proseCell(c.text)).length >= (ocr ? 1 : 2)).length;
  return lines.length > 0 && prose * 2 >= lines.length;
}

// A lead-in: a sentence of eight words or more that ends in a colon over the
// table ("Components of OI&E were as follows (in millions):"), no head or
// row of it. A group's name in a statement is shorter ("Derivatives not
// designated as hedging instruments:").
export function leadIn(text: string): boolean {
  const words = text.trim();
  return words.endsWith(":") && words.split(/\s+/).length >= 8;
}

// A line that opens with a bullet is a list's item, no cell's wrapped line:
// a résumé's bullets under each entry's two lines (a title and its dates, a
// place and its town) ran into the entry's table.
function bulleted(line: Line): boolean {
  const marker = readMarker(line);
  return marker !== null && isGlyphMarker(marker);
}

// Form lines: every cell a label awaiting its words ("Name:"), a blank to
// fill ("____"), or boxes to tick, with no rule drawn around them (a ruled
// form is found by its grid, ruled.ts).
function isFormLines(lines: Line[]): boolean {
  const cells = lines.flatMap((l) => l.cells.map((c) => c.text.trim())).filter((t) => t.length > 0);
  return cells.length > 0 && cells.every((t) => /:$/.test(t) || /_{3,}$/.test(t) || /[☐☑☒]/.test(t));
}

// A line whose cells after the first hold no letter or digit, whose first
// cell is prose, and that goes on the sentence of the line of one cell
// above it, at its left edge.
function besideMarks(line: Line, above: Line | undefined): boolean {
  return (
    line.cells.length >= 2 &&
    line.cells.slice(1).every((c) => !/[\p{L}\p{N}]/u.test(c.text)) &&
    line.cells[0].text.trim().length >= 30 &&
    above !== undefined &&
    above.cells.length === 1 &&
    Math.abs(above.x - line.x) <= above.size &&
    /[\p{Ll},]$/u.test(above.text.trim())
  );
}

// A line cut to its first cell, in place (other readers keep the line).
function firstCellOnly(line: Line) {
  const [first, next] = line.cells;
  const end = first.text.length;
  line.items = line.items.filter((it) => it.x + it.w / 2 < next.x);
  line.cells = [first];
  line.text = first.text;
  line.runs = line.runs.filter((r) => r.start < end).map((r) => ({ ...r, end: Math.min(r.end, end) }));
  line.xEnd = Math.max(...line.items.map((it) => it.x + it.w));
}

// A row set tight: a short line of one cell whose words stand an em apart or
// more, a number among them (Grinstead–Snell's Table 6.2: "HHH 1" under "X
// Y", its columns closer than a cell's gap). Its parts count as its cells.
function tightCells(line: Line): number {
  const items = line.items.filter((it) => it.str.trim().length > 0);
  if (line.cells.length !== 1 || line.text.length > 40 || items.length < 2) return line.cells.length;
  const parts = [items[0].str];
  items.slice(1).forEach((it, k) => {
    if (it.x - (items[k].x + items[k].w) >= line.size) parts.push(it.str);
    else parts[parts.length - 1] += ` ${it.str}`;
  });
  const words = line.text.split(/\s+/).filter((w) => /\p{L}{2}/u.test(w)).length;
  return parts.length >= 2 && words <= 4 && parts.some((p) => NUMERIC_CELL_RE.test(p.trim())) ? parts.length : 1;
}

// A line of prose is one cell, whatever its gaps: a cell that opens with a
// mark the words before it take (", where μ is the mean": a tall formula's
// gap in a sentence, OpenStax's ch. 6 p. 20), or words all spaced more than
// half an em apart, five or more (a justified line beside a long link:
// arXiv 2506.06352 p. 29). A row's cells hold word spaces of a third of an
// em beside any column gap the line did not part ("CALVIN [101]").
function proseLine(line: Line): boolean {
  if (line.cells.slice(1).some((c) => /^[,;:.)\]!?](?!\d)/.test(c.text.trim()))) return true;
  const items = line.items.filter((it) => it.str.trim().length > 0);
  const gaps = items.slice(1).map((it, k) => it.x - (items[k].x + items[k].w)).sort((a, b) => b - a);
  const spaces = gaps.slice(line.cells.length - 1).filter((g) => g > line.size * 0.15);
  return spaces.length >= 4 && Math.min(...spaces) >= line.size * 0.6;
}

// Table runs, computed before segmentation. A run grows forward over
// multi-cell lines and the single-cell lines that continue a wrapped cell
// (aligned with a column, or indented past the first column, or a first-column
// line followed closely by more of the table), and grows backward over
// wrapped header lines just above the first multi-cell line. A ruled table's
// line ends a run.
export function findTableRuns(lines: Line[], ctx: PageContext): number[] {
  const runOf = new Array<number>(lines.length).fill(-1);
  // Prose beside a form's boxes is a line of one cell: its first cell goes
  // on the sentence of the line above it, and its other cells are marks
  // alone (the W-9's Part I beside its SSN boxes: "… However, for a" |
  // "resident alien, … For other  –  –"). The marks are the boxes', no
  // words of the sentence: the line keeps its first cell.
  lines.forEach((line, k) => {
    if (besideMarks(line, lines[k - 1])) firstCellOnly(line);
  });
  const cells = lines.map((line) => (proseLine(line) ? 1 : Math.max(line.cells.length, tightCells(line))));
  let runId = 0;
  let i = 0;
  while (i < lines.length) {
    // A table row is text or numbers: a line of math glyphs is an equation,
    // whatever its gaps (import compare loop finding: an equation's wide gaps
    // read as cells, and the run swept the sentences around it into a table).
    if (
      cells[i] < 2 ||
      runOf[i] !== -1 ||
      isLabelLine(lines[i], ctx) ||
      isMonoLine(lines[i]) ||
      lineMathShare(lines[i]) >= 0.4 ||
      holdsCaption(lines[i])
    ) {
      i++;
      continue;
    }
    const members: number[] = [i];
    let multi = 1;
    let leftOnlyCount = 0;
    let alignedCount = 0;
    let j = i + 1;
    while (j < lines.length) {
      const next = lines[j];
      const last = lines[members[members.length - 1]];
      const gap = last.y - next.y;
      if (next.table || gap < 0 || gap > next.size * ctx.leading * 2.2 || holdsCaption(next)) break;
      // A wrapped row line can read as a label line (a short first cell at
      // the left edge, the rest under the last column); inside a run whose
      // columns it sits at, it is a row.
      if (
        (isLabelLine(next, ctx) && !sitsInColumns(next, clusterColumns(members.map((k) => lines[k])))) ||
        isMonoLine(next) ||
        lineMathShare(next) >= 0.4
      ) {
        break;
      }
      if (cells[j] >= 2) {
        members.push(j);
        multi++;
        j++;
        continue;
      }
      if (next.size > ctx.bodySize * 1.15) break;
      if (bulleted(next) || leadIn(next.text)) break;
      const columns = clusterColumns(members.map((k) => lines[k]));
      const aligned = isAlignedLine(next, columns);
      const leftOnly = isLeftOnly(next, columns);
      const indentedPastFirst = next.x > columns[0] + 8;
      const tight = gap <= next.size * ctx.leading * 1.35;
      // A row whose cells fused into one (narrow gaps), a wrapped row line at
      // the first column, a first-column line on its own baseline, or an
      // aligned line after a row gap: the table must resume within the next
      // two lines — a multi-cell line, a first-column line, or an aligned
      // line — at row pitch, and the line must not read as prose. A fused row
      // is as long as the table is wide and ends wherever its last cell ends,
      // so the prose gate is not its test: an item at one of the columns is.
      const fused = isFusedRowLine(next, columns);
      let resumes = false;
      if (
        (Math.abs(next.x - columns[0]) < 12 || leftOnly || aligned) &&
        gap <= next.size * ctx.leading * 1.9 &&
        (fused || (next.text.length < 90 && !/[.!?]$/.test(next.text.trim())))
      ) {
        let y = next.y;
        for (let k = j + 1; k <= j + 2 && k < lines.length; k++) {
          if (lines[k].table || y - lines[k].y > lines[k].size * ctx.leading * 2.2) break;
          if (lineMathShare(lines[k]) >= 0.4) break;
          if (
            (lines[k].cells.length >= 2 && !isLabelLine(lines[k], ctx)) ||
            isLeftOnly(lines[k], columns) ||
            (lines[k].cells.length === 1 && isAlignedLine(lines[k], columns))
          ) {
            resumes = true;
            break;
          }
          y = lines[k].y;
        }
      }
      // A trailing wrap line just under the last row: closer than the row
      // pitch and short, so a following paragraph never qualifies.
      const trailing =
        Math.abs(next.x - columns[0]) < 12 &&
        gap <= next.size * ctx.leading * 1.05 &&
        next.text.length < 60;
      if (resumes || (tight && (aligned || indentedPastFirst || trailing))) {
        members.push(j);
        if (leftOnly) leftOnlyCount++;
        else if (aligned) alignedCount++;
        j++;
        continue;
      }
      break;
    }
    // Display equations read as multi-cell lines: a fraction stacks its
    // numerator and denominator on lines of their own and leaves a gap in the
    // main line, and terms sit apart. The sentence between two equations then
    // resumes the "table". A run whose multi-cell lines are mostly math
    // glyphs is equations, never a table (import compare loop finding: a
    // solution set's equations and the sentences between them became tables).
    const multiCell = members.filter((k) => lines[k].cells.length >= 2);
    const mathMulti = multiCell.filter((k) => lineMathShare(lines[k]) >= 0.3).length;
    if (mathMulti * 2 >= multiCell.length) {
      i++;
      continue;
    }
    // Lines closer than a row's height are a formula's stacked parts: a
    // fraction's numerator and denominator over and under the gap it leaves
    // in its sentence (arXiv 2502.02648 p. 10: "2N" over "at b =" over "5").
    if (members.some((k, n) => n > 0 && lines[members[n - 1]].y - lines[k].y < lines[k].size * 0.7)) {
      i++;
      continue;
    }
    // One multi-cell line alone is a "Label: text" paragraph, unless the
    // lines around it are a table whose labels sit on their own baselines.
    if (multi < 2 && !(leftOnlyCount >= 2 && alignedCount >= 2)) {
      i++;
      continue;
    }
    // Text that only lines up is no table: two columns of prose side by side
    // (a page whose columns were not split: MMWR p. 21's text above Table 3,
    // arXiv 2504.02736's reference list), form lines with no rule drawn (a
    // label, its boxes, a blank to fill), and on a scan's text layer prose
    // wrapped beside a drawing's labels.
    if (isProseColumns(multiCell.map((k) => lines[k]), ctx.ocr) || isFormLines(members.map((k) => lines[k]))) {
      i++;
      continue;
    }
    // Two lines, one of them set far larger than the body, are display
    // type: a chapter's title in spaced capitals ("CHAPTER THREE" over its
    // name, NASA SP-4408 p. 87) read as two columns of one word each.
    if (members.length <= 2 && members.some((k) => lines[k].size > ctx.bodySize * 1.4)) {
      i++;
      continue;
    }
    // A run with no gutter down it, over lines of one cell too, is no table:
    // tableFromRun joined all its lines into one paragraph (a statement's
    // last rows, the sentence under them, and the next statement: the 10-K,
    // p. 71). Its leading lines of cells are one when a gutter runs down
    // them; the other lines go back to the other readers. Lines of cells
    // alone stay one paragraph (an author line whose names stand apart).
    const columned = (ks: number[]) => runSeparators(ks.map((k) => lines[k])).length > 0;
    const single = members.findIndex((k) => lines[k].cells.length < 2);
    if (single >= 0 && !columned(members)) {
      const lead = members.slice(0, single);
      if (lead.length < 2 || !columned(lead)) {
        i++;
        continue;
      }
      members.splice(lead.length);
      j = lead[lead.length - 1] + 1;
    }
    // Backward: wrapped header lines directly above (at most 3).
    const firstEdge = runSeparators(members.map((k) => lines[k]))[0];
    const left = Math.min(...members.map((k) => lines[k].x));
    let first = members[0];
    let absorbed = 0;
    while (first > 0 && absorbed < 3) {
      const prev = lines[first - 1];
      // A head of short cells right over the run's columns, one in each
      // (Grinstead–Snell's "n  n!" over its factorials): the run's first row.
      if (absorbed === 0 && prev.cells.length >= 2 && runOf[first - 1] === -1 && prev.size <= ctx.bodySize * 1.15 && prev.y - lines[first].y <= prev.size * ctx.leading * 2.2) {
        const separators = runSeparators(members.map((k) => lines[k]));
        const heads = cellsBySeparators(prev, separators);
        if (separators.length > 0 && heads.every((c) => c.text.trim().length > 0 && c.text.length <= 24)) {
          first--;
          members.unshift(first);
        }
        break;
      }
      if (prev.cells.length !== 1 || runOf[first - 1] !== -1 || bulleted(prev) || leadIn(prev.text)) break;
      if (prev.size > ctx.bodySize * 1.15) break;
      const gap = prev.y - lines[first].y;
      if (gap < 0 || gap > prev.size * ctx.leading * 1.35) break;
      const columns = clusterColumns(members.map((k) => lines[k]));
      const aligned = isAlignedLine(prev, columns);
      const indentedPastFirst = prev.x > columns[0] + 8;
      if (!aligned && !indentedPastFirst && !isLeftOnly(prev, columns)) break;
      // A title over the table is no head: a line that reaches from the
      // first column into the others, or that stands over the first column
      // alone, set in by a quarter of it (a statement's name and its units,
      // centered over the page: the 10-K, p. 55).
      if (firstEdge !== undefined && ((prev.x < firstEdge && prev.xEnd > firstEdge) || (prev.xEnd < firstEdge && prev.x > left + (firstEdge - left) * 0.25))) break;
      // A first-column line that continues the paragraph above it (same x,
      // one leading below) is that paragraph's last line — a caption's wrap.
      if (!aligned && !indentedPastFirst && first >= 2) {
        const above = lines[first - 2];
        if (
          above.cells.length === 1 &&
          Math.abs(above.x - prev.x) < 12 &&
          above.y - prev.y <= prev.size * ctx.leading * 1.35
        )
          break;
      }
      first--;
      members.unshift(first);
      absorbed++;
    }
    for (const k of members) runOf[k] = runId;
    runId++;
    i = j;
  }
  return runOf;
}
