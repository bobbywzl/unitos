// A page's lines cut into segments. Readers are tried in this order:
// contents lists, tables, code listings, label lines, an algorithm's lines
// (lists.ts), headings (headings.ts), references and lists (lists.ts), and
// paragraphs (paragraphs.ts). Each takes the lines from
// one index on and says where it stopped; the first that takes the line
// makes its segments.

import { TOC_ENTRY_RE, TOC_LABEL_RE, TOC_TAIL_RE, isContentsEntry, readContentsEntries, twoColumnList } from "@/lib/parse/pdf/contents";
import { lineColumn } from "@/lib/parse/pdf/columns";
import { geom, median } from "@/lib/parse/pdf/geometry";
import { readHeading } from "@/lib/parse/pdf/headings";
import { closeLists, joinMarkerCells, readAlgorithm, readList, readReferences } from "@/lib/parse/pdf/lists";
import { leftEdge, markEdges, readParagraph } from "@/lib/parse/pdf/paragraphs";
import { tableFromRegion } from "@/lib/parse/pdf/ruled";
import { findTableRuns, isLabelLine, tableFromRun } from "@/lib/parse/pdf/tables";
import { TextBuilder, appendProofBox, boldShare, fillLines, isFillRule, isMonoLine, lineAsPart, markTabs } from "@/lib/parse/pdf/text";
import type { Cell, Line, PageContext, Run, Segment, Step } from "@/lib/parse/pdf/types";

// ── Page segmentation ───────────────────────────────────────────────────────

// A contents list that runs past the page break continues on the next page.
let tocCarry = false;

const PROOF_END_RE = /^[□■∎]$/;

