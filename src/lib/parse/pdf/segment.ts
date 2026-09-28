// A page's lines cut into segments. Readers are tried in this order:
// contents lists, tables, code listings, label lines, headings (headings.ts),
// lists (lists.ts), and paragraphs (paragraphs.ts). Each takes the lines from
// one index on and says where it stopped; the first that takes the line
// makes its segments.

import { TOC_ENTRY_RE, TOC_LABEL_RE, TOC_TAIL_RE, isContentsEntry, readContentsEntries, twoColumnList } from "@/lib/parse/pdf/contents";
import { geom, median } from "@/lib/parse/pdf/geometry";
import { readHeading } from "@/lib/parse/pdf/headings";
import { closeLists, joinMarkerCells, readList } from "@/lib/parse/pdf/lists";
import { readParagraph } from "@/lib/parse/pdf/paragraphs";
import { tableFromRegion } from "@/lib/parse/pdf/ruled";
import { findTableRuns, isLabelLine, tableFromRun } from "@/lib/parse/pdf/tables";
import { isMonoLine, lineAsPart } from "@/lib/parse/pdf/text";
import type { Line, PageContext, Segment, Step } from "@/lib/parse/pdf/types";

// ── Page segmentation ───────────────────────────────────────────────────────

// A contents list that runs past the page break continues on the next page.
let tocCarry = false;

const PROOF_END_RE = /^[□■∎]$/;

export function segmentPage(pageLines: Line[], ctx: PageContext): Segment[] {
  const segments: Segment[] = [];
  const lines = joinMarkerCells(pageLines);
  // A document's first page opens no list the last document left open.
  if (lines[0]?.page === 0) closeLists();
  const runOf = findTableRuns(lines, ctx);
  let tocMode = tocCarry && lines.length > 0 && TOC_ENTRY_RE.test(lines[0].text) && TOC_TAIL_RE.test(lines[0].text);
  tocCarry = false;
  // Where each reader's segments begin: its first line and its first segment.
  const starts: { line: number; at: number }[] = [];
  let i = 0;

  while (i < lines.length) {
    starts.push({ line: i, at: segments.length });
    const line = lines[i];

    // Contents label ("CONTENTS", "INSIDE"): the entries that follow become a
    // linked list, not headings.
    if (line.cells.length === 1 && TOC_LABEL_RE.test(line.text.trim())) {
      segments.push({ type: "PARAGRAPH", text: line.text.trim(), page: line.page, runs: line.runs, ...geom([line]) });
      tocMode = true;
      i++;
      continue;
    }

    if (tocMode && isContentsEntry(line)) {
      const step = readContentsEntries(lines, i);
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
      last.text = `${last.text} ${line.text.trim()}`;
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

    const step =
      readCodeListing(lines, i, ctx, runOf) ??
      readRuleLine(lines, i) ??
      readLabelLine(lines, i, ctx) ??
      readHeading(lines, i, ctx, runOf) ??
      readList(lines, i, ctx, runOf) ??
      readParagraph(lines, i, ctx, runOf);
    if (step.segments.some((s) => s.type === "HEADING")) closeLists();
    segments.push(...step.segments);
    i = step.next;
  }
  return withDrawnSeparators(segments, starts, lines, ctx, runOf);
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
// lines of each other, and a separator stands alone.
function withDrawnSeparators(
  segments: Segment[],
  starts: { line: number; at: number }[],
  lines: Line[],
  ctx: PageContext,
  runOf: number[],
): Segment[] {
  const at = new Set<number>();
  for (const rule of ctx.drawing.rules) {
    if (rule.dir !== "h") continue;
    const y = (rule.y1 + rule.y2) / 2;
    const start = starts.find((s) => s.line > 0 && lines[s.line - 1].y > y && lines[s.line].y < y);
    if (!start || runOf[start.line - 1] !== -1 || runOf[start.line] !== -1) continue;
    const above = lines[start.line - 1];
    const below = lines[start.line];
    // A ruled table taken out of the flow is one line with no cells: its
    // own rules fall between it and the line under it.
    if (above.cells.length === 0 || below.cells.length === 0) continue;
    // A chart's axis between its labels: small words on both sides.
    if (Math.min(above.size, below.size) < ctx.bodySize * 0.9 || Math.max([...above.text].length, [...below.text].length) < 30) continue;
    const size = Math.max(above.size, below.size);
    const left = Math.min(above.x, below.x);
    const right = Math.max(above.xEnd, below.xEnd);
    if (rule.x2 - rule.x1 < Math.max(size * 10, (right - left) * 0.5) || rule.x2 < left || rule.x1 > right) continue;
    if (above.yMin - y < size * 0.4 || y - below.yMax < size * 0.85) continue;
    const framed = ctx.drawing.rules.some((r) => {
      const d = Math.abs((r.y1 + r.y2) / 2 - y);
      // A double rule's second stroke is the same separator.
      return r.dir === "h" && d > size * 0.5 && d < size * ctx.leading * 3 && r.x1 < rule.x2 && r.x2 > rule.x1;
    });
    if (framed) continue;
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
function readCodeListing(lines: Line[], i: number, ctx: PageContext, runOf: number[]): Step | null {
  const line = lines[i];
  if (!isMonoLine(line)) return null;
  const run: Line[] = [line];
  let j = i + 1;
  while (j < lines.length) {
    const next = lines[j];
    const gap = run[run.length - 1].y - next.y;
    if (!isMonoLine(next) || runOf[j] !== -1 || gap < 0 || gap > next.size * ctx.leading * 3.4) break;
    run.push(next);
    j++;
  }
  const advances = run.flatMap((l) => l.items.filter((it) => it.mono && it.str.length > 0).map((it) => it.w / it.str.length));
  const advance = median(advances) || line.size * 0.6;
  const left = Math.min(...run.map((l) => l.x));
  const rows: string[] = [];
  run.forEach((l, k) => {
    if (k > 0) {
      const blank = Math.round((run[k - 1].y - l.y) / (l.size * ctx.leading)) - 1;
      for (let b = 0; b < Math.min(2, blank); b++) rows.push("");
    }
    rows.push(codeLineText(l, left, advance));
  });
  return { segments: [{ type: "CODE", text: rows.join("\n"), page: line.page, runs: [], ...geom(run) }], next: j };
}

// ── Label lines ─────────────────────────────────────────────────────────────

// Label line: the label and the entry's title read as one paragraph; the
// entry's body follows as its own blocks.
function readLabelLine(lines: Line[], i: number, ctx: PageContext): Step | null {
  const line = lines[i];
  if (!isLabelLine(line, ctx)) return null;
  return { segments: [{ type: "PARAGRAPH", text: lineAsPart(line).text, page: line.page, runs: line.runs, ...geom([line]) }], next: i + 1 };
}
