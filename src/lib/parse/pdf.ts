import { getDocumentProxy } from "unpdf";
import type { LinkSpan, ParsedBlock, StyleSpan } from "@/lib/parse/types";

// PDF → blocks. Deterministic, no AI passes. Beyond text and reading order, the
// parse keeps what the PDF's fonts and geometry say: bold/italic/monospace runs
// become style spans, monospace paragraphs become CODE, indent-and-gap groups
// become LIST (bullet glyphs are often vector art and never reach the text
// layer), wide-gap runs become TABLE with header rows, repeated page furniture
// drops, letter-spaced caps collapse, and Contents entries link to their
// section headings.

type Flags = { bold: boolean; italic: boolean; mono: boolean; href: string | null };
type Item = Flags & { str: string; x: number; y: number; w: number; size: number };
type Run = Flags & { start: number; end: number };
type Cell = { x: number; text: string; runs: Run[] };
type Line = {
  cells: Cell[];
  text: string; // cells joined with \t
  runs: Run[]; // style runs over text; every run's chars share one Flags value
  items: Item[]; // kept for table column re-splitting
  x: number;
  xEnd: number;
  y: number;
  size: number;
  page: number;
  firstWordWidth: number;
};
type UriRegion = { href: string; x1: number; y1: number; x2: number; y2: number };

// Internal block: ParsedBlock plus what the cross-page passes need.
type Segment = ParsedBlock & {
  page: number;
  rawSize?: number; // heading candidate size, for level ranking
  runs?: Run[]; // style runs over text; spans emit after all merges
  listItem?: boolean; // lone indented item; may join a LIST across the page break
  tocEntries?: { start: number; end: number; num: number }[];
  headingNum?: number; // leading number of a numbered heading ("3." → 3)
};

const BULLET_RE = /^\s*([•▪◦‣●·*-]|\d{1,2}[.)]|\([a-z\d]{1,3}\)|[ivx]{1,4}[.)])\s+/i;
// Numbered heading: the number must close with "." or ")" or dot into a
// sub-number — "3.1 Results" and "1. Summary" match, "23 advertisers" does not.
// "3.1 Results", "2. Background", and the bare "2 Background" (ACL style).
// The word after the number starts uppercase — a body line rarely does.
const HEADING_NUM_STRICT_RE = /^\d{1,2}((\.\d{1,2})+\.?|[.)])?\s+[\p{Lu}\p{Lo}]/u;
const TOC_LABEL_RE = /^(contents|table of contents|inside|outline|in this issue)$/i;
const TOC_ENTRY_RE = /^(\d{1,2})[.)]?\s+\S/;
const ATTACH_PUNCT_RE = /^[.,;:!?)\]…%]/;

// ── Font flags ──────────────────────────────────────────────────────────────

function fontFlags(name: string | null): Omit<Flags, "href"> {
  const n = (name ?? "").replace(/^[A-Z]{6}\+/, ""); // subset prefix "HAAAAA+"
  return {
    bold: /bold|black|heavy|semi ?bold|demi/i.test(n),
    italic: /italic|oblique/i.test(n),
    mono: /mono|courier|consolas|menlo|typewriter/i.test(n),
  };
}

function sameFlags(a: Flags, b: Flags): boolean {
  return a.bold === b.bold && a.italic === b.italic && a.mono === b.mono && a.href === b.href;
}

// ── Letter-spaced caps ("A L P H A B E T") ──────────────────────────────────

// Inside one item: "A L P H A B E T" → "ALPHABET". Kickers and small-caps
// labels carry their letter spacing as literal spaces in the string.
function collapseSpacedStr(str: string): string {
  const tokens = str.split(" ").filter((t) => t.length > 0);
  if (tokens.length < 3 || !tokens.every((t) => t.length === 1)) return str;
  return tokens.join("");
}

// Across items: one glyph per item with small uniform gaps → merge into words.
function mergeSpacedItems(items: Item[]): Item[] {
  const singles = items.filter((i) => i.str.trim().length === 1).length;
  if (singles < 6 || singles < items.length * 0.6) return items;
  const out: Item[] = [];
  for (const item of items) {
    const last = out[out.length - 1];
    const gap = last ? item.x - (last.x + last.w) : Infinity;
    if (
      last &&
      last.str.length <= 2 &&
      item.str.trim().length === 1 &&
      gap >= 0 &&
      gap < item.size * 0.45 &&
      sameFlags(last, item)
    ) {
      last.str += item.str;
      last.w = item.x + item.w - last.x;
    } else {
      out.push({ ...item });
    }
  }
  return out;
}

// ── Line building ───────────────────────────────────────────────────────────