export function segmentPage(pageLines: Line[], ctx: PageContext): Segment[] {
  const segments: Segment[] = [];
  const lines = gatherAuthorGrid(joinRaisedMarks(joinMarkerCells(pageLines)), ctx);
  markEdges(lines, ctx);
  // A document's first page opens no list the last document left open.
  if (lines[0]?.page === 0) closeLists();
  const runOf = findTableRuns(lines, ctx);
  // Tabs and fill-in rules in the lines outside tables (text.ts).
  const fills = markTabs(lines, (k) => runOf[k] === -1, (l) => leftEdge(l, ctx), ctx.drawing, !ctx.tex);
  let tocMode = tocCarry && lines.length > 0 && TOC_ENTRY_RE.test(lines[0].text) && TOC_TAIL_RE.test(lines[0].text);
  tocCarry = false;
  // Where each reader's segments begin: its first line and its first segment.
  const starts: { line: number; at: number }[] = [];
  let i = 0;

  while (i < lines.length) {
    starts.push({ line: i, at: segments.length });
    const line = lines[i];

    // Contents label ("CONTENTS", "INSIDE"): the entries that follow become a
    // linked list, not headings. Set as a heading (larger than the body, or
    // bold), the label is one: a paper's "Contents" read as a paragraph.
    if (line.cells.length === 1 && TOC_LABEL_RE.test(line.text.trim())) {
      const heading = line.size >= ctx.bodySize * 1.14 || boldShare(line.runs, line.text.length) > 0.9;
      segments.push({ type: heading ? "HEADING" : "PARAGRAPH", text: line.text.trim(), page: line.page, runs: line.runs, ...(heading ? { rawSize: line.size } : {}), ...geom([line]) });
      tocMode = true;
      i++;
      continue;
    }

    if (tocMode && isContentsEntry(line)) {
      const step = readContentsEntries(lines, i, ctx.leading);
      segments.push(...step.segments);
      tocMode = false;
      tocCarry = step.next >= lines.length;
      i = step.next;
      continue;
    }

    // A ruled table, taken out of the text flow before the column split.
    if (line.table) {
      segments.push(tableFromRegion(line.table, line.page));
      tocMode = false;
      i++;
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

    // A proof's end mark alone on its line (flush right under a display)
    // ends the block before it, as the page shows it.
    const last = segments[segments.length - 1];
    if (PROOF_END_RE.test(line.text.trim()) && last !== undefined && (last.type === "PARAGRAPH" || last.type === "LIST")) {
      appendProofBox(last, line);
      i++;
      continue;
    }

    // A display equation's joined lines (math/display.ts) are one block:
    // no reader takes its label for a list marker or its sum for a heading.
    if (line.display) {
      segments.push({ type: "PARAGRAPH", text: lineAsPart(line).text, page: line.page, runs: line.runs, ...geom([line]) });
      i++;
      continue;
    }

    // An author's block of a title page's grid (gatherAuthorGrid).
    const stack = stackOf.get(line);
    if (stack && stack.every((l, k) => lines[i + k] === l)) {
      segments.push({ type: "PARAGRAPH", ...blockText(stack), html: '<p class="center"></p>', page: line.page, ...geom(stack) });
      i += stack.length;
      continue;
    }

    const step =
      readSplitLine(lines, i) ??
      readCodeListing(lines, i, ctx, runOf) ??
      readRuleLine(lines, i) ??
      readLabelLine(lines, i, ctx) ??
      readAlgorithm(lines, i, ctx, runOf) ??
      readHeading(lines, i, ctx, runOf) ??
      readReferences(lines, i, ctx, runOf) ??
      readList(lines, i, ctx, runOf) ??
      readParagraph(lines, i, ctx, runOf);
    const heading = step.segments.findLast((s) => s.type === "HEADING");
    if (heading) closeLists(heading.text);
    segments.push(...step.segments);
    i = step.next;
  }
  markPullQuotes(segments);
  return fillLines(withDrawnSeparators(segments, starts, lines, ctx, runOf), fills, lines[0]?.page ?? 0);
}

// ── Raised marks ────────────────────────────────────────────────────────────

// A note's mark raised over the end of a line may read as a line of its
// own, over it: a Chinese paper's author "许 为" with its "*" (arXiv
// 2111.04880), and the note linked to nothing. A line of one to four marks
// (note symbols, or a number or letter), set at most two thirds of the
// size of the line under it, less than that line's size over its baseline
// and within an em after its end, is that line's raised mark.
const MARKS_LINE_RE = /^(?:[*∗⋆†‡§¶‖∥]{1,4}|[\p{L}\p{N}]{1,2})$/u;
function joinRaisedMarks(lines: Line[]): Line[] {
  const out: Line[] = [];
  for (let k = 0; k < lines.length; k++) {
    const mark = lines[k];
    const line = lines[k + 1];
    const raised =
      line !== undefined &&
      mark.cells.length === 1 &&
      line.cells.length === 1 &&
      MARKS_LINE_RE.test(mark.text.trim()) &&
      mark.size <= line.size * 0.67 &&
      mark.y > line.y &&
      mark.y - line.y < line.size &&
      mark.x >= line.xEnd - 1 &&
      mark.x - line.xEnd <= line.size;
    if (!raised) {
      out.push(mark);
      continue;
    }
    // A word space between them stays: "许 为 *".
    const gap = mark.x - line.xEnd > line.size * 0.2 ? " " : "";
    const text = line.text + gap + mark.text.trim();
    const runs = [...line.runs, ...mark.runs.slice(0, 1).map((r) => ({ ...r, sup: true, zone: undefined, start: text.length - mark.text.trim().length, end: text.length }))];
    out.push({ ...line, text, runs, cells: [{ x: line.x, text, runs }], items: [...line.items, ...mark.items], xEnd: mark.xEnd, yMax: Math.max(line.yMax, mark.y) });
    k++;
  }
  return out;
}

// ── Author grids ────────────────────────────────────────────────────────────

// A title page's grid of authors: stacks of short centered lines side by
// side, each an author's block (a name, an affiliation, a city, an
// address). The column split reads a row of the grid across its stacks
// line by line, and may read a stack of the last row in the page's second
// column: the addresses ran together and "Wolfgang Lehner" read as a
// heading atop the right column (real-acm-damon25-3736236 p1). Each stack
// is one centered paragraph, the stacks in reading order where the row's
// first line stands.
const stackOf = new WeakMap<Line, Line[]>();

function gatherAuthorGrid(lines: Line[], ctx: PageContext): Line[] {
  if (lines[0]?.page !== 0) return lines;
  const width = Math.max(...lines.map((l) => l.xEnd)) - ctx.pageMinX;
  const short = (l: Line) =>
    l.cells.length === 1 && !l.table && !l.display && [...l.text].length <= 50 && l.xEnd - l.x <= width * 0.45 && l.size <= ctx.bodySize * 1.5;
  const middle = (l: Line) => (l.x + l.xEnd) / 2;
  // Lines under one another, a line's height apart, that share their
  // middle, top to bottom.
  const stacks: Line[][] = [];
  for (const line of lines.filter(short).sort((a, b) => b.y - a.y)) {
    const near = (stack: Line[]) => {
      const last = stack[stack.length - 1];
      const step = last.y - line.y;
      return step > line.size * 0.5 && step <= Math.max(line.size, last.size) * 1.6 && Math.abs(middle(last) - middle(line)) <= Math.max(1.5, line.size * 0.3);
    };
    const stack = stacks.find(near);
    if (stack) stack.push(line);
    else stacks.push([line]);
  }
  // A block holds three lines or more, centered: they start at different
  // places. A row holds two blocks or more, side by side, tops level.
  const blocks = stacks.filter((stack) => {
    const xs = stack.map((l) => l.x);
    return stack.length >= 3 && Math.max(...xs) - Math.min(...xs) > stack[0].size * 0.5;
  });
  const rows: Line[][][] = [];
  for (const block of blocks.sort((a, b) => b[0].y - a[0].y || a[0].x - b[0].x)) {
    const row = rows.find((r) => Math.abs(r[0][0].y - block[0].y) <= block[0].size);
    if (row) row.push(block);
    else rows.push([block]);
  }
  const grid = rows.filter((row) => {
    if (row.length < 2) return false;
    const spans = row.map((b) => [Math.min(...b.map((l) => l.x)), Math.max(...b.map((l) => l.xEnd))]).sort((a, b) => a[0] - b[0]);
    return spans.every((span, k) => k === 0 || span[0] > spans[k - 1][1]);
  });
  if (grid.length === 0) return lines;
  const taken = new Set(grid.flat(2));
  const at = lines.findIndex((l) => taken.has(l));
  const ordered = grid.flatMap((row) => [...row].sort((a, b) => a[0].x - b[0].x));
  for (const block of ordered) stackOf.set(block[0], block);
  const rest = lines.filter((l) => !taken.has(l));
  const before = lines.slice(0, at).filter((l) => !taken.has(l)).length;
  return [...rest.slice(0, before), ...ordered.flat(), ...rest.slice(before)];
}

// An author's block keeps its lines, each on a line of its own; an address
// cut at its own hyphen ("…@mailbox.tu-" over "dresden.de") joins whole.
function blockText(stack: Line[]): { text: string; runs: Run[] } {
  const builder = new TextBuilder();
  stack.forEach((line, k) => builder.append(lineAsPart(line), k > 0 && /\S-$/.test(stack[k - 1].text) ? "" : "\n"));
  return builder;
}

// ── Pull quotes ─────────────────────────────────────────────────────────────

// A paragraph set in a column under half as wide as a paragraph of its page
// that holds four in five of its words: a pull quote, the text's own words
// set apart ("Many Earth science missions, both airborne and on orbit, …"
// beside the paragraph it quotes, the Earth Observer p. 7: read as a
// paragraph).
function markPullQuotes(segments: Segment[]): void {
  const wordsOf = (text: string) => text.toLowerCase().match(/\p{L}{3,}/gu) ?? [];
  const width = (s: Segment) => (s.box ? s.box.x2 - s.box.x1 : 0);
  for (const s of segments) {
    if (s.type !== "PARAGRAPH" || /\b(?:quote|caption|center)\b/.test(s.html ?? "")) continue;
    const words = wordsOf(s.text);
    if (words.length < 8) continue;
    const quoted = segments.some((t) => {
      if (t === s || t.type !== "PARAGRAPH" || t.text.length <= s.text.length || width(s) * 2 > width(t)) return false;
      const theirs = new Set(wordsOf(t.text));
      return words.filter((w) => theirs.has(w)).length >= words.length * 0.8;
    });
    if (!quoted) continue;
    const tokens = /class="([^"]*)"/.exec(s.html ?? "")?.[1].split(/\s+/).filter(Boolean) ?? [];
    s.html = `<p class="${[...tokens.filter((t) => !t.startsWith("indent")), "quote"].join(" ")}"></p>`;
    delete s.indent;
  }
}

