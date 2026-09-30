// Lists: marked items (a bullet, a box, a number, a letter, a numeral, a legal
// number, a citation label) with their depth, and indented bands whose gaps
// split them into items (bullet glyphs are often vector art, not text).

import { lineColumn } from "@/lib/parse/pdf/columns";
import { geom, lineMathShare, median } from "@/lib/parse/pdf/geometry";
import { BULLET_RE, GLYPH_BULLET_RE, closesParen, follows, isGlyphMarker, opensSequence, readMarker, type Marker } from "@/lib/parse/pdf/markers";
import {
  isCentered,
  isFirstLineIndent,
  isIndented,
  justifiedItems,
  layout,
  leftEdge,
  opensWithLabel,
  proseEdge,
  pushedApart,
  stopsShort,
} from "@/lib/parse/pdf/paragraphs";
import { TextBuilder, boldShare, fillsMargin, joinGroup } from "@/lib/parse/pdf/text";
import type { Line, PageContext, Run, Segment, Step } from "@/lib/parse/pdf/types";
import type { Indent } from "@/lib/parse/types";

// The line inside a framed box: the frame's left edge sits within three ems
// left of the text and the frame spans the line.
function isBoxedLine(line: Line, ctx: PageContext): boolean {
  return ctx.frames.some(
    (f) =>
      f.x1 < line.x &&
      f.x1 > line.x - line.size * 3 &&
      f.x2 > line.xEnd - 1 &&
      f.y2 >= line.y &&
      f.y1 <= line.y,
  );
}

export function readList(lines: Line[], i: number, ctx: PageContext, runOf: number[]): Step | null {
  const line = lines[i];
  const marker = line.cells.length === 1 ? readMarker(line) : null;
  // A bullet glyph opens an item at any size (a slide sets its bullets
  // larger than the deck's body); a number opens one near the body's size.
  if (marker && (line.size <= ctx.bodySize * 1.15 || (isGlyphMarker(marker) && line.size <= ctx.bodySize * 1.6))) {
    return markedList(lines, i, ctx, runOf, marker);
  }
  // A bullet the page draws opens an item as a printed one does: Beamer's
  // balls beside lines at the frame's edge (synth-slides-tex: its first
  // items ran together as one paragraph).
  const drawn = marker ? null : drawnMarkerAt(line, ctx);
  const list = drawn !== null && line.size <= ctx.bodySize * 1.6 ? markedList(lines, i, ctx, runOf, DRAWN, drawn) : null;
  return list ?? indentedBand(lines, i, ctx, runOf);
}

// A marker set off by a tab reads as a cell of its own ("(i)⇥the investment
// …"): with its words it is one cell, so the line is an item, not a table
// row (a nested item read as a two-row table).
export function joinMarkerCells(lines: Line[]): Line[] {
  return lines.map((line) => {
    if (line.cells.length !== 2) return line;
    const [mark, words] = line.cells;
    const text = `${mark.text} ${words.text}`;
    const shift = mark.text.length + 1;
    const runs = [...mark.runs, ...words.runs.map((r) => ({ ...r, start: r.start + shift, end: r.end + shift }))];
    const marker = readMarker({ text, runs });
    if (!marker || marker.length !== shift) return line;
    return { ...line, cells: [{ x: mark.x, text, runs }], text, runs };
  });
}

// ── Marked items ────────────────────────────────────────────────────────────

type Item = { lines: Line[]; marker: Marker; markerX: number; bodyX: number };

// The list last read, for a list that goes on after something set between
// its items (a display equation, a fill-in line, the page break): the x of
// each of its levels and the marker last seen there. It holds on its page
// and the next; a heading ends it.
type Level = { markerX: number; bodyX: number; marker: Marker };
let open: { page: number; levels: Level[] } | null = null;

function openLevels(page: number): Level[] | null {
  return open && (page === open.page || page === open.page + 1) ? open.levels : null;
}

/** A heading closes the list last read: an item after it starts afresh.
    A references heading opens the references (readReferences), and any
    other heading closes them. */
export function closeLists(heading?: string) {
  open = null;
  references = heading !== undefined && REFERENCES_RE.test(heading.trim());
}

// Where the item's words start: the first glyph after the marker.
function bodyXOf(line: Line, marker: Marker): number {
  const skip = line.text.slice(0, marker.length).replace(/\s/g, "").length;
  let seen = 0;
  for (const item of line.items) {
    const chars = [...item.str];
    const count = chars.filter((c) => !/\s/.test(c)).length;
    if (seen + count > skip) {
      if (seen >= skip) return item.x;
      let at = 0;
      for (let n = 0; at < chars.length && n < skip - seen; at++) if (!/\s/.test(chars[at])) n++;
      while (at < chars.length && /\s/.test(chars[at])) at++;
      return item.x + (item.w * at) / chars.length;
    }
    seen += count;
  }
  return line.xEnd;
}

