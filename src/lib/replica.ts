import { JSDOM } from "jsdom";
import { z } from "zod";
import { diffSegments } from "@/lib/anchors/remap";
import type { TKey } from "@/lib/i18n/dictionaries";
import { escapeHtml } from "@/lib/parse/office";
import { columnLetter } from "@/lib/parse/sheets";

// A slide's or a sheet's replica with new words (SPEC.md §27). The one rule
// holds after every edit: the replica's DOM text — every text node outside
// [data-anchor-skip] — equals the block's text. The text is pieces between
// gaps (`.cell-gap`: a newline between a slide's lines or a sheet's rows, a
// tab between cells); an edit changes words within pieces and keeps every
// gap, so the slide keeps its lines and the sheet its grid. New words take
// the run where the change starts, so they keep its font, size, and color.
// The html is changed in place, text node by text node, and every other
// byte stays: an edit taken back gives the replica back byte for byte.

/** Why an edit does not go into the replica: a slide's line, or a tab in
    one, added or removed (lines); a sheet that is no longer a grid — a row
    with more or fewer cells than the first, or rows and columns changed in
    one edit (grid); a sheet's frozen rows or columns added or removed
    (frozen); rows or columns of a sheet with merged cells or a drawing
    (merged); words the replica draws elsewhere or keeps (fixed: a bullet,
    the speaker notes' label, a chart's data under its drawing, a formula's
    cell, a cell a merge covers); words where the replica has no run to
    hold them (empty); a replica whose text is not the block's (stale). */
export type ReplicaRefusal = "lines" | "grid" | "frozen" | "merged" | "fixed" | "empty" | "stale";

/** What the reader is told for each refusal. */
export const REPLICA_REFUSAL: Record<ReplicaRefusal, TKey> = {
  lines: "api.replicaLines",
  grid: "api.replicaGrid",
  frozen: "api.replicaFrozen",
  merged: "api.replicaMerged",
  fixed: "api.replicaFixed",
  empty: "api.replicaEmpty",
  stale: "api.replicaStale",
};

// A node's place in the html, as jsdom gives it.
type Location = {
  startOffset: number;
  endOffset: number;
  attrs?: Record<string, { startOffset: number; endOffset: number }>;
  startTag?: { endOffset: number };
  endTag?: { startOffset: number };
};

type Located = { node: Text; start: number; end: number; fixed: boolean };
type Piece = {
  nodes: Located[];
  // Where words go when the piece has none: before its gap, in a table cell.
  cell: number | null;
  // A formula's cell, or a cell a merge covers: its words stay.
  fixed: boolean;
  formula: boolean;
};

// The runs whose words stay: a bullet, the speaker notes' label, a chart's
// data, a table cell's formula (its characters drawn from its TeX).
const FIXED_RUNS = ".sb, .slide-notes-label, .scd-hidden, [data-type='inline-math']";
const PREFIX = "<!DOCTYPE html><html><head></head><body>";
// A gap between cells or lines; a space in a gap is the break between a
// table cell's paragraphs, a run whose words stay.
const CELL_GAP = /^[\t\n]$/;

/** A cell a merge covers: its gap rides in a cell drawn beside it, so that
    cell holds more than one gap (a sheet's, a Word table's), or in a
    hidden cell. Its piece has no words and takes none. */
const coveredIn = (cell: Element) =>
  [...cell.querySelectorAll(".cell-gap")].filter((gap) => CELL_GAP.test(gap.textContent ?? "")).length > 1 || /display:\s*none/.test(cell.getAttribute("style") ?? "");