// ── Separators ──────────────────────────────────────────────────────────────

function separatorOf(page: number): Segment {
  return { type: "SEPARATOR", text: "---", page };
}

// A line of rule glyphs alone ("———————", "- - - - - - - -"): the writer's
// separator (a Google Docs note's line of dashes read as a paragraph).
// Underscores are a form's blanks, not a separator.
const RULE_LINE_RE = /^[-–—─━═=~]{8,}$/;
function readRuleLine(lines: Line[], i: number): Step | null {
  const line = lines[i];
  if (line.cells.length !== 1 || !RULE_LINE_RE.test(line.text.replace(/\s/g, ""))) return null;
  return { segments: [separatorOf(line.page)], next: i + 1 };
}

// A rule drawn across the column between two blocks is a separator. A rule
// in or around a table, under a word, or over the text it heads is not: the
// lines on both sides are prose, set apart from the rule, and the rule spans
// most of their width. A float's frame is not either: the rules over and
// under an algorithm's caption or a table's header row lie within three
// lines of each other, and a separator stands alone. Nor is a box's edge: a
// rule drawn down from its end meets it at a corner (the frame around the
// Earth Observer p. 13's meeting story and its photos).
function withDrawnSeparators(
  segments: Segment[],
  starts: { line: number; at: number }[],
  lines: Line[],
  ctx: PageContext,
  runOf: number[],
): Segment[] {
  const at = new Set<number>();
  for (const rule of ctx.drawing.rules) {
    if (rule.dir !== "h" || isFillRule(rule)) continue;
    const y = (rule.y1 + rule.y2) / 2;
    const start = starts.find((s) => s.line > 0 && lines[s.line - 1].y > y && lines[s.line].y < y);
    if (!start || runOf[start.line - 1] !== -1 || runOf[start.line] !== -1) continue;
    const above = lines[start.line - 1];
    const below = lines[start.line];
    // A ruled table taken out of the flow is one line with no cells: its
    // own rules fall between it and the line under it.
    if (above.cells.length === 0 || below.cells.length === 0) continue;
    const size = Math.max(above.size, below.size);
    const left = Math.min(above.x, below.x);
    const right = Math.max(above.xEnd, below.xEnd);
    // A chart's axis between its labels: small words on both sides. A rule
    // across the whole column may stand between short lines (a billing code
    // over the next document's agency line: the Federal Register p. 1),
    // unless it frames smaller type with a rule of its extent on the small
    // lines' other side (a listing's box: synth-paper-tex); a shorter one
    // wants a line of prose beside it.
    const column = lineColumn(above) ?? lineColumn(below);
    const across = column !== undefined && rule.x1 <= column[0] + size && rule.x2 >= column[1] - size;
    const small = (l: Line) => l.size < ctx.bodySize * 0.9;
    const plain = Math.min(above.size, below.size) >= ctx.bodySize * 0.9 && Math.max([...above.text].length, [...below.text].length) >= 30;
    const boxed = ctx.drawing.rules.some((r) => {
      if (r === rule || r.dir !== "h" || Math.abs(r.x1 - rule.x1) > size || Math.abs(r.x2 - rule.x2) > size) return false;
      const [lo, hi] = [Math.min(y, (r.y1 + r.y2) / 2), Math.max(y, (r.y1 + r.y2) / 2)];
      const inside = lines.filter((l) => l.y > lo && l.y < hi && l.x < rule.x2 && l.xEnd > rule.x1);
      return inside.length > 0 && inside.every(small);
    });
    if (size < ctx.bodySize * 0.9 || (!plain && (!across || boxed))) continue;
    // A rule over the page's notes: every line under it, across its extent,
    // is set smaller than the line over it (a first page's notes and its
    // number under their rule: 2609.29669 p. 1).
    if (lines.every((l) => l.y >= y || l.xEnd <= rule.x1 || l.x >= rule.x2 || l.size < above.size * 0.95)) continue;
    if (rule.x2 - rule.x1 < Math.max(size * 10, (right - left) * 0.5) || rule.x2 < left || rule.x1 > right) continue;
    if (above.yMin - y < size * 0.4 || y - below.yMax < size * 0.85) continue;
    // A float's frame: another rule across most of this one, within three
    // lines. A ruled table's own rules frame nothing (a table over the rule:
    // synth-gdocs-docx), nor do a heading's side marks (the Earth Observer
    // p. 11).
    const tables = lines.flatMap((l) => (l.table ? [l.table.box] : []));
    const framed = ctx.drawing.rules.some((r) => {
      const d = Math.abs((r.y1 + r.y2) / 2 - y);
      const inTable = tables.some((b) => r.y1 >= b.y1 - 1 && r.y2 <= b.y2 + 1 && r.x1 >= b.x1 - 1 && r.x2 <= b.x2 + 1);
      // A double rule's second stroke is the same separator.
      return r.dir === "h" && !inTable && d > size * 0.5 && d < size * ctx.leading * 3 && Math.min(r.x2, rule.x2) - Math.max(r.x1, rule.x1) >= (rule.x2 - rule.x1) * 0.5;
    });
    const corner = ctx.drawing.rules.some(
      (r) => r.dir === "v" && [r.y1, r.y2].some((end) => Math.abs(end - y) <= 2) && [rule.x1, rule.x2].some((x) => Math.abs((r.x1 + r.x2) / 2 - x) <= 2),
    );
    if (framed || corner) continue;
    // A chart's axis: a vertical rule crosses it in its middle, an em past
    // either end and reaching an em over and under it. A separator stands
    // alone (parse loop finding: a textbook's circle drawn on two axes, its
    // x axis read as a separator under the figure).
    const crossed = ctx.drawing.rules.some((r) => {
      const x = (r.x1 + r.x2) / 2;
      return r.dir === "v" && x > rule.x1 + size && x < rule.x2 - size && r.y1 < y - size && r.y2 > y + size;
    });
    if (crossed) continue;
    at.add(start.at);
  }
  if (at.size === 0) return segments;
  const out: Segment[] = [];
  segments.forEach((s, k) => {
    if (at.has(k)) out.push(separatorOf(s.page));
    out.push(s);
  });
  return out;
}

