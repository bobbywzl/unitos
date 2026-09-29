import { JSDOM } from "jsdom";
import { diffSegments } from "@/lib/anchors/remap";
import { escapeHtml } from "@/lib/parse/office";

// A slide's or a sheet's replica with new words (SPEC.md §27). The one rule
// holds after every edit: the replica's DOM text — every text node outside
// [data-anchor-skip] — equals the block's text. The text is pieces between
// gaps (`.cell-gap`: a newline between a slide's lines or a sheet's rows, a
// tab between cells); an edit changes words within pieces and keeps every
// gap, so the slide keeps its lines and the sheet its grid. New words take
// the run where the change starts, so they keep its font, size, and color.
// The html is changed in place, text node by text node, and every other
// byte stays: an edit taken back gives the replica back byte for byte.

/** Why an edit does not go into the replica: a line, a row, a column, or a
    tab added or removed (lines); words the replica draws elsewhere or keeps
    (fixed: a bullet, the speaker notes' label, a chart's data under its
    drawing, a formula's cell, a cell a merge covers); words where the
    replica has no run to hold them (empty); a replica whose text is not the
    block's (stale). */
export type ReplicaRefusal = "lines" | "fixed" | "empty" | "stale";

type Located = { node: Text; start: number; end: number; fixed: boolean };
type Piece = {
  nodes: Located[];
  // Where words go when the piece has none: before its gap, in a table cell.
  cell: number | null;
  // A formula's cell, or a cell a merge covers: its words stay.
  fixed: boolean;
};

// The runs whose words stay: a bullet, the speaker notes' label, a chart's data.
const FIXED_RUNS = ".sb, .slide-notes-label, .scd-hidden";
const PREFIX = "<!DOCTYPE html><html><head></head><body>";

/** The replica's pieces and gaps, each text node with its place in `html`. */
function readReplica(html: string): { text: string; pieces: Piece[]; gaps: string[] } {
  const dom = new JSDOM(`${PREFIX}${html}</body></html>`, { includeNodeLocations: true });
  const document = dom.window.document;
  const at = (node: Node) => {
    const loc = dom.nodeLocation(node);
    if (!loc) throw new Error("a replica's node has no place");
    return { start: loc.startOffset - PREFIX.length, end: loc.endOffset - PREFIX.length };
  };
  const pieces: Piece[] = [{ nodes: [], cell: null, fixed: false }];
  const gaps: string[] = [];
  let text = "";
  // With merged cells in the table, an empty piece may be a cell a merge
  // covers (its gap rides in a cell beside it): no empty piece takes words.
  const merged = document.querySelector("td[colspan], td[rowspan]") !== null;
  const walker = document.createTreeWalker(document.body, 4 /* NodeFilter.SHOW_TEXT */);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const node = n as Text;
    const parent = node.parentElement;
    if (!parent || parent.closest("[data-anchor-skip]")) continue;
    text += node.data;
    const piece = pieces[pieces.length - 1];
    const gap = parent.closest(".cell-gap");
    if (!gap) {
      piece.nodes.push({ node, ...at(node), fixed: Boolean(parent.closest(FIXED_RUNS)) });
      continue;
    }
    // A gap closes the piece before it. In a table cell the piece's words
    // go before the gap; a formula's cell keeps its words.
    const cell = gap.parentElement?.closest("td, th") ?? null;
    if (cell) {
      piece.cell = at(gap).start;
      if (cell.getAttribute("title")?.startsWith("=") || (merged && piece.nodes.length === 0)) piece.fixed = true;
    }
    gaps.push(node.data);
    pieces.push({ nodes: [], cell: null, fixed: false });
  }
  return { text, pieces, gaps };
}

/** `next` cut into the replica's pieces: the text split at every newline and
    tab must give the same separators as the replica's, in order — its gaps,
    and the tabs or newlines a run holds (a tab inside a line) — so each
    piece takes the parts between its own. Null when they differ. */
function cutAsReplica(next: string, was: string[], gaps: string[]): string[] | null {
  const parts = next.split(/(\n|\t)/);
  const pieces: string[] = [];
  let k = 0;
  for (let i = 0; i < was.length; i++) {
    const inner = was[i].match(/[\n\t]/g) ?? [];
    let piece = parts[k] ?? "";
    for (const sep of inner) {
      if (parts[k + 1] !== sep) return null;
      piece += sep + (parts[k + 2] ?? "");
      k += 2;
    }
    pieces.push(piece);
    if (i < gaps.length) {
      if (parts[k + 1] !== gaps[i]) return null;
      k += 2;
    }
  }
  return k === parts.length - 1 ? pieces : null;
}

