import { JSDOM } from "jsdom";
import { z } from "zod";
import { diffSegments } from "@/lib/anchors/remap";
import type { TKey } from "@/lib/i18n/dictionaries";
import { separateBlocks } from "@/lib/parse/dom-text";
import { escapeHtml } from "@/lib/parse/office";
import { columnLetter } from "@/lib/parse/sheets";

// A slide's, a sheet's, or a table's replica with new words (SPEC.md §27,
// §16). The one rule holds after every edit: the replica's DOM text — every
// text node outside [data-anchor-skip] — equals the block's text. The text
// is pieces between gaps (`.cell-gap`: a newline between a slide's lines or
// a table's rows, a tab between cells); an edit changes words within pieces
// and keeps every gap, so the slide keeps its lines and the sheet its grid.
// New words take the run where the change starts, so they keep its font,
// size, and color. The html is changed in place, text node by text node,
// and every other byte stays: an edit taken back gives the replica back
// byte for byte (the text PATCH keeps the html of an edit that, run
// backwards, would not).

/** Why an edit does not go into the replica: a slide's line that no text
    box or speaker notes hold (a table's row, a line a break divides, notes
    with no line under their label), or a tab in a line, added or removed
    (lines); a sheet that is no longer a grid — a row
    with more or fewer cells than the first, or rows and columns changed in
    one edit (grid); a sheet's frozen rows or columns added or removed
    (frozen); rows or columns of a sheet with merged cells or a drawing
    (merged); words the replica draws elsewhere or keeps (fixed: a bullet,
    the speaker notes' label, a chart's data under its drawing, a formula's
    cell, a cell a merge covers); words where the replica has no run to
    hold them (empty); a replica whose text is not the block's (stale). A
    table that keeps its html keeps its rows and columns (cells) and the
    words a table keeps: a formula, the break between a cell's paragraphs,
    a cell a merge covers (held). */
export type ReplicaRefusal = "lines" | "grid" | "frozen" | "merged" | "fixed" | "empty" | "stale" | "cells" | "held";

/** What the reader is told for each refusal. */
export const REPLICA_REFUSAL: Record<ReplicaRefusal, TKey> = {
  lines: "api.replicaLines",
  grid: "api.replicaGrid",
  frozen: "api.replicaFrozen",
  merged: "api.replicaMerged",
  fixed: "api.replicaFixed",
  empty: "api.replicaEmpty",
  stale: "api.replicaStale",
  cells: "api.replicaCells",
  held: "api.replicaHeld",
};

// A node's place in the html, as jsdom gives it.
type Location = {
  startOffset: number;
  endOffset: number;
  attrs?: Record<string, { startOffset: number; endOffset: number }>;
  startTag?: { endOffset: number };
  endTag?: { startOffset: number };
};

// A text node with its place in the html; `bound`, the place of the link or
// the raised or lowered mark it stands in: words added at its edge go
// outside it.
type Located = { node: Text; start: number; end: number; fixed: boolean; bound: { start: number; end: number } | null };
type Splice = { start: number; end: number; source: string };
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
const BOUNDED = "a, sup, sub";

/** The place of the outermost link or raised or lowered mark `node` stands in. */
function boundOf(dom: JSDOM, node: Text): Located["bound"] {
  let el = node.parentElement?.closest(BOUNDED) ?? null;
  for (let up = el?.parentElement?.closest(BOUNDED); up; up = up.parentElement?.closest(BOUNDED)) el = up;
  const loc = el ? dom.nodeLocation(el) : null;
  return loc ? { start: loc.startOffset - PREFIX.length, end: loc.endOffset - PREFIX.length } : null;
}

/** `html` with the splices made, from the end; at one place, a
    replacement before an insert. */