function buildLine(rawItems: Item[], page: number): Line {
  const items = mergeSpacedItems(
    rawItems
      .map((i) => ({ ...i, str: i.mono ? i.str : collapseSpacedStr(i.str) }))
      .sort((a, b) => a.x - b.x),
  );
  const size = Math.max(...items.map((i) => i.size));
  const cells: Cell[] = [];
  let prevEnd: number | null = null;
  for (const item of items) {
    const gap = prevEnd === null ? 0 : item.x - prevEnd;
    const wide = prevEnd !== null && gap > Math.max(8, size * 1.6);
    let cell = cells[cells.length - 1];
    if (!cell || wide) {
      cell = { x: item.x, text: "", runs: [] };
      cells.push(cell);
    } else if (gap > size * 0.12 && !cell.text.endsWith(" ")) {
      // Punctuation that attaches left ("PRESS" chip then ".") takes no space.
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
  for (const cell of cells) {
    const trimmed = cell.text.trimEnd();
    const cut = trimmed.length;
    cell.text = trimmed;
    cell.runs = cell.runs
      .map((r) => ({ ...r, end: Math.min(r.end, cut) }))
      .filter((r) => r.end > r.start);
  }
  let text = "";
  const runs: Run[] = [];
  cells.forEach((cell, i) => {
    if (i > 0) text += "\t";
    const offset = text.length;
    text += cell.text;
    for (const r of cell.runs) runs.push({ ...r, start: r.start + offset, end: r.end + offset });
  });
  const first = items[0];
  const firstWord = first.str.split(" ")[0] || first.str;
  const firstWordWidth =
    first.str.length > 0 ? first.w * Math.min(1, firstWord.length / first.str.length) : size;
  const last = items[items.length - 1];
  return {
    cells,
    text,
    runs,
    items,
    x: first.x,
    xEnd: last.x + last.w,
    y: Math.max(...items.map((i) => i.y)),
    size,
    page,
    firstWordWidth,
  };
}

function buildLines(items: Item[], page: number): Line[] {
  const sorted = items.filter((i) => i.str.trim().length > 0);
  sorted.sort((a, b) => b.y - a.y || a.x - b.x);
  const grouped: Item[][] = [];
  for (const item of sorted) {
    const last = grouped[grouped.length - 1];
    const tolerance = Math.max(2, item.size * 0.4);
    if (last && Math.abs(last[0].y - item.y) < tolerance) last.push(item);
    else grouped.push([item]);
  }
  return grouped.map((g) => buildLine(g, page)).filter((l) => l.text.length > 0);
}

// Two-column pages: find a middle gutter that almost no text crosses, with two
// prose-shaped columns. A wide table also leaves a gutter, but its sides start
// at many x positions and its left and right lines share baselines — those
// pages stay in one pass so rows keep their reading order.
function pageLines(items: Item[], pageWidth: number, page: number): Line[] {
  const chars = (list: Item[]) => list.reduce((n, i) => n + i.str.length, 0);
  const total = chars(items);
  if (total === 0) return [];

  let best: { g: number; crossChars: number } | null = null;
  for (let g = pageWidth * 0.44; g <= pageWidth * 0.58; g += pageWidth * 0.02) {
    const crossers = items.filter((i) => i.x < g && i.x + i.w > g && i.str.trim().length > 0);
    const crossChars = chars(crossers);
    if (!best || crossChars < best.crossChars) best = { g, crossChars };
  }
  const g = best ? best.g : pageWidth / 2;
  const left = items.filter((i) => i.x + i.w <= g);
  const right = items.filter((i) => i.x >= g);
  const full = items.filter((i) => i.x < g && i.x + i.w > g);

  // Prose columns start their lines at the body edge or the paragraph indent —
  // two x positions cover almost every line. Table sides scatter across many.
  const columnShaped = (side: Item[]): boolean => {
    const lines = buildLines(side, page);
    if (lines.length < 6) return false;
    const counts = new Map<number, number>();
    for (const line of lines) {
      const x = Math.round(line.x / 4) * 4;
      counts.set(x, (counts.get(x) ?? 0) + 1);
    }
    const sorted = [...counts.values()].sort((a, b) => b - a);
    return (sorted[0] ?? 0) + (sorted[1] ?? 0) >= lines.length * 0.62;
  };
  // Shared baselines do NOT discriminate: LaTeX sets both columns on one
  // baseline grid, so real columns share most baselines. Shape decides.
  const twoColumn =
    best !== null &&
    best.crossChars / total < 0.15 &&
    chars(left) / total > 0.2 &&
    chars(right) / total > 0.2 &&
    columnShaped(left) &&
    columnShaped(right);

  if (!twoColumn) return buildLines(items, page);

  const leftLines = buildLines(left, page);
  const rightLines = buildLines(right, page);
  const fullLines = buildLines(full, page).sort((a, b) => b.y - a.y);

  const ordered: Line[] = [];
  let pendingLeft = [...leftLines];
  let pendingRight = [...rightLines];
  for (const boundary of fullLines) {
    const above = (l: Line) => l.y > boundary.y;
    ordered.push(...pendingLeft.filter(above));
    ordered.push(...pendingRight.filter(above));
    pendingLeft = pendingLeft.filter((l) => !above(l));
    pendingRight = pendingRight.filter((l) => !above(l));
    ordered.push(boundary);
  }
  ordered.push(...pendingLeft, ...pendingRight);
  return ordered;
}

// ── Shared math ─────────────────────────────────────────────────────────────

function median(values: number[]): number {
  if (values.length === 0) return 10;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ── Text assembly across lines ──────────────────────────────────────────────

// Joins line texts while shifting style runs. A wrap hyphen stays a hyphen:
// office-suite PDFs wrap after real compound hyphens ("AI-", "non-"), they do
// not auto-hyphenate words, so dropping the hyphen mangles compounds.
class TextBuilder {
  text = "";
  runs: Run[] = [];

  append(part: { text: string; runs: Run[] }, sep: " " | "\n" | "") {
    if (this.text.length === 0) {
      this.text = part.text;
      this.runs = part.runs.map((r) => ({ ...r }));
      return;
    }
    let s: string = sep;
    if (sep === " " && /[A-Za-z0-9][-–]$/.test(this.text) && /^[A-Za-z0-9(]/.test(part.text)) s = "";
    const offset = this.text.length + s.length;
    this.text += s + part.text;
    for (const r of part.runs) {
      const shifted = { ...r, start: r.start + offset, end: r.end + offset };
      const last = this.runs[this.runs.length - 1];
      if (
        last &&
        sameFlags(last, shifted) &&
        shifted.start - last.end <= s.length &&
        s !== "\n"
      ) {
        last.end = shifted.end;
      } else {
        this.runs.push(shifted);
      }
    }
  }
}

function lineAsPart(line: Line): { text: string; runs: Run[] } {
  return { text: line.text, runs: line.runs };
}

// Would the next line's first word have fit on this line? If yes, the break
// was intentional — keep it as a line break instead of a joining space.
function fillsMargin(line: Line, next: Line, rightEdge: number): boolean {
  return line.xEnd + line.size * 0.28 + next.firstWordWidth > rightEdge - 1;
}

// A field row starts with a short bold label ("Written", "Status") followed by
// regular text. Two or more of them in one group means the group is a field
// list: every line keeps its own row. A bold run that continues from the
// previous line is a wrapped span, not a label.
function startsWithBoldLead(line: Line): boolean {
  const first = line.runs[0];
  if (!first || !first.bold || first.start > 0) return false;
  if (first.end >= line.text.length) return false; // wholly bold line
  const lead = line.text.slice(first.start, first.end);
  return lead.length <= 40 && /^[A-Z0-9]/.test(lead);
}

function endsBold(line: Line): boolean {
  const last = line.runs[line.runs.length - 1];
  return last !== undefined && last.bold && last.end >= line.text.trimEnd().length;
}

// Join a group of lines into one text: spaces where the text wrapped, line
// breaks where the break was intentional. In prose (proseJoin), a break that
// lands mid-sentence — no terminal punctuation before it, lowercase or a
// number after it — is a wrap whatever the margin says.
function joinGroup(lines: Line[], proseJoin = false): { text: string; runs: Run[] } {
  const builder = new TextBuilder();
  if (lines.length === 0) return builder;
  const rightEdge = Math.max(...lines.map((l) => l.xEnd));
  const boldLeads = lines.filter(
    (l, i) => startsWithBoldLead(l) && (i === 0 || !endsBold(lines[i - 1])),
  ).length;
  const fieldList = boldLeads >= 2 && boldLeads >= Math.ceil(lines.length * 0.6);
  builder.append(lineAsPart(lines[0]), "");
  for (let i = 1; i < lines.length; i++) {
    const wrapped = fillsMargin(lines[i - 1], lines[i], rightEdge);
    const midSentence =
      proseJoin &&
      !/[.!?:…]["'”]?$/.test(lines[i - 1].text.trim()) &&
      /^[a-z0-9($€£"'“]/.test(lines[i].text);
    builder.append(lineAsPart(lines[i]), fieldList ? "\n" : wrapped || midSentence ? " " : "\n");
  }
  return builder;
}

// ── Style and link spans out of runs ────────────────────────────────────────

function spansFromRuns(
  text: string,
  runs: Run[] | undefined,
  opts: { skipBold?: boolean; skipMono?: boolean } = {},
): { styles: StyleSpan[]; links: LinkSpan[] } {
  const styles: StyleSpan[] = [];
  const links: LinkSpan[] = [];
  if (!runs || runs.length === 0) return { styles, links };

  const collect = (flag: "bold" | "italic" | "mono"): { start: number; end: number }[] => {
    const ranges: { start: number; end: number }[] = [];
    for (const r of runs) {
      if (!r[flag]) continue;
      const last = ranges[ranges.length - 1];
      if (last && r.start - last.end <= 1 && text.slice(last.end, r.start).trim() === "") {
        last.end = r.end;
      } else {
        ranges.push({ start: r.start, end: r.end });
      }
    }
    return ranges;
  };
  const trim = (range: { start: number; end: number }): { start: number; end: number } => {
    let { start, end } = range;
    while (start < end && /\s/.test(text[start])) start++;
    while (end > start && /\s/.test(text[end - 1])) end--;
    return { start, end };
  };
  const whole = (range: { start: number; end: number }): boolean =>
    text.slice(0, range.start).trim() === "" && text.slice(range.end).trim() === "";

  const push = (style: StyleSpan["style"], range: { start: number; end: number }) => {
    const { start, end } = trim(range);
    if (end <= start) return;
    styles.push({ start, end, style, quotedText: text.slice(start, end) });
  };
  for (const range of collect("bold")) {
    if (opts.skipBold && whole(range)) continue;
    push("bold", range);
  }
  for (const range of collect("italic")) push("italic", range);
  for (const range of collect("mono")) {
    if (opts.skipMono && whole(range)) continue;
    push("code", range);
  }
  // Hyperlink regions from the PDF's link annotations.
  for (const r of runs) {
    if (!r.href) continue;
    const last = links[links.length - 1];
    if (last && last.href === r.href && r.start - last.end <= 1) {
      last.end = r.end;
      last.quotedText = text.slice(last.start, last.end);
    } else {
      const { start, end } = trim(r);
      if (end > start) links.push({ start, end, quotedText: text.slice(start, end), href: r.href });
    }
  }
  return { styles, links };
}

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
  const need = Math.max(2, Math.ceil(run.length * 0.3));
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

function boldShare(runs: Run[], length: number): number {
  if (length === 0) return 0;
  let bold = 0;
  for (const r of runs) if (r.bold) bold += r.end - r.start;
  return bold / length;
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
function tableFromRun(run: Line[], leading: number): Segment {
  const separators = columnSeparators(run);
  const columnCount = separators.length + 1;
  const page = run[0].page;

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

  const rows: TableRow[] = [];
  let prev: Line | null = null;
  for (const line of run) {
    const gap = prev ? prev.y - line.y : Infinity;
    const rowBreak = !prev || (rowGapThreshold > 0 ? gap > rowGapThreshold : gap > floor);
    if (rowBreak || rows.length === 0) {
      rows.push({ cells: Array.from({ length: columnCount }, () => ({ text: "", runs: [] })) });
    }
    const row = rows[rows.length - 1];
    cellsBySeparators(line, separators).forEach((cell, idx) => {
      if (cell.text.length === 0) return;
      const target = row.cells[idx];
      const builder = new TextBuilder();
      builder.append({ text: target.text, runs: target.runs }, "");
      builder.append({ text: cell.text, runs: cell.runs }, target.text.length > 0 ? " " : "");
      target.text = builder.text;
      target.runs = builder.runs;
    });
    prev = line;
  }

  // Fragmented figure text, not a real table: mostly tiny cells.
  const flat = rows.flatMap((r) => r.cells.map((c) => c.text.trim()).filter((t) => t.length > 0));
  const shortCells = flat.filter((c) => c.length <= 2).length;
  if (flat.length > 0 && shortCells / flat.length > 0.6) {
    const builder = new TextBuilder();
    for (const line of run) builder.append({ text: line.text.replace(/\t/g, " "), runs: line.runs }, " ");
    return { type: "FIGURE", text: builder.text, page, runs: builder.runs };
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
  return { type: "TABLE", text, html, page };
}

// A two-column run of numbered entries is a contents list read column-wise,
// not a table: left column top to bottom, then right column.
function twoColumnList(run: Line[]): Segment | null {
  if (run.length < 2 || !run.every((l) => l.cells.length === 2)) return null;
  const cells = run.flatMap((l) => l.cells);
  const numbered = cells.filter((c) => TOC_ENTRY_RE.test(c.text)).length;
  if (numbered < cells.length * 0.7) return null;
  const ordered = [...run.map((l) => l.cells[0]), ...run.map((l) => l.cells[1])];
  const builder = new TextBuilder();
  const entries: { start: number; end: number; num: number }[] = [];
  for (const cell of ordered) {
    const start = builder.text.length === 0 ? 0 : builder.text.length + 1;
    builder.append({ text: cell.text, runs: cell.runs }, "\n");
    const m = TOC_ENTRY_RE.exec(cell.text);
    if (m) entries.push({ start, end: start + cell.text.length, num: Number(m[1]) });
  }
  return { type: "LIST", text: builder.text, page: run[0].page, runs: builder.runs, tocEntries: entries };
}

// ── Page segmentation ───────────────────────────────────────────────────────

type PageContext = {
  bodySize: number;
  leading: number; // line leading as a multiple of font size
  columnLeft: number;
  // Some PDFs expose no bold flags at all (font subsetting); heading rules
  // that require bold would then match nothing.
  hasBold: boolean;
};

function isIndented(line: Line, ctx: PageContext): boolean {
  return (
    line.x > ctx.columnLeft + line.size * 0.6 &&
    line.x < ctx.columnLeft + line.size * 6 &&
    line.cells.length === 1
  );
}

// Table runs, computed before segmentation. A run grows forward over
// multi-cell lines and the single-cell lines that continue a wrapped cell
// (aligned with a column, or indented past the first column, or a first-column
// label followed closely by another multi-cell line), and grows backward over
// wrapped header lines just above the first multi-cell line.
function findTableRuns(lines: Line[], ctx: PageContext): number[] {
  const runOf = new Array<number>(lines.length).fill(-1);
  let runId = 0;
  let i = 0;
  while (i < lines.length) {
    if (lines[i].cells.length < 2 || runOf[i] !== -1) {
      i++;
      continue;
    }
    const members: number[] = [i];
    let multi = 1;
    let j = i + 1;
    while (j < lines.length) {
      const next = lines[j];
      const last = lines[members[members.length - 1]];
      const gap = last.y - next.y;
      if (gap < 0 || gap > next.size * ctx.leading * 2.2) break;
      if (next.cells.length >= 2) {
        members.push(j);
        multi++;
        j++;
        continue;
      }
      if (next.size > ctx.bodySize * 1.15) break;
      const columns = clusterColumns(members.map((k) => lines[k]));
      const aligned = columns.some((c, idx) => idx > 0 && Math.abs(next.x - c) < 12);
      const indentedPastFirst = next.x > columns[0] + 8;
      const tight = gap <= next.size * ctx.leading * 1.35;
      // A row whose cells fused into one (narrow gaps), or a wrapped row line
      // at the first column: the table must resume with a multi-cell line
      // within the next two lines, at row pitch, and the line must not read
      // as prose.
      let resumes = false;
      if (
        Math.abs(next.x - columns[0]) < 12 &&
        gap <= next.size * ctx.leading * 1.9 &&
        next.text.length < 90 &&
        !/[.!?]$/.test(next.text.trim())
      ) {
        let y = next.y;
        for (let k = j + 1; k <= j + 2 && k < lines.length; k++) {
          if (y - lines[k].y > lines[k].size * ctx.leading * 2.2) break;
          if (lines[k].cells.length >= 2) {
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
        j++;
        continue;
      }
      break;
    }
    if (multi < 2) {
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
      const aligned = columns.some((c, idx) => idx > 0 && Math.abs(prev.x - c) < 12);
      const indentedPastFirst = prev.x > columns[0] + 8;
      if (!aligned && !indentedPastFirst) break;
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

function segmentPage(lines: Line[], ctx: PageContext): Segment[] {
  const segments: Segment[] = [];
  const body = ctx.bodySize;
  const runOf = findTableRuns(lines, ctx);
  let tocMode = false;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const single = line.cells.length === 1;

    // Contents label ("CONTENTS", "INSIDE"): the entries that follow become a
    // linked list, not headings.
    if (single && TOC_LABEL_RE.test(line.text.trim())) {
      segments.push({ type: "PARAGRAPH", text: line.text.trim(), page: line.page, runs: line.runs });
      tocMode = true;
      i++;
      continue;
    }

    if (tocMode && single && TOC_ENTRY_RE.test(line.text)) {
      const builder = new TextBuilder();
      const entries: { start: number; end: number; num: number }[] = [];
      let j = i;
      while (j < lines.length && lines[j].cells.length === 1 && TOC_ENTRY_RE.test(lines[j].text)) {
        const entry = lines[j];
        const start = builder.text.length === 0 ? 0 : builder.text.length + 1;
        builder.append(lineAsPart(entry), "\n");
        const m = TOC_ENTRY_RE.exec(entry.text);
        if (m) entries.push({ start, end: start + entry.text.length, num: Number(m[1]) });
        j++;
      }
      segments.push({
        type: "LIST",
        text: builder.text,
        page: line.page,
        runs: builder.runs,
        tocEntries: entries,
      });
      tocMode = false;
      i = j;
      continue;
    }

    // Table run (precomputed).
    if (runOf[i] !== -1) {
      const id = runOf[i];
      const run: Line[] = [];
      let j = i;
      while (j < lines.length && runOf[j] === id) {
        run.push(lines[j]);
        j++;
      }
      const list = twoColumnList(run);
      segments.push(list ?? tableFromRun(run, ctx.leading));
      if (!list) tocMode = false;
      i = j;
      continue;
    }
    tocMode = false;

    // Heading run: larger than body. Wrapped heading lines merge; a merged run
    // that reads as prose (ends in a period, runs long) is a lead paragraph.
    if (single && line.size > body * 1.14) {
      const run: Line[] = [line];
      let j = i + 1;
      while (j < lines.length) {
        const next = lines[j];
        if (
          runOf[j] !== -1 ||
          next.cells.length !== 1 ||
          Math.abs(next.size - line.size) > 0.5 ||
          run[run.length - 1].y - next.y > line.size * 1.7 ||
          Math.abs(next.x - line.x) > 12
        )
          break;
        run.push(next);
        j++;
      }
      const { text, runs } = joinGroup(run);
      const flat = text.replace(/\n/g, " ");
      const prose = /[.!?]$/.test(flat.trim()) && flat.length > 80;
      if (prose || flat.trim().length <= 1) {
        segments.push({ type: "PARAGRAPH", text: flat, page: line.page, runs });
      } else {
        const m = /^(\d{1,2})[.)]\s/.exec(flat);
        segments.push({
          type: "HEADING",
          text: flat,
          page: line.page,
          rawSize: line.size,
          runs,
          headingNum: m ? Number(m[1]) : undefined,
        });
      }
      i = j;
      continue;
    }

    // Numbered heading at body size: "3.1 Results" — short, isolated, and
    // bold, or set larger than body, or in a document with no bold flags at all.
    if (
      single &&
      HEADING_NUM_STRICT_RE.test(line.text) &&
      !BULLET_RE.test(line.text) &&
      line.text.length < 120 &&
      !/[.,;:]$/.test(line.text) &&
      line.size >= body * 0.98 &&
      (boldShare(line.runs, line.text.length) > 0.6 ||
        line.size >= body * 1.05 ||
        !ctx.hasBold ||
        /^\d{1,2}(\.\d{1,2})+/.test(line.text))
    ) {
      const below = lines[i + 1];
      const isolated = !below || line.y - below.y > line.size * ctx.leading * 1.15;
      if (isolated) {
        const m = /^(\d{1,2})[.)]\s/.exec(line.text);
        segments.push({
          type: "HEADING",
          text: line.text,
          page: line.page,
          rawSize: line.size,
          runs: line.runs,
          headingNum: m ? Number(m[1]) : undefined,
        });
        i++;
        continue;
      }
    }

    // List run: bullet-marked lines, or an indented band whose gaps split it
    // into items (bullet glyphs are often vector art, not text).
    const bulletStart = BULLET_RE.test(line.text) && single && line.size <= body * 1.15;
    const indentStart = isIndented(line, ctx) && line.size <= body * 1.15 && line.size >= body * 0.8;
    if (bulletStart || indentStart) {
      const run: Line[] = [line];
      let j = i + 1;
      while (j < lines.length) {
        const next = lines[j];
        if (
          runOf[j] !== -1 ||
          next.cells.length !== 1 ||
          next.size > body * 1.15 ||
          Math.abs(next.size - line.size) > 1.2 ||
          run[run.length - 1].y - next.y > next.size * ctx.leading * 1.6 ||
          run[run.length - 1].y - next.y < 0
        )
          break;
        const continues = BULLET_RE.test(next.text) || next.x >= line.x - 2;
        if (!continues) break;
        run.push(next);
        j++;
      }
      // Item boundaries: bullet markers, or gaps looser than the run's leading.
      const starts: number[] = [0];
      const gaps = run.slice(1).map((l, k) => run[k].y - l.y);
      const gapThreshold = ctx.leading * line.size * 1.12;
      for (let k = 1; k < run.length; k++) {
        const marked = BULLET_RE.test(run[k].text);
        const spaced = gaps[k - 1] > gapThreshold;
        const outdented = run[k].x < run[k - 1].x - line.size * 0.5;
        if (marked || spaced || outdented) starts.push(k);
      }
      const items: { text: string; runs: Run[] }[] = [];
      for (let s = 0; s < starts.length; s++) {
        const slice = run.slice(starts[s], starts[s + 1] ?? run.length);
        const joined = joinGroup(slice);
        items.push({ text: joined.text.replace(/\n/g, " "), runs: joined.runs });
      }
      // At the top of a page, an unmarked first group before marked items is
      // the tail of the previous page's last item, not an item: emit it as a
      // paragraph so the cross-page merge can finish that item.
      if (i === 0 && items.length >= 2 && !BULLET_RE.test(items[0].text) && BULLET_RE.test(items[1].text)) {
        const tail = items.shift()!;
        segments.push({ type: "PARAGRAPH", text: tail.text, page: line.page, runs: tail.runs });
      }
      // Numbered lead-ins over flush-left paragraphs are prose, not a list:
      // when unmarked groups sit between marked ones at the column edge, every
      // group is its own paragraph.
      if (bulletStart && !indentStart && !items.every((item) => BULLET_RE.test(item.text))) {
        for (const item of items) {
          segments.push({ type: "PARAGRAPH", text: item.text, page: line.page, runs: item.runs });
        }
        i = j;
        continue;
      }
      if (items.length >= 2) {
        const builder = new TextBuilder();
        for (const item of items) {
          const marker = BULLET_RE.test(item.text) ? "" : "- ";
          builder.append(
            {
              text: marker + item.text,
              runs: item.runs.map((r) => ({
                ...r,
                start: r.start + marker.length,
                end: r.end + marker.length,
              })),
            },
            "\n",
          );
        }
        segments.push({ type: "LIST", text: builder.text, page: line.page, runs: builder.runs });
        i = j;
        continue;
      }
      // One item alone (usually cut by the page break): a paragraph that a
      // LIST on the neighboring page may claim.
      segments.push({
        type: "PARAGRAPH",
        text: items[0].text,
        page: line.page,
        runs: items[0].runs,
        listItem: run.length <= 6,
      });
      i = j;
      continue;
    }

    // Paragraph group: vertically continuous same-size lines in one column.
    const group: Line[] = [line];
    let j = i + 1;
    while (j < lines.length) {
      const next = lines[j];
      const prev = group[group.length - 1];
      const gap = prev.y - next.y;
      if (
        runOf[j] !== -1 ||
        next.cells.length !== 1 ||
        gap < 0 ||
        gap > next.size * 1.9 ||
        Math.abs(next.size - prev.size) > 0.6 ||
        next.x > prev.x + next.size * 1.1 ||
        next.x < prev.x - next.size * 1.1 ||
        next.size > body * 1.14 ||
        (tocMode && TOC_ENTRY_RE.test(next.text)) ||
        TOC_LABEL_RE.test(next.text.trim()) ||
        (isIndented(next, ctx) && !isIndented(prev, ctx)) ||
        (BULLET_RE.test(next.text) && !BULLET_RE.test(prev.text))
      )
        break;
      group.push(next);
      j++;
    }
    const { text, runs } = joinGroup(group, true);
    const monoChars = runs.filter((r) => r.mono).reduce((n, r) => n + (r.end - r.start), 0);
    const type = text.length > 0 && monoChars / text.length > 0.85 ? "CODE" : "PARAGRAPH";
    segments.push({ type, text, page: line.page, runs });
    i = j;
  }
  return segments;
}

// ── Repeated page furniture ─────────────────────────────────────────────────

function furnitureKeys(pages: Line[][], pageHeights: number[]): Set<string> {
  const normalize = (text: string) =>
    text.toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ").trim();
  const seenOn = new Map<string, Set<number>>();
  pages.forEach((lines, p) => {
    const h = pageHeights[p];
    for (const line of lines) {
      if (line.y > h * 0.085 && line.y < h * 0.915) continue;
      const key = normalize(line.text);
      if (key.length === 0) continue;
      const set = seenOn.get(key) ?? new Set<number>();
      set.add(p);
      seenOn.set(key, set);
    }
  });
  const threshold = Math.max(3, Math.round(pages.length * 0.25));
  const furniture = new Set<string>();
  for (const [key, on] of seenOn) if (on.size >= threshold) furniture.add(key);
  return furniture;
}

// ── Cross-page merges ───────────────────────────────────────────────────────

function shiftSpansInto(target: Segment, source: Segment, offset: number) {
  if (!source.runs) return;
  target.runs = [
    ...(target.runs ?? []),
    ...source.runs.map((r) => ({ ...r, start: r.start + offset, end: r.end + offset })),
  ];
}

function lastListNumber(text: string): number | null {
  const matches = [...text.matchAll(/(?:^|\n)(\d{1,2})[.)]\s/g)];
  return matches.length > 0 ? Number(matches[matches.length - 1][1]) : null;
}

function mergeAcrossPages(segments: Segment[]): Segment[] {
  const out: Segment[] = [];
  for (const segment of segments) {
    const prev = out[out.length - 1];
    if (!prev || segment.page === prev.page) {
      out.push(segment);
      continue;
    }

    // Paragraph that continues across the page break.
    if (
      segment.type === "PARAGRAPH" &&
      prev.type === "PARAGRAPH" &&
      !prev.listItem &&
      /[a-z,;\-–—]$/.test(prev.text) &&
      /^[a-z($€£0-9"'“]/.test(segment.text)
    ) {
      const glue = /[A-Za-z0-9][-–]$/.test(prev.text) && /^[A-Za-z0-9(]/.test(segment.text) ? "" : " ";
      const offset = prev.text.length + glue.length;
      prev.text = prev.text + glue + segment.text;
      shiftSpansInto(prev, segment, offset);
      continue;
    }

    // List split by the page break: LIST + LIST concatenate.
    if (segment.type === "LIST" && prev.type === "LIST" && !prev.tocEntries && !segment.tocEntries) {
      const offset = prev.text.length + 1;
      prev.text = prev.text + "\n" + segment.text;
      shiftSpansInto(prev, segment, offset);
      continue;
    }

    // A numbered list whose last item wraps into a paragraph on the next page:
    // the paragraph's leading words finish the item, and any "N." markers that
    // continue the numbering become items again. Checked before item-append so
    // a mid-sentence tail continues the item instead of becoming a new one.
    if (
      segment.type === "PARAGRAPH" &&
      prev.type === "LIST" &&
      !prev.tocEntries &&
      !/[.!?…:]$/.test(prev.text.trim()) &&
      /^[a-z($€£0-9"'“]/.test(segment.text)
    ) {
      const lastNum = lastListNumber(prev.text);
      const offset = prev.text.length + 1;
      prev.text = prev.text + " " + segment.text;
      shiftSpansInto(prev, segment, offset);
      if (lastNum !== null) {
        let expect = lastNum + 1;
        const re = /([ \n])(\d{1,2})([.)] )/g;
        let m: RegExpExecArray | null;
        const breaks: number[] = [];
        while ((m = re.exec(prev.text)) !== null) {
          if (m.index + 1 < offset) continue;
          if (Number(m[2]) === expect) {
            breaks.push(m.index);
            expect++;
          }
        }
        const chars = prev.text.split("");
        for (const at of breaks) chars[at] = "\n";
        prev.text = chars.join("");
      }
      continue;
    }

    // A lone item cut off at the page end joins the LIST that follows.
    if (segment.type === "LIST" && prev.type === "PARAGRAPH" && prev.listItem && !segment.tocEntries) {
      const marker = BULLET_RE.test(prev.text) ? "" : "- ";
      const offset = marker.length;
      segment.text = marker + prev.text + "\n" + segment.text;
      segment.runs = [
        ...(prev.runs ?? []).map((r) => ({ ...r, start: r.start + offset, end: r.end + offset })),
        ...(segment.runs ?? []).map((r) => ({
          ...r,
          start: r.start + marker.length + prev.text.length + 1,
          end: r.end + marker.length + prev.text.length + 1,
        })),
      ];
      out.pop();
      out.push(segment);
      continue;
    }
    if (segment.type === "PARAGRAPH" && segment.listItem && prev.type === "LIST" && !prev.tocEntries) {
      const marker = BULLET_RE.test(segment.text) ? "" : "- ";
      const offset = prev.text.length + 1 + marker.length;
      prev.text = prev.text + "\n" + marker + segment.text;
      shiftSpansInto(prev, segment, offset);
      continue;
    }

    // Table split by the page break: same column count concatenates; a
    // repeated header row drops.
    if (segment.type === "TABLE" && prev.type === "TABLE" && prev.html && segment.html) {
      const cols = (t: string) => t.split("\n")[0]?.split("\t").length ?? 0;
      if (cols(prev.text) === cols(segment.text)) {
        const prevHeader = prev.text.split("\n")[0];
        let rows = segment.text.split("\n");
        let html = segment.html;
        if (rows[0] === prevHeader) {
          rows = rows.slice(1);
          html = html
            .replace(/<thead>.*?<\/thead>/, "")
            .replace(/^<table>/, "<table>");
        }
        if (rows.length > 0) {
          prev.text = prev.text + "\n" + rows.join("\n");
          const prevBody = /<\/tbody><\/table>$/.test(prev.html);
          const newBody = /<tbody>(.*)<\/tbody><\/table>$/.exec(html);
          if (prevBody && newBody) {
            prev.html = prev.html.replace(/<\/tbody><\/table>$/, `${newBody[1]}</tbody></table>`);
          }
        }
        continue;
      }
    }

    out.push(segment);
  }
  return out;
}

// ── Heading levels ──────────────────────────────────────────────────────────

// Ranked by size: the biggest heading size in the document gets the level its
// ratio to body earns (a modest largest heading starts at h2), each smaller
// cluster steps one level down, floor h3.
function assignHeadingLevels(segments: Segment[], bodySize: number) {
  const sizes: number[] = [];
  for (const s of segments) {
    if (s.type !== "HEADING" || s.rawSize === undefined) continue;
    if (!sizes.some((v) => Math.abs(v - s.rawSize!) < v * 0.05)) sizes.push(s.rawSize);
  }
  sizes.sort((a, b) => b - a);
  const topRatio = sizes.length > 0 ? sizes[0] / bodySize : 1;
  const base = topRatio > 1.5 ? 1 : topRatio > 1.18 ? 2 : 3;
  for (const s of segments) {
    if (s.type !== "HEADING") continue;
    const idx = sizes.findIndex((v) => s.rawSize !== undefined && Math.abs(v - s.rawSize) < v * 0.05);
    const level = Math.min(3, base + Math.max(0, idx)) as 1 | 2 | 3;
    s.html = `<h${level}>${escapeHtml(s.text)}</h${level}>`;
  }
}

// ── Contents links ──────────────────────────────────────────────────────────

function resolveContentsLinks(segments: Segment[]) {
  const numToOrder = new Map<number, number>();
  segments.forEach((s, idx) => {
    if (s.type === "HEADING" && s.headingNum !== undefined && !numToOrder.has(s.headingNum)) {
      numToOrder.set(s.headingNum, idx);
    }
  });
  segments.forEach((s, idx) => {
    if (!s.tocEntries) return;
    const links: LinkSpan[] = [];
    for (const entry of s.tocEntries) {
      const target = numToOrder.get(entry.num);
      if (target === undefined || target === idx) continue;
      links.push({
        start: entry.start,
        end: entry.end,
        quotedText: s.text.slice(entry.start, entry.end),
        targetOrder: target,
      });
    }
    if (links.length > 0) s.links = [...(s.links ?? []), ...links];
  });
}

// ── Main ────────────────────────────────────────────────────────────────────

export async function parsePdf(
  data: Uint8Array,
): Promise<{ title: string | null; blocks: ParsedBlock[] }> {
  // pdf.js transfers (detaches) the buffer it receives — parse a copy so callers keep theirs.
  const pdf = await getDocumentProxy(new Uint8Array(data));

  const pages: Line[][] = [];
  const pageHeights: number[] = [];
  const flagsByFont = new Map<string, Omit<Flags, "href">>();

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    // Font programs resolve during operator-list building; afterwards the
    // real font names (Carlito-Bold, DejaVuSansMono, …) are readable.
    try {
      await page.getOperatorList();
    } catch {
      // Broken page resources: fall back to no style flags.
    }
    let uriRegions: UriRegion[] = [];
    try {
      const annots = (await page.getAnnotations()) as Array<Record<string, unknown>>;
      uriRegions = annots
        .filter((a) => a.subtype === "Link" && typeof a.url === "string" && Array.isArray(a.rect))
        .map((a) => {
          const rect = a.rect as number[];
          return {
            href: a.url as string,
            x1: Math.min(rect[0], rect[2]),
            y1: Math.min(rect[1], rect[3]),
            x2: Math.max(rect[0], rect[2]),
            y2: Math.max(rect[1], rect[3]),
          };
        });
    } catch {
      uriRegions = [];
    }

    const items: Item[] = [];
    for (const raw of content.items) {
      if (!("str" in raw) || typeof raw.str !== "string") continue;
      const t = raw.transform as number[];
      const size = Math.hypot(t[0], t[1]) || Math.hypot(t[2], t[3]) || 10;
      if (Math.abs(t[1]) > size * 0.3) continue; // rotated text (margin watermarks)
      const fontName = String(raw.fontName ?? "");
      let flags = flagsByFont.get(fontName);
      if (!flags) {
        let realName: string | null = null;
        try {
          const font = page.commonObjs.get(fontName) as { name?: string } | null;
          realName = font?.name ?? null;
        } catch {
          realName = null;
        }
        flags = fontFlags(realName);
        flagsByFont.set(fontName, flags);
      }
      const x = t[4];
      const y = t[5];
      const cx = x + raw.width / 2;
      const cy = y + size * 0.3;
      const region = uriRegions.find((r) => cx >= r.x1 && cx <= r.x2 && cy >= r.y1 && cy <= r.y2);
      items.push({
        str: raw.str,
        x,
        y,
        w: raw.width,
        size,
        ...flags,
        href: region?.href ?? null,
      });
    }
    pageHeights.push(viewport.height);
    pages.push(
      pageLines(items, viewport.width, p - 1).filter(
        (l) =>
          !(
            /^\d{1,4}$/.test(l.text) &&
            (l.y < viewport.height * 0.08 || l.y > viewport.height * 0.92)
          ),
      ),
    );
  }

  // Repeated headers and footers drop before anything is segmented.
  const furniture = furnitureKeys(pages, pageHeights);
  const cleaned = pages.map((lines, p) => {
    const h = pageHeights[p];
    return lines.filter((l) => {
      if (l.y > h * 0.085 && l.y < h * 0.915) return true;
      const key = l.text.toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ").trim();
      return !furniture.has(key);
    });
  });

  // Document metrics.
  const allBodySizes: number[] = [];
  const leadingRatios: number[] = [];
  for (const lines of cleaned) {
    for (let k = 0; k < lines.length; k++) {
      if (lines[k].text.length > 40) allBodySizes.push(lines[k].size);
      if (k > 0) {
        const gap = lines[k - 1].y - lines[k].y;
        const size = lines[k].size;
        if (Math.abs(lines[k - 1].size - size) < 0.6 && gap > size * 1.05 && gap < size * 2.0) {
          leadingRatios.push(gap / size);
        }
      }
    }
  }
  const bodySize = median(allBodySizes);
  const leading = leadingRatios.length >= 3 ? median(leadingRatios) : 1.45;
  const hasBold = cleaned.some((lines) => lines.some((l) => l.runs.some((r) => r.bold)));

  let segments: Segment[] = [];
  for (const lines of cleaned) {
    // The column's left edge: the smallest x that body lines regularly start
    // at. The mode is wrong on list-heavy pages, where indented item lines
    // outnumber flush body lines.
    const bodyXs = lines
      .filter((l) => l.cells.length === 1 && l.text.length > 30)
      .map((l) => Math.round(l.x));
    const counts = new Map<number, number>();
    for (const x of bodyXs) counts.set(x, (counts.get(x) ?? 0) + 1);
    const prominent = Math.max(2, Math.ceil(bodyXs.length * 0.12));
    let columnLeft = Infinity;
    for (const [x, count] of counts) {
      if (count >= prominent && x < columnLeft) columnLeft = x;
    }
    if (!Number.isFinite(columnLeft)) {
      columnLeft = lines.length > 0 ? Math.min(...lines.map((l) => l.x)) : 0;
    }
    segments.push(...segmentPage(lines, { bodySize, leading, columnLeft, hasBold }));
  }
  segments = segments.filter((s) => s.text.trim().length > 0);
  // Vector-figure debris: chart axis ticks read as tiny numeric-only lines.
  segments = segments.filter(
    (s) => !(s.type === "PARAGRAPH" && s.text.length <= 14 && /^[\d\s.,%−–-]+$/.test(s.text)),
  );

  // Same-page paragraph fragments that end mid-sentence join the next paragraph.
  const fused: Segment[] = [];
  for (const segment of segments) {
    const prev = fused[fused.length - 1];
    if (
      segment.type === "PARAGRAPH" &&
      prev &&
      prev.type === "PARAGRAPH" &&
      segment.page === prev.page &&
      !prev.listItem &&
      !segment.listItem &&
      !prev.text.includes("\n") &&
      /[a-z,;\-–—]$/.test(prev.text) &&
      /^[a-z(]/.test(segment.text)
    ) {
      const glue = /[A-Za-z0-9][-–]$/.test(prev.text) && /^[A-Za-z0-9(]/.test(segment.text) ? "" : " ";
      const offset = prev.text.length + glue.length;
      prev.text = prev.text + glue + segment.text;
      shiftSpansInto(prev, segment, offset);
      continue;
    }
    fused.push(segment);
  }

  segments = mergeAcrossPages(fused);
  assignHeadingLevels(segments, bodySize);
  resolveContentsLinks(segments);

  // A long title wraps across layout lines: consecutive equal-size HEADING
  // segments at the top of page 0 are one title, not several headings.
  while (
    segments.length >= 2 &&
    segments[0].page === 0 &&
    segments[1].page === 0 &&
    segments[0].type === "HEADING" &&
    segments[1].type === "HEADING" &&
    segments[0].rawSize !== undefined &&
    segments[1].rawSize !== undefined &&
    Math.abs(segments[0].rawSize - segments[1].rawSize) < 0.5
  ) {
    const offset = segments[0].text.length + 1;
    segments[0].text = `${segments[0].text} ${segments[1].text}`;
    shiftSpansInto(segments[0], segments[1], offset);
    segments.splice(1, 1);
  }

  // Title: the biggest heading on the first page.
  let title: string | null = null;
  let titleSize = 0;
  for (const s of segments) {
    if (s.page !== 0 || s.type !== "HEADING" || s.rawSize === undefined) continue;
    if (s.rawSize > titleSize && s.text.length > 4) {
      title = s.text;
      titleSize = s.rawSize;
    }
  }

  const blocks: ParsedBlock[] = segments.map((s) => {
    const { styles, links } = spansFromRuns(s.text, s.runs, {
      skipBold: s.type === "HEADING",
      skipMono: s.type === "CODE",
    });
    const block: ParsedBlock = { type: s.type, text: s.text };
    if (s.html) block.html = s.html;
    const allLinks = [...(s.links ?? []), ...links];
    if (styles.length > 0) block.styles = styles;
    if (allLinks.length > 0) block.links = allLinks;
    return block;
  });

  return { title, blocks: blocks.filter((b) => b.text.trim().length > 0) };
}
