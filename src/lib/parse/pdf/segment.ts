// A page's lines cut into segments, tried in this order: contents lists,
// tables, code listings, label lines, headings, lists, and paragraphs.

import { TOC_ENTRY_RE, TOC_LABEL_RE, TOC_TAIL_RE, tocEntryPart, twoColumnList } from "@/lib/parse/pdf/contents";
import { geom, lineMathShare, median } from "@/lib/parse/pdf/geometry";
import { HEADING_NUM_STRICT_RE, LETTER_HEADING_RE } from "@/lib/parse/pdf/headings";
import { findTableRuns, isLabelLine, tableFromRun } from "@/lib/parse/pdf/tables";
import {
  TextBuilder,
  boldShare,
  endsBold,
  fillsMargin,
  isMonoLine,
  joinGroup,
  lineAsPart,
  startsWithBoldLead,
} from "@/lib/parse/pdf/text";
import type { Line, PageContext, Run, Segment } from "@/lib/parse/pdf/types";

// ── Page segmentation ───────────────────────────────────────────────────────

export const BULLET_RE = /^\s*([•▪◦‣●·*-]|\d{1,2}[.)]|\([a-z\d]{1,3}\)|[ivx]{1,4}[.)])\s+/i;
const GLYPH_BULLET_RE = /^\s*[•▪◦‣●·*-]\s+/;

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

// The column's right edge near a band of lines [from, to): the widest prose
// line (single cell, longer than 40 chars, in the same column) within four
// lines before or after the band. A band's own longest line always reads as
// wrapped against itself.
function proseEdge(lines: Line[], from: number, to: number): number {
  let edge = 0;
  const x = lines[from].x;
  const size = lines[from].size;
  for (let k = Math.max(0, from - 4); k < Math.min(lines.length, to + 4); k++) {
    if (k >= from && k < to) continue;
    const l = lines[k];
    if (l.cells.length !== 1 || l.text.length <= 40) continue;
    if (Math.abs(l.x - x) > size * 6) continue;
    if (l.xEnd > edge) edge = l.xEnd;
  }
  return edge;
}

function isIndented(line: Line, ctx: PageContext): boolean {
  return (
    line.x > ctx.columnLeft + line.size * 0.6 &&
    line.x < ctx.columnLeft + line.size * 6 &&
    line.cells.length === 1
  );
}

// A contents list that runs past the page break continues on the next page.
let tocCarry = false;

// Two lines pushed apart by tall glyphs: an inline fraction's denominator on
// the upper line and a sum sign on the lower leave the baselines farther
// apart than the text leading while the glyphs nearly touch (TeX's lineskip).
// That gap is no paragraph or item gap (import compare loop finding: an
// exercise's item split at such a line).
function pushedApart(prev: Line, next: Line): boolean {
  const size = Math.max(prev.size, next.size);
  const deep = prev.yMin < prev.y - size * 0.3;
  const tall = next.yMax > next.y + size * 0.6;
  return (deep || tall) && prev.yMin - next.yMax <= size * 0.45;
}

// A display equation's line: mostly math glyphs, set in from the column edge.
function isDisplayMathLine(line: Line, ctx: PageContext): boolean {
  return lineMathShare(line) >= 0.4 && line.x > ctx.columnLeft + line.size * 2;
}

