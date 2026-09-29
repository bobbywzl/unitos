// Ruled tables: a table's rules say where it is before any text is read —
// the grid of a fully ruled table (lattice.ts), or the horizontal rules that
// bound a booktabs table and its head. Found in the page loop, before the
// column split, a table's text leaves the flow there and comes back as one
// line at its place in the reading order (ruledTables, takeTables,
// placeTables); segmentPage builds its TABLE segment (tableFromRegion). A
// full-width table on a two-column page read as two halves, one per column,
// before (census class 3: MMWR's Table 1 in six blocks), and prose beside a
// table joined its rows.

import type { Fill, PageDrawing, PathBox, Rule } from "@/lib/parse/pdf/drawing";
import { geom, median } from "@/lib/parse/pdf/geometry";
import { joinedRules, latticeGrids, ruleStacks, type Grid, type GridCell } from "@/lib/parse/pdf/lattice";
import { buildLines } from "@/lib/parse/pdf/lines";
import { resolveZones } from "@/lib/parse/pdf/math/zones";
import {
  boldHeaderRows,
  captionTable,
  cellsBySeparators,
  columnAt,
  columnSeparators,
  isProseColumns,
  leadIn,
  LINK_LINE_RE,
  NUMERIC_CELL_RE,
  rowsOf,
  tableSegment,
  withoutSignColumns,
  type CellParagraph,
  type TableCell,
  type TableRow,
} from "@/lib/parse/pdf/tables";
import { escapeHtml, insidePair, isMonoLine, joinGroup } from "@/lib/parse/pdf/text";
import type { Box, Cell, Item, Line, MathZone, Run, Segment, TableRegion } from "@/lib/parse/pdf/types";

// What the ruled tables read of a page's drawing.
type TableDrawing = Pick<PageDrawing, "rules" | "fills" | "images" | "paths">;

// An item's center: its glyphs sit from the baseline up.
const centerOf = (it: Item) => ({ x: it.x + it.w / 2, y: it.y + it.size * 0.3 });
const inBox = (it: Item, b: Box) => {
  const c = centerOf(it);
  return c.x > b.x1 && c.x < b.x2 && c.y > b.y1 && c.y < b.y2;
};
// A line as far from both sides of its cell, within a quarter of its size.
const balancedIn = (l: Line, b: Box) => Math.abs(l.x - b.x1 - (b.x2 - l.xEnd)) <= l.size * 0.25;

// A fill as light as the page: white, or a color too light to see on it.
const WHITE_RE = /^#(?:f[5-9a-f]){3}$/i;

// A sliver between two grid lines closer than this, with no text in it, is
// no column or row: a frame drawn double, a shaded cell set inside its border.
const SLIVER = 6;

// The grid with its slivers closed: grid lines that bound an empty sliver
// become one line, and a cell that spanned the sliver spans one fewer. A
// run of slivers is one line: Word shades a header cell with a second box
// set in by the cell's padding, and a form's two shaded header cells read
// their insets and the rule between them as a column of their own.
function closeSlivers(grid: Grid, items: Item[]): Grid {
  // Each line's run: a line an empty sliver from the one before joins its
  // run. A run stands at its outer line on the table's edge (the border),
  // else at its middle one (the rule between two insets).
  const runsOf = (lines: number[], dir: "x" | "y") => {
    const runOf = [0];
    for (let k = 1; k < lines.length; k++) {
      const [a, b] = [Math.min(lines[k - 1], lines[k]), Math.max(lines[k - 1], lines[k])];
      const empty = !items.some((it) => {
        const c = centerOf(it);
        const v = dir === "x" ? c.x : c.y;
        const inside = dir === "x" ? c.y > grid.box.y1 && c.y < grid.box.y2 : c.x > grid.box.x1 && c.x < grid.box.x2;
        return inside && v > a && v < b;
      });
      runOf.push(runOf[k - 1] + (b - a < SLIVER && empty ? 0 : 1));
    }
    const count = runOf[runOf.length - 1] + 1;
    const kept = Array.from({ length: count }, (_, r) => {
      const members = lines.filter((_, k) => runOf[k] === r);
      return r === 0 ? members[0] : r === count - 1 ? members[members.length - 1] : members[Math.floor(members.length / 2)];
    });
    return { kept, runOf };
  };
  const x = runsOf(grid.xs, "x");
  const y = runsOf(grid.ys, "y");
  const cells: GridCell[] = [];
  for (const c of grid.cells) {
    const col = x.runOf[grid.xs.indexOf(c.x1)];
    const colEnd = x.runOf[grid.xs.indexOf(c.x2)];
    const row = y.runOf[grid.ys.indexOf(c.y2)];
    const rowEnd = y.runOf[grid.ys.indexOf(c.y1)];
    if (colEnd <= col || rowEnd <= row) continue;
    if (cells.some((d) => d.row === row && d.col === col)) continue;
    // The cell reaches the kept lines, over the slivers it closed.
    const box = { x1: x.kept[col], x2: x.kept[colEnd], y1: y.kept[rowEnd], y2: y.kept[row] };
    cells.push({ ...box, col, row, colspan: colEnd - col, rowspan: rowEnd - row });
  }
  return { box: grid.box, xs: x.kept, ys: y.kept, cells };
}

// Two tables drawn one on the other share a border: the rows above it draw
// other column lines than the rows under it, each part the same lines on
// every row that draws any (the invoice's order details over its lines of
// goods read as one grid of eight columns). A row across the whole width
// goes with the part above it. A part that draws one column line is no
// table of its own: its rows are the other part's, a cell merged across
// (a form's fields: the W-9 sets its 5 and 6 beside one box, its 3a and 3b
// beside another, and read as two tables).
function splitStacked(grid: Grid): Grid[] {
  const rows = grid.ys.length - 1;
  const lines = Array.from({ length: rows }, (_, r) =>
    [...new Set(grid.cells.filter((c) => c.row === r).flatMap((c) => [c.col, c.col + c.colspan]))].filter((k) => k > 0 && k < grid.xs.length - 1).sort((a, b) => a - b).join(","),
  );
  for (let r = 1; r + 2 <= rows; r++) {
    const above = [...new Set(lines.slice(0, r).filter(Boolean))];
    const below = [...new Set(lines.slice(r).filter(Boolean))];
    if (above.length !== 1 || below.length !== 1 || !lines[r] || rows - r < 2) continue;
    if (!above[0].includes(",") || !below[0].includes(",")) continue;
    const shared = above[0].split(",").some((k) => below[0].split(",").includes(k));
    if (shared || grid.cells.some((c) => c.row < r && c.row + c.rowspan > r)) continue;
    return [partOf(grid, 0, r), ...splitStacked(partOf(grid, r, rows))];
  }
  return [grid];
}

// The rows from r0 to r1 of a grid as a grid of their own, on the column
// lines their cells draw.
function partOf(grid: Grid, r0: number, r1: number): Grid {
  const cells = grid.cells.filter((c) => c.row >= r0 && c.row < r1);
  const used = [...new Set(cells.flatMap((c) => [c.col, c.col + c.colspan]))].sort((a, b) => a - b);
  const xs = used.map((k) => grid.xs[k]);
  const ys = grid.ys.slice(r0, r1 + 1);
  return {
    box: { x1: xs[0], x2: xs[xs.length - 1], y1: ys[ys.length - 1], y2: ys[0] },
    xs,
    ys,
    cells: cells.map((c) => ({ ...c, row: c.row - r0, col: used.indexOf(c.col), colspan: used.indexOf(c.col + c.colspan) - used.indexOf(c.col) })),
  };
}

// A grid is a table when its text fills it: two rows and two columns at
// least, words in two cells or more and in a third of its cells, and no
// picture, listing, or prose inside. A chart's frame and gridlines hold a
// legend at most; a lone box or a signature line has one cell; a slide's
// background and title band reach the page's edges; highlighted lines of a
// paragraph abut like cells and hold its sentences.
function isTableGrid(grid: Grid, items: Item[], drawing: TableDrawing, pageWidth: number, pageHeight: number): boolean {
  const b = grid.box;
  if (grid.ys.length < 3 || grid.xs.length < 3) return false;
  // A grid the page does not show is no table: no rule on it, every box
  // filled in the page's white (Word paints a paragraph's lines white, and
  // a Chinese paper's last three references read as a table).
  const on = (r: Box) => r.x1 < b.x2 + 1 && r.x2 > b.x1 - 1 && r.y1 < b.y2 + 1 && r.y2 > b.y1 - 1;
  if (!drawing.rules.some(on) && drawing.fills.filter(on).every((f) => f.color !== undefined && WHITE_RE.test(f.color))) return false;
  const edges = [b.x1 <= pageWidth * 0.02, b.x2 >= pageWidth * 0.98, b.y1 <= pageHeight * 0.02, b.y2 >= pageHeight * 0.98];
  if (edges.filter(Boolean).length >= 2) return false;
  if (drawing.images.some((img) => img.x1 < b.x2 && img.x2 > b.x1 && img.y1 < b.y2 && img.y2 > b.y1)) return false;
  if (isChart(b, grid.xs, grid.ys, grid.cells.length, drawing)) return false;
  const inside = items.filter((it) => inBox(it, b));
  if (inside.length === 0 || inside.filter((it) => it.mono).length * 2 > inside.length) return false;
  const lines = buildLines(inside, 0);
  if (lines.filter((l) => isProseLine(l, b.x2 - b.x1)).length * 2 >= lines.length) return false;
  const filled = grid.cells.filter((c) => inside.some((it) => inBox(it, c)));
  if (filled.length < 2 || filled.length * 3 < grid.cells.length) return false;
  return !mostlyTiny(filled.map((c) => inside.filter((it) => inBox(it, c)).map((it) => it.str.trim()).join("")));
}

