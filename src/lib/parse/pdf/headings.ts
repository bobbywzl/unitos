// Headings: which lines are a heading, what a numbered heading looks like,
// and each heading's level.

import { TOC_TAIL_RE } from "@/lib/parse/pdf/contents";
import { CAPTION_RE } from "@/lib/parse/pdf/figures";
import { geom, lineMathShare } from "@/lib/parse/pdf/geometry";
import { charCount } from "@/lib/parse/pdf/glyphs";
import { BULLET_RE, isGlyphMarker, readMarker } from "@/lib/parse/pdf/markers";
import { isCentered, readParagraph } from "@/lib/parse/pdf/paragraphs";
import { boldShare, escapeHtml, joinGroup, startsWithBoldLead } from "@/lib/parse/pdf/text";
import type { Line, PageContext, Run, Segment, Step } from "@/lib/parse/pdf/types";

// Numbered heading: the number must close with "." or ")" or dot into a
// sub-number — "3.1 Results" and "1. Summary" match, "23 advertisers" does not.
// "3.1 Results", "2. Background", and the bare "2 Background" (ACL style).
// The word after the number starts uppercase — a body line rarely does.
export const HEADING_NUM_STRICT_RE = /^(\d{1,2}((\.\d{1,2})+\.?|[.)])?|[A-Z](\.\d{1,2})+\.?)\s+[\p{Lu}\p{Lo}]/u;
// An appendix section: "A Benchmarks and audits" — a letter alone, bold.
export const LETTER_HEADING_RE = /^[A-Z]\s+[\p{Lu}]/u;
// The number of a heading and its depth: "3" → 1, "3.2" → 2, "A.1" → 2.
const HEADING_NUMBER_RE = /^(\d{1,2}|[A-Z])((?:\.\d{1,2})*)\.?[.)]?\s/;
function headingDepth(text: string): number | null {
  const m = HEADING_NUMBER_RE.exec(text);
  if (!m) return null;
  return 1 + (m[2].match(/\./g)?.length ?? 0);
}
// A run-in heading's lead: a number with a sub-number, words, a period
// ("3.2.1. Two examples.").
const RUN_IN_RE = /^(?:\d{1,2}|[A-Z])(?:\.\d{1,2})+\.?\s+\S.*\.$/u;

// Share of a line's characters set bold or in small caps: a heading's look.
function styledShare(line: Line): number {
  if (line.text.length === 0) return 0;
  let styled = 0;
  for (const r of line.runs) if (r.bold || r.smallCaps) styled += r.end - r.start;
  return styled / line.text.length;
}

function capsShare(text: string): number {
  const letters = text.replace(/[^\p{L}]/gu, "");
  return letters.length > 0 ? letters.replace(/[^\p{Lu}]/gu, "").length / letters.length : 0;
}

// A rule drawn in glyphs under a title joins its line: "…UNITED
// STATES_________________". A heading never ends in a blank to fill.
const RULE_TAIL_RE = /\s*[_—–-]{4,}\s*$/;

function headingOf(run: Line[], raw: string, rawRuns: Run[]): Segment {
  const text = raw.replace(RULE_TAIL_RE, "");
  const runs = rawRuns.map((r) => ({ ...r, end: Math.min(r.end, text.length) })).filter((r) => r.end > r.start);
  const m = /^(\d{1,2})[.)]\s/.exec(text);
  return {
    type: "HEADING",
    text,
    page: run[0].page,
    rawSize: run[0].size,
    runs,
    headingNum: m ? Number(m[1]) : undefined,
    ...geom(run),
  };
}

// ── Heading lines ───────────────────────────────────────────────────────────

// A heading at the lines from i: a run set larger than the body, a numbered
// lead run into its paragraph, a numbered heading at body size, an IEEE
// section's label and title, short bold lines set apart, or a part's
// numeral alone.
export function readHeading(lines: Line[], i: number, ctx: PageContext, runOf: number[]): Step | null {
  return (
    largeHeading(lines, i, ctx, runOf) ??
    runInHeading(lines, i, ctx, runOf) ??
    numberedHeading(lines, i, ctx, runOf) ??
    sectionHeading(lines, i, ctx) ??
    boldHeading(lines, i, ctx, runOf) ??
    partHeading(lines, i, ctx)
  );
}