/** The stretches `after` changes in `before`, as small as they go: a
    word-level diff; words changed one for one, with the spaces between
    the same, change one by one; each loses the letters both sides share
    at its ends. */
function stretches(before: string, after: string): { from: number; to: number; words: string }[] {
  const out: { from: number; to: number; words: string }[] = [];
  const trimmed = (from: number, to: number, words: string) => {
    let p = 0;
    while (from + p < to && p < words.length && before[from + p] === words[p]) p++;
    let s = 0;
    while (from + p < to - s && p < words.length - s && before[to - 1 - s] === words[words.length - 1 - s]) s++;
    if (from + p < to - s || p < words.length - s) out.push({ from: from + p, to: to - s, words: words.slice(p, words.length - s) });
  };
  for (const seg of diffSegments(before, after)) {
    if (seg.matched) continue;
    const a = before.slice(seg.oldStart, seg.oldEnd);
    const b = after.slice(seg.newStart, seg.newEnd);
    const wordsA = [...a.matchAll(/\S+/g)];
    const wordsB = [...b.matchAll(/\S+/g)];
    if (wordsA.length > 1 && wordsA.length === wordsB.length && a.replace(/\S+/g, " ") === b.replace(/\S+/g, " ")) {
      wordsA.forEach((w, i) => trimmed(seg.oldStart + w.index, seg.oldStart + w.index + w[0].length, wordsB[i][0]));
    } else trimmed(seg.oldStart, seg.oldEnd, b);
  }
  return out;
}

/** One piece's changes as splices of the html, or why not. The words both
    sides share stay; each changed stretch (a word-level diff) goes into the
    run where it starts (a pure insert: the run it follows, else the one it
    precedes), and the runs after lose what it covers. */
function pieceSplices(piece: Piece, before: string, after: string): { start: number; end: number; source: string }[] | ReplicaRefusal {
  if (piece.fixed) return "fixed";
  if (piece.nodes.length === 0) return piece.cell === null ? "empty" : [{ start: piece.cell, end: piece.cell, source: escapeHtml(after) }];
  const runs: { run: Located; from: number; to: number; edits: { from: number; to: number; words: string }[] }[] = [];
  let offset = 0;
  for (const run of piece.nodes) {
    runs.push({ run, from: offset, to: offset + run.node.data.length, edits: [] });
    offset += run.node.data.length;
  }
  for (const { from, to, words } of stretches(before, after)) {
    const home =
      from < to
        ? runs.find((x) => from >= x.from && from < x.to)
        : (runs.find((x) => from > x.from && from <= x.to && !x.run.fixed) ??
          runs.find((x) => from >= x.from && from < x.to && !x.run.fixed) ??
          runs.find((x) => from === x.from && !x.run.fixed));
    if (!home) return "empty";
    for (const x of runs) {
      const cut = Math.max(from, x.from) < Math.min(to, x.to);
      if (x !== home && !cut) continue;
      if (x.run.fixed) return "fixed";
      x.edits.push({ from: Math.max(from, x.from) - x.from, to: Math.max(Math.min(to, x.to), Math.max(from, x.from)) - x.from, words: x === home ? words : "" });
    }
  }
  const splices: { start: number; end: number; source: string }[] = [];
  for (const x of runs) {
    if (x.edits.length === 0) continue;
    let data = x.run.node.data;
    for (const e of [...x.edits].sort((a, b) => b.from - a.from)) data = data.slice(0, e.from) + e.words + data.slice(e.to);
    splices.push({ start: x.run.start, end: x.run.end, source: escapeHtml(data) });
  }
  return splices;
}

/** The replica with `next` for its words, or why not. */
export function replicaWithText(html: string, prev: string, next: string): { html: string } | { refused: ReplicaRefusal } {
  const replica = readReplica(html);
  if (replica.text !== prev) return { refused: "stale" };
  const was = replica.pieces.map((p) => p.nodes.map((n) => n.node.data).join(""));
  const now = cutAsReplica(next, was, replica.gaps);
  if (!now) return { refused: "lines" };
  const splices: { start: number; end: number; source: string }[] = [];
  for (let i = 0; i < replica.pieces.length; i++) {
    if (was[i] === now[i]) continue;
    const piece = pieceSplices(replica.pieces[i], was[i], now[i]);
    if (typeof piece === "string") return { refused: piece };
    splices.push(...piece);
  }
  let out = html;
  for (const { start, end, source } of splices.sort((a, b) => b.start - a.start)) out = out.slice(0, start) + source + out.slice(end);
  // The one rule, checked on what will be stored.
  if (readReplica(out).text !== next) return { refused: "stale" };
  return { html: out };
}