// A grid drawn around groups of cells, not around each: LaTeX's |l|ccc|
// draws no rule between the value columns, and \hline under the head and
// between groups of rows only. Its text has more rows or columns than the
// grid: phrases far apart side by side in one grid column on most of its
// lines, or three lines or more in a grid row's first cell with every
// other cell's lines on the same baselines. Wrapped cells are no rows: a
// cell of words whose lines run to its right edge, or cells that each end
// after their own count of lines (a form's cells, a Chinese table's). The
// text reads the rows and columns then, the rules only bound it (arXiv
// 2506.06752's run-time tables read 25 rows as one, 2302.12627's three
// value columns as one).
function isGroupGrid(grid: Grid, items: Item[]): boolean {
  for (let c = 0; c + 1 < grid.xs.length; c++) {
    const inColumn = items.filter((it) => centerOf(it).x > grid.xs[c] && centerOf(it).x < grid.xs[c + 1]);
    const lines = buildLines(inColumn, 0);
    const split = lines.filter((l) => l.items.some((it, k) => k > 0 && it.x - (l.items[k - 1].x + l.items[k - 1].w) > l.size * 1.5));
    if (lines.length >= 2 && split.length * 2 > lines.length) return true;
  }
  const baselines = (cell: Box) => [...new Set(items.filter((it) => inBox(it, cell)).map((it) => Math.round(it.y)))];
  const same = (a: number[], b: number[]) => a.every((y) => b.some((v) => Math.abs(v - y) <= 2)) && b.every((y) => a.some((v) => Math.abs(v - y) <= 2));
  // A line wraps when it runs to the cell's right quarter, or when the next
  // line's first word had no room left on it (a form's label in a narrow
  // cell: the SF 298's "8. PERFORMING / ORGANIZATION REPORT / NUMBER" on
  // the baselines of the name and address beside it).
  const wrapped = (cell: Box) => {
    const lines = buildLines(items.filter((it) => inBox(it, cell)), 0);
    const reach = cell.x2 - (cell.x2 - cell.x1) * 0.25;
    const right = cell.x2 - Math.max(0, Math.min(...lines.map((l) => l.x)) - cell.x1);
    const full = (l: Line, next: Line) => l.xEnd >= reach || l.xEnd + l.size * 0.28 + next.firstWordWidth > right;
    return lines.length >= 2 && lines.slice(0, -1).every((l, k) => full(l, lines[k + 1]) && /\p{L}{2}/u.test(l.text));
  };
  for (let r = 0; r + 1 < grid.ys.length; r++) {
    const cells = grid.cells.filter((cell) => cell.row === r).sort((a, b) => a.col - b.col);
    const first = cells.length >= 2 ? baselines(cells[0]) : [];
    const rest = cells.slice(1).map(baselines).filter((b) => b.length > 0);
    if (first.length >= 3 && rest.length > 0 && rest.every((b) => same(b, first)) && !cells.some(wrapped)) return true;
  }
  return false;
}

// A plot's frame and gridlines hold its tick labels and legend: mostly
// numbers and letters of one or two characters (tableFromRun reads a run of
// tiny cells as figure text the same way).
function mostlyTiny(texts: string[]): boolean {
  const filled = texts.filter((t) => t.length > 0);
  return filled.length > 0 && filled.filter((t) => t.length <= 2).length * 5 > filled.length * 3;
}

// Is the box a chart's frame? Its axes read as a grid or as booktabs rules
// (arXiv 2502.02648's plots). A chart draws what a table never does: curves,
// polylines, markers — paths that are no rule, no filled box, and no box on
// the table's own lines (xs, ys) — or its data as a staircase of rules off
// those lines. Three shapes, or more stray rules than twice the cells, make
// a chart.
function isChart(b: Box, xs: number[], ys: number[], cells: number, drawing: TableDrawing): boolean {
  const on = (v: number, lines: number[]) => lines.some((l) => Math.abs(l - v) <= 1.5);
  const within = (r: Box) => r.x1 >= b.x1 - 1 && r.x2 <= b.x2 + 1 && r.y1 >= b.y1 - 1 && r.y2 <= b.y2 + 1;
  const stray = drawing.rules.filter((r) => within(r) && (r.dir === "h" ? !on(r.y1, ys) : !on(r.x1, xs))).length;
  if (stray > Math.max(20, cells * 2)) return true;
  const same = (p: Box, f: Box) => Math.abs(p.x1 - f.x1) <= 0.5 && Math.abs(p.x2 - f.x2) <= 0.5 && Math.abs(p.y1 - f.y1) <= 0.5 && Math.abs(p.y2 - f.y2) <= 0.5;
  const shapes = drawing.paths.filter(
    (p) =>
      !p.clip &&
      p.x2 - p.x1 > 3 &&
      p.y2 - p.y1 > 3 &&
      p.x1 >= b.x1 - 1 &&
      p.x2 <= b.x2 + 1 &&
      p.y1 >= b.y1 - 1 &&
      p.y2 <= b.y2 + 1 &&
      !drawing.fills.some((f) => same(p, f)) &&
      !(on(p.x1, xs) && on(p.x2, xs) && on(p.y1, ys) && on(p.y2, ys)),
  );
  return shapes.length >= 3;
}

// Lines as a table reads them: a line of prose, set across most of the
// region in one piece, is no row (a caption, a paragraph between two tables
// that share their rules' width). Prose is eight words of letters: a row of
// numbers set close is none (arXiv 2302.12627's "ℙ(1852 ∈ 𝒮̂) 0.00 (0.00)
// 0.00 (0.00) 0.00 (0.00)" cut its table in three). Chinese sets no spaces:
// twenty characters are a sentence's worth. Column heads set an em apart,
// too close to part cells, are no prose either: prose has word spaces
// (MMWR p. 21's "Vaccination status beneficiaries related TE person-days
// …" cut Table 3's head from its body).
const CJK_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;
const CJK_START_RE = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
function isProseLine(line: Line, width: number): boolean {
  if (line.cells.length !== 1 || line.xEnd - line.x <= width * 0.6) return false;
  const apart = line.items.filter((it, k) => k > 0 && it.x - (line.items[k - 1].x + line.items[k - 1].w) > line.size * 0.7).length;
  if (apart >= 3) return false;
  const words = line.text.split(/\s+/).filter((w) => /\p{L}{2}/u.test(w));
  return words.length >= 8 || (line.text.match(CJK_RE)?.length ?? 0) >= 20;
}

const CAPTION_START_RE = /^(fig\.|figure|table|tab\.)\s*([\dIVX]+|[A-Z]\d+)\b/i;

// The regions a stack of same-width rules bounds: the bands between
// consecutive rules, joined while they read as one table. A band that holds
// a caption or prose ends a region (two tables stacked at one width with a
// heading and the next caption between them, a page's head rule and foot
// rule around its text, two columns of text between a form's signature
// rule and the page's foot rule: the IRS W-9's instructions).
function stackRegions(rules: Rule[], x1: number, x2: number, items: Item[]): Box[] {
  const sorted = [...rules].sort((a, b) => b.y1 - a.y1);
  const regions: Box[] = [];
  let top: number | null = null;
  let bottom: number | null = null;
  const close = () => {
    if (top !== null && bottom !== null && bottom < top) regions.push({ x1, x2, y1: bottom, y2: top });
    top = null;
    bottom = null;
  };
  for (let k = 0; k + 1 < sorted.length; k++) {
    const band = { x1: x1 - 2, x2: x2 + 2, y1: sorted[k + 1].y1, y2: sorted[k].y1 };
    const lines = buildLines(items.filter((it) => inBox(it, band)), 0);
    const breaks =
      lines.some((l) => isProseLine(l, x2 - x1) || CAPTION_START_RE.test(l.text)) ||
      isProseColumns(lines.filter((l) => l.cells.length >= 2), false);
    if (breaks) {
      close();
      continue;
    }
    if (top === null) top = sorted[k].y1;
    bottom = sorted[k + 1].y1;
    // A line alone at the band's foot, set larger than every other line of
    // the band, is the heading the rule under it underlines, not a row: a
    // résumé's "Experience" (12 pt over entries of 10 and 10.9 pt) closed
    // its Education entries' table.
    const low = lines[lines.length - 1];
    if (lines.length >= 2 && low.cells.length === 1 && low.size >= Math.max(...lines.slice(0, -1).map((l) => l.size)) * 1.05) {
      bottom = low.y + low.size;
      close();
    }
  }
  close();
  return regions;
}

// A rule stack as wide as one column of a table bounds no table of its
// own: most of its lines run on past its sides, with words on their
// baselines on both sides of it (a row's label and its other values) or an
// em or less outside it. The 10-K underlines each column of values apart,
// and its OI&E statement read as four tables, a year's values in each
// (p. 78).
function slices(box: Box, lines: Line[], items: Item[]): boolean {
  const on = lines.filter((l) => {
    const row = items.filter((it) => Math.abs(it.y - l.y) < l.size * 0.5);
    const left = row.filter((it) => it.x + it.w < box.x1 - 2);
    const right = row.filter((it) => it.x > box.x2 + 2);
    const close = left.some((it) => it.x + it.w > box.x1 - l.size) || right.some((it) => it.x < box.x2 + l.size);
    return (left.length > 0 && right.length > 0) || close;
  });
  return on.length * 2 > lines.length;
}

// A rule region is a table when its lines split into two columns or more and
// two rows or more carry cells in two of them. A listing's frame, a figure's
// box around one label, a region of prose, and a plot's frame are not.
function isTableRegion(lines: Line[], width: number): boolean {
  if (lines.length < 2 || lines.filter((l) => isMonoLine(l)).length * 2 > lines.length) return false;
  if (lines.some((l) => isProseLine(l, width))) return false;
  const separators = columnSeparators(lines);
  if (separators.length === 0) return false;
  const multi = lines.filter((l) => new Set(l.items.map((it) => columnAt(it.x + it.w / 2, separators))).size >= 2);
  if (multi.length < 2) return false;
  return !mostlyTiny(lines.flatMap((l) => cellsBySeparators(l, separators).map((c) => c.text.trim())));
}