// ── Code listings ───────────────────────────────────────────────────────────

// One listing line: indentation and internal runs of spaces rebuilt from the
// glyph advance, so the code reads as typed.
function codeLineText(line: Line, left: number, advance: number): string {
  const cols = (px: number) => Math.max(0, Math.round(px / advance));
  let text = " ".repeat(cols(line.x - left));
  let prevEnd: number | null = null;
  for (const item of line.items) {
    if (prevEnd !== null) {
      const gap = item.x - prevEnd;
      if (gap > advance * 0.4) text += " ".repeat(Math.max(1, cols(gap)));
    }
    text += item.str;
    prevEnd = item.x + item.w;
  }
  return text.replace(/\s+$/, "");
}

// Code listing: consecutive monospace lines, blank lines included, are one
// CODE block with one line per PDF line and the indentation the glyph
// offsets give.
// A listing's empty line keeps its line number: a line that is only the
// number after the line above's, set smaller than the code, between two
// code lines (parse loop finding: a LaTeX package's manual numbers every
// line of an example, and each empty line, "3" alone, cut its listing in
// two and read as a paragraph).
function bareLineNumber(line: Line, above: Line, below: Line | undefined): boolean {
  const number = /^\s*(\d{1,4})\s*$/.exec(line.text);
  const before = /^\s*(\d{1,4})\s/.exec(above.text);
  const code = above.items.filter((it) => it.mono && it.str.trim());
  return (
    number !== null &&
    before !== null &&
    Number(number[1]) === Number(before[1]) + 1 &&
    below !== undefined &&
    isMonoLine(below) &&
    code.length > 0 &&
    line.size < Math.min(...code.map((it) => it.size)) * 0.85
  );
}