/** A slide's own words: its text before the speaker notes. */
const slideWords = (text: string) => text.replace(/(^|\n)Speaker notes:\n[\s\S]*$/, "");

/** A slide whose own words are not its words as parsed shows its replica:
    the picture shows the words as parsed, so it waits (`data-picture-held`)
    until the words are back. The speaker notes are no part of the picture. */
export function slidePicture(html: string, text: string, parsed: string): string {
  return slideWords(text) !== slideWords(parsed)
    ? html.replace(/(<div class="slide-frame"[^>]*?) data-picture="1"/, '$1 data-picture-held="1"')
    : html.replace(/(<div class="slide-frame"[^>]*?) data-picture-held="1"/, '$1 data-picture="1"');
}

// ── A sheet's rows and columns ─────────────────────────────────────────────

/** Rows (or columns) of `before` and `after` aligned: the ones both keep
    as they are anchor the rest; between two, old and new pair up in order
    (their words change later), the extra old ones go, the extra new ones
    come. Each entry of the result is a new one: the old one it keeps
    (paired or equal), or null for a new one; `gone` lists the old ones
    that go. */
function alignLines(before: string[], after: string[]): { kept: (number | null)[]; gone: number[] } {
  const n = before.length;
  const m = after.length;
  const table = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) table[i][j] = before[i] === after[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  const equal: [number, number][] = [];
  for (let i = 0, j = 0; i < n && j < m; ) {
    if (before[i] === after[j]) equal.push([i++, j++]);
    else if (table[i + 1][j] >= table[i][j + 1]) i++;
    else j++;
  }
  const kept: (number | null)[] = [];
  const gone: number[] = [];
  let i = 0;
  let j = 0;
  for (const [ei, ej] of [...equal, [n, m] as [number, number]]) {
    const olds = ej - j < ei - i ? ei - i : ei - i;
    const pairs = Math.min(ei - i, ej - j);
    for (let k = 0; k < pairs; k++) kept.push(i + k);
    for (let k = pairs; k < ej - j; k++) kept.push(null);
    for (let k = pairs; k < olds; k++) gone.push(i + k);
    if (ei < n) kept.push(ei);
    i = ei + 1;
    j = ej + 1;
  }
  return { kept, gone };
}

const GAP_SOURCE = (gap: string) => (gap ? `<span class="cell-gap">${gap}</span>` : "");
/** A cell's source with its own gap (the one it ends with) set to `gap`. */
const withGap = (cell: string, gap: string) => cell.replace(/(?:<span class="cell-gap">[\t\n]<\/span>)?<\/td>$/, `${GAP_SOURCE(gap)}</td>`);

/** The grid of a sheet's replica, every part with its place in `html`. */
function readGrid(html: string) {
  const dom = new JSDOM(`${PREFIX}${html}</body></html>`, { includeNodeLocations: true });
  const document = dom.window.document;
  const place = (node: Node) => {
    const loc = dom.nodeLocation(node) as { startOffset: number; endOffset: number; attrs?: Record<string, { startOffset: number; endOffset: number }>; startTag?: { endOffset: number }; endTag?: { startOffset: number } } | null;
    if (!loc) throw new Error("a sheet's node has no place");
    const at = (o: number) => o - PREFIX.length;
    return {
      start: at(loc.startOffset),
      end: at(loc.endOffset),
      inner: { start: at(loc.startTag?.endOffset ?? loc.startOffset), end: at(loc.endTag?.startOffset ?? loc.endOffset) },
      attrs: Object.fromEntries(Object.entries(loc.attrs ?? {}).map(([k, v]) => [k, { start: at(v.startOffset), end: at(v.endOffset) }])),
    };
  };
  const sheet = document.querySelector(".sheet");
  const table = sheet?.querySelector(":scope > .sheet-inner > table");
  const body = table?.querySelector(":scope > tbody");
  const colgroup = table?.querySelector(":scope > colgroup");
  const headRow = table?.querySelector(":scope > thead > tr");
  if (!sheet || !table || !body || !colgroup || !headRow) return null;
  const inner = sheet.querySelector(":scope > .sheet-inner")!;
  const rows = [...body.children].filter((el) => el.localName === "tr");
  return {
    document,
    place,
    sheet,
    inner,
    table,
    body,
    colgroup,
    headRow,
    rows: rows.map((tr) => ({ tr, cells: [...tr.children].filter((el) => el.localName === "td") })),
    frozenRows: Number(sheet.getAttribute("data-frozen-rows") ?? 0),
    frozenCols: Number(sheet.getAttribute("data-frozen-cols") ?? 0),
    // A merge or a drawing over the grid: rows and columns stay.
    fixed: sheet.querySelector("td[colspan], td[rowspan], .sheet-drawing, td[style*='display:none']") !== null,
  };
}