// The column ranges a line's phrases cover, bounds the column edges (the
// table's left edge first). Items a word gap apart are one phrase. A phrase
// belongs to a column it covers half of, or that holds a quarter of it: a
// head centered over a column of right-aligned numbers reaches past the
// column's edge into the next.
function phraseColumns(line: Line, bounds: number[], ruled: number[] = []): { from: number; to: number; items: Item[] }[] {
  const inner = bounds.slice(1, -1);
  const phrases: Item[][] = [];
  for (const it of line.items) {
    const last = phrases[phrases.length - 1];
    const prev = last?.[last.length - 1];
    const gap = prev ? it.x - (prev.x + prev.w) : Infinity;
    // A gap wider than a word space parts two heads of narrow columns when a
    // column edge lies in it ("Kitaev" and "complex fermion" 5 pt apart) or
    // the two sit over two columns (Word's "Capacity" and "Output (GWh)"
    // 10 pt apart, the edge under "Output"). A column rule drawn through the
    // gap parts them however narrow it is (arXiv 2504.02736 p. 9's heads,
    // a cell each between rules 2 pt from their words).
    const edge =
      prev !== undefined &&
      (ruled.some((x) => x > prev.x + prev.w - 0.5 && x < it.x + 0.5) ||
        (gap > line.size * 0.45 &&
          (bounds.some((b) => b > prev.x + prev.w && b < it.x) || columnAt(centerOf(prev).x, inner) !== columnAt(centerOf(it).x, inner))));
    if (prev && gap < line.size * 1.2 && !edge) last.push(it);
    else phrases.push([it]);
  }
  const columns = bounds.length - 1;
  const out = phrases.map((phrase) => {
    const x1 = phrase[0].x;
    const x2 = phrase[phrase.length - 1].x + phrase[phrase.length - 1].w;
    const covered: number[] = [];
    for (let c = 0; c < columns; c++) {
      const overlap = Math.min(x2, bounds[c + 1]) - Math.max(x1, bounds[c]);
      if (overlap > 0 && (overlap >= (bounds[c + 1] - bounds[c]) * 0.5 || overlap >= (x2 - x1) * 0.25)) covered.push(c);
    }
    const center = Math.min(columns - 1, columnAt((x1 + x2) / 2, inner));
    if (covered.length === 0) covered.push(center);
    return { from: covered[0], to: covered[covered.length - 1], center, items: phrase };
  });
  // Two phrases of one line share no column: a column both reach goes to
  // the one centered in it (Word's "Output (GWh)", right-aligned over its
  // numbers, reached a quarter of itself into the column of "Capacity").
  for (let k = 1; k < out.length; k++) {
    const [a, b] = [out[k - 1], out[k]];
    if (b.from > a.to) continue;
    if (a.to === a.center) b.from = Math.min(b.to, a.to + 1);
    else a.to = Math.max(a.from, b.from - 1);
  }
  return out.map(({ from, to, items }) => ({ from, to, items }));
}

// The head over a grid that draws only the table's body: Apple's statements
// shade their rows, and the column heads above them sit on no fill (the
// heads read as paragraphs, apart from their table). Lines right above the
// grid, inside its width, while each phrase sits over whole columns: a
// label over the first column, a head over value columns. A title centered
// over the table reaches from the first column into the others and ends the
// head, and so do a caption, a sentence, and a line set larger than the
// table. A grid whose first row holds bold words in two cells or more (the
// column heads) has its head.
function gridHead(grid: Grid, body: Item[], items: Item[]): Item[] {
  const b = grid.box;
  const boldCells = grid.cells.filter((c) => c.row === 0 && body.some((it) => it.bold && inBox(it, c))).length;
  if (boldCells >= 2) return [];
  const size = median(body.map((it) => it.size));
  const pitch = median(grid.ys.slice(1).map((y, k) => grid.ys[k] - y));
  const above = items.filter((it) => centerOf(it).y > b.y2 && it.x >= b.x1 - 2 && it.x + it.w <= b.x2 + 2);
  const lines = buildLines(above, 0);
  let edge = b.y2;
  let top: Line | null = null;
  let stop: Line | null = null;
  // The heads beside a lead-in's last words (below).
  let beside: Item[] = [];
  // Six lines at most: a head of four over a first row the grid's shading
  // leaves out (apple-fy24q4 p. 4's "Three Months Ended" over its dates,
  // its column heads, and its first row).
  for (let k = lines.length - 1; k >= 0 && k >= lines.length - 6; k--) {
    const line = lines[k];
    // A line over the first column alone, set well in from its left edge,
    // above the column heads, is a title centered over the page (a
    // statement's line of units over its year head: the 10-K's income
    // statement, p. 54); right over the rows it is their label
    // (apple-fy24q4 p. 2's "ASSETS:").
    const phrases = phraseColumns(line, grid.xs);
    // A lead-in's words over the first column end the head: a sentence that
    // ends in a colon ("The following table presents our cash flows (in
    // millions):"), or its last words under a line of prose. The 10-K took
    // them into its heads on six pages; beside "millions):" its line holds
    // "As of December 31, 2023", a head still (p. 68).
    const lead = phrases.find((p) => p.to === 0);
    const words = lead ? lead.items.map((it) => it.str).join(" ").trim() : "";
    if (lead && (leadIn(words) || (words.endsWith(":") && k > 0 && isProseLine(lines[k - 1], b.x2 - b.x1)))) {
      const end = Math.max(...lead.items.map((it) => it.x + it.w));
      beside = above.filter((it) => Math.abs(it.y - line.y) < line.size * 0.5 && it.x > end);
      stop = line;
      break;
    }
    const titled = top !== null && phrases.every((p) => p.to === 0) && line.x > grid.xs[0] + (grid.xs[1] - grid.xs[0]) * 0.25;
    const aligned = !phrases.some((p) => p.from === 0 && p.to > 0) && !titled;
    const plain = !CAPTION_START_RE.test(line.text) && !/[.!?]$/.test(line.text.trim()) && !isProseLine(line, b.x2 - b.x1);
    // A line that runs on past the table's sides is the page's: a running
    // head with its page number beside the table (synth-notes-html p. 8's
    // dice table took its running head for a head row).
    const beyond = items.some((it) => Math.abs(it.y - line.y) < line.size * 0.5 && (it.x + it.w < b.x1 - 2 || it.x > b.x2 + 2));
    if (line.y - edge > pitch * 1.5 || line.size > size * 1.15 || !aligned || !plain || beyond) {
      stop = line;
      break;
    }
    top = line;
    edge = line.y + line.size * 0.7;
  }
  if (!top) return beside;
  // The lines are copies (buildLines): the head is every item from the grid
  // up to halfway to the line that ended it.
  const cut = stop ? (top.y + stop.y) / 2 + size * 0.3 : top.y + top.size;
  return [...above.filter((it) => centerOf(it).y < cut), ...beside];
}

// A box to tick: a square drawn empty, its four sides ruled, about the size
// of the words on its line, apart from other squares, words right after it
// or right before it (a form's boxes: the W-9's seven boxes of line 3a read
// as a chart's marks, and their form as no table). Its mark is ☐, set as
// the words beside it.
const CHECKBOX = "\u2610";
function checkboxes(drawing: PageDrawing, items: Item[]): { squares: PathBox[]; marks: Item[] } {
  const near = (a: number, b: number) => Math.abs(a - b) <= 1;
  const across = (r: Rule, a: number, b: number) => (r.dir === "h" ? r.x1 <= a + 1 && r.x2 >= b - 1 : r.y1 <= a + 1 && r.y2 >= b - 1);
  const ruled = (p: Box) =>
    drawing.rules.some((r) => r.dir === "h" && near(r.y1, p.y1) && across(r, p.x1, p.x2)) &&
    drawing.rules.some((r) => r.dir === "h" && near(r.y1, p.y2) && across(r, p.x1, p.x2)) &&
    drawing.rules.some((r) => r.dir === "v" && near(r.x1, p.x1) && across(r, p.y1, p.y2)) &&
    drawing.rules.some((r) => r.dir === "v" && near(r.x1, p.x2) && across(r, p.y1, p.y2));
  // A square filled in a color is a chart's legend key, no box to tick.
  const filled = (p: Box) => drawing.fills.some((f) => f.color !== undefined && !WHITE_RE.test(f.color) && near(f.x1, p.x1) && near(f.x2, p.x2) && near(f.y1, p.y1) && near(f.y2, p.y2));
  const found = drawing.paths.filter((p) => {
    const [w, h] = [p.x2 - p.x1, p.y2 - p.y1];
    return !p.clip && w >= 4 && w <= 16 && Math.abs(w - h) <= w * 0.15 && ruled(p) && !filled(p) && !items.some((it) => inBox(it, p));
  });
  const squares: PathBox[] = [];
  const marks: Item[] = [];
  for (const p of found) {
    const side = p.x2 - p.x1;
    if (found.some((q) => q !== p && q.x1 < p.x2 + side * 0.5 && q.x2 > p.x1 - side * 0.5 && q.y1 < p.y2 + side * 0.5 && q.y2 > p.y1 - side * 0.5)) continue;
    const beside = items.filter(
      (it) =>
        it.y >= p.y1 - it.size * 0.4 &&
        it.y <= (p.y1 + p.y2) / 2 &&
        ((it.x >= p.x2 && it.x - p.x2 <= it.size * 2) || (it.x + it.w <= p.x1 && p.x1 - (it.x + it.w) <= it.size * 2)),
    );
    const word = beside.sort((a, b) => Math.min(Math.abs(a.x - p.x2), Math.abs(p.x1 - a.x - a.w)) - Math.min(Math.abs(b.x - p.x2), Math.abs(p.x1 - b.x - b.w)))[0];
    if (!word || side < word.size * 0.6 || side > word.size * 1.8) continue;
    squares.push(p);
    marks.push({ ...word, str: CHECKBOX, x: p.x1, w: side, href: null, math: false, glyphs: undefined, zone: undefined, sup: undefined, sub: undefined });
  }
  return { squares, marks };
}