function itemOf(line: Line, marker: Marker, markerX = line.x): Item {
  return { lines: [line], marker, markerX, bodyX: bodyXOf(line, marker) };
}

// One level of a list: markers within 0.8 em of one another (a right-aligned
// "(iii)" starts left of "(i)") or words that start at one x.
function sameLevel(a: { markerX: number; bodyX: number }, b: { markerX: number; bodyX: number }, size: number): boolean {
  return Math.abs(a.markerX - b.markerX) <= size * 0.8 || Math.abs(a.bodyX - b.bodyX) <= size * 0.3;
}

// A marked line after the items read so far opens the next item when its
// marker follows the last one at its level, or opens a nested list under
// the last item.
function joinsList(items: Item[], line: Line, marker: Marker, markerX = line.x): boolean {
  const here = { markerX, bodyX: bodyXOf(line, marker) };
  let at = items.length - 1;
  while (at >= 0 && !sameLevel(items[at], here, line.size)) at--;
  if (at < 0) return markerX > items[items.length - 1].markerX + line.size * 0.5 && opensSequence(marker);
  if (follows(items[at].marker, marker)) return true;
  // An item of an outer level after the sibling ("2." after "1.3") opens
  // this level again: "2.1" starts it anew.
  const reopened = items.slice(at + 1).some((it) => it.markerX < items[at].markerX - line.size * 0.5);
  return reopened && opensSequence(marker);
}

// An unmarked line under an item goes on with it: it starts where the item's
// words start (a hanging indent), or the line above ran to the column's edge
// and this one starts back at the marker (a wrap).
function goesOn(item: Item, prev: Line, next: Line, edge: number, ctx: PageContext): boolean {
  const gap = prev.y - next.y;
  if (gap > next.size * ctx.leading * 1.3 && !pushedApart(prev, next)) return false;
  if (Math.abs(next.x - item.bodyX) <= next.size * 0.5) return true;
  return (
    fillsMargin(prev, next, edge) &&
    next.x <= item.markerX + next.size * 0.5 &&
    next.x >= Math.min(ctx.columnLeft, item.markerX) - next.size * 0.3
  );
}

function markedList(lines: Line[], i: number, ctx: PageContext, runOf: number[], first: Marker, firstX = lines[i].x): Step | null {
  const line = lines[i];
  const items: Item[] = [itemOf(line, first, firstX)];
  // The column's right edge, where a wrapped line runs to: the prose lines
  // around the list end there, else the column the list was read in (a
  // form's items, with no prose line near the first: an item's last word
  // on its next line read as a paragraph of its own). A short centered
  // line never reaches it.
  const prose = proseEdge(lines, i, i + 1);
  const edge = prose > 0 ? Math.max(line.xEnd, prose) : (lineColumn(line)?.[1] ?? Infinity);
  let j = i + 1;
  while (j < lines.length) {
    const next = lines[j];
    const prev = lines[j - 1];
    const gap = prev.y - next.y;
    if (
      runOf[j] !== -1 ||
      next.cells.length !== 1 ||
      gap < 0 ||
      next.size > Math.max(ctx.bodySize * 1.15, line.size + 0.5) ||
      Math.abs(next.size - line.size) > 1.2
    )
      break;
    const item = items[items.length - 1];
    const sibling = [...items].reverse().find((it) => Math.abs(it.markerX - next.x) <= next.size * 0.8);
    const marker = readMarker(next, sibling?.marker);
    const drawn = marker ? null : drawnMarkerAt(next, ctx);
    const mark = marker ?? (drawn !== null ? DRAWN : null);
    // A marker at the item's words, under a line that ran to the column's
    // edge mid-sentence and at no level the list has, is the item's next
    // line ("… are either" over "(1) in the public domain or (2) …": a
    // nested item "(1)", real-gslides-oer-5rs p3), and so is a number that
    // closes a parenthesis the line above left open.
    const here = { markerX: drawn ?? next.x, bodyX: mark ? bodyXOf(next, mark) : next.x };
    const wrap =
      mark !== null &&
      (closesParen(prev, next) ||
        (Math.abs(next.x - item.bodyX) <= next.size * 0.3 &&
          !/[.:;!?]$/.test(prev.text.trim()) &&
          fillsMargin(prev, next, edge) &&
          !items.some((it) => sameLevel(it, here, next.size))));
    // Marked items sit farther apart than wrapped lines (itemsep).
    if (mark && !wrap && gap <= next.size * ctx.leading * 2.2 && joinsList(items, next, mark, drawn ?? next.x)) {
      items.push(itemOf(next, mark, drawn ?? next.x));
      j++;
      continue;
    }
    // On a page set justified a wrapped line fills the column: under a line
    // that stopped short, a line with no marker is no wrap of the item (a
    // form's label lines under a checkbox item).
    if (!stopsShort(lines, j - 1, ctx) && goesOn(item, prev, next, edge, ctx)) {
      item.lines.push(next);
      j++;
      continue;
    }
    break;
  }
  if ((first === DRAWN && items.length < 2) || !isList(items, i, ctx)) return null;
  const { depths, levels } = depthsOf(items, line.size);
  const list = listSegment(items, depths);
  list.listIndents = listIndentsOf(items, depths, levels, listEdge(items, lines, i, j, ctx));
  return { segments: [withItemLayout(list, lines, items.map((item) => item.lines), ctx)], next: j };
}