function readCodeListing(lines: Line[], i: number, ctx: PageContext, runOf: number[]): Step | null {
  const line = lines[i];
  if (!isMonoLine(line)) return null;
  const run: Line[] = [line];
  let j = i + 1;
  while (j < lines.length) {
    const next = lines[j];
    const gap = run[run.length - 1].y - next.y;
    const code = isMonoLine(next) || bareLineNumber(next, run[run.length - 1], lines[j + 1]);
    if (!code || runOf[j] !== -1 || gap < 0 || gap > next.size * ctx.leading * 3.4) break;
    run.push(next);
    j++;
  }
  const advances = run.flatMap((l) => l.items.filter((it) => it.mono && it.str.length > 0).map((it) => it.w / it.str.length));
  const advance = median(advances) || line.size * 0.6;
  const left = Math.min(...run.map((l) => l.x));
  const rows: string[] = [];
  run.forEach((l, k) => {
    if (k > 0) {
      const blank = Math.round((run[k - 1].y - l.y) / (Math.max(l.size, run[k - 1].size) * ctx.leading)) - 1;
      for (let b = 0; b < Math.min(2, blank); b++) rows.push("");
    }
    rows.push(codeLineText(l, left, advance));
  });
  return { segments: [{ type: "CODE", text: rows.join("\n"), page: line.page, runs: [], ...geom(run) }], next: j };
}