// The ruled tables of a page, from its rules and filled boxes: grids first,
// then the regions of rule stacks outside them.
export function ruledTables(all: Item[], page: PageDrawing, pageWidth: number, pageHeight: number): TableRegion[] {
  // Blank items (the spaces pdf.js reports between words) say nothing of
  // where text is: one in a sliver between two cells kept the sliver open.
  const words = all.filter((it) => it.str.trim().length > 0);
  // A form's boxes to tick read as ☐ in their cells; their squares are no
  // rules of a table and no marks of a chart.
  const boxes = checkboxes(page, words);
  const items = [...words, ...boxes.marks];
  const squared = (r: Rule) => boxes.squares.some((s) => r.x1 >= s.x1 - 1 && r.x2 <= s.x2 + 1 && r.y1 >= s.y1 - 1 && r.y2 <= s.y2 + 1);
  const drawing = { ...page, rules: page.rules.filter((r) => !squared(r)), paths: page.paths.filter((p) => !boxes.squares.includes(p)) };
  const regions: TableRegion[] = [];
  // A grid inside the rules of a wider table is part of that table: its
  // vertical rules run between some columns only, and the horizontal rules
  // reach past them, on the grid's own row lines (arXiv 2504.02736's Table
  // III read as a grid of two cells, the rest of it lost). A frame drawn
  // around a grid holds it and draws none of its rows (the invoice's order
  // grid inside the frame around the sample).
  const wide = ruleStacks(joinedRules(drawing.rules.filter((r) => r.dir === "h")), 40).flatMap((stack) =>
    stackRegions(stack.rules, stack.x1, stack.x2, items).map((box) => ({ box, ys: stack.rules.map((r) => r.y1) })),
  );
  const grids = latticeGrids(drawing.rules, drawing.fills)
    .map((raw) => closeSlivers(raw, items))
    .flatMap((grid) => {
      // Parts whose words set more columns than their lines draw are one
      // table's rows, shaded apart (the 10-K's summary of results, p. 36,
      // read as two tables at a row whose shading drew other edges).
      const parts = splitStacked(grid);
      return parts.length > 1 && parts.some((part) => isGroupGrid(part, items.filter((it) => inBox(it, part.box)))) ? [grid] : parts;
    })
    .filter((grid) => {
      const g = grid.box;
      const inWider = wide.some(
        ({ box: b, ys }) =>
          b.y1 <= g.y1 + 3 &&
          b.y2 >= g.y2 - 3 &&
          b.x1 <= g.x1 + 3 &&
          b.x2 >= g.x2 - 3 &&
          b.x2 - b.x1 > g.x2 - g.x1 + 10 &&
          grid.ys.filter((y) => ys.some((r) => Math.abs(r - y) <= 2.5)).length * 2 >= grid.ys.length,
      );
      return !inWider && isTableGrid(grid, items, drawing, pageWidth, pageHeight);
    });
  // A grid's head is text no grid holds: the lines above a form's grid are
  // the grid above it, never its head.
  const loose = items.filter((it) => !grids.some((grid) => inBox(it, grid.box)));
  for (const grid of grids) {
    const body = items.filter((it) => inBox(it, grid.box));
    if (isGroupGrid(grid, body)) {
      // Its head, found against the columns its text sets: a statement
      // shades its rows, and its year head stands over the shading (the
      // 10-K's income statement, p. 54). Its rows hold several lines: the
      // head stands within the lines' pitch (arXiv 2302.12627 p. 24 took
      // the last row of a matrix 30 pt above its Table 3 for a head row).
      const b = grid.box;
      const bodyLines = buildLines(body, 0);
      const head = gridHead({ ...grid, xs: [b.x1, ...columnSeparators(bodyLines), b.x2], ys: bodyLines.map((l) => l.y) }, body, loose);
      const box = head.length > 0 ? { ...b, y2: Math.max(...head.map((it) => it.y + it.size)) } : b;
      const inside = [...head, ...body];
      const inner = joinedRules(drawing.rules.filter((r) => r.dir === "h" && r.y1 < box.y2 - 1 && r.y1 > box.y1 + 1 && r.x1 >= box.x1 - 3 && r.x2 <= box.x2 + 3));
      regions.push({ box, items: inside, lines: buildLines(inside, 0), grid: null, rules: inner, drawing });
      continue;
    }
    const head = gridHead(grid, body, loose);
    const box = head.length > 0 ? { ...grid.box, y2: Math.max(...head.map((it) => it.y + it.size)) } : grid.box;
    const inside = [...head, ...body];
    regions.push({ box, items: inside, lines: buildLines(inside, 0), grid, rules: [], drawing });
  }
  const free = (b: Box) => !regions.some((r) => b.x1 < r.box.x2 && b.x2 > r.box.x1 && b.y1 < r.box.y2 && b.y2 > r.box.y1);
  const rules = joinedRules(drawing.rules.filter((r) => r.dir === "h" && free({ x1: r.x1, x2: r.x2, y1: r.y1 - 1, y2: r.y2 + 1 })));
  for (const stack of ruleStacks(rules, 40)) {
    for (const box of stackRegions(stack.rules, stack.x1, stack.x2, items)) {
      if (!free(box)) continue;
      const inside = items.filter((it) => inBox(it, { ...box, x1: box.x1 - 2, x2: box.x2 + 2 }));
      const lines = buildLines(inside, 0);
      if (!isTableRegion(lines, box.x2 - box.x1) || slices(box, lines, items)) continue;
      const inner = rules.filter((r) => r.y1 < box.y2 - 1 && r.y1 > box.y1 + 1 && r.x1 >= box.x1 - 3 && r.x2 <= box.x2 + 3);
      const region = { box, items: inside, lines, grid: null, rules: inner, drawing };
      // The rules drawn between its columns are the table's, no chart's
      // (PLOS's tables rule every cell apart: forty rules read as a plot).
      const ruledXs = [...new Set(columnRules(region).map((r) => r.x1))];
      if (isChart(box, [box.x1, ...ruledXs, box.x2], stack.rules.map((r) => r.y1), lines.length, drawing)) continue;
      regions.push(region);
    }
  }
  // A table's own link under its last rule goes with it, out of the text
  // flow (PLOS sets each table's DOI there, and it ran into the paragraph
  // after the table: "….t001 their results").
  const kept = new Set(regions.flatMap((r) => r.items));
  for (const region of regions) region.items.push(...linkUnder(region, items.filter((it) => !kept.has(it))));
  return regions;
}

// The line right under a table that is a link alone, inside its width.
function linkUnder(region: TableRegion, items: Item[]): Item[] {
  const b = region.box;
  const size = median(region.items.map((it) => it.size));
  const below = items.filter((it) => centerOf(it).y < b.y1 && centerOf(it).y > b.y1 - size * 2.5 && it.x >= b.x1 - 2 && it.x + it.w <= b.x2 + 2);
  // The line's own items, not buildLines' copies: they leave the text flow.
  const [line] = buildLines(below, 0);
  return line && LINK_LINE_RE.test(line.text.trim()) ? below.filter((it) => Math.abs(it.y - line.y) < line.size * 0.5) : [];
}

// The page's items with each table's text taken out and one item in its
// place: the item goes through the column split and the line building like
// text, so the table lands where a reader meets it (a table across the
// gutter is a row between the column bands, a table inside a column a line
// of that column), and placeTables turns it into the table's own line.
export function takeTables(items: Item[], regions: TableRegion[]): Item[] {
  const taken = new Set(regions.flatMap((r) => r.items));
  const out = items.filter((it) => !taken.has(it));
  for (const region of regions) {
    const size = median(region.items.map((it) => it.size));
    out.push({
      str: "\uFFFC",
      x: region.box.x1,
      w: region.box.x2 - region.box.x1,
      // The box's middle: no line of text sits there.
      y: (region.box.y1 + region.box.y2) / 2 - size * 0.3,
      size,
      bold: false,
      italic: false,
      mono: false,
      smallCaps: false,
      href: null,
      math: false,
      table: region,
    });
  }
  return out;
}

// Each table item as a line of its own at its place in the reading order:
// no cells and no text, so no reader of lines takes it for text; its y is
// the table's top edge. An item a line of text took in (text beside a
// table) leaves that line, and the table follows it.
export function placeTables(lines: Line[]): Line[] {
  const out: Line[] = [];
  for (const line of lines) {
    const tables = line.items.flatMap((it) => (it.table ? [{ region: it.table, size: it.size }] : []));
    if (tables.length === 0) {
      out.push(line);
      continue;
    }
    const rest = line.items.filter((it) => !it.table);
    if (rest.length > 0) out.push(...buildLines(rest, line.page));
    for (const { region, size } of tables) {
      out.push({
        cells: [],
        text: "",
        runs: [],
        items: [],
        x: region.box.x1,
        xEnd: region.box.x2,
        y: region.box.y2,
        size,
        page: line.page,
        firstWordWidth: 0,
        mathChars: 0,
        yMin: region.box.y1,
        yMax: region.box.y2,
        table: region,
      });
    }
  }
  return out;
}

// A ruled table's rows and columns. A grid gives them: each item lands in
// the cell its center is in, and a merged cell spans what it covers. Without
// a grid, the lines between the rules give them: the columns from the text
// under the header rule, the header rows above it (split where a partial
// rule runs between two of its lines), the body rows by the rhythm.
export function tableFromRegion(region: TableRegion, page: number): Segment {
  // The table's own link under its last rule (linkUnder) is its caption's
  // line, the caption's words joining it (attachTableCaptions).
  const link = region.items.filter((it) => centerOf(it).y < region.box.y1 - 1);
  if (link.length === 0) return tableOfRegion(region, page);
  const table = tableOfRegion({ ...region, items: region.items.filter((it) => !link.includes(it)) }, page);
  const text = buildLines(link, page).map((l) => l.text.trim()).join(" ");
  if (table.html) captionTable(table, text, escapeHtml(text));
  return table;
}