// A lone marked line is an item when something says so: its words hang
// under the marker, it is set in from the column, or its marker goes on
// with the list last read. A marker at the column's edge with its wraps
// under it, alone, is a paragraph that opens with a number ("(7) Weight-
// space…"), and a row of boxes on one line is a form line ("☐ Yes ☒ No").
function isList(items: Item[], i: number, ctx: PageContext): boolean {
  const first = items[0];
  const size = first.lines[0].size;
  const hanging = items.some((it) => it.lines.slice(1).some((l) => l.x > it.markerX + size * 0.5));
  const continued = (openLevels(first.lines[0].page) ?? []).some((level) => sameLevel(level, first, size) && follows(level.marker, first.marker));
  if (!opensSequence(first.marker) && !continued && i > 0 && !(items.length >= 2 && follows(first.marker, items[1].marker))) return false;
  if (items.length >= 2) return true;
  if (first.marker.family === "box" && /[☐☑☒]/.test(first.lines[0].text.slice(first.marker.length))) return false;
  // An asterisk alone is a note's symbol, not a bullet: the note under a
  // table whose header carries an asterisk read as a list item and lost it.
  if (first.marker.text === "*") return false;
  // A bullet glyph opens an item even alone (a slide's one bullet).
  if (isGlyphMarker(first.marker) || GLYPH_BULLET_RE.test(first.lines[0].text)) return true;
  // "A." and "I." open initials ("A. Vaswani") as often as items.
  if (/^[A-Z]\.$/.test(first.marker.text)) return false;
  const indented = first.markerX > ctx.columnLeft + size * 0.5;
  return hanging || continued || indented;
}

// Each item's depth: the rank of its level among the list's levels, left to
// right, and each level's marker x by rank. A list that goes on from the one
// last read keeps its levels.
function depthsOf(items: Item[], size: number): { depths: number[]; levels: number[] } {
  const levels: Level[] = [];
  const first = items[0];
  const remembered = openLevels(first.lines[0].page);
  // A list goes on from the one last read where it starts at one of its
  // levels: at the outermost with a marker that opens no sequence, or at a
  // level under it with any (an exercise's "(a)" after a display cut its
  // list, Grinstead p. 35: read as a new list, one level out).
  const continued =
    remembered !== null &&
    remembered.some(
      (level, r) =>
        sameLevel(level, first, size) && (r >= 1 || !opensSequence(first.marker) || first.marker.family === "box" || first.marker.family === "bullet"),
    );
  if (continued && remembered) levels.push(...remembered.map((level) => ({ ...level })));
  const levelOf = items.map((item) => {
    let k = levels.findIndex((level) => sameLevel(level, item, size));
    if (k < 0) k = levels.push({ markerX: item.markerX, bodyX: item.bodyX, marker: item.marker }) - 1;
    levels[k].marker = item.marker;
    return k;
  });
  const order = levels.map((_, k) => k).sort((a, b) => levels[a].markerX - levels[b].markerX);
  const rank = new Map(order.map((k, r) => [k, r]));
  open = { page: first.lines[0].page, levels: order.map((k) => levels[k]) };
  return { depths: levelOf.map((k) => rank.get(k) ?? 0), levels: order.map((k) => levels[k].markerX) };
}

// The left edge of the column a list stands in: its first line's
// (leftEdge), or where the line right above or below the list in its column
// starts, when that is further left. A page whose lines are mostly a list
// set in from the prose reads its column at the list (its markers stood at
// the column's edge or in the margin, its words half their place in). A
// column never starts right of the list's markers.
function listEdge(items: Item[], lines: Line[], from: number, to: number, ctx: PageContext): number {
  const own = items.flatMap((item) => item.lines);
  const markers = Math.min(...items.map((item) => item.markerX));
  const left = Math.min(...own.map((l) => l.x));
  const right = Math.max(...own.map((l) => l.xEnd));
  const reach = own[0].size * ctx.leading * 4;
  let edge = leftEdge(own[0], ctx);
  for (const [line, gap] of [
    [lines[from - 1], lines[from - 1] ? lines[from - 1].y - own[0].y : 0],
    [lines[to], lines[to] ? own[own.length - 1].y - lines[to].y : 0],
  ] as const) {
    if (!line || line.cells.length !== 1 || gap <= 0 || gap > reach || line.x >= right || line.xEnd <= left) continue;
    edge = Math.min(edge, leftEdge(line, ctx), line.x);
  }
  return Math.min(edge, markers);
}

