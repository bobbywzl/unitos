// Tables: which lines form a table run (findTableRuns, before segmentation),
// and the rows and columns a run makes (tableFromRun).

import { geom, lineMathShare, median } from "@/lib/parse/pdf/geometry";
import { sameFlags } from "@/lib/parse/pdf/glyphs";
import { ATTACH_PUNCT_RE } from "@/lib/parse/pdf/lines";
import { TextBuilder, boldShare, escapeHtml, isMonoLine, joinGroup } from "@/lib/parse/pdf/text";
import type { Cell, Item, Line, PageContext, Run, Segment } from "@/lib/parse/pdf/types";

// ── Tables ──────────────────────────────────────────────────────────────────

type TableRow = { cells: { text: string; runs: Run[] }[] };

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
// every row, but nothing ever crosses the gutter between columns.
function columnSeparators(run: Line[]): number[] {
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
      if (width >= 5) separators.push(minX + ((bandStart + s) / 2) * step);
      bandStart = null;
    }
  }
  return separators;
}

// Split one line's items at the separators. Items are pdf.js chunks, so a cell
// boundary nearly always falls between items; assignment is by item center.
function cellsBySeparators(line: Line, separators: number[]): Cell[] {
  const size = line.size;
  const buckets: Item[][] = Array.from({ length: separators.length + 1 }, () => []);
  for (const item of line.items) {
    const center = item.x + item.w / 2;
    let idx = 0;
    while (idx < separators.length && center > separators[idx]) idx++;
    buckets[idx].push(item);
  }
  return buckets.map((bucket) => {
    if (bucket.length === 0) return { x: 0, text: "", runs: [] };
    const cell: Cell = { x: bucket[0].x, text: "", runs: [] };
    let prevEnd: number | null = null;
    for (const item of bucket) {
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
        cell.runs.push({
          start,
          end: cell.text.length,
          bold: item.bold,
          italic: item.italic,
          mono: item.mono,
          href: item.href,
        });
      }
      prevEnd = item.x + item.w;
    }
    return cell;
  });
}

function cellHtml(text: string, runs: Run[]): string {
  if (text.length === 0) return "";
  const bounds = new Set<number>([0, text.length]);
  for (const r of runs) {
    bounds.add(Math.max(0, Math.min(r.start, text.length)));
    bounds.add(Math.max(0, Math.min(r.end, text.length)));
  }
  const points = [...bounds].sort((a, b) => a - b);
  let html = "";
  for (let i = 0; i < points.length - 1; i++) {
    const [from, to] = [points[i], points[i + 1]];
    if (from === to) continue;
    const segment = escapeHtml(text.slice(from, to));
    const covering = runs.filter((r) => r.start <= from && r.end >= to);
    const bold = covering.some((r) => r.bold);
    const italic = covering.some((r) => r.italic);
    const mono = covering.some((r) => r.mono);
    let wrapped = segment;
    if (mono) wrapped = `<code>${wrapped}</code>`;
    if (italic) wrapped = `<em>${wrapped}</em>`;
    if (bold) wrapped = `<strong>${wrapped}</strong>`;
    html += wrapped;
  }
  return html;
}