function tableOfRegion(region: TableRegion, page: number): Segment {
  const lines = buildLines(region.items, page);
  const where = { ...geom(lines), box: region.box, mathShare: 0 };
  // The lines the cells' words come from: their formulas are read last,
  // against the glyphs and rules the page draws (a failed check keeps the
  // words; synth-notes-tex's table of fractions read "1 36" for 1/36).
  const built: Line[] = [];
  const segment = (rows: TableRow[], headerRows: number, edges: number[]) => {
    resolveZones(built, region.drawing);
    const look = { size: Math.round(textSize(region.items) * 2) / 2, columns: edges.slice(1).map((x, k) => x - edges[k]) };
    return tableSegment(rows, headerRows, page, where, look);
  };
  if (region.grid) {
    const grid = region.grid;
    // The head found over the grid: its lines grouped into rows, a row per
    // change in the columns its phrases cover (a head's wrapped lines over
    // the same columns are one row).
    const headLines = buildLines(region.items.filter((it) => centerOf(it).y > grid.box.y2), page);
    const groups: Line[][] = [];
    let last = "";
    headLines.forEach((line, k) => {
      const covers = phraseColumns(line, grid.xs).map((p) => `${p.from}-${p.to}`).join(",");
      if (k === 0 || covers !== last || headLines[k - 1].y - line.y > line.size * 1.6) groups.push([]);
      groups[groups.length - 1].push(line);
      last = covers;
    });
    const head = groups.map((g, k) => headerRow(g, grid.xs, built, [], filledBelow(groups.slice(k + 1), grid.xs)));
    // A lone label under the column heads ("ASSETS:" under a balance
    // sheet's dates) is a row across the table, not a head its column
    // spans down to (apple-fy24q4 p. 2).
    const label = head.length >= 2 ? head[head.length - 1] : null;
    if (label && label.cells[0].text && label.cells.slice(1).every((c) => !c.text)) label.cells = [{ ...label.cells[0], colspan: grid.xs.length - 1 }];
    const rows = [...head, ...gridRows(grid, region.items.filter((it) => centerOf(it).y <= grid.box.y2), page, built, region.drawing)];
    const headerRows = boldHeaderRows(rows);
    spanHeadColumns(rows, headerRows);
    return segment(rows, headerRows, grid.xs);
  }
  const width = region.box.x2 - region.box.x1;
  // A line's phrases are its words: pdf.js reads phrases across a column
  // gap into one string, and a column rule drawn through the string cuts
  // it (arXiv 2504.02736's Table III read its three heads "Kitaev",
  // "complex fermion", "bosonic" as one, 4 pt apart).
  const drawn = columnRules(region);
  const cuts = (it: Item) =>
    drawn.filter((r) => r.x1 > it.x + it.w * 0.05 && r.x1 < it.x + it.w * 0.95 && r.y1 <= centerOf(it).y && r.y2 >= centerOf(it).y).map((r) => r.x1);
  const phrased = buildLines(region.items.flatMap(splitWide).flatMap((it) => splitAt(it, [...new Set(cuts(it))].sort((a, b) => a - b))), page);
  const full = region.rules.filter((r) => r.x2 - r.x1 >= width * 0.9).map((r) => r.y1);
  // With no full rule under the head, the first rule under two lines or
  // more that spans some columns alone parts the head from the body (a web
  // table's border under "arXiv | PubMed" and not under the heads that span
  // both head rows: synth-paper-html's Table I).
  const under = region.rules
    .filter((r) => r.x2 - r.x1 < width * 0.9 && phrased.filter((l) => l.y > r.y1).length >= 2 && phrased.filter((l) => l.y < r.y1).length >= 2)
    .map((r) => r.y1)
    .sort((a, b) => b - a)[0];
  const headerRule = full.find((y) => phrased.some((l) => l.y > y) && phrased.filter((l) => l.y < y).length >= 2) ?? under;
  let head = headerRule === undefined ? [] : phrased.filter((l) => l.y > headerRule);
  let body = headerRule === undefined ? phrased : phrased.filter((l) => l.y < headerRule);
  // With no rule under the head, the lines at the top with no words in the
  // first column are the column heads (a statement's year head and its
  // years over the amounts: the 10-K's income statement, p. 54).
  const labels = headerRule === undefined && body.length >= 3 ? columnSeparators(body)[0] : undefined;
  if (labels !== undefined) {
    let k = 0;
    while (k < body.length - 2 && body[k].items.every((it) => it.x >= labels)) k++;
    head = body.slice(0, k);
    body = body.slice(k);
  }
  // Header rows: lines between two partial rules are one row, each cell its
  // column's words; a cell whose words cross a column separator spans the
  // columns it covers, or the ones the partial rule under it spans.
  const partial = region.rules.filter((r) => r.x2 - r.x1 < width * 0.9);
  const headGroups: Line[][] = [];
  // A head line over two phrases or more of the line under it is a row of
  // its own ("arXiv" over "R-1 R-L"), not a wrapped head.
  const spans = (upper: Line, lower: Line) => phrasesOf(upper).some((p) => phrasesOf(lower).filter((q) => q.x1 < p.x2 && q.x2 > p.x1).length >= 2);
  head.forEach((line, k) => {
    const cut = k > 0 && (partial.some((r) => r.y1 < head[k - 1].y && r.y1 > line.y) || spans(head[k - 1], line));
    if (k === 0 || cut) headGroups.push([]);
    headGroups[headGroups.length - 1].push(line);
  });
  // The columns: the column rules drawn, and the gaps no body line crosses,
  // each set where the column heads (the last head row) leave it room. A
  // head row parts a column its values' merged cells cross: "EN-DE" and
  // "EN-FR" under "Training Cost (FLOPs)" over "3.3 · 10^18" set across
  // both (arXiv 1706.03762's Table 2).
  const ruledAt = [...new Set(drawn.map((r) => r.x1))];
  const open = (a: number, b: number) => !body.some((l) => l.items.some((it) => it.x < Math.max(a, b) && it.x + it.w > Math.min(a, b)));
  const scanned = withoutSignColumns(
    body.length >= 2 ? body : phrased,
    [
      ...ruledAt,
      ...columnSeparators(body.length >= 2 ? body : phrased, headGroups.at(-1) ?? []).filter((x) => !ruledAt.some((d) => open(x, d))),
    ].sort((a, b) => a - b),
  );
  const separators = [...scanned, ...headSeparators(headGroups.at(-1) ?? [], body, scanned, region.box)].sort((a, b) => a - b);
  const columnCount = separators.length + 1;
  const bounds = [region.box.x1, ...separators, region.box.x2];
  const rows: TableRow[] = [];
  headGroups.forEach((group, k) => rows.push(headerRow(group, bounds, built, partial, filledBelow(headGroups.slice(k + 1), bounds), body, drawn)));
  const headerRows = rows.length;
  spanHeadColumns(rows, headerRows);
  if (body.length > 0) {
    built.push(...body);
    const cellsOf = body.map((line) => cellsBySeparators(line, separators));
    const starts = regionRowStarts(body, cellsOf);
    const bodyRows = rowsOf(cellsOf, starts, columnCount);
    spanValues(bodyRows, body, starts, separators, ruledAt);
    rows.push(...spanCenteredLabels(bodyRows, starts.map((k) => body[k].y), full));
  }
  return segment(rows, headerRows || (rows.length > 1 && boldHeaderRows(rows) > 0 ? 1 : 0), bounds);
}

// The column rules a region draws: vertical rules inside it, at one x
// (their pieces share the x of the longest), that run through two fifths of
// its height or more; a table ruled between its columns draws them row by
// row. Each piece keeps its own extent: it cuts only what it crosses.
function columnRules(region: TableRegion): Rule[] {
  const b = region.box;
  const inside = region.drawing.rules.filter((r) => r.dir === "v" && r.x1 > b.x1 + 2 && r.x1 < b.x2 - 2 && r.y2 > b.y1 && r.y1 < b.y2);
  const groups: Rule[][] = [];
  for (const r of [...inside].sort((p, q) => p.x1 - q.x1)) {
    const group = groups[groups.length - 1];
    if (group && r.x1 - group[0].x1 <= 1.5) group.push(r);
    else groups.push([r]);
  }
  const length = (g: Rule[]) => g.reduce((sum, r) => sum + Math.min(r.y2, b.y2) - Math.max(r.y1, b.y1), 0);
  return groups
    .filter((g) => length(g) >= (b.y2 - b.y1) * 0.4)
    .flatMap((g) => {
      const x = g.reduce((best, r) => (r.y2 - r.y1 > best.y2 - best.y1 ? r : best)).x1;
      return g.map((r) => ({ ...r, x1: x, x2: x }));
    });
}

// An item cut at its wide gaps: two glyphs more than 0.8 of the size apart,
// with a space between them in the string, part two phrases. An item whose
// glyphs do not match its characters one to one stays whole.
function splitWide(it: Item): Item[] {
  const glyphs = it.glyphs ?? [];
  const chars: number[] = [];
  for (let i = 0; i < it.str.length; i += String.fromCodePoint(it.str.codePointAt(i) ?? 0).length) chars.push(i);
  // The glyphs stand for the characters, or for the characters less the
  // spaces (a browser's PDF draws its spaces, TeX's does not).
  const drawn = chars.filter((i) => it.str[i].trim());
  const mapped = glyphs.length === drawn.length ? drawn : glyphs.length === chars.length ? chars : null;
  if (glyphs.length < 2 || !mapped) return [it];
  const placed = mapped.map((i, k) => ({ i, g: glyphs[k] })).filter((p) => it.str[p.i].trim());
  const out: Item[] = [];
  let from = 0;
  for (let k = 1; k <= placed.length; k++) {
    const wide =
      k < placed.length &&
      placed[k].g.x - (placed[k - 1].g.x + placed[k - 1].g.w) > it.size * 0.8 &&
      /\s/.test(it.str.slice(placed[k - 1].i, placed[k].i));
    if (k < placed.length && !wide) continue;
    const own = placed.slice(from, k);
    const [first, last] = [own[0].g, own[own.length - 1].g];
    const end = k < placed.length ? placed[k].i : it.str.length;
    const inside = new Set(own.map((p) => p.g));
    out.push({ ...it, str: it.str.slice(own[0].i, end).trimEnd(), x: first.x, w: last.x + last.w - first.x, glyphs: glyphs.filter((g, n) => inside.has(g) || (mapped[n] >= own[0].i && mapped[n] < end)) });
    from = k;
  }
  return out;
}