// A part's numeral or letter alone on a centered line, set apart above and
// below: an opinion's "I", "II", "A" (read as a paragraph of one letter).
function partHeading(lines: Line[], i: number, ctx: PageContext): Step | null {
  const line = lines[i];
  if (line.cells.length !== 1 || !/^(?:[IVX]{1,5}|[A-Z])\.?$/.test(line.text.trim()) || !isCentered(lines, i, ctx)) return null;
  const leading = line.size * ctx.leading;
  const above = lines[i - 1];
  const below = lines[i + 1];
  if (!above || !below || above.y - line.y <= leading * 1.3 || line.y - below.y <= leading * 1.15) return null;
  return { segments: [headingOf([line], line.text.trim(), line.runs)], next: i + 1 };
}

// Heading run: larger than body. Wrapped heading lines merge; a merged run
// that reads as prose (ends in a period, runs long) is a lead paragraph.
// A line set large by a math glyph (an integral sign with its limit) is
// part of an equation, not a heading, and a bulleted line is an item (a
// slide's bullets, set larger than the deck's body, read as headings).
function largeHeading(lines: Line[], i: number, ctx: PageContext, runOf: number[]): Step | null {
  const line = lines[i];
  if (line.cells.length !== 1 || line.size <= ctx.bodySize * 1.14 || lineMathShare(line) >= 0.5) return null;
  const marker = readMarker(line);
  if (marker && isGlyphMarker(marker)) return null;
  // An OCR layer's body lines jitter past 1.14 times the body's size: below
  // 1.3 times, a heading there is set apart from the lines around it.
  const ocr = ctx.ocr;
  if (ocr && line.size <= ctx.bodySize * 1.3) {
    const leading = ctx.bodySize * ctx.leading * 1.3;
    const above = lines[i - 1];
    const below = lines[i + 1];
    if (above && below && above.y - line.y <= leading && line.y - below.y <= leading) return null;
  }
  const run: Line[] = [line];
  let j = i + 1;
  while (j < lines.length) {
    const next = lines[j];
    const centered =
      Math.abs((next.x + next.xEnd) / 2 - (line.x + line.xEnd) / 2) <= 12 && next.x > ctx.columnLeft + 12;
    if (
      runOf[j] !== -1 ||
      next.cells.length !== 1 ||
      Math.abs(next.size - line.size) > (ocr ? line.size * 0.2 : 0.5) ||
      run[run.length - 1].y - next.y > line.size * 1.7 ||
      (Math.abs(next.x - line.x) > 12 && !centered)
    )
      break;
    run.push(next);
    j++;
  }
  const { text, runs } = joinGroup(run);
  const flat = text.replace(/\n/g, " ");
  const prose = /[.!?]$/.test(flat.trim()) && [...flat].length > 80;
  // A quotation set large, in its quote marks, is a quote (a slide's 20 pt
  // quotation read as a heading).
  const quoted = /^[“"‘]/.test(flat.trim()) && /(?:[”"’][.!?]?|[.!?][”"’])$/.test(flat.trim());
  if (prose || quoted || [...flat.trim()].length <= 1) {
    const html = quoted ? { html: '<p class="quote"></p>' } : {};
    return { segments: [{ type: "PARAGRAPH", text: flat, ...html, page: line.page, runs, ...geom(run) }], next: j };
  }
  return { segments: [headingOf(run, flat, runs)], next: j };
}

// The end of a line's lead set bold or in small caps: its styled runs from
// the line's start, through short runs of other glyphs between them (a
// formula's letters in a bold title).
function styledLeadEnd(line: Line): number {
  let end = 0;
  const runs = line.runs;
  for (let k = 0; k < runs.length; k++) {
    const r = runs[k];
    if (line.text.slice(end, r.start).trim() !== "") break;
    if (r.bold || r.smallCaps) {
      end = r.end;
      continue;
    }
    const short = charCount(line.text.slice(r.start, r.end)) <= 3;
    const styledAfter = runs[k + 1] !== undefined && (runs[k + 1].bold || runs[k + 1].smallCaps);
    if (!short || !styledAfter) break;
  }
  return end;
}

// A run-in heading: a paragraph that opens with a numbered lead set bold or
// in small caps and closed by a period ("3.2.1. Two examples. We state …",
// amsbook's subsections). The lead is a heading; the words after it open
// the paragraph (the lead read as the paragraph's first words before).
function runInHeading(lines: Line[], i: number, ctx: PageContext, runOf: number[]): Step | null {
  const line = lines[i];
  if (line.cells.length !== 1 || line.size > ctx.bodySize * 1.14) return null;
  const end = styledLeadEnd(line);
  const lead = line.text.slice(0, end).trim();
  if (!RUN_IN_RE.test(lead) || [...lead].length > 120) return null;
  const heading = headingOf([line], lead, line.runs.filter((r) => r.start < end).map((r) => ({ ...r, end: Math.min(r.end, lead.length) })));
  const rest = line.text.slice(end);
  const cut = end + (rest.length - rest.trimStart().length);
  if (cut >= line.text.length) return { segments: [heading], next: i + 1 };
  // The paragraph's first line: the line after the lead, where it stood.
  const text = line.text.slice(cut);
  const runs = line.runs.filter((r) => r.end > cut).map((r) => ({ ...r, start: Math.max(0, r.start - cut), end: r.end - cut }));
  const first: Line = { ...line, text, runs, cells: [{ x: line.x, text, runs }] };
  const paragraph = readParagraph([...lines.slice(0, i), first, ...lines.slice(i + 1)], i, ctx, runOf);
  return { segments: [heading, ...paragraph.segments], next: paragraph.next };
}

// IEEE's section headings: a roman numeral and a title in capitals ("II.
// RELATED WORK"), and a letter and a title in italics ("A. Efficient
// attention"), each on a line of its own over its section's first
// paragraph. They read as a paragraph, and as a list item that took the
// section's first paragraph.
const ROMAN_SECTION_RE = /^[IVX]{1,5}\.\s+\p{Lu}/u;
const LETTER_SECTION_RE = /^[A-Z]\.\s+\p{Lu}/u;

function italicShare(line: Line): number {
  let italic = 0;
  for (const r of line.runs) if (r.italic) italic += r.end - r.start;
  return line.text.length > 0 ? italic / line.text.length : 0;
}

function sectionHeading(lines: Line[], i: number, ctx: PageContext): Step | null {
  const line = lines[i];
  const text = line.text.trim();
  if (line.cells.length !== 1 || [...text].length > 80 || /[.,;:]$/.test(text)) return null;
  if (line.size < ctx.bodySize * 0.9 || line.size > ctx.bodySize * 1.14) return null;
  const roman = ROMAN_SECTION_RE.test(text) && capsShare(text) >= 0.9;
  const lettered = LETTER_SECTION_RE.test(text) && italicShare(line) > 0.9;
  if (!roman && !lettered) return null;
  // Set apart above, or over a paragraph's indented first line.
  const above = lines[i - 1];
  const below = lines[i + 1];
  if (!below) return null;
  const gapAbove = !above || above.y - line.y > line.size * ctx.leading * 1.3;
  const opens = below.x > line.x + line.size * 0.8 && below.x < line.x + line.size * 3 && italicShare(below) < 0.5;
  if (!gapAbove && !opens) return null;
  return { segments: [headingOf([line], line.text, line.runs)], next: i + 1 };
}

// Numbered heading at body size: "3.1 Results" — short, isolated, and
// bold, in small caps, centered, or set larger than body, or in a document
// with no bold flags at all. "1. Introduction" reads as a list item too:
// only its look tells it apart.
function numberedHeading(lines: Line[], i: number, ctx: PageContext, runOf: number[]): Step | null {
  const line = lines[i];
  const lineBold = boldShare(line.runs, line.text.length) > 0.6;
  const styled = styledShare(line) > 0.6;
  const centered = isCentered(lines, i, ctx);
  if (
    !(
      line.cells.length === 1 &&
      (HEADING_NUM_STRICT_RE.test(line.text) || (lineBold && LETTER_HEADING_RE.test(line.text))) &&
      !(BULLET_RE.test(line.text) && !styled && !centered) &&
      !TOC_TAIL_RE.test(line.text) &&
      [...line.text].length < 120 &&
      !/[.,;:]$/.test(line.text) &&
      line.size >= ctx.bodySize * 0.98 &&
      (styled ||
        centered ||
        line.size >= ctx.bodySize * 1.05 ||
        !ctx.hasBold ||
        /^(\d{1,2}|[A-Z])(\.\d{1,2})+/.test(line.text))
    )
  )
    return null;
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
  const above = lines[i - 1];
  // Set apart below — or in bold or small caps and centered, or set apart
  // above over regular text, which no item and no paragraph's line is
  // (amsart's "1. Scripts and accents" sits one leading over its section's
  // first line), or short over a paragraph's indented first line (a Chinese
  // paper's "1. 引言", at text leading over its section).
  const isolated =
    !below ||
    last.y - below.y > last.size * ctx.leading * 1.15 ||
    (styled && centered) ||
    (styled && above !== undefined && above.y - line.y > line.size * ctx.leading * 1.3 && styledShare(below) < 0.5) ||
    (styled && below.x > last.x + last.size && last.xEnd < below.xEnd - last.size * 3);
  if (!isolated) return null;
  const { text, runs } = joinGroup(run);
  return { segments: [headingOf(run, text.replace(/\n/g, " "), runs)], next: j };
}

// The line's last words are set bold or in small caps. A bold lead with a
// regular word after it opens a paragraph ("RONA Improves Relevance and
// Diversity We" over "present our evaluation…" read as a heading); a
// regular footnote mark after a title has no letters.
function endsStyled(line: Line): boolean {
  const last = line.runs.findLast((r) => /\p{L}/u.test(line.text.slice(r.start, r.end)));
  return last !== undefined && (last.bold || last.smallCaps);
}

// A short line set wholly bold or in small caps, with no sentence end: a
// title line's look.
function titleLike(line: Line): boolean {
  const text = line.text.trim();
  return (
    line.cells.length === 1 &&
    styledShare(line) > 0.9 &&
    endsStyled(line) &&
    [...text].length > 2 &&
    [...text].length < 90 &&
    !/[.,;:?!]$/.test(text) &&
    !BULLET_RE.test(text) &&
    !CAPTION_RE.test(text)
  );
}

// An unnumbered heading at about body size: one to three short lines set
// wholly bold or in small caps (each centered, or all at one x), or one line
// opening with a bold label ("Problem 1: Risk-neutral pricing"), set apart
// by a gap above and below. A caps title may end with a period. A heading
// stacked on a heading of another size needs no gap between them (MMWR's
// "Results" over "Prescriptions"); a caption ("TABLE 1. …") and a question
// stay text.
function boldHeading(lines: Line[], i: number, ctx: PageContext, runOf: number[]): Step | null {
  const line = lines[i];
  if (line.cells.length !== 1 || line.size > ctx.bodySize * 1.14) return null;
  const text = line.text.trim();
  // The lead is a label: it ends with a colon or a period ("Problem 3:").
  const boldLead =
    startsWithBoldLead(line) && /[:.]\s*$/.test(line.text.slice(line.runs[0].start, line.runs[0].end));
  const capsPeriod = boldLead && capsShare(text) >= 0.6 && /\.$/.test(text);
  const labelled =
    boldLead &&
    [...text].length < 90 &&
    !BULLET_RE.test(text) &&
    !CAPTION_RE.test(text) &&
    !/(?:\s*\.){3,}\s*\d{1,4}\s*$/.test(text) &&
    (!/[.,;:?!]$/.test(text) || capsPeriod);
  const title = titleLike(line);
  if (!title && !labelled) return null;
  // A contents entry ends in leader dots and a page number; a title may end
  // in a number of its own ("Risk-neutral pricing 1").
  if (/(?:\s*\.){3,}\s*\d{1,4}\s*$/.test(text)) return null;
  const run: Line[] = [line];
  let j = i + 1;
  const centered = isCentered(lines, i, ctx);
  while (j < lines.length && run.length < 3 && !boldLead && runOf[j] === -1) {
    const next = lines[j];
    if (
      !titleLike(next) ||
      Math.abs(next.size - line.size) > 0.5 ||
      run[run.length - 1].y - next.y > line.size * ctx.leading * 1.3 ||
      !(centered ? isCentered(lines, j, ctx) : Math.abs(next.x - line.x) <= line.size)
    )
      break;
    run.push(next);
    j++;
  }
  const last = run[run.length - 1];
  const above = lines[i - 1];
  const below = lines[j];
  const leading = line.size * ctx.leading;
  const gapAbove = !above || above.y - line.y > leading * 1.3;
  const gapBelow = !below || last.y - below.y > leading * 1.15;
  // Stacked headings: a title-like line of another size right above (itself
  // set apart) or right below. A labelled line needs its gaps: a paragraph's
  // bold lead under a section heading ("Mosaic splicing pattern. Mosaic
  // stitching…") read as a heading.
  const headingAbove =
    title &&
    above !== undefined &&
    titleLike(above) &&
    Math.abs(above.size - line.size) > 0.5 &&
    (i < 2 || lines[i - 2].y - above.y > above.size * ctx.leading * 1.3);
  const headingBelow = title && below !== undefined && titleLike(below) && Math.abs(below.size - last.size) > 0.5;
  const bodyBelow = below !== undefined && styledShare(below) < 0.5;
  const small = line.size < ctx.bodySize * 0.98;
  if (small && !(headingAbove && bodyBelow) && !(gapAbove && headingBelow)) return null;
  if (!((gapAbove || headingAbove) && (gapBelow || headingBelow || (headingAbove && bodyBelow)) && below)) return null;
  const { text: joined, runs } = joinGroup(run);
  return { segments: [headingOf(run, joined.replace(/\n/g, " "), runs)], next: j };
}

// ── Heading levels ──────────────────────────────────────────────────────────

// Ranked by size: the biggest heading size in the document gets the level its
// ratio to body earns (a modest largest heading starts at h2), each smaller
// cluster steps one level down, floor h3. Numbered headings take their level
// from the numbering's depth, counted from the document's shallowest number
// ("2.1" is a section where chapters number "2"); an unnumbered heading the
// size of numbered ones ("Abstract", "References") takes their level.
export function assignHeadingLevels(segments: Segment[], bodySize: number) {
  const sizes: number[] = [];
  for (const s of segments) {
    if (s.type !== "HEADING" || s.rawSize === undefined) continue;
    if (!sizes.some((v) => Math.abs(v - s.rawSize!) < v * 0.05)) sizes.push(s.rawSize);
  }
  sizes.sort((a, b) => b - a);
  const topRatio = sizes.length > 0 ? sizes[0] / bodySize : 1;
  const base = topRatio > 1.5 ? 1 : topRatio > 1.18 ? 2 : 3;
  // Numbered headings take their level from the numbering's depth ("3" one
  // step under the title, "3.2" the next), so a 12pt section and a 12pt-bold
  // subsection do not land in one bucket.
  const numberedBase = sizes.length > 1 && base === 1 ? 2 : base;
  const clusterOf = (s: Segment) => sizes.findIndex((v) => s.rawSize !== undefined && Math.abs(v - s.rawSize) < v * 0.05);
  // Where sections number in roman numerals ("II. RELATED WORK"), letters
  // number their subsections and arabic numbers the parts under those.
  const roman = segments.some((s) => s.type === "HEADING" && ROMAN_SECTION_RE.test(s.text));
  const depthOf = (text: string) =>
    !roman ? headingDepth(text)
    : ROMAN_SECTION_RE.test(text) ? 1
    : LETTER_SECTION_RE.test(text) ? 2
    : /^\d{1,2}[.)]\s/.test(text) ? 3
    : headingDepth(text);
  const depths = segments.map((s) => (s.type === "HEADING" ? depthOf(s.text) : null));
  const minDepth = Math.min(...depths.filter((d): d is number => d !== null));
  // The level most numbered headings of each size take.
  const votes = new Map<number, Map<number, number>>();
  segments.forEach((s, k) => {
    const depth = depths[k];
    if (depth === null) return;
    const level = numberedBase + depth - minDepth;
    const row = votes.get(clusterOf(s)) ?? new Map<number, number>();
    row.set(level, (row.get(level) ?? 0) + 1);
    votes.set(clusterOf(s), row);
  });
  segments.forEach((s, k) => {
    if (s.type !== "HEADING") return;
    const idx = clusterOf(s);
    const depth = depths[k];
    const sized = votes.get(idx);
    const level =
      depth !== null
        ? numberedBase + depth - minDepth
        : sized
          ? [...sized].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0]
          : base + Math.max(0, idx);
    const capped = Math.min(3, Math.max(1, level));
    s.html = `<h${capped}>${escapeHtml(s.text)}</h${capped}>`;
  });
}