// One table out of a run of gap-aligned lines. Columns come from the coverage
// scan; rows come from the run's vertical rhythm: with two gap sizes present,
// the small gap is a wrapped cell line and the large one a row break; with one
// gap size, every line is its own row.
export function tableFromRun(run: Line[], leading: number): Segment {
  const separators = columnSeparators(run);
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
  const cellsOf = run.map((line) => cellsBySeparators(line, separators));
  const hasFirst = cellsOf.map((cells) => cells[0].text.length > 0);
  const anchors: number[] = [];
  let lastFirst = -1;
  run.forEach((line, k) => {
    if (!hasFirst[k]) return;
    // A wrap: only the first column continues, or the first cell starts
    // lowercase ("Concealing" / "uncertainty know" — both columns wrapped).
    const firstOnly = cellsOf[k].every((cell, idx) => idx === 0 || cell.text.length === 0);
    const continues = firstOnly || /^[a-z]/.test(cellsOf[k][0].text);
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
  if (anchorRows) {
    // Lines above the first anchor: their own row when one gap stands out.
    if (anchors[0] > 1) {
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
    run.forEach((line, k) => {
      if (k === 0) return;
      const gap = gapAt(k);
      if (rowGapThreshold > 0 ? gap > rowGapThreshold : gap > floor) rowStarts.push(k);
    });
  }

  const rows: TableRow[] = [];
  run.forEach((line, k) => {
    if (rowStarts.includes(k) || rows.length === 0) {
      rows.push({ cells: Array.from({ length: columnCount }, () => ({ text: "", runs: [] })) });
    }
    const row = rows[rows.length - 1];
    cellsOf[k].forEach((cell, idx) => {
      if (cell.text.length === 0) return;
      const target = row.cells[idx];
      const builder = new TextBuilder();
      builder.append({ text: target.text, runs: target.runs }, "");
      builder.append({ text: cell.text, runs: cell.runs }, target.text.length > 0 ? " " : "");
      target.text = builder.text;
      target.runs = builder.runs;
    });
  });

  // Fragmented figure text, not a real table: mostly tiny cells.
  const flat = rows.flatMap((r) => r.cells.map((c) => c.text.trim()).filter((t) => t.length > 0));
  const shortCells = flat.filter((c) => c.length <= 2).length;
  if (flat.length > 0 && shortCells / flat.length > 0.6) {
    const builder = new TextBuilder();
    for (const line of run) builder.append({ text: line.text.replace(/\t/g, " "), runs: line.runs }, " ");
    return { type: "FIGURE", text: builder.text, page, runs: builder.runs, ...geom(run) };
  }

  const headerRow =
    rows.length > 1 &&
    boldShare(
      rows[0].cells.flatMap((c) => c.runs),
      rows[0].cells.reduce((n, c) => n + c.text.length, 0),
    ) > 0.5;
  // Header cells render bold on their own; strip bold runs so <th> holds no <strong>.
  // Every cell ends with an invisible separator (tab between cells, newline
  // between rows) so the table's DOM text equals block text exactly — text
  // anchors inside tables depend on this (SPEC.md §5).
  const rowHtml = (row: TableRow, tag: "td" | "th", rowIdx: number) =>
    `<tr>${row.cells
      .map((c, cellIdx) => {
        const runs = tag === "th" ? c.runs.map((r) => ({ ...r, bold: false })) : c.runs;
        const last = cellIdx === row.cells.length - 1;
        const gap = last
          ? rowIdx === rows.length - 1
            ? ""
            : '<span class="cell-gap">\n</span>'
          : '<span class="cell-gap">\t</span>';
        return `<${tag}>${cellHtml(c.text, runs)}${gap}</${tag}>`;
      })
      .join("")}</tr>`;
  const bodyRows = headerRow ? rows.slice(1) : rows;
  const html =
    "<table>" +
    (headerRow ? `<thead>${rowHtml(rows[0], "th", 0)}</thead>` : "") +
    `<tbody>${bodyRows.map((r, i) => rowHtml(r, "td", (headerRow ? 1 : 0) + i)).join("")}</tbody>` +
    "</table>";
  const text = rows.map((r) => r.cells.map((c) => c.text).join("\t")).join("\n");
  return { type: "TABLE", text, html, page, ...geom(run) };
}

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

// Table runs, computed before segmentation. A run grows forward over
// multi-cell lines and the single-cell lines that continue a wrapped cell
// (aligned with a column, or indented past the first column, or a first-column
// line followed closely by more of the table), and grows backward over
// wrapped header lines just above the first multi-cell line.
export function findTableRuns(lines: Line[], ctx: PageContext): number[] {
  const runOf = new Array<number>(lines.length).fill(-1);
  let runId = 0;
  let i = 0;
  while (i < lines.length) {
    // A table row is text or numbers: a line of math glyphs is an equation,
    // whatever its gaps (import compare loop finding: an equation's wide gaps
    // read as cells, and the run swept the sentences around it into a table).
    if (
      lines[i].cells.length < 2 ||
      runOf[i] !== -1 ||
      isLabelLine(lines[i], ctx) ||
      isMonoLine(lines[i]) ||
      lineMathShare(lines[i]) >= 0.4
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
      if (gap < 0 || gap > next.size * ctx.leading * 2.2) break;
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
      if (next.cells.length >= 2) {
        members.push(j);
        multi++;
        j++;
        continue;
      }
      if (next.size > ctx.bodySize * 1.15) break;
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
          if (y - lines[k].y > lines[k].size * ctx.leading * 2.2) break;
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
    // One multi-cell line alone is a "Label: text" paragraph, unless the
    // lines around it are a table whose labels sit on their own baselines.
    if (multi < 2 && !(leftOnlyCount >= 2 && alignedCount >= 2)) {
      i++;
      continue;
    }
    // Backward: wrapped header lines directly above (at most 3).
    let first = members[0];
    let absorbed = 0;
    while (first > 0 && absorbed < 3) {
      const prev = lines[first - 1];
      if (prev.cells.length !== 1 || runOf[first - 1] !== -1) break;
      if (prev.size > ctx.bodySize * 1.15) break;
      const gap = prev.y - lines[first].y;
      if (gap < 0 || gap > prev.size * ctx.leading * 1.35) break;
      const columns = clusterColumns(members.map((k) => lines[k]));
      const aligned = isAlignedLine(prev, columns);
      const indentedPastFirst = prev.x > columns[0] + 8;
      if (!aligned && !indentedPastFirst && !isLeftOnly(prev, columns)) break;
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