// A line's phrases: its items a word gap apart or closer.
function phrasesOf(line: Line): { x1: number; x2: number }[] {
  const out: { x1: number; x2: number }[] = [];
  for (const it of line.items) {
    const last = out[out.length - 1];
    if (last && it.x - last.x2 < line.size * 0.6) last.x2 = Math.max(last.x2, it.x + it.w);
    else out.push({ x1: it.x, x2: it.x + it.w });
  }
  return out;
}

// The columns a head row parts where the body's own gaps are crossed: two
// heads set apart over one column of the body ("EN-DE" and "EN-FR" under
// "Training Cost (FLOPs)", arXiv 1706.03762's Table 2) part it, when most
// body lines with words on both sides of the gap between the heads leave
// it open and the few that cross it are values set across both (a merged
// cell: "3.3 · 10^18").
function headSeparators(head: Line[], body: Line[], separators: number[], box: Box): number[] {
  const out: number[] = [];
  for (const line of head) {
    const phrases = phrasesOf(line);
    for (let k = 1; k < phrases.length; k++) {
      const [a, b] = [phrases[k - 1].x2, phrases[k].x1];
      if (b - a < line.size * 0.8 || separators.some((x) => x > a && x < b)) continue;
      const x = (a + b) / 2;
      const lo = Math.max(box.x1, ...separators.filter((s) => s < x));
      const hi = Math.min(box.x2, ...separators.filter((s) => s > x));
      let both = 0;
      let across = 0;
      for (const row of body) {
        const inside = phrasesOf(row).filter((p) => p.x2 > lo && p.x1 < hi);
        if (inside.some((p) => p.x1 < x && p.x2 > x)) across++;
        else if (inside.some((p) => p.x2 <= x) && inside.some((p) => p.x1 >= x)) both++;
      }
      if (both >= 2 && across * 2 <= both) out.push(x);
    }
  }
  return out;
}

// A value set across two columns or more is one cell spanning them: a
// phrase with a fifth of it or more on each side of a column's edge ("3.3 ·
// 10^18" under both of Table 2's cost columns, arXiv 1706.03762). Its row is
// read again without the edges it crosses. starts: each row's first line.
function spanValues(rows: TableRow[], lines: Line[], starts: number[], separators: number[], ruled: number[] = []) {
  rows.forEach((row, r) => {
    const rowLines = lines.slice(starts[r], starts[r + 1] ?? lines.length);
    // A column rule drawn is never crossed: the values on its sides are two.
    const crossed = new Set(
      rowLines
        .flatMap((l) => phrasesOf(l))
        .flatMap((p) => separators.filter((x) => !ruled.includes(x) && x - p.x1 >= (p.x2 - p.x1) * 0.2 && p.x2 - x >= (p.x2 - p.x1) * 0.2)),
    );
    if (crossed.size === 0) return;
    const kept = separators.filter((x) => !crossed.has(x));
    const [merged] = rowsOf(rowLines.map((l) => cellsBySeparators(l, kept)), [0], kept.length + 1);
    // Each cell covers the columns up to the next edge kept.
    let col = 0;
    row.cells = merged.cells.map((cell, k) => {
      const end = k < kept.length ? separators.indexOf(kept[k]) + 1 : separators.length + 1;
      const span = end - col;
      col = end;
      return span > 1 ? { ...cell, colspan: span } : cell;
    });
  });
}

// A label set alone on its line midway between two rows, with no rule
// between them and no row of its group beyond them, is the first cell of
// both (arXiv 2503.10997: "Image-only" beside the rows of two models). ys:
// each row's first baseline; rules: the full-width rules inside the table.
function spanCenteredLabels(rows: TableRow[], ys: number[], rules: number[]): TableRow[] {
  const apart = (a: number, b: number) => rules.some((y) => y < ys[a] && y > ys[b]);
  const empty = (r: number) => r >= 0 && r < rows.length && rows[r].cells[0].text.length === 0;
  const alone = (r: number) => rows[r].cells.every((c, i) => i === 0 || c.text.length === 0) && !empty(r);
  const out: TableRow[] = [];
  const drop = new Set<number>();
  for (let r = 0; r < rows.length; r++) {
    if (drop.has(r)) continue;
    const label =
      r > 0 &&
      r + 1 < rows.length &&
      alone(r) &&
      empty(r - 1) &&
      empty(r + 1) &&
      !apart(r - 1, r) &&
      !apart(r, r + 1) &&
      Math.abs(ys[r] - (ys[r - 1] + ys[r + 1]) / 2) <= (ys[r - 1] - ys[r + 1]) * 0.25 &&
      (r - 2 < 0 || apart(r - 2, r - 1) || !empty(r - 2)) &&
      (r + 2 >= rows.length || apart(r + 1, r + 2) || !empty(r + 2));
    if (!label) {
      out.push(rows[r]);
      continue;
    }
    const above = out[out.length - 1];
    above.cells[0] = { ...rows[r].cells[0], rowspan: 2 };
    rows[r + 1] = { cells: rows[r + 1].cells.slice(1) };
  }
  return out;
}

// A head column empty above its last head row spans every head row: a head
// set at the foot of a head that other columns split in two (MMWR's
// "Provider type (no.)" beside "All topical antifungal prescribers" over
// "No. of prescribers").
function spanHeadColumns(rows: TableRow[], count: number) {
  if (count < 2) return;
  const starts = (row: TableRow) => {
    let col = 0;
    return row.cells.map((cell) => {
      const at = col;
      col += cell.colspan ?? 1;
      return at;
    });
  };
  const last = rows[count - 1];
  const lastStarts = starts(last);
  // Right to left: a cell taken out of a row moves only the cells after it.
  for (let i = last.cells.length - 1; i >= 0; i--) {
    const cell = last.cells[i];
    const col = lastStarts[i];
    if (cell.text.length === 0 || (cell.colspan ?? 1) > 1) continue;
    const emptyAbove = rows.slice(0, count - 1).every((row) => {
      const k = starts(row).indexOf(col);
      return k >= 0 && row.cells[k].text.length === 0 && (row.cells[k].colspan ?? 1) === 1;
    });
    if (!emptyAbove) continue;
    rows[0].cells[starts(rows[0]).indexOf(col)] = { ...cell, rowspan: count };
    for (let r = 1; r < count - 1; r++) rows[r].cells.splice(starts(rows[r]).indexOf(col), 1);
    last.cells.splice(i, 1);
  }
}