/** A new cell like `model` (its style, its class), holding `words`. */
function newCell(model: Element, words: string, gap: string): string {
  const cell = model.cloneNode(false) as Element;
  cell.removeAttribute("title");
  cell.textContent = words;
  return withGap(cell.outerHTML, gap);
}

/** A sheet's replica with rows or columns added or removed to match
    `next`'s grid, the kept cells' words as they were; or why not. */
function sheetShape(html: string, prev: string, next: string): { html: string } | { refused: ReplicaRefusal } {
  const grid = readGrid(html);
  if (!grid) return { refused: "lines" };
  const before = prev.split("\n").map((r) => r.split("\t"));
  const after = next.split("\n").map((r) => r.split("\t"));
  const width = before[0].length;
  const newWidth = after[0].length;
  // A grid is a rectangle: every row as wide as the first.
  if (before.some((r) => r.length !== width) || after.some((r) => r.length !== newWidth)) return { refused: "lines" };
  if (grid.fixed || before.length !== grid.rows.length || grid.rows.some((r) => r.cells.length !== width)) return { refused: "fixed" };
  const rowsChange = before.length !== after.length;
  const colsChange = width !== newWidth;
  if (rowsChange && colsChange) return { refused: "lines" };
  const splices: { start: number; end: number; source: string }[] = [];
  const source = (start: number, end: number) => html.slice(start, end);
  const setAttr = (el: Element, name: string, value: string) => {
    const at = grid.place(el).attrs[name];
    if (at) splices.push({ start: at.start, end: at.end, source: `${name}="${value}"` });
  };

  if (rowsChange) {
    const { kept, gone } = alignLines(before.map((r) => r.join("\t")), after.map((r) => r.join("\t")));
    // The header rows a sheet holds frozen stay where they are.
    if (gone.some((i) => i < grid.frozenRows) || kept.some((k, j) => k === null && j < grid.frozenRows)) return { refused: "fixed" };
    const model = grid.rows.findLast((_, i) => i >= grid.frozenRows && !gone.includes(i)) ?? grid.rows.find((_, i) => i >= grid.frozenRows);
    if (!model) return { refused: "fixed" };
    const last = after.length - 1;
    const rows = kept.map((k, j) => {
      const gap = j === last ? "" : "\n";
      if (k !== null) {
        const row = grid.rows[k];
        const where = grid.place(row.tr);
        let out = source(where.start, where.end);
        // The row's number, and its last cell's gap: a row's end, or none for the sheet's last row.
        out = out.replace(/(<th class="sheet-rn[^"]*"[^>]*>)\d+(<\/th>)/, `$1${j + 1}$2`);
        const lastCell = grid.place(row.cells[row.cells.length - 1]);
        const cellSource = source(lastCell.start, lastCell.end);
        return out.replace(cellSource, withGap(cellSource, gap));
      }
      const tr = model.tr.cloneNode(false) as Element;
      const number = model.tr.querySelector("th.sheet-rn")?.cloneNode(false) as Element | undefined;
      if (number) number.textContent = String(j + 1);
      const cells = model.cells.map((cell, c) => newCell(cell, after[j][c], c === width - 1 ? gap : "\t"));
      return tr.outerHTML.replace("></tr>", `>${number?.outerHTML ?? ""}${cells.join("")}</tr>`);
    });
    const body = grid.place(grid.body);
    splices.push({ start: body.inner.start, end: body.inner.end, source: rows.join("") });
    setAttr(grid.sheet, "data-rows", String(after.length));
  } else if (colsChange) {
    const column = (rows: string[][], c: number) => rows.map((r) => r[c]).join("\n");
    const { kept, gone } = alignLines(
      Array.from({ length: width }, (_, c) => column(before, c)),
      Array.from({ length: newWidth }, (_, c) => column(after, c)),
    );
    if (gone.some((c) => c < grid.frozenCols) || kept.some((k, j) => k === null && j < grid.frozenCols)) return { refused: "fixed" };
    // A new column is like the kept column before it, else the one after.
    const modelOf = (j: number) => {
      for (let x = j - 1; x >= 0; x--) if (kept[x] !== null) return kept[x]!;
      for (let x = j + 1; x < kept.length; x++) if (kept[x] !== null) return kept[x]!;
      return null;
    };
    const cols = [...grid.colgroup.children];
    const heads = [...grid.headRow.children];
    // colgroup: the row numbers' column, then one per column.
    const colSource = (c: number) => {
      const at = grid.place(cols[c + 1]);
      return source(at.start, at.end);
    };
    const widthOf = (col: string) => Number(/width:(\d+(?:\.\d+)?)px/.exec(col)?.[1] ?? 0);
    const newCols = kept.map((k, j) => (k !== null ? colSource(k) : modelOf(j) !== null ? colSource(modelOf(j)!) : null));
    if (newCols.some((c) => c === null)) return { refused: "fixed" };
    const colgroup = grid.place(grid.colgroup);
    const first = grid.place(cols[0]);
    splices.push({ start: colgroup.inner.start, end: colgroup.inner.end, source: source(first.start, first.end) + newCols.join("") });
    // The column letters: A, B, C, … as the grid now stands.
    const letter = (index: number) => {
      let n = index + 1;
      let out = "";
      while (n > 0) {
        n -= 1;
        out = String.fromCharCode(65 + (n % 26)) + out;
        n = Math.floor(n / 26);
      }
      return out;
    };
    const headSource = (c: number) => {
      const at = grid.place(heads[c + 1]);
      return source(at.start, at.end);
    };
    const newHeads = kept.map((k, j) => headSource(k ?? modelOf(j)!).replace(/>[A-Z]+<\/th>$/, `>${letter(j)}</th>`));
    const head = grid.place(grid.headRow);
    const corner = grid.place(heads[0]);
    splices.push({ start: head.inner.start, end: head.inner.end, source: source(corner.start, corner.end) + newHeads.join("") });
    // Every row: its number, then its cells in the new order.
    const lastRow = grid.rows.length - 1;
    grid.rows.forEach((row, r) => {
      const tr = grid.place(row.tr);
      const number = row.tr.querySelector("th.sheet-rn");
      const numberAt = number ? grid.place(number) : null;
      const cells = kept.map((k, j) => {
        const gap = j === newWidth - 1 ? (r === lastRow ? "" : "\n") : "\t";
        if (k !== null) {
          const at = grid.place(row.cells[k]);
          return withGap(source(at.start, at.end), gap);
        }
        return newCell(row.cells[modelOf(j)!], after[r][j], gap);
      });
      splices.push({ start: tr.inner.start, end: tr.inner.end, source: (numberAt ? source(numberAt.start, numberAt.end) : "") + cells.join("") });
    });
    // The grid's width: the row numbers' column and every column.
    const total = [grid.place(cols[0])].map((c) => widthOf(source(c.start, c.end)))[0] + newCols.reduce((sum, c) => sum + widthOf(c!), 0);
    const setWidth = (el: Element) => {
      const at = grid.place(el).attrs.style;
      if (!at) return;
      const style = source(at.start, at.end);
      splices.push({ start: at.start, end: at.end, source: style.replace(/width:\d+(?:\.\d+)?px/, `width:${total}px`) });
    };
    setWidth(grid.table);
    setWidth(grid.inner);
    setAttr(grid.sheet, "data-cols", String(newWidth));
  }
  let out = html;
  for (const { start, end, source: text } of splices.sort((a, b) => b.start - a.start)) out = out.slice(0, start) + text + out.slice(end);
  return { html: out };
}

/** A sheet's replica with `next` for its text: its words cell by cell, and
    rows or columns added or removed (one of the two at a time); or why not. */
export function sheetWithText(html: string, prev: string, next: string): { html: string } | { refused: ReplicaRefusal } {
  const shape = (text: string) => text.split("\n").map((r) => r.split("\t").length).join(",");
  if (shape(prev) === shape(next)) return replicaWithText(html, prev, next);
  const reshaped = sheetShape(html, prev, next);
  if ("refused" in reshaped) return reshaped;
  // The kept cells' words, then.
  return replicaWithText(reshaped.html, readReplica(reshaped.html).text, next);
}