// ── Split lines ─────────────────────────────────────────────────────────────

// The document's first line in two parts far apart, one at each side (a
// journal's "一般論文" at the left, a boxed "Peer-Reviewed" at the right):
// two lines, the second flush right, not one paragraph that joins them.
function readSplitLine(lines: Line[], i: number): Step | null {
  const line = lines[i];
  if (i !== 0 || line.page !== 0 || line.cells.length !== 2 || line.table) return null;
  const [a, b] = line.cells;
  const aEnd = Math.max(...line.items.filter((it) => it.x < b.x - 0.5).map((it) => it.x + it.w));
  if (!Number.isFinite(aEnd) || b.x - aEnd < (line.xEnd - line.x) / 3) return null;
  const { box, ...rest } = geom([line]);
  const part = (cell: Cell, x1: number, x2: number, html?: string): Segment => ({
    type: "PARAGRAPH",
    text: cell.text,
    runs: cell.runs,
    page: line.page,
    ...(html ? { html } : {}),
    ...rest,
    box: { ...box, x1, x2 },
  });
  const right = line.xEnd >= Math.max(...lines.map((l) => l.xEnd)) - line.size;
  return { segments: [part(a, line.x, aEnd), part(b, b.x, line.xEnd, right ? '<p class="right"></p>' : undefined)], next: i + 1 };
}

// ── Label lines ─────────────────────────────────────────────────────────────

// Label line: the label and the entry's title read as one paragraph; the
// entry's body follows as its own blocks.
function readLabelLine(lines: Line[], i: number, ctx: PageContext): Step | null {
  const line = lines[i];
  if (!isLabelLine(line, ctx)) return null;
  return { segments: [{ type: "PARAGRAPH", ...lineAsPart(line), page: line.page, ...geom([line]) }], next: i + 1 };
}