const applied = (html: string, splices: Splice[]) =>
  [...splices].sort((a, b) => b.start - a.start || b.end - a.end).reduce((out, { start, end, source }) => out.slice(0, start) + source + out.slice(end), html);

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
      piece.nodes.push({ node, ...at(node), fixed: Boolean(gap || parent.closest(FIXED_RUNS)), bound: boundOf(dom, node) });
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
function stretches(before: string, after: string): Stretch[] {
  const out: Stretch[] = [];
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

type Stretch = { from: number; to: number; words: string };

/** One piece's changes as splices of the html, or why not. */
function pieceSplices(piece: Piece, before: string, after: string): Splice[] | ReplicaRefusal {
  if (piece.fixed) return "fixed";
  if (piece.nodes.length === 0) return piece.cell === null ? "empty" : [{ start: piece.cell, end: piece.cell, source: escapeHtml(after) }];
  return placed(piece.nodes, stretches(before, after));
}

/** Changed stretches of the runs' words (their text nodes, one after
    another) as splices of the html, or why not. The words both sides share
    stay; each stretch goes into the run where it starts (a pure insert:
    the run it follows, else the one it precedes; at the edge of a link or
    a raised or lowered mark, outside it), and the runs after lose what it
    covers. */
function placed(nodes: Located[], changes: Stretch[]): Splice[] | ReplicaRefusal {
  const runs: { run: Located; from: number; to: number; edits: Stretch[] }[] = [];
  let offset = 0;
  for (const run of nodes) {
    runs.push({ run, from: offset, to: offset + run.node.data.length, edits: [] });
    offset += run.node.data.length;
  }
  // Each link's or mark's words: from its first run to its last.
  const spans = new Map<number, { from: number; to: number }>();
  for (const x of runs) {
    if (!x.run.bound) continue;
    const span = spans.get(x.run.bound.start);
    spans.set(x.run.bound.start, { from: Math.min(span?.from ?? x.from, x.from), to: Math.max(span?.to ?? x.to, x.to) });
  }
  const splices: Splice[] = [];
  for (const { from, to, words } of changes) {
    const edge = (x: (typeof runs)[number]) => {
      const span = x.run.bound ? spans.get(x.run.bound.start) : undefined;
      return span && (from === span.from || from === span.to) ? span : null;
    };
    const takes = (x: (typeof runs)[number]) => !x.run.fixed && !edge(x);
    const home =
      from < to
        ? runs.find((x) => from >= x.from && from < x.to)
        : (runs.find((x) => from > x.from && from <= x.to && takes(x)) ??
          runs.find((x) => from >= x.from && from < x.to && takes(x)) ??
          runs.find((x) => from === x.from && takes(x)));
    if (!home) {
      // Words added at a link's or a mark's edge, with no run beside it:
      // outside it.
      const beside = from === to ? runs.find((x) => !x.run.fixed && edge(x)) : undefined;
      const span = beside && edge(beside);
      if (!beside?.run.bound || !span) return "empty";
      const at = from === span.to ? beside.run.bound.end : beside.run.bound.start;
      splices.push({ start: at, end: at, source: escapeHtml(words) });
      continue;
    }
    for (const x of runs) {
      const cut = Math.max(from, x.from) < Math.min(to, x.to);
      if (x !== home && !cut) continue;
      if (x.run.fixed) return "fixed";
      x.edits.push({ from: Math.max(from, x.from) - x.from, to: Math.max(Math.min(to, x.to), Math.max(from, x.from)) - x.from, words: x === home ? words : "" });
    }
  }
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
  const splices: Splice[] = [];
  for (let i = 0; i < replica.pieces.length; i++) {
    if (was[i] === now[i]) continue;
    const piece = pieceSplices(replica.pieces[i], was[i], now[i]);
    if (typeof piece === "string") return { refused: piece };
    splices.push(...piece);
  }
  const out = applied(html, splices);
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
    and new pair up in order, each with the one most like it (`alike`: by
    default, the most cells the same) — its words change later — the extra
    old ones go, and the extra new ones come. `kept` has an entry per new
    line: the old line it keeps, or null for a new one; `gone` lists the old
    lines that go. */
function alignLines(
  before: string[][],
  after: string[][],
  alike = (x: string[], y: string[]) => x.reduce((sum, cell, c) => sum + (cell === y[c] ? 1 : 0), 0),
): { kept: (number | null)[]; gone: number[] } {
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

// ── A slide's lines ────────────────────────────────────────────────────────

// The line that opens a slide's speaker notes (lib/parse/slides.ts).
const NOTES_LABEL = "Speaker notes:";
const LINE_GAP = '<span class="cell-gap">\n</span>';
const linesOf = (text: string) => (text === "" ? [] : text.split("\n"));
// A bullet that is a number: "3. ", "3) ".
const NUMBERED = /^(\d+)([.)])(\s*)/;

/** A slide's lines as its text reads them (a newline gap between two), each
    with its paragraph when the line is one whole paragraph of a text box or
    of the speaker notes — not a table's row, not a line of a paragraph a
    break divides, not the notes' label. */
function readSlideLines(html: string) {
  const dom = new JSDOM(`${PREFIX}${html}</body></html>`, { includeNodeLocations: true });
  const document = dom.window.document;
  const place = (node: Node) => {
    const loc = dom.nodeLocation(node) as Location | null;
    if (!loc) throw new Error("a slide's node has no place");
    return { start: loc.startOffset - PREFIX.length, end: loc.endOffset - PREFIX.length, inner: (loc.endTag?.startOffset ?? loc.endOffset) - PREFIX.length };
  };
  const read: { text: string; nodes: Text[]; tabbed: boolean; before: Element | null; after: Element | null }[] = [
    { text: "", nodes: [], tabbed: false, before: null, after: null },
  ];
  const walker = document.createTreeWalker(document.body, 4 /* NodeFilter.SHOW_TEXT */);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const node = n as Text;
    const parent = node.parentElement;
    if (!parent || parent.closest("[data-anchor-skip]")) continue;
    const gap = parent.closest(".cell-gap");
    const line = read[read.length - 1];
    if (gap && node.data === "\n") {
      line.after = gap;
      read.push({ text: "", nodes: [], tabbed: false, before: gap, after: null });
      continue;
    }
    line.text += node.data;
    if (gap) line.tabbed = true;
    else line.nodes.push(node);
  }
  const whole = (p: Element | null | undefined): p is Element => Boolean(p?.matches("p.sp") && !p.closest("table") && !p.querySelector(".cell-gap"));
  const lines = read.map((line) => {
    let para: Element | null = null;
    if (!line.tabbed && line.nodes.length > 0) {
      const p = line.nodes[0].parentElement?.closest("p.sp");
      if (whole(p) && line.nodes.every((node) => node.parentElement?.closest("p.sp") === p)) para = p;
    } else if (!line.tabbed) {
      const p = line.before ? line.before.nextElementSibling : line.after?.previousElementSibling;
      if (whole(p) && !p.textContent) para = p;
    }
    return { text: line.text, para };
  });
  return {
    text: lines.map((l) => l.text).join("\n"),
    lines: lines.length === 1 && lines[0].text === "" ? [] : lines,
    place,
    frame: document.querySelector(".slide-frame"),
    notes: document.querySelector(".slide-frame > .slide-notes"),
  };
}

/** A new paragraph for `words`, built like the paragraph of its box whose
    bullet the words open with, the nearest to `anchor` first (in a box
    without bullets, the nearest): its style, its bullet (a number takes the
    words' own), its first run's style. Null when no paragraph of the box
    has the words' bullet. */
function newParagraph(anchor: Element, words: string): string | null {
  const box = [...(anchor.parentElement?.children ?? [])].filter((el) => el.matches("p.sp"));
  const at = box.indexOf(anchor);
  const near = box.map((p, i) => ({ p, far: Math.abs(i - at) })).sort((x, y) => x.far - y.far).map((x) => x.p);
  const bulletOf = (p: Element) => p.querySelector(":scope > .sb")?.textContent ?? "";
  const ownBullet = (p: Element): string | null => {
    const bullet = bulletOf(p);
    const number = NUMBERED.exec(bullet);
    if (!number) return words.startsWith(bullet) ? bullet : null;
    const own = NUMBERED.exec(words);
    return own && own[2] === number[2] && own[3] === number[3] ? own[0] : null;
  };
  const model = near.find((p) => bulletOf(p) && ownBullet(p) !== null) ?? near.find((p) => !bulletOf(p));
  if (!model) return null;
  const p = model.cloneNode(false) as Element;
  const bullet = model.querySelector(":scope > .sb");
  let rest = words;
  if (bullet && bulletOf(model)) {
    const own = ownBullet(model) ?? "";
    const b = bullet.cloneNode(false) as Element;
    b.textContent = own;
    p.append(b);
    rest = words.slice(own.length);
  }
  if (rest) {
    const run = model.querySelector(":scope > span:not(.sb), :scope > a");
    const style = run?.getAttribute("style");
    if (run) {
      const r = model.ownerDocument.createElement("span");
      if (style !== null && style !== undefined) r.setAttribute("style", style);
      r.textContent = rest;
      p.append(r);
    } else p.append(rest);
  }
  p.classList.remove("sp-empty");
  if (!words) p.classList.add("sp-empty");
  return p.outerHTML;
}

/** Two lines' likeness: the words they share. */
function sharedWords(x: string[], y: string[]): number {
  const count = new Map<string, number>();
  for (const w of x[0].split(/\s+/)) if (w) count.set(w, (count.get(w) ?? 0) + 1);
  let shared = 0;
  for (const w of y[0].split(/\s+/)) {
    const c = count.get(w);
    if (c) {
      shared += 1;
      count.set(w, c - 1);
    }
  }
  return shared;
}

/** The slide's replica with lines added or removed to match `next`'s lines,
    the kept lines' words as they were; null when no line comes or goes; or
    why not. The slide's own lines and its speaker notes' lines align apart
    (alignLines, lines paired by the words they share). A line that goes
    takes its paragraph and the gap beside it; a text box whose every line
    goes stays, empty. A new line comes after the kept line before it (at
    the start, before the kept line after it), built like a paragraph of
    that box (newParagraph). Notes taken away whole take their label; notes given to
    a slide without them come after it, a paragraph per line. */
function slideShape(html: string, prev: string, next: string): { html: string } | { refused: ReplicaRefusal } | null {
  const slide = readSlideLines(html);
  if (slide.text !== prev) return { refused: "stale" };
  const was = linesOf(prev);
  const now = linesOf(next);
  const wasLabel = slide.notes ? was.lastIndexOf(NOTES_LABEL) : -1;
  const nowLabel = now.lastIndexOf(NOTES_LABEL);
  // Speaker notes hold a line at the least.
  if (nowLabel >= 0 && nowLabel === now.length - 1) return { refused: "lines" };
  const splices: Splice[] = [];
  const cut = (el: Element) => {
    const at = slide.place(el);
    splices.push({ start: at.start, end: at.end, source: "" });
  };
  const used = new Set<Element>();
  const lineGap = (el: Element | null | undefined) => (el?.matches(".cell-gap") && el.textContent === "\n" && !used.has(el) ? el : null);
  const parts = [{ from: 0, was: wasLabel >= 0 ? was.slice(0, wasLabel) : was, now: nowLabel >= 0 ? now.slice(0, nowLabel) : now }];
  if (wasLabel >= 0 && nowLabel >= 0) parts.push({ from: wasLabel + 1, was: was.slice(wasLabel + 1), now: now.slice(nowLabel + 1) });
  else if (wasLabel >= 0 && slide.notes) {
    cut(slide.notes);
    const gap = lineGap(slide.notes.previousElementSibling);
    if (gap) cut(gap);
  } else if (nowLabel >= 0 && slide.frame) {
    const end = slide.place(slide.frame).inner;
    const body = now.slice(nowLabel + 1).map((line) => `<p class="sp">${escapeHtml(line)}</p>`).join(LINE_GAP);
    splices.push({
      start: end,
      end,
      source: `${nowLabel > 0 ? LINE_GAP : ""}<div class="slide-notes"><span class="slide-notes-label">${NOTES_LABEL}</span>${LINE_GAP}<div class="slide-notes-body">${body}</div></div>`,
    });
  } else if (nowLabel >= 0) return { refused: "lines" };
  for (const part of parts) {
    const { kept, gone } = alignLines(part.was.map((l) => [l]), part.now.map((l) => [l]), sharedWords);
    for (const i of gone) {
      const para = slide.lines[part.from + i]?.para;
      if (!para) return { refused: "lines" };
      cut(para);
      let gap: Element | null = null;
      for (let el: Element | null = para; el && !gap && el !== slide.frame; el = el.parentElement) gap = lineGap(el.previousElementSibling) ?? lineGap(el.nextElementSibling);
      if (gap) {
        used.add(gap);
        cut(gap);
      }
    }
    for (let j = 0; j < kept.length; ) {
      if (kept[j] !== null) {
        j += 1;
        continue;
      }
      let k = j;
      while (k < kept.length && kept[k] === null) k += 1;
      // After the kept line before (a table's row or a broken line takes
      // none), else, at the start, before the kept line after.
      const before = j > 0 ? slide.lines[part.from + kept[j - 1]!]?.para : null;
      const after = j === 0 && k < kept.length ? slide.lines[part.from + kept[k]!]?.para : null;
      const anchor = before ?? after;
      if (!anchor) return { refused: "lines" };
      const made = part.now.slice(j, k).map((line) => newParagraph(anchor, line));
      if (made.some((m) => m === null)) return { refused: "fixed" };
      const at = slide.place(anchor);
      splices.push(
        before
          ? { start: at.end, end: at.end, source: made.map((m) => `${LINE_GAP}${m}`).join("") }
          : { start: at.start, end: at.start, source: made.map((m) => `${m}${LINE_GAP}`).join("") },
      );
      j = k;
    }
  }
  return splices.length > 0 ? { html: applied(html, splices) } : null;
}

/** A slide's replica with `next` for its words, lines added or removed
    first (slideShape), then the words changed within lines; or why not. */
export function slideWithText(html: string, prev: string, next: string): { html: string } | { refused: ReplicaRefusal } {
  const shaped = slideShape(html, prev, next);
  if (shaped === null) return replicaWithText(html, prev, next);
  if ("refused" in shaped) return shaped;
  return replicaWithText(shaped.html, readReplica(shaped.html).text, next);
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

// ── A table that keeps its html ────────────────────────────────────────────

// One cell of a web page's table, as the walk reads its words: its text
// nodes (a block boundary's space among them, with no place in the html),
// and each character of its words with the stretch of those nodes it reads.
type WebCell = { nodes: Located[]; text: string; units: { from: number; to: number }[]; end: number };

/** A web page's or a Markdown file's table keeps the page's html
    (lib/parse/url.ts tableText): its text is the grid its cells make, each
    cell's words read with a space at every block boundary and one space
    for each run of white space (lib/parse/dom-text.ts), a merged cell's
    words in every row it spans and its other columns empty. Its DOM text is
    not its text. The grid, read the walk's way, and its text. */
function readWebTable(html: string) {
  const dom = new JSDOM(`${PREFIX}${html}</body></html>`, { includeNodeLocations: true });
  const table = dom.window.document.querySelector("table");
  if (!table) return null;
  const rows = [...table.querySelectorAll("tr")].filter((tr) => tr.closest("table") === table);
  const slots: ({ cell: Element; blank: boolean } | undefined)[][] = rows.map(() => []);
  rows.forEach((tr, r) => {
    let c = 0;
    for (const cell of [...tr.children].filter((x) => /^(td|th)$/i.test(x.tagName))) {
      while (slots[r][c] !== undefined) c++;
      const colspan = Math.max(1, Math.min(50, Number(cell.getAttribute("colspan") ?? "1") || 1));
      const rowspan = Math.max(1, Math.min(200, Number(cell.getAttribute("rowspan") ?? "1") || 1));
      for (let dr = 0; dr < rowspan && r + dr < slots.length; dr++) {
        for (let dc = 0; dc < colspan; dc++) slots[r + dr][c + dc] = { cell, blank: dc > 0 };
      }
      c += colspan;
    }
  });
  const cells = new Map<Element, WebCell>();
  const read = (cell: Element): WebCell => {
    const known = cells.get(cell);
    if (known) return known;
    separateBlocks(cell);
    const nodes: Located[] = [];
    let raw = "";
    const walker = dom.window.document.createTreeWalker(cell, 4 /* NodeFilter.SHOW_TEXT */);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const node = n as Text;
      const loc = dom.nodeLocation(node);
      nodes.push(
        loc
          ? { node, start: loc.startOffset - PREFIX.length, end: loc.endOffset - PREFIX.length, fixed: false, bound: boundOf(dom, node) }
          : { node, start: -1, end: -1, fixed: true, bound: null },
      );
      raw += node.data;
    }
    const units = [...raw.matchAll(/\s+|\S/g)].map((m) => ({ from: m.index, to: m.index + m[0].length, space: /\s/.test(m[0]) }));
    if (units[0]?.space) units.shift();
    if (units.at(-1)?.space) units.pop();
    const text = units.map((u) => (u.space ? " " : raw.slice(u.from, u.to))).join("");
    const end = ((dom.nodeLocation(cell) as Location | null)?.endTag?.startOffset ?? -1) - PREFIX.length;
    const out = { nodes, text, units, end };
    cells.set(cell, out);
    return out;
  };
  const grid = slots.map((row) => [...row].map((slot) => (slot ? { cell: read(slot.cell), blank: slot.blank } : undefined)));
  return { grid, text: grid.map((row) => row.map((slot) => (slot && !slot.blank ? slot.cell.text : "")).join("\t")).join("\n") };
}

/** A web page's table with `next` for its words (the same rows and cells),
    or why not: each changed cell's words change in place, in the runs that
    hold them. A merged cell's words change the same in every row it spans,
    its other columns stay empty, and a block boundary's space stays. */
function webTableWithText(html: string, prev: string, next: string): { html: string } | { refused: ReplicaRefusal } {
  const table = readWebTable(html);
  if (!table || table.text !== prev) return { refused: "stale" };
  if (prev.replace(/[^\n\t]/g, "") !== next.replace(/[^\n\t]/g, "")) return { refused: "cells" };
  const after = next.split("\n").map((r) => r.split("\t"));
  const changed = new Map<WebCell, string>();
  for (const [r, row] of table.grid.entries()) {
    for (const [c, slot] of row.entries()) {
      if (after[r][c] === (slot && !slot.blank ? slot.cell.text : "")) continue;
      if (!slot) return { refused: "cells" };
      if (slot.blank || (changed.has(slot.cell) && changed.get(slot.cell) !== after[r][c])) return { refused: "held" };
      changed.set(slot.cell, after[r][c]);
    }
  }
  for (const [r, row] of table.grid.entries()) {
    for (const [c, slot] of row.entries()) if (slot && !slot.blank && changed.has(slot.cell) && changed.get(slot.cell) !== after[r][c]) return { refused: "held" };
  }
  const splices: Splice[] = [];
  for (const [cell, words] of changed) {
    if (cell.text === "") {
      splices.push({ start: cell.end, end: cell.end, source: escapeHtml(words) });
      continue;
    }
    // The words' stretches as stretches of the cell's text nodes.
    const at = (p: number) => (p < cell.units.length ? cell.units[p].from : cell.units[cell.units.length - 1].to);
    const made = placed(
      cell.nodes,
      stretches(cell.text, words).map((s) => ({ from: at(s.from), to: s.to > s.from ? cell.units[s.to - 1].to : at(s.from), words: s.words })),
    );
    if (typeof made === "string") return { refused: "held" };
    splices.push(...made);
  }
  const out = applied(html, splices);
  // Read back the walk's way, the table's text is the new text.
  if (readWebTable(out)?.text !== next) return { refused: "stale" };
  return { html: out };
}

/** A table's html with `next` for its words, or why not. A table whose
    html holds nothing but its text (a converted table, SPEC.md §16) is
    drawn anew from the new text, its rows and columns too. Any other keeps
    its html and its rows and columns: a PDF's or a Word file's table (its
    DOM text is its text) takes the words piece by piece, as a slide does —
    the caption line a piece, each cell a piece, the break between a cell's
    paragraphs and a formula kept; a web page's cell by cell. */
function tableEdit(html: string, prev: string, next: string): { html: string } | { refused: ReplicaRefusal } {
  if (html === tableHtml(prev)) return { html: tableHtml(next) };
  if (readReplica(html).text !== prev) return webTableWithText(html, prev, next);
  const edited = replicaWithText(html, prev, next);
  if (!("refused" in edited)) return edited;
  return { refused: edited.refused === "stale" ? "stale" : edited.refused === "lines" ? "cells" : "held" };
}

/** A slide's, a sheet's, or a table's replica with `next` for its words:
    what the text PATCH stores, and what the plan checks before it offers
    the edit. */
export function replicaEdit(type: string, html: string, prev: string, next: string, cut: SheetCut | null = null): { html: string; cut: SheetCut | null } | { refused: ReplicaRefusal } {
  if (type === "SHEET") return sheetWithText(html, prev, next, cut);
  const edited = type === "TABLE" ? tableEdit(html, prev, next) : slideWithText(html, prev, next);
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