/** The replica's pieces and gaps, each text node with its place in `html`. */
function readReplica(html: string): { text: string; pieces: Piece[]; gaps: string[] } {
  const dom = new JSDOM(`${PREFIX}${html}</body></html>`, { includeNodeLocations: true });
  const document = dom.window.document;
  const at = (node: Node) => {
    const loc = dom.nodeLocation(node);
    if (!loc) throw new Error("a replica's node has no place");
    return { start: loc.startOffset - PREFIX.length, end: loc.endOffset - PREFIX.length };
  };
  const pieces: Piece[] = [{ nodes: [], cell: null, fixed: false, formula: false }];
  const gaps: string[] = [];
  let lastGap = -1;
  let text = "";
  const walker = document.createTreeWalker(document.body, 4 /* NodeFilter.SHOW_TEXT */);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const node = n as Text;
    const parent = node.parentElement;
    if (!parent || parent.closest("[data-anchor-skip]")) continue;
    text += node.data;
    const piece = pieces[pieces.length - 1];
    const gap = parent.closest(".cell-gap");
    if (!gap || !CELL_GAP.test(node.data)) {
      piece.nodes.push({ node, ...at(node), fixed: Boolean(gap || parent.closest(FIXED_RUNS)) });
      continue;
    }
    // A gap closes the piece before it. In a table cell or a caption the
    // piece's words go before the gap; a formula's cell, a cell a merge
    // covers, and a cell of a chart's data keep their words.
    const cell = gap.parentElement?.closest("td, th, caption") ?? null;
    if (cell) {
      piece.cell = at(gap).start;
      piece.formula = cell.getAttribute("title")?.startsWith("=") === true;
      if (piece.formula || cell.closest(FIXED_RUNS) || (piece.nodes.length === 0 && coveredIn(cell))) piece.fixed = true;
    }
    gaps.push(node.data);
    lastGap = at(gap).start;
    pieces.push({ nodes: [], cell: null, fixed: false, formula: false });
  }
  // A table's last cell has no gap after it: a formula's keeps its words;
  // an empty one takes words at its end.
  const last = pieces[pieces.length - 1];
  const final = last.nodes.at(-1)?.node.parentElement?.closest("td");
  if (final?.getAttribute("title")?.startsWith("=")) last.fixed = last.formula = true;
  const lastRow = [...document.querySelectorAll("tr")].at(-1);
  const lastCell = last.nodes.length === 0 && lastRow?.lastElementChild?.matches("td, th") ? lastRow.lastElementChild : null;
  const lastCellAt = lastCell && !lastCell.textContent ? (dom.nodeLocation(lastCell) as Location | null) : null;
  if (lastCellAt?.endTag && lastCellAt.startOffset - PREFIX.length > lastGap) {
    last.cell = lastCellAt.endTag.startOffset - PREFIX.length;
    last.formula = lastCell!.getAttribute("title")?.startsWith("=") === true;
    last.fixed = last.formula || coveredIn(lastCell!);
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

/** What an edit took out of a sheet: each removed row's source, or each
    removed column's col, letter, and cells, with its words. It is kept on
    the edit (BlockEdit.meta), so the edit taken back puts them back as they
    were, byte for byte. */
export const sheetCutSchema = z.union([
  z.object({ rows: z.array(z.object({ words: z.string(), source: z.string() })) }),
  z.object({ cols: z.array(z.object({ words: z.string(), col: z.string(), head: z.string(), cells: z.array(z.string()) })) }),
]);
export type SheetCut = z.infer<typeof sheetCutSchema>;

/** Rows (or columns) of `before` and `after` aligned, each a list of cells.
    The ones both keep as they are anchor the rest; between two anchors, old
    and new pair up in order, each with the one most like it (the most cells
    the same) — its words change later — the extra old ones go, and the
    extra new ones come. `kept` has an entry per new line: the old line it
    keeps, or null for a new one; `gone` lists the old lines that go. */
function alignLines(before: string[][], after: string[][]): { kept: (number | null)[]; gone: number[] } {
  const a = before.map((line) => line.join("\t"));
  const b = after.map((line) => line.join("\t"));
  const n = a.length;
  const m = b.length;
  const lcs = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const anchors: [number, number][] = [];
  for (let i = 0, j = 0; i < n && j < m; ) {
    if (a[i] === b[j]) anchors.push([i++, j++]);
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) i++;
    else j++;
  }
  const alike = (x: string[], y: string[]) => x.reduce((sum, cell, c) => sum + (cell === y[c] ? 1 : 0), 0);
  const kept: (number | null)[] = [];
  const gone: number[] = [];
  let i = 0;
  let j = 0;
  for (const [ai, aj] of [...anchors, [n, m] as [number, number]]) {
    // Old i..ai and new j..aj: as many pairs as the shorter side has lines,
    // the sum of the cells they share the most it can be.
    const p = ai - i;
    const q = aj - j;
    const best = Array.from({ length: p + 1 }, () => new Array<number>(q + 1).fill(-Infinity));
    best[0][0] = 0;
    for (let x = 0; x <= p; x++) {
      for (let y = 0; y <= q; y++) {
        if (x > 0 && p > q) best[x][y] = Math.max(best[x][y], best[x - 1][y]);
        if (y > 0 && q > p) best[x][y] = Math.max(best[x][y], best[x][y - 1]);
        if (x > 0 && y > 0) best[x][y] = Math.max(best[x][y], best[x - 1][y - 1] + alike(before[i + x - 1], after[j + y - 1]));
      }
    }
    const paired = new Array<number | null>(q).fill(null);
    for (let x = p, y = q; x > 0 || y > 0; ) {
      if (x > 0 && p > q && best[x][y] === best[x - 1][y]) {
        gone.push(i + --x);
      } else if (y > 0 && q > p && best[x][y] === best[x][y - 1]) {
        y--;
      } else {
        paired[--y] = i + --x;
      }
    }
    kept.push(...paired);
    if (ai < n) kept.push(ai);
    i = ai + 1;
    j = aj + 1;
  }
  return { kept, gone: gone.sort((x, y) => x - y) };
}