// Where each depth's items stand (ParsedBlock.listIndents), from the
// column's left edge (listEdge): an item's marker at left + first, its
// wrapped lines at left; where no item of a depth wraps, its words stand at
// left, as under a hanging marker. A flush list's wraps come back under its
// markers (a form's checkbox items), a hanging list's stand under its words
// (a book's exercises): the import drew every list hanging half an inch in.
// Where the wraps come back under the markers, the first line's words stand
// hang after the marker's start: a word space after a TeX label, a tab
// after a Word number.
function listIndentsOf(items: Item[], depths: number[], levels: number[], edge: number): Indent[] {
  return levels.map((x, d) => {
    const at = items.filter((_, k) => depths[k] === d);
    if (at.length === 0) return { left: Math.round(x - edge), first: 0 };
    const marker = median(at.map((item) => item.markerX));
    const wraps = at.flatMap((item) => item.lines.slice(1).map((l) => l.x));
    const left = median(wraps.length > 0 ? wraps : at.map((item) => item.bodyX));
    const first = Math.round(marker - left);
    const hang = first >= 0 ? Math.round(median(at.map((item) => item.bodyX - item.markerX))) : 0;
    return { left: Math.round(left - edge), first, ...(hang > 0 ? { hang } : {}) };
  });
}

// A list's layout beside its words: the space the page leaves between two
// items beyond the line pitch (ParsedBlock.itemSpace, the middle one, as
// measureSpacing reads a block's space after: a form spaces its checkbox
// items, and the import drew them tight), and "justify" on its html where
// its items are set justified.
function withItemLayout(list: Segment, lines: Line[], items: Line[][], ctx: PageContext): Segment {
  // Items one under the other: an item atop the next column stands higher.
  const pitches = items.slice(1).map((item, k) => ({ pitch: items[k][items[k].length - 1].y - item[0].y, size: item[0].size })).filter((p) => p.pitch > 0);
  const space = pitches.length > 0 ? Math.round(median(pitches.map((p) => p.pitch - ctx.leading * p.size))) : 0;
  if (space > 0) list.itemSpace = space;
  if (justifiedItems(lines, items, ctx)) list.html = '<ul class="justify"></ul>';
  return list;
}

// The LIST text: one line per item, two spaces per depth, the marker as
// printed, a space, the words. A bullet keeps its glyph ("–" for a Google
// Docs dash list, "◦", "▪"), so the page editor draws the page's glyph at
// each level; Word's Courier "o" is its hollow bullet.
function listSegment(items: Item[], depths: number[]): Segment {
  const builder = new TextBuilder();
  items.forEach((item, k) => {
    const joined = joinGroup(item.lines);
    const text = joined.text.replace(/\n/g, " ");
    const indent = "  ".repeat(depths[k]);
    const bullet = item.marker.family === "bullet";
    const cut = bullet ? item.marker.length : /^\s*/.exec(text)?.[0].length ?? 0;
    const glyph = item.marker.text === "o" ? "◦" : item.marker.text;
    const lead = indent + (bullet ? `${glyph} ` : "");
    builder.append(
      {
        text: lead + text.slice(cut),
        runs: joined.runs
          .map((r) => ({ ...r, start: Math.max(0, r.start - cut) + lead.length, end: r.end - cut + lead.length }))
          .filter((r) => r.end > r.start),
      },
      "\n",
    );
  });
  const all = items.flatMap((item) => item.lines);
  return { type: "LIST", text: builder.text, page: all[0].page, runs: builder.runs, ...geom(all) };
}

// ── Indented bands ──────────────────────────────────────────────────────────

// A bullet the page draws as a shape left of a line's first word, about its
// letters' height, at most `most` ems wide and high (Beamer's and a slide
// program's bullets never reach the text layer; Beamer paints its balls as
// shadings): the shape's left edge, or null.
function drawnBulletAt(line: Line, ctx: PageContext, most = 0.9): number | null {
  const s = line.size;
  const shape = [...ctx.drawing.paths.filter((b) => !b.clip), ...ctx.drawing.fills, ...ctx.drawing.shades].find(
    (b) =>
      b.x2 <= line.x + s * 0.1 &&
      b.x1 >= line.x - s * 3 &&
      b.x2 - b.x1 >= s * 0.1 &&
      b.x2 - b.x1 <= s * most &&
      b.y2 - b.y1 >= s * 0.1 &&
      b.y2 - b.y1 <= s * most &&
      b.y1 >= line.y - s * 0.3 &&
      b.y2 <= line.y + s,
  );
  return shape ? shape.x1 : null;
}

