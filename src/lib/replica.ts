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
  let lastGapCell: Element | null = null;
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
    // go before the gap; a formula's cell, and a cell a merge covers (its
    // gap rides in the cell before it), keep theirs.
    const cell = gap.parentElement?.closest("td, th") ?? null;
    if (cell) {
      piece.cell = at(gap).start;
      if (cell.getAttribute("title")?.startsWith("=") || (cell === lastGapCell && piece.nodes.length === 0)) piece.fixed = true;
    }
    lastGapCell = cell;
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

/** A slide whose words are not its words as parsed shows its replica: the
    picture shows the words as parsed, so it waits (`data-picture-held`)
    until the words are back. */
export function slidePicture(html: string, edited: boolean): string {
  return edited
    ? html.replace(/(<div class="slide-frame"[^>]*?) data-picture="1"/, '$1 data-picture-held="1"')
    : html.replace(/(<div class="slide-frame"[^>]*?) data-picture-held="1"/, '$1 data-picture="1"');
}