/** The line a new line at `j` is built like: the kept one before it, past
    the frozen ones; else the kept one after it; else any kept one. */
function modelOf(kept: (number | null)[], j: number, frozen: number): number {
  for (let x = j - 1; x >= 0; x--) if (kept[x] !== null && kept[x]! >= frozen) return kept[x]!;
  for (let x = j + 1; x < kept.length; x++) if (kept[x] !== null) return kept[x]!;
  return kept.find((k) => k !== null) ?? 0;
}

const GAP_SOURCE = (gap: string) => (gap ? `<span class="cell-gap">${gap}</span>` : "");
/** A cell's source with its own gap (the one it ends with) set to `gap`. */
const withGap = (cell: string, gap: string) => cell.replace(/(?:<span class="cell-gap">[\t\n]<\/span>)?<\/td>$/, () => `${GAP_SOURCE(gap)}</td>`);
/** A row's source numbered `n`, its last cell ending in `gap`. */
const rowAt = (row: string, n: number, gap: string) =>
  row
    .replace(/(<th class="sheet-rn[^"]*"[^>]*>)\d*(<\/th>)/, (_, open: string, close: string) => `${open}${n}${close}`)
    .replace(/(?:<span class="cell-gap">[\t\n]<\/span>)?<\/td><\/tr>$/, () => `${GAP_SOURCE(gap)}</td></tr>`);
// A value a sheet lines up right: a number, a percent, an amount, a date.
const NUMBER = /^(?:[-+(]?[$€£¥]?\d[\d,]*(?:\.\d+)?(?:[eE][-+]?\d+)?%?\)?|\d{4}-\d{2}-\d{2})$/;

/** An element like `model` with no children: not frozen the way `frozen`
    names (a new row stands after the frozen rows, a new column after the
    frozen columns), no formula. */
function bare(model: Element, frozen: "sheet-fr" | "sheet-fc"): Element {
  const el = model.cloneNode(false) as Element;
  el.removeAttribute("title");
  el.classList.remove(frozen);
  const style = el.getAttribute("style");
  if (style !== null) {
    const rest = style
      .split(";")
      .filter((rule) => !(frozen === "sheet-fc" ? /^\s*left\s*:/ : /^\s*--sheet-top\s*:/).test(rule))
      .join(";");
    if (rest) el.setAttribute("style", rest);
    else el.removeAttribute("style");
  }
  return el;
}

/** A new cell like `model` (its style, its width's class), holding `words`. */
function newCell(model: Element, words: string, gap: string, frozen: "sheet-fr" | "sheet-fc"): string {
  const cell = bare(model, frozen);
  cell.classList.remove("sheet-num", "sheet-mid");
  if (NUMBER.test(words.trim())) cell.classList.add("sheet-num");
  if (cell.classList.length === 0) cell.removeAttribute("class");
  cell.textContent = words;
  return withGap(cell.outerHTML, gap);
}

/** The grid of a sheet's replica, every part with its place in `html`. */
function readGrid(html: string) {
  const dom = new JSDOM(`${PREFIX}${html}</body></html>`, { includeNodeLocations: true });
  const document = dom.window.document;
  const place = (node: Node) => {
    const loc = dom.nodeLocation(node) as Location | null;
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
  const inner = sheet?.querySelector(":scope > .sheet-inner");
  const table = inner?.querySelector(":scope > table");
  const body = table?.querySelector(":scope > tbody");
  const colgroup = table?.querySelector(":scope > colgroup");
  const headRow = table?.querySelector(":scope > thead > tr");
  if (!sheet || !inner || !table || !body || !colgroup || !headRow) return null;
  const rows = [...body.children].filter((el) => el.localName === "tr");
  return {
    place,
    source: (node: Node) => {
      const at = place(node);
      return html.slice(at.start, at.end);
    },
    sheet,
    inner,
    table,
    body,
    cols: [...colgroup.children],
    colgroup,
    heads: [...headRow.children],
    headRow,
    rows: rows.map((tr) => ({ tr, number: tr.querySelector(":scope > th.sheet-rn"), cells: [...tr.children].filter((el) => el.localName === "td") })),
    frozenRows: Number(sheet.getAttribute("data-frozen-rows") ?? 0),
    frozenCols: Number(sheet.getAttribute("data-frozen-cols") ?? 0),
    // A merge, a drawing, or a row a merge hides ties cells to their places.
    fixed: sheet.querySelector("td[colspan], td[rowspan], .sheet-drawing, td[style*='display:none']") !== null,
  };
}

/** A sheet's replica with rows or columns added or removed to match
    `next`'s grid, the kept cells' words as they were, and what went; or
    why not. A new row or column is built like the kept one before it (the
    one after it, when the one before is frozen): its height or width, its
    cells' style. One that `cut` holds comes back as it was. */
function sheetShape(html: string, prev: string, next: string, cut: SheetCut | null): { html: string; cut: SheetCut } | { refused: ReplicaRefusal } {
  const grid = readGrid(html);
  if (!grid) return { refused: "grid" };
  if (grid.fixed) return { refused: "merged" };
  const before = prev.split("\n").map((r) => r.split("\t"));
  const after = next.split("\n").map((r) => r.split("\t"));
  const width = before[0].length;
  const newWidth = after[0].length;
  // A grid is a rectangle — a cell with a line break in its words reads as
  // two rows, so rows and columns stay — and one edit changes its rows or
  // its columns.
  if (before.some((r) => r.length !== width) || before.length !== grid.rows.length || grid.rows.some((r) => r.cells.length !== width)) return { refused: "grid" };
  if (after.some((r) => r.length !== newWidth) || (before.length !== after.length && width !== newWidth)) return { refused: "grid" };
  const splices: { start: number; end: number; source: string }[] = [];
  const setAttr = (el: Element, name: string, value: string) => {
    const at = grid.place(el).attrs[name];
    if (at) splices.push({ start: at.start, end: at.end, source: `${name}="${value}"` });
  };
  const within = (el: Element, source: string) => {
    const at = grid.place(el).inner;
    splices.push({ start: at.start, end: at.end, source });
  };
  let taken: SheetCut;

  if (before.length !== after.length) {
    const { kept, gone } = alignLines(before, after);
    if (gone.some((i) => i < grid.frozenRows) || kept.some((k, j) => k === null && j < grid.frozenRows)) return { refused: "frozen" };
    const stored = cut && "rows" in cut ? [...cut.rows] : [];
    const last = after.length - 1;
    const rows = kept.map((k, j) => {
      const gap = j === last ? "" : "\n";
      if (k !== null) return rowAt(grid.source(grid.rows[k].tr), j + 1, gap);
      const back = stored.findIndex((row) => row.words === after[j].join("\t"));
      if (back >= 0) return rowAt(stored.splice(back, 1)[0].source, j + 1, gap);
      const model = grid.rows[modelOf(kept, j, grid.frozenRows)];
      const number = model.number ? bare(model.number, "sheet-fr").outerHTML : "";
      const cells = model.cells.map((cell, c) => newCell(cell, after[j][c], "\t", "sheet-fr")).join("");
      return rowAt(bare(model.tr, "sheet-fr").outerHTML.replace(/<\/tr>$/, () => `${number}${cells}</tr>`), j + 1, gap);
    });
    within(grid.body, rows.join(""));
    setAttr(grid.sheet, "data-rows", String(after.length));
    taken = { rows: gone.map((i) => ({ words: before[i].join("\t"), source: grid.source(grid.rows[i].tr) })) };
  } else {
    const column = (rows: string[][], c: number) => rows.map((r) => r[c]);
    const { kept, gone } = alignLines(
      Array.from({ length: width }, (_, c) => column(before, c)),
      Array.from({ length: newWidth }, (_, c) => column(after, c)),
    );
    if (gone.some((c) => c < grid.frozenCols) || kept.some((k, j) => k === null && j < grid.frozenCols)) return { refused: "frozen" };
    const stored = cut && "cols" in cut ? cut.cols.filter((c) => c.cells.length === grid.rows.length) : [];
    // colgroup and the letters: the row numbers' column and the corner first.
    const lines = kept.map((k, j) => {
      if (k !== null) return { col: grid.source(grid.cols[k + 1]), head: grid.source(grid.heads[k + 1]), cells: grid.rows.map((row) => grid.source(row.cells[k])) };
      const back = stored.findIndex((c) => c.words === column(after, j).join("\n"));
      if (back >= 0) return stored.splice(back, 1)[0];
      const m = modelOf(kept, j, grid.frozenCols);
      return {
        col: grid.source(grid.cols[m + 1]),
        head: bare(grid.heads[m + 1], "sheet-fc").outerHTML.replace(/<\/th>$/, "A</th>"),
        cells: grid.rows.map((row, r) => newCell(row.cells[m], after[r][j], "", "sheet-fc")),
      };
    });
    within(grid.colgroup, grid.source(grid.cols[0]) + lines.map((l) => l.col).join(""));
    within(grid.headRow, grid.source(grid.heads[0]) + lines.map((l, j) => l.head.replace(/>[A-Z]+<\/th>$/, () => `>${columnLetter(j)}</th>`)).join(""));
    const lastRow = grid.rows.length - 1;
    grid.rows.forEach((row, r) => {
      const cells = lines.map((l, j) => withGap(l.cells[r], j < newWidth - 1 ? "\t" : r === lastRow ? "" : "\n"));
      within(row.tr, (row.number ? grid.source(row.number) : "") + cells.join(""));
    });
    // The grid's width: the row numbers' column and every column.
    const px = (col: string) => Number(/width:(\d+(?:\.\d+)?)px/.exec(col)?.[1] ?? 0);
    const total = px(grid.source(grid.cols[0])) + lines.reduce((sum, l) => sum + px(l.col), 0);
    for (const el of [grid.table, grid.inner]) {
      const at = grid.place(el).attrs.style;
      if (at) splices.push({ start: at.start, end: at.end, source: html.slice(at.start, at.end).replace(/width:\d+(?:\.\d+)?px/, `width:${total}px`) });
    }
    setAttr(grid.sheet, "data-cols", String(newWidth));
    taken = {
      cols: gone.map((c) => ({
        words: column(before, c).join("\n"),
        col: grid.source(grid.cols[c + 1]),
        head: grid.source(grid.heads[c + 1]),
        cells: grid.rows.map((row) => grid.source(row.cells[c])),
      })),
    };
  }
  let out = html;
  for (const { start, end, source } of splices.sort((x, y) => y.start - x.start)) out = out.slice(0, start) + source + out.slice(end);
  return { html: out, cut: taken };
}

/** A cell's own words: its text without its gaps. */
const wordsOf = (el: Element): string =>
  [...el.childNodes].map((n) => (n.nodeType === 3 ? (n.textContent ?? "") : n.nodeType === 1 && !(n as Element).matches(".cell-gap, [data-anchor-skip]") ? wordsOf(n as Element) : "")).join("");

/** The classes a cell's words set, after an edit (`was`: the replica with
    the old words, cell for cell). Words that turn into a number line up
    right (`sheet-num`) unless the cell's style sets its alignment, and
    words that are no longer a number lose it; words that run over their
    empty neighbours (`sheet-over`, text beside an empty cell as the parser
    draws it) are clipped while the cell to their right has words —
    `sheet-clip`, marked `data-over` — and run over again once it is empty.
    Only a class and the mark change, in place, so an edit taken back gives
    the same bytes. */
function cellClasses(was: string, html: string): string {
  const dom = new JSDOM(`${PREFIX}${html}</body></html>`, { includeNodeLocations: true });
  const before = new JSDOM(`${PREFIX}${was}</body></html>`).window.document.querySelectorAll("tbody td");
  // The cell styles that set the alignment themselves.
  const aligned = new Set([...html.matchAll(/\.(x\d+)\{[^}]*text-align:/g)].map((m) => m[1]));
  const splices: { start: number; end: number; source: string }[] = [];
  dom.window.document.querySelectorAll("tbody td").forEach((td, i) => {
    const loc = dom.nodeLocation(td) as Location | null;
    const at = loc?.attrs?.class;
    if (!at) return;
    const start = at.startOffset - PREFIX.length;
    const end = at.endOffset - PREFIX.length;
    const tokens = html.slice(start + 7, end - 1).split(" ").filter(Boolean);
    const prior = tokens.join(" ");
    const words = wordsOf(td);
    const old = before[i] ? wordsOf(before[i]) : words;
    const number = NUMBER.test(words.trim());
    if (old !== words && number !== NUMBER.test(old.trim())) {
      const own = tokens.some((t) => t === "sheet-num" || t === "sheet-mid" || aligned.has(t));
      if (!number && tokens.includes("sheet-num")) tokens.splice(tokens.indexOf("sheet-num"), 1);
      else if (number && !own) tokens.splice(/^x\d+$/.test(tokens[0] ?? "") ? 1 : 0, 0, "sheet-num");
    }
    const mark = loc!.attrs!["data-over"];
    const over = tokens.indexOf("sheet-over");
    const clip = tokens.indexOf("sheet-clip");
    const right = td.nextElementSibling;
    const empty = right?.localName !== "td" || wordsOf(right) === "";
    let marked = Boolean(mark);
    if (over >= 0 && !empty) {
      tokens[over] = "sheet-clip";
      marked = true;
    } else if (mark && clip >= 0 && empty) {
      tokens[clip] = "sheet-over";
      marked = false;
    }
    if (tokens.join(" ") === prior && marked === Boolean(mark)) return;
    splices.push({ start, end, source: `class="${tokens.join(" ")}"${marked && !mark ? ' data-over="1"' : ""}` });
    if (mark && !marked) splices.push({ start: mark.startOffset - PREFIX.length - 1, end: mark.endOffset - PREFIX.length, source: "" });
  });
  let out = html;
  for (const { start, end, source } of splices.sort((x, y) => y.start - x.start)) out = out.slice(0, start) + source + out.slice(end);
  return out;
}

/** A sheet's replica with `next` for its text — its words cell by cell, and
    rows or columns added or removed (one of the two in one edit) — with
    what the edit took out; or why not. `cut` is what the edit this one
    takes back took out: its rows or columns come back as they were. */
export function sheetWithText(html: string, prev: string, next: string, cut: SheetCut | null = null): { html: string; cut: SheetCut | null } | { refused: ReplicaRefusal } {
  const shape = (text: string) => text.split("\n").map((r) => r.split("\t").length).join(",");
  if (shape(prev) === shape(next)) {
    const edited = replicaWithText(html, prev, next);
    return "refused" in edited ? edited : { html: cellClasses(html, edited.html), cut: null };
  }
  if (readReplica(html).text !== prev) return { refused: "stale" };
  const reshaped = sheetShape(html, prev, next, cut);
  if ("refused" in reshaped) return reshaped;
  // The kept cells' new words, then.
  const edited = replicaWithText(reshaped.html, readReplica(reshaped.html).text, next);
  return "refused" in edited ? edited : { html: cellClasses(reshaped.html, edited.html), cut: reshaped.cut };
}

// ── A converted table ──────────────────────────────────────────────────────

/** A converted table's html (a handwritten document's TABLE, SPEC.md §16):
    its text as a table, the first row the header row when there are more,
    with the invisible cell separators the PDF parse uses, so the table's DOM
    text equals its text (SPEC.md §5). The html follows from the text alone:
    an edit writes it anew from the new text, and the old text gives the old
    html back byte for byte. */
export function tableHtml(text: string): string {
  const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const rows = text.split("\n").map((r) => r.split("\t"));
  const rowHtml = (cells: string[], tag: "td" | "th", rowIdx: number) =>
    `<tr>${cells
      .map((c, cellIdx) => {
        const last = cellIdx === cells.length - 1;
        const gap = last
          ? rowIdx === rows.length - 1
            ? ""
            : '<span class="cell-gap">\n</span>'
          : '<span class="cell-gap">\t</span>';
        return `<${tag}>${escape(c)}${gap}</${tag}>`;
      })
      .join("")}</tr>`;
  if (rows.length === 1) return `<table><tbody>${rowHtml(rows[0], "td", 0)}</tbody></table>`;
  return (
    "<table>" +
    `<thead>${rowHtml(rows[0], "th", 0)}</thead>` +
    `<tbody>${rows.slice(1).map((r, i) => rowHtml(r, "td", i + 1)).join("")}</tbody>` +
    "</table>"
  );
}

/** A slide's, a sheet's, or a converted table's replica with `next` for
    its words: what the text PATCH stores, and what the plan checks before
    it offers the edit. */
export function replicaEdit(type: string, html: string, prev: string, next: string, cut: SheetCut | null = null): { html: string; cut: SheetCut | null } | { refused: ReplicaRefusal } {
  if (type === "TABLE") return { html: tableHtml(next), cut: null };
  if (type === "SHEET") return sheetWithText(html, prev, next, cut);
  const edited = replicaWithText(html, prev, next);
  return "refused" in edited ? edited : { html: edited.html, cut: null };
}

/** What a sheet keeps as it is, for the assistant: its frozen rows and
    columns, the cells a formula computes (named as the text reads them:
    the row is the line, the column A, B, … the cell in it), and — with a
    merge or a drawing — its rows and columns. Null when it keeps nothing. */
function sheetKeeps(html: string): string | null {
  const replica = readReplica(html);
  const formulas: string[] = [];
  let row = 0;
  let col = 0;
  replica.pieces.forEach((piece, i) => {
    if (piece.formula) formulas.push(`${columnLetter(col)}${row + 1}`);
    if (replica.gaps[i] === "\n") {
      row += 1;
      col = 0;
    } else col += 1;
  });
  const sheet = /<div class="sheet [^>]*>/.exec(html)?.[0] ?? "";
  const frozenRows = Number(/data-frozen-rows="(\d+)"/.exec(sheet)?.[1] ?? 0);
  const frozenCols = Number(/data-frozen-cols="(\d+)"/.exec(sheet)?.[1] ?? 0);
  const frozen = [
    frozenRows === 1 ? "row 1" : frozenRows > 1 ? `rows 1–${frozenRows}` : "",
    frozenCols === 1 ? "column A" : frozenCols > 1 ? `columns A–${columnLetter(frozenCols - 1)}` : "",
  ].filter(Boolean);
  const parts: string[] = [];
  if (frozen.length > 0) parts.push(`${frozen.join(" and ")} (frozen)`);
  if (formulas.length > 0) parts.push(`${formulas.slice(0, 40).join(", ")}${formulas.length > 40 ? `, and ${formulas.length - 40} more` : ""} (formulas)`);
  if (/<td[^>]* (?:colspan|rowspan)=|class="sheet-drawing"|<td style="display:none">/.test(html)) parts.push("its rows and columns (merged cells or a drawing)");
  return parts.length > 0 ? parts.join("; ") : null;
}

/** The assistant's lines on the sheets of a document: one per SHEET block
    that keeps anything as it is (sheetKeeps). */
export function sheetKeepLines(blocks: { id: string; type: string; html: string | null }[]): string[] {
  return blocks.flatMap((b) => {
    const keeps = b.type === "SHEET" && b.html ? sheetKeeps(b.html) : null;
    return keeps ? [`[block ${b.id}]: ${keeps}`] : [];
  });
}