// Rows between a table's rules, by the pitch of its lines: a line less than
// 0.7 of the pitch under the line before shares its row (a label wrapped
// beside its row's numbers, which sit on the label's middle: MMWR's Table 2
// fused five rows into one by the text leading's rhythm). A line whose
// words all go on lowercase continues the row above it (a wrapped cell),
// when its first column is empty, or when two of its cells or more each go
// on from a cell above that ends no sentence and a cell the row above
// fills stays empty (arXiv 2503.22874's Table 4: "per cent CL |
// observations (EBL Saldana) |" under "0.500 < z < 0.537 at 95 | Global
// fit of the photohadronic model to independent | This work"; arXiv
// 2506.06752's variables and their descriptions fill every column: rows).
function regionRowStarts(lines: Line[], cellsOf: Cell[][]): number[] {
  const gaps = lines.slice(1).map((l, k) => lines[k].y - l.y);
  const pitch = median(gaps);
  const starts = [0];
  // Two lines that each hold a label and values are two rows however close:
  // a statement's blank rows between its groups doubled the median gap (the
  // 10-K's summary of results, p. 36, fused its rows in pairs).
  const full = (cells: Cell[]) => cells[0].text.length > 0 && cells.slice(1).some((c) => c.text.length > 0);
  for (let k = 1; k < lines.length; k++) {
    const gap = gaps[k - 1];
    if (gap < pitch * 0.7 && !(full(cellsOf[k]) && full(cellsOf[k - 1]))) continue;
    const cells = cellsOf[k];
    const filled = cells.filter((c) => c.text.length > 0);
    const lower = filled.every((c) => /^\p{Ll}/u.test(c.text));
    const above = cellsOf[k - 1];
    const goesOn =
      filled.length >= 2 &&
      cells.some((c, j) => c.text.length === 0 && (above[j]?.text.trim().length ?? 0) > 0) &&
      cells.every((c, j) => c.text.length === 0 || ((above[j]?.text.trim().length ?? 0) > 0 && !/[.!?:;]["'”’)\]]?$/.test(above[j].text.trim())));
    const wrap = gap <= pitch * 1.3 && lower && (cells[0].text.length === 0 || goesOn);
    if (!wrap) starts.push(k);
  }
  return starts;
}

// One header row out of lines: the words of each column joined, a phrase
// over several columns one cell spanning them. bounds are the column edges,
// the table's left edge first.
function headerRow(lines: Line[], bounds: number[], built: Line[], rules: Rule[] = [], below: boolean[] = [], body: Line[] = [], cuts: Rule[] = []): TableRow {
  type Piece = { from: number; to: number; items: Item[] };
  const pieces: Piece[] = [];
  const columns = bounds.length - 1;
  // A column's middle is its words' middle when the body gives it words: a
  // column that starts in a wide gutter (a statement's amounts after its
  // labels) stands at its words, not at the gutter's middle.
  const middles = bounds.slice(1).map((x, c) => {
    const inside = body.flatMap((l) => l.items).filter((it) => centerOf(it).x > bounds[c] && centerOf(it).x < x);
    return inside.length > 0 ? (Math.min(...inside.map((it) => it.x)) + Math.max(...inside.map((it) => it.x + it.w))) / 2 : (bounds[c] + x) / 2;
  });
  const drawnXs = [...new Set(cuts.map((r) => r.x1))];
  const middleOf = (p: { items: Item[] }) => (p.items[0].x + p.items[p.items.length - 1].x + p.items[p.items.length - 1].w) / 2;
  for (const line of lines) {
    // The column rules drawn through the line part its phrases, and bound
    // its cells when the line leaves out some the body draws: a head spans
    // the columns between the two around it (PLOS's "Fig 2A, segment 1"
    // over its "exp." and "theo."). A table ruled after its first column
    // alone draws that rule through every row (arXiv 2302.12627's
    // |l|ccc|): its heads are read by their words.
    const crossing = cuts.filter((r) => r.y1 <= line.y + line.size * 0.3 && r.y2 >= line.y + line.size * 0.3).map((r) => r.x1);
    const through = drawnXs.some((x) => !crossing.includes(x)) ? crossing : [];
    const phrases = phraseColumns(line, bounds, crossing);
    for (const phrase of phrases) {
      // A rule drawn under a head spans the columns the head does (a
      // booktabs \cmidrule): its ends say which, where a head centered
      // over them falls short of the first (MMWR p. 21's Table 3). A rule
      // under the line's other heads too is the row's.
      const x = middleOf(phrase);
      const rule = rules.find((r) => r.y1 < line.y && line.y - r.y1 <= line.size * 1.5 && r.x1 <= x && r.x2 >= x);
      const own = rule && !phrases.some((q) => q !== phrase && middleOf(q) > rule.x1 && middleOf(q) < rule.x2) ? rule : undefined;
      const lo = Math.max(bounds[0], ...through.filter((c) => c < x));
      const hi = Math.min(bounds[bounds.length - 1], ...through.filter((c) => c > x));
      const within = (a: number, b: number) => middles.flatMap((m, c) => (m > a && m < b ? [c] : []));
      const under = through.length > 0 ? within(lo, hi) : own ? within(own.x1, own.x2) : [];
      const { from, to, items } = under.length > 0 ? { from: under[0], to: under[under.length - 1], items: phrase.items } : phrase;
      const piece = pieces.find((p) => p.from <= to && p.to >= from);
      if (piece) {
        piece.from = Math.min(piece.from, from);
        piece.to = Math.max(piece.to, to);
        piece.items.push(...items);
      } else pieces.push({ from, to, items: [...items] });
    }
  }
  // Pieces that now overlap merge.
  pieces.sort((a, b) => a.from - b.from);
  const merged: Piece[] = [];
  for (const p of pieces) {
    const last = merged[merged.length - 1];
    if (last && p.from <= last.to) {
      last.to = Math.max(last.to, p.to);
      last.items.push(...p.items);
    } else merged.push(p);
  }
  // A head centered over columns spans them: it grows a column on each
  // side while it stays centered over what it spans and the heads under it
  // fill those columns (apple-fy24q4 p. 4: "Three Months Ended" over its
  // four columns). below: the columns the head rows under this one fill.
  merged.forEach((p, k) => {
    const middle = (Math.min(...p.items.map((it) => it.x)) + Math.max(...p.items.map((it) => it.x + it.w))) / 2;
    const free = (c: number) => c >= 0 && c < columns && below[c] && (merged[k - 1]?.to ?? -1) < c && (merged[k + 1]?.from ?? columns) > c;
    while (free(p.from - 1) && free(p.to + 1)) {
      const [x1, x2] = [bounds[p.from - 1], bounds[p.to + 2]];
      if (Math.abs((x1 + x2) / 2 - middle) > (x2 - x1) * 0.1) break;
      p.from--;
      p.to++;
    }
  });
  const cells: TableCell[] = [];
  let col = 0;
  for (const p of merged) {
    while (col < p.from) {
      cells.push({ text: "", runs: [] });
      col++;
    }
    const pieceLines = buildLines(p.items, 0);
    built.push(...pieceLines);
    const cell: TableCell = { ...linesText(pieceLines) };
    if (p.to > p.from) cell.colspan = p.to - p.from + 1;
    cells.push(cell);
    col = p.to + 1;
  }
  while (col < columns) {
    cells.push({ text: "", runs: [] });
    col++;
  }
  return { cells };
}

// The columns head rows fill: a column one of their phrases covers.
function filledBelow(groups: Line[][], bounds: number[]): boolean[] {
  const filled = new Array<boolean>(bounds.length - 1).fill(false);
  for (const line of groups.flat()) for (const p of phraseColumns(line, bounds)) for (let c = p.from; c <= p.to; c++) filled[c] = true;
  return filled;
}

// A cell's lines as one run of text: wrapped lines joined, a line-end
// hyphen decided as in a paragraph at every join (a cell's line short of
// its edge kept "predic-" before "tion"), never a line break (a newline
// ends a table row in the table's text).
function linesText(lines: Line[]): { text: string; runs: Run[] } {
  const { text, runs } = joinGroup(lines, true);
  return { text: text.replace(/\n/g, " "), runs };
}

// The rows of a grid: each item in the cell its center is in; an item that
// runs across a column line is cut there (splitAt). Each cell's lines go
// into `built`, where the table's formulas are read.
function gridRows(grid: Grid, items: Item[], page: number, built: Line[], drawing: TableDrawing): TableRow[] {
  const inner = grid.xs.slice(1, -1);
  const pieces = items.flatMap((it) => splitAt(it, inner.filter((x) => x > it.x + it.w * 0.05 && x < it.x + it.w * 0.95)));
  const cells = grid.cells.flatMap((cell) => unmerged(cell, grid.xs, items, pieces));
  const rowCount = grid.ys.length - 1;
  const size = textSize(items);
  const cellLines = cells.map((cell) => fractionCell(buildLines(pieces.filter((it) => inBox(it, cell)), page), drawing.rules, size));
  // A row whose cells with words each hold as many lines on the same
  // baselines, one cell's lines all amounts, is that many rows: a
  // statement's lines in one ruled row (the invoice's vehicle price,
  // plates, and discount read as one row of three-line cells).
  const splits = Array.from({ length: rowCount }, (_, r) => {
    const own = cells.flatMap((cell, k) => (cell.row === r && cellLines[k].length > 0 ? [cellLines[k]] : []));
    const n = own[0]?.length ?? 0;
    const spanned = cells.some((cell) => cell.rowspan > 1 && cell.row <= r && cell.row + cell.rowspan > r);
    if (spanned || own.length < 2 || n < 2 || own.some((lines) => lines.length !== n)) return 1;
    const level = own.every((lines) => lines.every((l, i) => Math.abs(l.y - own[0][i].y) <= l.size * 0.3));
    return level && own.some((lines) => lines.every((l) => NUMERIC_CELL_RE.test(l.text.trim()))) ? n : 1;
  });
  const rows: TableRow[][] = splits.map((n) => Array.from({ length: n }, () => ({ cells: [] })));
  // The cells' padding: the least a line stands from its cell's left edge,
  // and from its right edge (Word's 5.4 pt); more is a line set in.
  const least = (gaps: number[]) => Math.min(10, ...gaps.filter((d) => d >= 0));
  const inset = {
    left: least(cells.flatMap((cell, k) => cellLines[k].map((l) => l.x - cell.x1))),
    right: least(cells.flatMap((cell, k) => cellLines[k].map((l) => cell.x2 - l.xEnd))),
  };
  // A column set flush right (numbers): most of its lines end at one edge,
  // short of the cell's padding when a narrow column sits beside it
  // (apple-fy24q4's values set in as if indented).
  const flush = new Map<number, number>();
  for (let col = 0; col + 1 < grid.xs.length; col++) {
    const lines = cells.flatMap((cell, k) => (cell.col === col && cell.colspan === 1 ? cellLines[k] : []));
    const edge = Math.max(...lines.map((l) => l.xEnd));
    if (lines.length >= 2 && lines.filter((l) => edge - l.xEnd <= l.size * 0.3).length * 5 >= lines.length * 3) flush.set(col, edge);
  }
  // A row's cells sit alike: a cell its words fill, each line as far from
  // both of its sides, is centered when the row's other cells with words
  // are, two at least (a form's head row).
  const sits = cells.map((cell, k) => {
    const lines = cellLines[k];
    if (lines.length === 0 || !lines.every((l) => balancedIn(l, cell))) return "other";
    const short = lines.some((l) => l.x - cell.x1 - inset.left > l.size * 0.3 && cell.x2 - inset.right - l.xEnd > l.size * 0.3);
    return short ? "center" : "full";
  });
  const centeredRow = (row: number) => {
    const own = cells.flatMap((cell, k) => (cell.row === row && cellLines[k].length > 0 ? [sits[k]] : []));
    return own.filter((s) => s === "center").length >= 2 && !own.includes("other");
  };
  cells.forEach((cell, k) => {
    built.push(...cellLines[k]);
    const edge = cell.colspan === 1 ? flush.get(cell.col) : undefined;
    const fill = cellFill(cell, grid.box, drawing.fills);
    const n = splits[cell.row];
    const parts = n > 1 ? Array.from({ length: n }, (_, i) => cellLines[k].slice(i, i + 1)) : [cellLines[k]];
    parts.forEach((lines, i) => {
      const words = lines.length > 0 ? cellParagraphs(lines, cell, inset, edge, sits[k] === "full" && centeredRow(cell.row)) : { text: "", runs: [] };
      const out: TableCell = words.text.trim() === "" ? { text: "", runs: [] } : words;
      if (cell.colspan > 1) out.colspan = cell.colspan;
      if (cell.rowspan > 1) out.rowspan = cell.rowspan;
      if (fill) out.fill = fill;
      rows[cell.row][i].cells.push(out);
    });
  });
  return rows.flat().filter((r) => r.cells.length > 0);
}

// A cell merged across columns whose phrases stand in those columns, none
// across a column's line (half an em past it at most), two columns with
// words at least, is those columns' cells: a form's row whose inner rules
// are not drawn (the invoice's vehicle row, set under its order row's
// columns, read as one cell). pieces: the items cut at the lines.
function unmerged(cell: GridCell, xs: number[], items: Item[], pieces: Item[]): GridCell[] {
  if (cell.colspan < 2) return [cell];
  const lines = xs.slice(cell.col + 1, cell.col + cell.colspan);
  const across = buildLines(items.filter((it) => inBox(it, cell)), 0).some((l) =>
    phrasesOf(l).some((p) => lines.some((x) => Math.min(x - p.x1, p.x2 - x) > l.size * 0.5)),
  );
  const columns = new Set(pieces.filter((it) => inBox(it, cell)).map((it) => columnAt(centerOf(it).x, lines)));
  if (across || columns.size < 2) return [cell];
  return Array.from({ length: cell.colspan }, (_, k) => ({ ...cell, x1: xs[cell.col + k], x2: xs[cell.col + k + 1], col: cell.col + k, colspan: 1 }));
}

// A table's text size: the size three quarters of its words are set in or
// smaller. A table of fractions sets most of its digits at script size.
function textSize(items: Item[]): number {
  const sizes = items.map((it) => it.size).sort((a, b) => a - b);
  return sizes[Math.floor((sizes.length - 1) * 0.75)] ?? 10;
}

// A fraction alone in a cell: its numerator and its denominator read as two
// lines, too far apart for one (no words of the cell's size between them
// to join). With a bar drawn between them, the cell's glyphs are one
// formula (synth-notes-tex's table of fractions read "1 36" for 1/36).
function fractionCell(lines: Line[], rules: Rule[], size: number): Line[] {
  if (lines.length < 2 || !lines.every((l) => /^[\p{L}\p{N}+\-−=(),.\s]{1,12}$/u.test(l.text))) return lines;
  const x1 = Math.min(...lines.map((l) => l.x));
  const x2 = Math.max(...lines.map((l) => l.xEnd));
  const barred = lines.slice(1).every((l, k) => rules.some((r) => r.dir === "h" && r.y1 < lines[k].yMin && r.y1 > l.yMax && r.x1 < x2 && r.x2 > x1));
  const glyphs = lines.flatMap((l) => l.items.flatMap((it) => it.glyphs ?? []));
  if (!barred || glyphs.length === 0) return lines;
  const zone: MathZone = { glyphs, size, latex: "", ok: false, open: false };
  for (const line of lines) {
    for (const it of line.items) it.zone = zone;
    for (const r of line.runs) r.zone = zone;
  }
  return lines;
}

// A cell's shading: the last box filled over the cell's middle that covers
// most of the cell and stays inside the table (a page's or a slide's
// background is none); white is none.
function cellFill(cell: Box, table: Box, fills: Fill[]): string | undefined {
  const [cx, cy] = [(cell.x1 + cell.x2) / 2, (cell.y1 + cell.y2) / 2];
  for (let k = fills.length - 1; k >= 0; k--) {
    const f = fills[k];
    if (f.x1 > cx || f.x2 < cx || f.y1 > cy || f.y2 < cy) continue;
    if (f.x1 < table.x1 - 2 || f.x2 > table.x2 + 2 || f.y1 < table.y1 - 2 || f.y2 > table.y2 + 2) continue;
    const overlap = (Math.min(f.x2, cell.x2) - Math.max(f.x1, cell.x1)) * (Math.min(f.y2, cell.y2) - Math.max(f.y1, cell.y1));
    if (overlap < (cell.x2 - cell.x1) * (cell.y2 - cell.y1) * 0.6) continue;
    return f.color && !WHITE_RE.test(f.color) ? f.color : undefined;
  }
  return undefined;
}

// A grid cell's lines as its paragraphs: a line breaks where the page
// breaks it, not where the cell's width wraps it. A line wraps into the
// next when the next line's first word had no room left on it, when it
// ends in a hyphen, or when it ends mid-sentence and the next goes on in
// lowercase; else the next line opens a paragraph (a signature cell's
// "By:" lines, each on a line of its own, read as one line).
// Each paragraph keeps how its lines sit in the cell: centered, flush
// right, or set in from the cell's left edge. inset: the cells' padding;
// flush: the right edge of a column set flush right; centered: the cell's
// row centers its cells.
function cellParagraphs(lines: Line[], box: Box, inset: { left: number; right: number }, flush?: number, centered = false): TableCell {
  const left = box.x1 + inset.left;
  const right = box.x2 - inset.right;
  const groups: Line[][] = [];
  lines.forEach((line, k) => {
    const prev = lines[k - 1];
    const before = prev?.text.trim() ?? "";
    // Chinese wraps anywhere, a closing quote never opening a line: a
    // line short of the edge goes on unless a sentence ends it.
    const wraps =
      prev !== undefined &&
      (prev.xEnd - prev.x + prev.size * 0.28 + line.firstWordWidth > right - left - 1 ||
        /[\p{L}\p{N}]-$/u.test(before) ||
        (!/[.!?:;。！？：；]["'”’)]?$/.test(before) && (/^\p{Ll}/u.test(line.text) || CJK_START_RE.test(line.text))));
    if (wraps) groups[groups.length - 1].push(line);
    else groups.push([line]);
  });
  const middle = (box.x1 + box.x2) / 2;
  const sitOf = (group: Line[]): Pick<CellParagraph, "align" | "indent"> => {
    const size = group[0].size;
    const indent = Math.min(...group.map((l) => l.x)) - left;
    // Centered lines whose widest fills the cell start at its padding, as
    // flush left does: lines each as far from both sides of the cell, one
    // of them short of both paddings, are centered (a form's heads read
    // flush left); so are lines that fill a cell of a centered row.
    const short = group.some((l) => l.x - left > size * 0.3 && right - l.xEnd > size * 0.3);
    if (group.every((l) => balancedIn(l, box)) && (short || centered)) return { align: "center" };
    if (indent <= size * 0.5) return {};
    if (group.every((l) => Math.abs((l.x + l.xEnd) / 2 - middle) <= Math.max(size * 0.6, (box.x2 - box.x1) * 0.04))) return { align: "center" };
    if (group.every((l) => (flush ?? right) - l.xEnd <= size * 0.3)) return { align: "right" };
    return { indent: Math.round(indent) };
  };
  const cell: TableCell = { text: "", runs: [], paragraphs: [] };
  for (const group of groups) {
    const words = linesText(group);
    const start = cell.text.length + (cell.text.length > 0 ? 1 : 0);
    cell.text = cell.text.length > 0 ? `${cell.text} ${words.text}` : words.text;
    cell.runs.push(...words.runs.map((r) => ({ ...r, start: r.start + start, end: r.end + start })));
    cell.paragraphs?.push({ start, end: cell.text.length, ...sitOf(group) });
  }
  // One paragraph set at the cell's left edge is the cell's words alone.
  const [only] = cell.paragraphs ?? [];
  if (groups.length === 1 && !only.align && !only.indent) delete cell.paragraphs;
  return cell;
}

// An item that runs across column lines, cut into one piece per cell. A
// character sits where its glyph is (a font draws no glyph for a space, so
// the glyphs stand for the characters or for the characters less the
// spaces; else a character's share of the item's width puts it); a cut
// moves to the word gap nearest it, so a word is never cut in two. A piece
// spans its own glyphs: the gap between two pieces is the page's (arXiv
// 2504.02736's Table III heads, 4 pt apart across a column rule).
function splitAt(it: Item, cuts: number[]): Item[] {
  if (cuts.length === 0 || it.str.length < 2) return [it];
  const n = it.str.length;
  const chars: number[] = [];
  for (let i = 0; i < n; i += String.fromCodePoint(it.str.codePointAt(i) ?? 0).length) chars.push(i);
  const drawn = chars.filter((i) => it.str[i].trim());
  const glyphs = it.glyphs ?? [];
  const mapped = glyphs.length === chars.length ? chars : glyphs.length === drawn.length ? drawn : null;
  const placed = (mapped ?? []).map((i, k) => ({ i, g: glyphs[k] }));
  const charsBefore = (x: number) =>
    mapped ? (placed.find((p) => p.g.x + p.g.w / 2 >= x)?.i ?? n) : Math.round(((x - it.x) / it.w) * n);
  const out: Item[] = [];
  let from = 0;
  for (const x of [...cuts, it.x + it.w]) {
    let to = Math.min(n, charsBefore(x));
    if (to < n) {
      let gap = CJK_START_RE.test(it.str.slice(to - 1)) || CJK_START_RE.test(it.str.slice(to));
      for (let d = 0; d <= 3 && !gap; d++) {
        if (it.str[to - d - 1] === " " || it.str[to - d] === " ") {
          to -= d;
          gap = true;
        } else if (it.str[to + d - 1] === " " || it.str[to + d] === " ") {
          to += d;
          gap = true;
        }
      }
      // A word the line crosses stays whole, in the cell that holds most of
      // it (the invoice's "Date:" 3 pt past its column's line read ":" in
      // the next cell). Chinese sets no spaces: it is cut where the line is.
      if (!gap) continue;
    }
    to = Math.max(from, Math.min(n, to));
    // A share of the width counts UTF-16 units: a cut never halves a character.
    if (insidePair(it.str, to)) to += 1;
    const str = it.str.slice(from, to);
    const words = str.trim();
    if (words.length > 0) {
      const lead = str.length - str.trimStart().length;
      const own = placed.filter((p) => p.i >= from && p.i < to);
      const [first, last] = [own[0]?.g, own[own.length - 1]?.g];
      const x1 = first ? first.x : it.x + ((from + lead) / n) * it.w;
      const x2 = last ? last.x + last.w : it.x + ((from + lead + words.length) / n) * it.w;
      out.push({ ...it, str: words, x: x1, w: x2 - x1, glyphs: mapped ? own.map((p) => p.g) : undefined });
    }
    from = to;
  }
  return out;
}