function drawnBullet(line: Line, ctx: PageContext): boolean {
  return drawnBulletAt(line, ctx) !== null;
}

// A drawn bullet's marker: "•", no characters of the line.
const DRAWN: Marker = { text: "•", family: "bullet", shape: "•", value: 0, length: 0, checked: false };

// A caption's label after a square the page draws (LIPIcs: "Figure 2",
// "Algorithm 1") opens no item.
const CAPTION_RE = /^(?:Figure|Fig\.|Table|Algorithm|Listing)\s*\d/i;

// Where a drawn bullet stands left of a line that opens an item: a shape
// two thirds of an em at most (a form's checkbox is bigger than a bullet).
function drawnMarkerAt(line: Line, ctx: PageContext): number | null {
  if (line.cells.length !== 1 || CAPTION_RE.test(line.text.trim())) return null;
  return drawnBulletAt(line, ctx, 0.65);
}

// An unmarked indented band: its gaps, outdents, and short lines split it
// into items (vector bullets, whose glyphs never reach the text layer).
function indentedBand(lines: Line[], i: number, ctx: PageContext, runOf: number[]): Step | null {
  const line = lines[i];
  const body = ctx.bodySize;
  // Text inside a framed box sits at the frame's inset: an indent that is
  // the box's, not a list's (import compare loop finding: a verbatim
  // briefing box read as one long list).
  const indentStart =
    !isFirstLineIndent(lines, i, ctx, runOf) &&
    isIndented(line, ctx) &&
    line.size <= body * 1.15 &&
    line.size >= body * 0.8 &&
    !isBoxedLine(line, ctx) &&
    !opensWithLabel(line) &&
    // A centered line is set in from both edges, not indented: a court's
    // caption and a paper's author lines read as lists.
    !isCentered(lines, i, ctx);
  if (!indentStart) return null;
  const run: Line[] = [line];
  let j = i + 1;
  while (j < lines.length) {
    const next = lines[j];
    // A theorem's label, or a paragraph's first line (the lines under it back
    // at the column's edge), opens a paragraph: "PER CURIAM." over the
    // opinion's first paragraph read as a two-item list.
    if (opensWithLabel(next) || isFirstLineIndent(lines, j, ctx, runOf)) break;
    // Marked items sit farther apart than wrapped lines (itemsep); an
    // unmarked line past 1.6 leading is the next paragraph.
    const maxGap = BULLET_RE.test(next.text) ? 2.2 : 1.6;
    if (
      runOf[j] !== -1 ||
      next.cells.length !== 1 ||
      next.size > body * 1.15 ||
      Math.abs(next.size - line.size) > 1.2 ||
      run[run.length - 1].y - next.y > next.size * ctx.leading * maxGap ||
      run[run.length - 1].y - next.y < 0
    )
      break;
    // A display equation under an item (centered, set in math fonts) is
    // its own block, never the item's next line.
    if (lineMathShare(next) >= 0.5 && next.x > line.x + next.size * 4) break;
    // A marked line stepping back left of the run's first line is the
    // next item of an outer list, not a line of this run; under an unmarked
    // first line it opens a list of its own, and the lines above it are a
    // paragraph (an exercise's words after its display over its items,
    // "(see Example 1.6).", read as a bullet over them: Grinstead p. 35).
    const marked = BULLET_RE.test(next.text) && !closesParen(run[run.length - 1], next);
    if (marked && (next.x < line.x - next.size * 0.5 || (!BULLET_RE.test(line.text) && readMarker(next) !== null))) break;
    const continues = marked || next.x >= line.x - 2;
    if (!continues) break;
    run.push(next);
    j++;
  }
  // Item boundaries: bullet markers, or gaps looser than the run's leading.
  // Items with neither (vector bullets at text leading): in a band of
  // mostly short lines, a line that stops short of the column's right edge
  // ends its item (import compare loop finding: a CJK dish list fused into
  // one paragraph).
  const starts: number[] = [0];
  const gaps = run.slice(1).map((l, k) => run[k].y - l.y);
  const gapThreshold = ctx.leading * line.size * 1.12;
  // A block indented on both sides (an abstract, a quotation) has its own
  // right edge: most lines end together there and none is short.
  const runMax = Math.max(...run.map((l) => l.xEnd));
  const alignedRight = run.filter((l) => l.xEnd > runMax - l.size).length;
  const wideBlock = runMax - line.x > line.size * 20;
  const edge =
    wideBlock && alignedRight * 10 >= run.length * 6 ? runMax : Math.max(runMax, proseEdge(lines, i, j));
  const shortLines = run.filter((l) => l.xEnd < edge - l.size * 3).length;
  const ragged = shortLines * 2 >= run.length;
  for (let k = 1; k < run.length; k++) {
    const marked = BULLET_RE.test(run[k].text) && !closesParen(run[k - 1], run[k]);
    const spaced = gaps[k - 1] > gapThreshold && !pushedApart(run[k - 1], run[k]);
    const outdented = run[k].x < run[k - 1].x - line.size * 0.5;
    const ended = ragged && !fillsMargin(run[k - 1], run[k], edge);
    if (marked || spaced || outdented || ended) starts.push(k);
  }
  // Each item keeps the geometry of its own lines: with the run's box on
  // every item, an integral sign split off an equation read as starting
  // at the column edge and never rejoined it (import compare loop finding).
  const items: { text: string; runs: Run[]; lines: Line[] }[] = [];
  for (let s = 0; s < starts.length; s++) {
    const slice = run.slice(starts[s], starts[s + 1] ?? run.length);
    const joined = joinGroup(slice);
    items.push({ text: joined.text.replace(/\n/g, " "), runs: joined.runs, lines: slice });
  }
  const segments: Segment[] = [];
  // At the top of a page, an unmarked first group before marked items is
  // the tail of the previous page's last item, not an item: emit it as a
  // paragraph so the cross-page merge can finish that item.
  if (i === 0 && items.length >= 2 && !BULLET_RE.test(items[0].text) && BULLET_RE.test(items[1].text)) {
    const tail = items.shift()!;
    segments.push({ type: "PARAGRAPH", text: tail.text, page: line.page, runs: tail.runs, ...geom(tail.lines) });
  }
  // Labels that end in a colon, one to a line with no marker, are a form's
  // fields (a fill-in rule drawn after each, or typed as a blank): each is a
  // paragraph set in as the page sets it, not an item of an invented list.
  if (items.length >= 2 && items.every((item) => item.lines.length === 1 && !BULLET_RE.test(item.text) && /:(?:\s*_{3,})?$/.test(item.text.trim()))) {
    const field = (item: (typeof items)[number]): Segment => {
      const k = lines.indexOf(item.lines[0]);
      const { tokens, indent } = layout(lines, k, k + 1, ctx, item.text);
      const html = tokens.length > 0 ? `<p class="${tokens.join(" ")}"></p>` : undefined;
      return { type: "PARAGRAPH", text: item.text, ...(html ? { html } : {}), ...(indent ? { indent } : {}), page: item.lines[0].page, runs: item.runs, ...geom(item.lines) };
    };
    return { segments: [...segments, ...items.map(field)], next: j };
  }
  const glyphItem = items.length === 1 && GLYPH_BULLET_RE.test(items[0].text) && !/^\s*\*/.test(items[0].text);
  // Items with no marker in the text are a list only where the page draws
  // their bullets as shapes; else they are paragraphs set in (an example
  // box's lines read as a bullet list: OpenStax p. 3).
  const unmarked = items.filter((item) => !BULLET_RE.test(item.text));
  if (items.length >= 2 && unmarked.length > 0 && unmarked.filter((item) => drawnBullet(item.lines[0], ctx)).length * 2 < unmarked.length) {
    const paragraph = (item: (typeof items)[number]): Segment => {
      const k = lines.indexOf(item.lines[0]);
      const { tokens, indent } = layout(lines, k, k + item.lines.length, ctx, item.text);
      const html = tokens.length > 0 ? `<p class="${tokens.join(" ")}"></p>` : undefined;
      return { type: "PARAGRAPH", text: item.text, ...(html ? { html } : {}), ...(indent ? { indent } : {}), page: item.lines[0].page, runs: item.runs, ...geom(item.lines) };
    };
    return { segments: [...segments, ...items.map(paragraph)], next: j };
  }
  if (items.length >= 2 || glyphItem) {
    const builder = new TextBuilder();
    for (const item of items) {
      // A bullet glyph in the text stays as printed, a number stays (its
      // value is content), and an item whose bullet the page draws as a
      // shape (no glyph in the text) takes the plain "•".
      const glyph = GLYPH_BULLET_RE.exec(item.text);
      const cut = glyph ? glyph[0].length : 0;
      const marker = glyph ? `${glyph[0].trim()} ` : BULLET_RE.test(item.text) ? "" : "• ";
      builder.append(
        {
          text: marker + item.text.slice(cut),
          runs: item.runs
            .map((r) => ({
              ...r,
              start: Math.max(0, r.start - cut) + marker.length,
              end: r.end - cut + marker.length,
            }))
            .filter((r) => r.end > r.start),
        },
        "\n",
      );
    }
    const list: Segment = { type: "LIST", text: builder.text, page: line.page, runs: builder.runs, ...geom(run) };
    segments.push(withItemLayout(list, lines, items.map((item) => item.lines), ctx));
    return { segments, next: j };
  }
  // One item alone (usually cut by the page break): a paragraph that a
  // LIST on the neighboring page may claim. A block of lines set in under a
  // line that ends in a colon, or opening with a quotation mark, is a block
  // quotation (an opinion quoting a statute read as a lone list item).
  const above = lines[i - 1];
  const quoted = run.length >= 2 && (/^[“"‘]/.test(items[0].text) || (above !== undefined && /:$/.test(above.text.trim())));
  // Set in as the page sets it, where no list claims it (a title line under
  // a signature's company line).
  const { tokens, indent } = quoted ? { tokens: ["quote"], indent: undefined } : layout(lines, i, j, ctx, items[0].text);
  segments.push({
    type: "PARAGRAPH",
    text: items[0].text,
    ...(tokens.length > 0 ? { html: `<p class="${tokens.join(" ")}"></p>` } : {}),
    ...(indent ? { indent } : {}),
    page: line.page,
    runs: items[0].runs,
    listItem: !quoted && run.length <= 6,
    ...geom(run),
  });
  return { segments, next: j };
}

// ── Algorithms ──────────────────────────────────────────────────────────────

// An algorithm's caption ("Algorithm 1 Building and solving the SAT
// encoding."), and the lines that say what it takes and gives.
const ALGORITHM_RE = /^Algorithm\s+\d+[.:]?(?:\s|$)/;
const ALGORITHM_HEAD_RE = /^(?:Input|Output|Require|Ensure|Data|Result|Parameters?)\s*:/;

/** The lines under an algorithm's caption: one LIST, a line an item, no
    marker, each at the depth its indent reads (a loop's body one step in
    from its "for … do"); the lines that say what it takes and gives stand
    at the first depth. Read as paragraphs and a band set in, arXiv
    2506.06752's Algorithm 1 kept depth 0 for depths 1 to 3. The lines go
    on at the text's leading to a gap wider than a line and a half. A
    sentence that opens a line with "Algorithm 2 in Section S1…" (arXiv
    2302.12627) is no caption: a caption's label is bold or its line
    stands apart from the line above, and its lines stop short of the
    column's edge, where prose runs to it. */
export function readAlgorithm(lines: Line[], i: number, ctx: PageContext, runOf: number[]): Step | null {
  const line = lines[i];
  const caption = lines[i - 1];
  const size = line.size;
  if (!caption || caption.page !== line.page || !ALGORITHM_RE.test(caption.text.trim()) || runOf[i] !== -1 || line.cells.length !== 1) return null;
  if (caption.y - line.y <= 0 || caption.y - line.y > size * ctx.leading * 2.5) return null;
  const label = /^\s*Algorithm\s+\d+/.exec(caption.text)![0].length;
  const above = lines[i - 2];
  const apart = above === undefined || above.page !== caption.page || lineColumn(above) !== lineColumn(caption) || above.y - caption.y > caption.size * ctx.leading * 1.5;
  if (!apart && !caption.runs.some((r) => r.bold && r.start <= label - 1 && r.end >= label)) return null;
  const run: Line[] = [line];
  for (let j = i + 1; j < lines.length; j++) {
    const next = lines[j];
    const prev = run[run.length - 1];
    const gap = prev.y - next.y;
    if (runOf[j] !== -1 || next.cells.length !== 1 || lineColumn(next) !== lineColumn(prev) || Math.abs(next.size - size) > size * 0.15) break;
    if (gap <= 0 || gap > size * ctx.leading * 1.6) break;
    run.push(next);
  }
  if (run.length < 2) return null;
  const right = Math.max(proseEdge(lines, i, i + run.length), lineColumn(line)?.[1] ?? 0);
  if (right > 0 && run.slice(0, -1).filter((l) => l.xEnd >= right - size * 1.5).length * 3 > run.length - 1) return null;
  const head = (l: Line) => ALGORITHM_HEAD_RE.test(l.text.trim());
  const levels: number[] = [];
  for (const x of run.filter((l) => !head(l)).map((l) => l.x).sort((a, b) => a - b)) {
    if (!levels.some((v) => Math.abs(v - x) <= size * 0.3)) levels.push(x);
  }
  const depths = run.map((l) => (head(l) ? 0 : Math.max(0, levels.findIndex((v) => Math.abs(v - l.x) <= size * 0.3))));
  const builder = new TextBuilder();
  run.forEach((l, k) => {
    const lead = "  ".repeat(depths[k]);
    builder.append({ text: lead + l.text, runs: l.runs.map((r) => ({ ...r, start: r.start + lead.length, end: r.end + lead.length })) }, "\n");
  });
  const edge = leftEdge(line, ctx);
  const list: Segment = {
    type: "LIST",
    text: builder.text,
    page: line.page,
    runs: builder.runs,
    listIndents: levels.map((x) => ({ left: Math.round(x - edge), first: 0 })),
    ...geom(run),
  };
  open = null;
  return { segments: [withItemLayout(list, lines, run.map((l) => [l]), ctx)], next: i + run.length };
}

// ── References ──────────────────────────────────────────────────────────────

// A references section's heading (a Chinese or Japanese paper's "参考文献"
// too): its entries follow, on its page and the pages after, up to the next
// heading.
const REFERENCES_RE = /^(?:\d{1,2}\.?\s+)?(?:references(?: and notes)?|bibliography|literature cited|works cited|参考文献|참고문헌)$/i;
let references = false;

/** A references section whose entries carry no marker, each set with a
    hanging indent (author-year references: MNRAS, ACL): a line at the
    entries' left edge opens an entry and a line set in by the hanging step
    goes on with it, in each column. One LIST, an entry a line, no marker:
    read as paragraphs, the entries of one line ran together, 25 in one
    (arXiv 2503.22874), and 42 of 50 entries were no list's (arXiv
    2503.10997). Lines that show no hanging indent are left to the other
    readers. */
export function readReferences(lines: Line[], i: number, ctx: PageContext, runOf: number[]): Step | null {
  const line = lines[i];
  const marker = references ? readMarker(line) : null;
  if (!references || runOf[i] !== -1 || line.table || marker?.family === "cite" || marker?.family === "arabic") return null;
  const size = line.size;
  const run: Line[] = [line];
  for (let j = i + 1; j < lines.length; j++) {
    const next = lines[j];
    const prev = run[run.length - 1];
    const gap = prev.y - next.y;
    if (runOf[j] !== -1 || next.table || Math.abs(next.size - size) > 0.6 || boldShare(next.runs, next.text.length) > 0.9) break;
    if (lineColumn(next) === lineColumn(prev) && (gap <= 0 || gap > size * ctx.leading * 3)) break;
    run.push(next);
  }
  // Each column's entry edge (its leftmost line) and right edge, and the
  // hanging step: how far the lines set in stand from the edge.
  const columns = new Map<unknown, { left: number; right: number; lines: Line[] }>();
  for (const l of run) {
    const key = lineColumn(l);
    const c = columns.get(key) ?? { left: l.x, right: l.xEnd, lines: [] };
    columns.set(key, { left: Math.min(c.left, l.x), right: Math.max(c.right, l.xEnd), lines: [...c.lines, l] });
  }
  const columnOf = (l: Line) => columns.get(lineColumn(l))!;
  // A word processor hangs its entries half an inch: 3.6 ems at 10 pt.
  const steps = run.map((l) => l.x - columnOf(l).left).filter((d) => d >= size * 0.3 && d <= size * 4);
  if (steps.length === 0) return null;
  const step = median(steps);
  // A column whose lines all start at one place shows no hanging indent:
  // the middle of an entry of hundreds of authors (its lines wrap at the
  // column's edge, and a line under a short one opens the next entry), or
  // entries of one line each.
  const wraps = new Set<unknown>();
  for (const [key, c] of columns) {
    if (c.lines.some((l) => Math.abs(l.x - c.left - step) <= size * 0.5)) continue;
    const full = c.lines.slice(0, -1).filter((l, k) => fillsMargin(l, c.lines[k + 1], c.right)).length;
    if (full >= (c.lines.length - 1) * 0.6 && full > 0) wraps.add(key);
  }
  const entries: Line[][] = [];
  const tail: Line[] = [];
  let end = 0;
  for (const [k, l] of run.entries()) {
    const c = columnOf(l);
    const d = l.x - c.left;
    const prev = run[k - 1];
    const opens = wraps.has(lineColumn(l))
      ? prev === undefined || !fillsMargin(prev, l, lineColumn(prev) === lineColumn(l) ? c.right : columnOf(prev).right)
      : Math.abs(d) <= size * 0.3;
    if (opens) entries.push([l]);
    else if (wraps.has(lineColumn(l)) || Math.abs(d - step) <= size * 0.5) {
      if (entries.length > 0) entries[entries.length - 1].push(l);
      else tail.push(l);
    } else break;
    end = k + 1;
  }
  if (!entries.some((entry) => entry.length >= 2)) return null;
  const segments: Segment[] = [];
  // The page opens with the end of the entry the page before cut: a
  // paragraph the cross-page join gives to that entry.
  if (tail.length > 0) {
    const { text, runs } = joinGroup(tail, true);
    segments.push({ type: "PARAGRAPH", text: text.replace(/\n/g, " "), page: line.page, runs, ...geom(tail) });
  }
  const builder = new TextBuilder();
  for (const entry of entries) {
    const { text, runs } = joinGroup(entry, true);
    builder.append({ text: text.replace(/\n/g, " "), runs }, "\n");
  }
  const all = entries.flat();
  const list: Segment = { type: "LIST", text: builder.text, page: line.page, runs: builder.runs, ...geom(all) };
  list.listIndents = [{ left: Math.round(columnOf(all[0]).left + step - leftEdge(all[0], ctx)), first: Math.round(-step) }];
  segments.push(withItemLayout(list, lines, entries, ctx));
  return { segments, next: i + end };
}
