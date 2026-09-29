// Lists: marked items (a bullet, a box, a number, a letter, a numeral, a legal
// number, a citation label) with their depth, and indented bands whose gaps
// split them into items (bullet glyphs are often vector art, not text).

import { lineColumn } from "@/lib/parse/pdf/columns";
import { geom, lineMathShare, median } from "@/lib/parse/pdf/geometry";
import { BULLET_RE, GLYPH_BULLET_RE, follows, isGlyphMarker, opensSequence, readMarker, type Marker } from "@/lib/parse/pdf/markers";
import { isCentered, isFirstLineIndent, isIndented, justifiedItems, leftEdge, opensWithLabel, proseEdge, pushedApart } from "@/lib/parse/pdf/paragraphs";
import { TextBuilder, fillsMargin, joinGroup } from "@/lib/parse/pdf/text";
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
  return indentedBand(lines, i, ctx, runOf);
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
let open: { page: number; levels: { x: number; marker: Marker }[] } | null = null;

function openLevels(page: number): { x: number; marker: Marker }[] | null {
  return open && (page === open.page || page === open.page + 1) ? open.levels : null;
}

/** A heading closes the list last read: an item after it starts afresh. */
export function closeLists() {
  open = null;
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

function itemOf(line: Line, marker: Marker): Item {
  return { lines: [line], marker, markerX: line.x, bodyX: bodyXOf(line, marker) };
}

// One level of a list: markers within 0.8 em of one another (a right-aligned
// "(iii)" starts left of "(i)") or words that start at one x.
function sameLevel(a: { markerX: number; bodyX: number }, b: { markerX: number; bodyX: number }, size: number): boolean {
  return Math.abs(a.markerX - b.markerX) <= size * 0.8 || Math.abs(a.bodyX - b.bodyX) <= size * 0.3;
}

// A marked line after the items read so far opens the next item when its
// marker follows the last one at its level, or opens a nested list under
// the last item.
function joinsList(items: Item[], line: Line, marker: Marker): boolean {
  const here = { markerX: line.x, bodyX: bodyXOf(line, marker) };
  let at = items.length - 1;
  while (at >= 0 && !sameLevel(items[at], here, line.size)) at--;
  if (at < 0) return line.x > items[items.length - 1].markerX + line.size * 0.5 && opensSequence(marker);
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

function markedList(lines: Line[], i: number, ctx: PageContext, runOf: number[], first: Marker): Step | null {
  const line = lines[i];
  const items: Item[] = [itemOf(line, first)];
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
    // Marked items sit farther apart than wrapped lines (itemsep).
    if (marker && gap <= next.size * ctx.leading * 2.2 && joinsList(items, next, marker)) {
      items.push(itemOf(next, marker));
      j++;
      continue;
    }
    if (goesOn(item, prev, next, edge, ctx)) {
      item.lines.push(next);
      j++;
      continue;
    }
    break;
  }
  if (!isList(items, i, ctx)) return null;
  const { depths, levels } = depthsOf(items, line.size);
  const list = listSegment(items, depths);
  list.listIndents = listIndentsOf(items, depths, levels, ctx);
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
  const continued = (openLevels(first.lines[0].page) ?? []).some(
    (level) => Math.abs(level.x - first.markerX) <= size * 0.8 && follows(level.marker, first.marker),
  );
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
  const levels: { markerX: number; bodyX: number; marker: Marker }[] = [];
  const first = items[0];
  const remembered = openLevels(first.lines[0].page);
  const continued =
    remembered !== null &&
    (!opensSequence(first.marker) || first.marker.family === "box" || first.marker.family === "bullet") &&
    remembered.some((level) => Math.abs(level.x - first.markerX) <= size * 0.8);
  if (continued && remembered) for (const level of remembered) levels.push({ markerX: level.x, bodyX: Number.NaN, marker: level.marker });
  const levelOf = items.map((item) => {
    let k = levels.findIndex((level) => sameLevel(level, item, size));
    if (k < 0) k = levels.push({ markerX: item.markerX, bodyX: item.bodyX, marker: item.marker }) - 1;
    levels[k].marker = item.marker;
    if (Number.isNaN(levels[k].bodyX)) levels[k].bodyX = item.bodyX;
    return k;
  });
  const order = levels.map((_, k) => k).sort((a, b) => levels[a].markerX - levels[b].markerX);
  const rank = new Map(order.map((k, r) => [k, r]));
  open = { page: first.lines[0].page, levels: order.map((k) => ({ x: levels[k].markerX, marker: levels[k].marker })) };
  return { depths: levelOf.map((k) => rank.get(k) ?? 0), levels: order.map((k) => levels[k].markerX) };
}

// Where each depth's items stand (ParsedBlock.listIndents), from the
// column's left edge: an item's marker at left + first, its wrapped lines at
// left; where no item of a depth wraps, its words stand at left, as under a
// hanging marker. A flush list's wraps come back under its markers (the
// legal packet's checkbox items), a hanging list's stand under its words
// (the math notes' exercises): the import drew every list hanging half an
// inch in.
function listIndentsOf(items: Item[], depths: number[], levels: number[], ctx: PageContext): Indent[] {
  const edge = leftEdge(items[0].lines[0], ctx);
  return levels.map((x, d) => {
    const at = items.filter((_, k) => depths[k] === d);
    if (at.length === 0) return { left: Math.round(x - edge), first: 0 };
    const marker = median(at.map((item) => item.markerX));
    const wraps = at.flatMap((item) => item.lines.slice(1).map((l) => l.x));
    const left = median(wraps.length > 0 ? wraps : at.map((item) => item.bodyX));
    return { left: Math.round(left - edge), first: Math.round(marker - left) };
  });
}

// A list's layout beside its words: the space the page leaves between two
// items beyond the line pitch (ParsedBlock.itemSpace, the middle one, as
// measureSpacing reads a block's space after: the legal packet sets 4 pt
// between its checkbox items, and the import drew them tight), and "justify"
// on its html where its items are set justified.
function withItemLayout(list: Segment, lines: Line[], items: Line[][], ctx: PageContext): Segment {
  const gaps = items.slice(1).map((item, k) => items[k][items[k].length - 1].y - item[0].y - ctx.leading * item[0].size);
  const space = gaps.length > 0 ? Math.round(median(gaps)) : 0;
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
    // next item of an outer list, not a line of this run.
    if (BULLET_RE.test(next.text) && next.x < line.x - next.size * 0.5) break;
    const continues = BULLET_RE.test(next.text) || next.x >= line.x - 2;
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
    const marked = BULLET_RE.test(run[k].text);
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
  // fields (a fill-in rule drawn after each): each is a paragraph, not an
  // item of an invented list.
  if (items.length >= 2 && items.every((item) => item.lines.length === 1 && !BULLET_RE.test(item.text) && /:$/.test(item.text.trim()))) {
    const field = (item: (typeof items)[number]): Segment => ({ type: "PARAGRAPH", text: item.text, page: item.lines[0].page, runs: item.runs, ...geom(item.lines) });
    return { segments: [...segments, ...items.map(field)], next: j };
  }
  const glyphItem = items.length === 1 && GLYPH_BULLET_RE.test(items[0].text) && !/^\s*\*/.test(items[0].text);
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
  segments.push({
    type: "PARAGRAPH",
    text: items[0].text,
    ...(quoted ? { html: '<p class="quote"></p>' } : {}),
    page: line.page,
    runs: items[0].runs,
    listItem: !quoted && run.length <= 6,
    ...geom(run),
  });
  return { segments, next: j };
}