export function segmentPage(lines: Line[], ctx: PageContext): Segment[] {
  const segments: Segment[] = [];
  const body = ctx.bodySize;
  const runOf = findTableRuns(lines, ctx);
  let tocMode = tocCarry && lines.length > 0 && TOC_ENTRY_RE.test(lines[0].text) && TOC_TAIL_RE.test(lines[0].text);
  tocCarry = false;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const single = line.cells.length === 1;

    // Contents label ("CONTENTS", "INSIDE"): the entries that follow become a
    // linked list, not headings.
    if (single && TOC_LABEL_RE.test(line.text.trim())) {
      segments.push({ type: "PARAGRAPH", text: line.text.trim(), page: line.page, runs: line.runs, ...geom([line]) });
      tocMode = true;
      i++;
      continue;
    }

    if (tocMode && (line.cells.length <= 2 || TOC_TAIL_RE.test(line.text)) && TOC_ENTRY_RE.test(line.text)) {
      const builder = new TextBuilder();
      const entries: { start: number; end: number; num: number }[] = [];
      let j = i;
      while (
        j < lines.length &&
        (lines[j].cells.length <= 2 || TOC_TAIL_RE.test(lines[j].text)) &&
        TOC_ENTRY_RE.test(lines[j].text)
      ) {
        const entry = lines[j];
        const start = builder.text.length === 0 ? 0 : builder.text.length + 1;
        const part = tocEntryPart(entry);
        builder.append(part, "\n");
        const m = TOC_ENTRY_RE.exec(entry.text);
        if (m && /^\d+$/.test(m[1])) entries.push({ start, end: start + part.text.length, num: Number(m[1]) });
        j++;
      }
      segments.push({
        type: "LIST",
        text: builder.text,
        page: line.page,
        runs: builder.runs,
        tocEntries: entries,
        ...geom(lines.slice(i, j)),
      });
      tocMode = false;
      tocCarry = j >= lines.length;
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

    // Code listing: consecutive monospace lines, blank lines included, are
    // one CODE block with one line per PDF line and the indentation the
    // glyph offsets give.
    if (isMonoLine(line)) {
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
      segments.push({ type: "CODE", text: rows.join("\n"), page: line.page, runs: [], ...geom(run) });
      i = j;
      continue;
    }

    // Label line: the label and the entry's title read as one paragraph; the
    // entry's body follows as its own blocks.
    if (isLabelLine(line, ctx)) {
      segments.push({ type: "PARAGRAPH", text: lineAsPart(line).text, page: line.page, runs: line.runs, ...geom([line]) });
      i++;
      continue;
    }

    // Heading run: larger than body. Wrapped heading lines merge; a merged run
    // that reads as prose (ends in a period, runs long) is a lead paragraph.
    // A line set large by a math glyph (an integral sign with its limit) is
    // part of an equation, not a heading.
    if (single && line.size > body * 1.14 && lineMathShare(line) < 0.5) {
      const run: Line[] = [line];
      let j = i + 1;
      while (j < lines.length) {
        const next = lines[j];
        const centered =
          Math.abs((next.x + next.xEnd) / 2 - (line.x + line.xEnd) / 2) <= 12 && next.x > ctx.columnLeft + 12;
        if (
          runOf[j] !== -1 ||
          next.cells.length !== 1 ||
          Math.abs(next.size - line.size) > 0.5 ||
          run[run.length - 1].y - next.y > line.size * 1.7 ||
          (Math.abs(next.x - line.x) > 12 && !centered)
        )
          break;
        run.push(next);
        j++;
      }
      const { text, runs } = joinGroup(run);
      const flat = text.replace(/\n/g, " ");
      const prose = /[.!?]$/.test(flat.trim()) && flat.length > 80;
      if (prose || flat.trim().length <= 1) {
        segments.push({ type: "PARAGRAPH", text: flat, page: line.page, runs, ...geom(run) });
      } else {
        const m = /^(\d{1,2})[.)]\s/.exec(flat);
        segments.push({
          type: "HEADING",
          text: flat,
          page: line.page,
          rawSize: line.size,
          runs,
          headingNum: m ? Number(m[1]) : undefined,
          ...geom(run),
        });
      }
      i = j;
      continue;
    }

    // Numbered heading at body size: "3.1 Results" — short, isolated, and
    // bold, or set larger than body, or in a document with no bold flags at all.
    const lineBold = boldShare(line.runs, line.text.length) > 0.6;
    if (
      single &&
      (HEADING_NUM_STRICT_RE.test(line.text) || (lineBold && LETTER_HEADING_RE.test(line.text))) &&
      !BULLET_RE.test(line.text) &&
      !TOC_TAIL_RE.test(line.text) &&
      line.text.length < 120 &&
      !/[.,;:]$/.test(line.text) &&
      line.size >= body * 0.98 &&
      (lineBold ||
        line.size >= body * 1.05 ||
        !ctx.hasBold ||
        /^(\d{1,2}|[A-Z])(\.\d{1,2})+/.test(line.text))
    ) {
      // A heading wrapped to a second bold line at the same size and leading.
      const run: Line[] = [line];
      let j = i + 1;
      while (
        j < lines.length &&
        run.length < 3 &&
        lineBold &&
        runOf[j] === -1 &&
        lines[j].cells.length === 1 &&
        Math.abs(lines[j].size - line.size) <= 0.5 &&
        run[run.length - 1].y - lines[j].y <= line.size * ctx.leading * 1.3 &&
        boldShare(lines[j].runs, lines[j].text.length) > 0.6 &&
        !HEADING_NUM_STRICT_RE.test(lines[j].text)
      ) {
        run.push(lines[j]);
        j++;
      }
      const last = run[run.length - 1];
      const below = lines[j];
      const isolated = !below || last.y - below.y > last.size * ctx.leading * 1.15;
      if (isolated) {
        const { text, runs } = joinGroup(run);
        const flat = text.replace(/\n/g, " ");
        const m = /^(\d{1,2})[.)]\s/.exec(flat);
        segments.push({
          type: "HEADING",
          text: flat,
          page: line.page,
          rawSize: line.size,
          runs,
          headingNum: m ? Number(m[1]) : undefined,
          ...geom(run),
        });
        i = j;
        continue;
      }
    }
    // An unnumbered heading at body size: one short line, wholly bold or
    // opening with a bold lead ("Problem 1: Risk-neutral pricing"), set apart
    // by a gap above and below. A caps title may end with a period.
    const letters = line.text.replace(/[^\p{L}]/gu, "");
    const capsShare = letters.length > 0 ? letters.replace(/[^\p{Lu}]/gu, "").length / letters.length : 0;
    // The lead is a label: it ends with a colon or a period ("Problem 3:").
    const boldLead =
      startsWithBoldLead(line) &&
      /[:.]\s*$/.test(line.text.slice(line.runs[0].start, line.runs[0].end));
    if (
      single &&
      (lineBold || boldLead) &&
      (boldShare(line.runs, line.text.length) > 0.9 || boldLead) &&
      line.text.length < 90 &&
      line.text.length > 2 &&
      !BULLET_RE.test(line.text) &&
      // A contents entry ends in leader dots and a page number; a title may
      // end in a number of its own ("Risk-neutral pricing 1").
      !/(?:\s*\.){3,}\s*\d{1,4}\s*$/.test(line.text) &&
      (!/[.,;:]$/.test(line.text.trim()) || (boldLead && capsShare >= 0.6 && /\.$/.test(line.text.trim()))) &&
      line.size >= body * 0.98 &&
      line.size <= body * 1.14
    ) {
      const above = lines[i - 1];
      const below = lines[i + 1];
      const gapAbove = !above || above.y - line.y > line.size * ctx.leading * 1.3;
      const gapBelow = !below || line.y - below.y > line.size * ctx.leading * 1.15;
      if (gapAbove && gapBelow && below) {
        segments.push({
          type: "HEADING",
          text: line.text,
          page: line.page,
          rawSize: line.size,
          runs: line.runs,
          ...geom([line]),
        });
        i++;
        continue;
      }
    }

    // List run: bullet-marked lines, or an indented band whose gaps split it
    // into items (bullet glyphs are often vector art, not text).
    const bulletStart = BULLET_RE.test(line.text) && single && line.size <= body * 1.15;
    // A first-line indent (LaTeX's parindent): an unmarked indented line whose
    // next line is back at the column's left edge at text leading is the
    // first line of that paragraph, not an item (import compare loop finding:
    // every indented paragraph split after its first line).
    const after = lines[i + 1];
    const firstLineIndent =
      single &&
      !bulletStart &&
      isIndented(line, ctx) &&
      line.x - ctx.columnLeft <= line.size * 3.2 &&
      after !== undefined &&
      runOf[i + 1] === -1 &&
      after.cells.length === 1 &&
      Math.abs(after.x - ctx.columnLeft) <= 3 &&
      line.y - after.y > 0 &&
      line.y - after.y <= after.size * ctx.leading * 1.3 &&
      Math.abs(after.size - line.size) <= 0.6 &&
      !BULLET_RE.test(after.text);
    // Text inside a framed box sits at the frame's inset: an indent that is
    // the box's, not a list's (import compare loop finding: a verbatim
    // briefing box read as one long list).
    const indentStart =
      !firstLineIndent &&
      isIndented(line, ctx) &&
      line.size <= body * 1.15 &&
      line.size >= body * 0.8 &&
      !isBoxedLine(line, ctx);
    if (bulletStart || indentStart) {
      const run: Line[] = [line];
      let j = i + 1;
      while (j < lines.length) {
        const next = lines[j];
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
      // At the top of a page, an unmarked first group before marked items is
      // the tail of the previous page's last item, not an item: emit it as a
      // paragraph so the cross-page merge can finish that item.
      if (i === 0 && items.length >= 2 && !BULLET_RE.test(items[0].text) && BULLET_RE.test(items[1].text)) {
        const tail = items.shift()!;
        segments.push({ type: "PARAGRAPH", text: tail.text, page: line.page, runs: tail.runs, ...geom(tail.lines) });
      }
      // Numbered lead-ins over flush-left paragraphs are prose, not a list:
      // when unmarked groups sit between marked ones at the column edge, every
      // group is its own paragraph.
      if (bulletStart && !indentStart && !items.every((item) => BULLET_RE.test(item.text))) {
        for (const item of items) {
          segments.push({ type: "PARAGRAPH", text: item.text, page: line.page, runs: item.runs, ...geom(item.lines) });
        }
        i = j;
        continue;
      }
      const glyphItem = items.length === 1 && GLYPH_BULLET_RE.test(items[0].text);
      if (items.length >= 2 || glyphItem) {
        const builder = new TextBuilder();
        for (const item of items) {
          // A bullet glyph in the text becomes the list's own marker; a
          // number stays (its value is content).
          const glyph = GLYPH_BULLET_RE.exec(item.text);
          const cut = glyph ? glyph[0].length : 0;
          const marker = BULLET_RE.test(item.text) && !glyph ? "" : "- ";
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
        segments.push({ type: "LIST", text: builder.text, page: line.page, runs: builder.runs, ...geom(run) });
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
        ...geom(run),
      });
      i = j;
      continue;
    }

    // Paragraph group: vertically continuous same-size lines in one column.
    // A hanging indent (a reference entry, a glossary term) indents every
    // line after the first: the second line may step in by up to three ems
    // when the first line breaks mid-sentence.
    const group: Line[] = [line];
    const colEdge = proseEdge(lines, i, i);
    let j = i + 1;
    while (j < lines.length) {
      const next = lines[j];
      const prev = group[group.length - 1];
      const gap = prev.y - next.y;
      const prevTerminal = /[.!?:]["'”]?$/.test(prev.text.trim());
      // A hanging indent (a reference entry, a glossary term): the second
      // line steps in by one to three ems under a first line that wrapped —
      // it ran to the margin, or broke mid-sentence.
      const hanging =
        group.length === 1 &&
        !isIndented(prev, ctx) &&
        next.x > prev.x + next.size * 0.8 &&
        next.x <= prev.x + next.size * 3.5 &&
        !BULLET_RE.test(next.text) &&
        gap <= next.size * ctx.leading * 1.3 &&
        (!prevTerminal || /^[a-z0-9(]/.test(next.text) || prev.xEnd > colEdge - prev.size * 1.5);
      // A wrapped line whose stretched word gaps read as cells is still one
      // line of prose when no table run claims it.
      const stretched =
        next.cells.length > 1 &&
        next.cells.length <= 3 &&
        Math.abs(next.x - prev.x) <= next.size * 0.5 &&
        next.cells.every((c) => c.text.length > 0);
      if (
        runOf[j] !== -1 ||
        (next.cells.length !== 1 && !stretched) ||
        gap < 0 ||
        gap > next.size * 1.9 ||
        // The paragraph gap: looser than the text leading by a third.
        (gap > next.size * ctx.leading * 1.3 && !pushedApart(prev, next)) ||
        Math.abs(next.size - prev.size) > 0.6 ||
        (next.x > prev.x + next.size * 1.1 && !hanging) ||
        (next.x < prev.x - next.size * 1.1 && !(group.length === 1 && firstLineIndent)) ||
        next.size > body * 1.14 ||
        (tocMode && TOC_ENTRY_RE.test(next.text)) ||
        TOC_LABEL_RE.test(next.text.trim()) ||
        (isIndented(next, ctx) && !isIndented(prev, ctx) && !hanging) ||
        // An equation's line and a text line never share a paragraph: the
        // label under an underbrace joined the formula and diluted its math
        // share below the equation threshold (import compare loop finding).
        isDisplayMathLine(prev, ctx) !== isDisplayMathLine(next, ctx) ||
        // A marker opening the next line starts an item — a glyph bullet
        // always, a number or a "(7)" only under a line that ended short of
        // the column edge or with a sentence: "(7) Weight-space…" at a line
        // start inside a justified paragraph is text (import compare loop
        // finding).
        (BULLET_RE.test(next.text) &&
          !BULLET_RE.test(prev.text) &&
          (GLYPH_BULLET_RE.test(next.text) || prev.xEnd < colEdge - prev.size * 1.5)) ||
        // "Setup." after a sentence end opens the next paragraph, and so does a
        // bold label under a line that stopped short of the column edge
        // ("Category. mechanism" over "Summary. …" in a boxed entry).
        (startsWithBoldLead(next) &&
          !endsBold(prev) &&
          (prevTerminal || prev.xEnd < colEdge - prev.size * 2)) ||
        // A wholly bold line that stops short of the column edge is a title
        // line: the regular text under it is its own block.
        (boldShare(prev.runs, prev.text.length) > 0.9 &&
          prev.text.length > 2 &&
          prev.xEnd < colEdge - prev.size * 2 &&
          boldShare(next.runs, next.text.length) < 0.5)
      )
        break;
      group.push(next);
      j++;
    }
    const { text, runs } = joinGroup(group, true);
    const monoChars = runs.filter((r) => r.mono).reduce((n, r) => n + (r.end - r.start), 0);
    const type = text.length > 0 && monoChars / text.length > 0.85 ? "CODE" : "PARAGRAPH";
    segments.push({ type, text, page: line.page, runs, ...geom(group) });
    i = j;
  }
  return segments;
}
