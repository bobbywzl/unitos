// Headings: which lines are a heading, what a numbered heading looks like,
// and each heading's level.

import { lineColumn } from "@/lib/parse/pdf/columns";
import { TOC_TAIL_RE } from "@/lib/parse/pdf/contents";
import { CAPTION_RE } from "@/lib/parse/pdf/figures";
import { geom, lineMathShare } from "@/lib/parse/pdf/geometry";
import { charCount } from "@/lib/parse/pdf/glyphs";
import { BULLET_RE, isGlyphMarker, readMarker } from "@/lib/parse/pdf/markers";
import { isCentered, leftEdge, lineAlign, readParagraph } from "@/lib/parse/pdf/paragraphs";
import { TextBuilder, boldShare, escapeHtml, fillsMargin, joinGroup, lineAsPart, startsWithBoldLead } from "@/lib/parse/pdf/text";
import type { Item, Line, PageContext, Run, Segment, Step } from "@/lib/parse/pdf/types";

// Numbered heading: the number must close with "." or ")" or dot into a
// sub-number — "3.1 Results" and "1. Summary" match, "23 advertisers" does not.
// "3.1 Results", "2. Background", and the bare "2 Background" (ACL style).
// The word after the number starts uppercase — a body line rarely does.
export const HEADING_NUM_STRICT_RE = /^(\d{1,2}((\.\d{1,2})+\.?|[.)])?|[A-Z](\.\d{1,2})+\.?)\s+[\p{Lu}\p{Lo}]/u;
// An appendix section: "A Benchmarks and audits" — a letter alone, bold.
export const LETTER_HEADING_RE = /^[A-Z]\s+[\p{Lu}]/u;
// The number of a heading and its depth: "3" → 1, "3.2" → 2, "A.1" → 2.
const HEADING_NUMBER_RE = /^(\d{1,2}|[A-Z])((?:\.\d{1,2})*)\.?[.)]?\s/;
// A Japanese or Chinese document numbers its chapters "第2章" and its
// sections "第1節", over the numbered parts "1", "2" (a white paper's
// section and its first part read at one level).
const CJK_PART_RE = /^第\s*[0-9０-９一二三四五六七八九十百]+\s*([章編部節])/;
function headingDepth(text: string): number | null {
  const cjk = CJK_PART_RE.exec(text);
  if (cjk) return cjk[1] === "節" ? 0 : -1;
  const m = HEADING_NUMBER_RE.exec(text);
  if (!m) return null;
  return 1 + (m[2].match(/\./g)?.length ?? 0);
}
// A run-in heading's lead: a number with a sub-number, words, a period
// ("3.2.1. Two examples.").
const RUN_IN_RE = /^(?:\d{1,2}|[A-Z])(?:\.\d{1,2})+\.?\s+\S.*\.$/u;
// A run-in heading's token (<h3 class="run-in">): the page editor draws the
// heading as the bold opening words of the paragraph after it.
const RUN_IN_TOKEN_RE = /\brun-in\b/;
// A sentence's end inside a line, and the next sentence's first letter:
// "examples. We", "zj's. If".
const SENTENCE_END_RE = /\p{Ll}[\p{Ll}'’]{2,}\.\s+\p{Lu}/u;
// IEEE's fourth level: a number with a parenthesis and a title in italics
// closed by a colon, run into its paragraph ("1) Implementation: The
// pattern needs…"). It read as a list item that took the paragraph.
const IEEE_RUN_IN_RE = /^\d{1,2}\)\s+\S.*:$/u;

// The end of a line's lead set in italics from the line's start, marker
// and all: IEEE sets "1) Implementation:" in one italic run.
function italicLeadEnd(line: Line): number {
  let end = 0;
  for (const r of line.runs) {
    if (!r.italic || line.text.slice(end, r.start).trim() !== "") break;
    end = r.end;
  }
  return end;
}

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
    rawSize: Math.max(...run.map((l) => l.size)),
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
  const step =
    largeHeading(lines, i, ctx, runOf) ??
    runInHeading(lines, i, ctx, runOf) ??
    numberedHeading(lines, i, ctx, runOf) ??
    sectionHeading(lines, i, ctx) ??
    capsHeading(lines, i, ctx) ??
    abstractHeading(lines, i, ctx) ??
    boldHeading(lines, i, ctx, runOf) ??
    italicHeading(lines, i, ctx) ??
    partHeading(lines, i, ctx);
  if (step?.segments.some((s) => s.type === "HEADING" && (wordless(s.text) || SIGNATURE_RE.test(s.text) || (ctx.ocr && !/\p{L}{2}/u.test(s.text))))) return null;
  // A heading of its own lines keeps where it stands: centered or flush
  // right in its column (a run-in lead's is its paragraph's).
  const [heading] = step?.segments ?? [];
  if (step && step.segments.length === 1 && heading.type === "HEADING") {
    const align = lineAlign(lines, i, step.next, ctx) ?? (step.next === i + 1 && symmetric(lines[i]) ? "center" : null);
    if (align === "center" || align === "right") heading.align = align;
  }
  return step;
}

// A line that opens with a dash signs a piece or names a quotation's
// source: no heading (the Earth Observer's "—Alan Ward [Executive Editor,
// …]", set large and bold, read as h2).
const SIGNATURE_RE = /^\s*[—–―]/;

// A heading has a word. Panel letters ("(b)", "b)", "(a) (b)") or a number
// alone are no heading: Grinstead–Snell's "(b)" under Figure 4.6's second
// drawing, bold, small, and set apart, read as a heading, and the labels of
// the figure above it stayed text (p. 163). An opinion's part ("I", "A")
// carries no parenthesis or period and stays one (partHeading). On a scan's
// text layer a word has two letters: its page numbers and specks read "4O4",
// "I !", "N H".
// Panel letters stand apart: "H.V.", letters set close, are initials.
const PANEL_LETTERS_RE = /^\s*(?:\(\p{L}\)|\p{L}[.)])(?:\s+(?:\(\p{L}\)|\p{L}[.)]))*\s*$/u;
function wordless(text: string): boolean {
  return PANEL_LETTERS_RE.test(text) || !/\p{L}/u.test(text);
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
// A date on a line of its own ("March 15, 2023", "15 March 2023", "September
// 2026", "2023-03-15"): a cover sets it under the title at the title's size
// and weight, and it read as the title's second line.
const MONTH = "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\.?";
export const DATE_RE = new RegExp(
  `^(?:${MONTH}\\s+(?:\\d{1,2}(?:st|nd|rd|th)?,?\\s+)?\\d{4}|\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH},?\\s+\\d{4}|\\d{4}-\\d{2}-\\d{2})$`,
  "i",
);

function largeHeading(lines: Line[], i: number, ctx: PageContext, runOf: number[]): Step | null {
  const line = lines[i];
  // A division's label an inch or more from its title on their line is one
  // heading with it (a form's bar: "Part I", then "Taxpayer Identification
  // Number (TIN)").
  const labeled = line.cells.length === 2 && DIVISION_RE.test(line.cells[0].text.trim());
  if ((line.cells.length !== 1 && !labeled) || line.size <= ctx.bodySize * 1.14 || lineMathShare(line) >= 0.5) return null;
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
  // A numbered heading's wrap may hang under its title's first word ("3
  // Well-posedness of … and upper" over "bound for moments of the solution",
  // read as two headings).
  const hang = HEADING_NUMBER_RE.test(line.text) ? line.items.find((it) => it.x > line.x + line.size * 0.5 && /\p{L}/u.test(it.str))?.x : undefined;
  while (j < lines.length) {
    const next = lines[j];
    // Centered on one another: the same middle, the next line set in from
    // the column's edge, or set at the very same size where the next line
    // is that edge: a title slide's widest line makes the column
    // (real-gslides-oer-5rs p2: "OER, the 5Rs, and" over "Creative
    // Commons" read as two headings).
    const centered =
      Math.abs((next.x + next.xEnd) / 2 - (line.x + line.xEnd) / 2) <= 12 &&
      (next.x > ctx.columnLeft + 12 || (!ocr && Math.abs(next.size - line.size) < 0.1));
    const hung = hang !== undefined && run.length === 1 && Math.abs(next.x - hang) <= 2;
    if (
      runOf[j] !== -1 ||
      next.cells.length !== 1 ||
      Math.abs(next.size - line.size) > (ocr ? line.size * 0.2 : 0.5) ||
      run[run.length - 1].y - next.y > line.size * 1.7 ||
      (Math.abs(next.x - line.x) > 12 && !centered && !hung) ||
      DATE_RE.test(next.text.trim())
    )
      break;
    run.push(next);
    j++;
  }
  // A chapter's label over its title, set smaller and centered with it, is
  // one heading with it ("CHAPTER Two" over "FIRST STEPS", a scanned book).
  const title = lines[j];
  if (
    run.length === 1 &&
    title !== undefined &&
    runOf[j] === -1 &&
    LABEL_RE.test(line.text.trim()) &&
    title.cells.length === 1 &&
    title.size > line.size * 1.1 &&
    line.y - title.y <= title.size * 2.2 &&
    Math.abs((title.x + title.xEnd) / 2 - (line.x + line.xEnd) / 2) <= line.size * 2
  ) {
    run.push(title);
    j++;
  }
  // Four lines or more at one left edge that each end short of the
  // longest while the next line's first word would fit are a block of
  // lines, not a heading: an author list set large read as one six-line
  // heading (arxiv-2609-29669). Each line is a paragraph. A centered
  // title's lines end short too. The longest line says nothing of its own
  // end: under it the author list's second line, the longest, read as a
  // wrap.
  const edge = Math.max(...run.map((l) => l.xEnd));
  const flush = run.every((l) => Math.abs(l.x - line.x) <= line.size * 0.5);
  if (run.length >= 4 && flush && run.slice(0, -1).every((l, k) => l.xEnd === edge || !fillsMargin(l, run[k + 1], edge))) {
    const one = (l: Line): Segment => ({ type: "PARAGRAPH", ...lineAsPart(l), page: l.page, ...geom([l]) });
    return { segments: run.map(one), next: j };
  }
  const { text, runs } = joinGroup(run);
  const flat = text.replace(/\n/g, " ");
  // A title set in capitals may end in a period (a 1913 bulletin's
  // "BOUILLON CUBES: … PREPARATIONS OF MEAT."). Past 200 characters, lines
  // set a little larger than the body that end their column are a paragraph
  // the page break cut before its period (a survey's 9 pt text over its 7 pt
  // tables); lines over more lines are no such paragraph (a paper's authors
  // over their affiliations).
  const last = run[run.length - 1];
  const ends = lines.slice(j).every((l) => l.y > last.y || l.x >= last.xEnd || l.xEnd <= line.x);
  const prose = (/[.!?]$/.test(flat.trim()) ? [...flat].length > 80 : [...flat].length > 200 && ends) && capsShare(flat) < 0.9;
  // A numbered sentence set large is an exercise, an item of its list
  // (OpenStax's "6.2 Fill in the blanks.", "6.4 In 2012, … took the SAT
  // exam. The …", read as headings among its sections "6.1 | …").
  const sentence = /[.!?]$/.test(flat.trim()) || SENTENCE_END_RE.test(flat);
  if (marker && marker.family !== "bullet" && sentence && flat.slice(marker.length).trim().split(/\s+/).length >= 3) return null;
  // A quotation set large, in its quote marks, is a quote (a slide's 20 pt
  // quotation read as a heading).
  const quoted = /^[“"‘]/.test(flat.trim()) && /(?:[”"’][.!?]?|[.!?][”"’])$/.test(flat.trim());
  if (prose || quoted || [...flat.trim()].length <= 1 || DATE_RE.test(flat.trim())) {
    const tokens = [quoted ? "quote" : "", lineAlign(lines, i, j, ctx) === "center" ? "center" : ""].filter(Boolean);
    const html = tokens.length > 0 ? { html: `<p class="${tokens.join(" ")}"></p>` } : {};
    return { segments: [{ type: "PARAGRAPH", text: flat, ...html, page: line.page, runs, ...geom(run) }], next: j };
  }
  // Most of a line's letters are set large: a form's number set large after
  // a word set small ("Form W-9": "W-9" at 24 pt, "Form" at 7 pt) is no
  // heading, and it stood over the form's title as the document's title. An
  // OCR layer sizes each word from the scan: a scanned bulletin's heading
  // read as small words.
  if (run.length === 1 && !ctx.ocr) {
    let big = 0;
    let all = 0;
    for (const r of line.runs) {
      const letters = line.text.slice(r.start, r.end).match(/\p{L}/gu)?.length ?? 0;
      all += letters;
      if ((r.look ? (r.look.capitals ?? r.look.size) : line.size) > ctx.bodySize * 1.14) big += letters;
    }
    if (all > 0 && big * 2 < all) return null;
  }
  return { segments: [headingOf(run, flat, runs)], next: j };
}

// The end of a line's lead set bold or in small caps: its styled runs from
// the line's start, through short runs of other glyphs between them (a
// formula's letters in a bold title) and through a formula of any length
// (an amsbook subsection lead "1.1.1. A title with a formula.": the
// formula is in math fonts, and the lead read as a list item "1.").
function styledLeadEnd(line: Line): number {
  let end = 0;
  // Where the next run may start: the lead's end, or past the glyphs let
  // through between two styled runs.
  let from = 0;
  const runs = line.runs;
  for (let k = 0; k < runs.length; k++) {
    const r = runs[k];
    if (line.text.slice(from, r.start).trim() !== "") break;
    if (r.bold || r.smallCaps) {
      end = from = r.end;
      continue;
    }
    // A formula's runs (one zone: a letter and its subscript) pass as one.
    let last = k;
    while (r.zone !== undefined && runs[last + 1]?.zone === r.zone) last++;
    // Only between two styled runs: a clause whose number is set plain
    // ("3.1 Accredited status.") is a list item, not a run-in heading.
    const short = charCount(line.text.slice(r.start, runs[last].end)) <= 3 || r.zone !== undefined;
    const styledAfter = runs[last + 1] !== undefined && (runs[last + 1].bold || runs[last + 1].smallCaps);
    if (end === 0 || !short || !styledAfter) break;
    from = runs[last].end;
    k = last;
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
  const styled = styledLeadEnd(line);
  const italic = italicLeadEnd(line);
  const ieee = IEEE_RUN_IN_RE.test(line.text.slice(0, italic).trim());
  const end = ieee ? italic : styled;
  const lead = line.text.slice(0, end).trim();
  if (!(ieee || RUN_IN_RE.test(lead)) || [...lead].length > 120) return null;
  const heading = headingOf([line], lead, line.runs.filter((r) => r.start < end).map((r) => ({ ...r, end: Math.min(r.end, lead.length) })));
  const rest = line.text.slice(end);
  const cut = end + (rest.length - rest.trimStart().length);
  if (cut >= line.text.length) return { segments: [heading], next: i + 1 };
  heading.html = '<h3 class="run-in"></h3>';
  // The paragraph's first line: the line after the lead, set at the
  // column's edge. The lead's indent is the heading's (ParsedBlock.indent,
  // the first line's): under a run-in head the paragraph drew a first-line
  // indent, and the page editor drew the head at the column's edge where
  // the page sets it in.
  const text = line.text.slice(cut);
  const runs = line.runs.filter((r) => r.end > cut).map((r) => ({ ...r, start: Math.max(0, r.start - cut), end: r.end - cut }));
  const x = leftEdge(line, ctx);
  if (line.x - x >= line.size * 0.5) heading.indent = { left: 0, first: Math.round(line.x - x) };
  const first: Line = { ...line, x, text, runs, cells: [{ x, text, runs }] };
  const paragraph = readParagraph([...lines.slice(0, i), first, ...lines.slice(i + 1)], i, ctx, runOf);
  return { segments: [heading, ...paragraph.segments], next: paragraph.next };
}

// IEEE's and APS's (REVTeX) section headings: a roman numeral and a title
// in capitals ("II. RELATED WORK") or bold ("I. Executive Summary", the
// Federal Register's), a letter and a title in italics or, in a centered
// line, bold ("A. Efficient attention"), and REVTeX's third level, a number
// and a title centered in italics ("1. Density of states"), each on a line
// of its own over its section's first paragraph. REVTeX sets them a size
// under the body's (8.97 pt over 9.96 pt). They read as a paragraph, and as
// a list item that took the section's first paragraph.
const ROMAN_SECTION_RE = /^[IVX]{1,5}\.\s+\p{Lu}/u;
// "I.", "V.", and "X." number a roman section or a lettered one: the look
// of the other heads tells which (assignHeadingLevels).
const ROMAN_OR_LETTER_RE = /^[IVX]\.\s/;
const LETTER_SECTION_RE = /^[A-Z]\.\s+\p{Lu}/u;
const NUMBER_SECTION_RE = /^\d{1,2}\.\s+\p{Lu}/u;

// Share of a line's characters, its formulas aside, whose item passes a
// test: a heading's formula is set in math italic, not in the heading's
// style ("1. Time for the beginning of the ramp for BRM: tdip").
function textShare(line: Line, test: (item: Item) => boolean): number {
  let all = 0;
  let hit = 0;
  for (const item of line.items) {
    if (item.math) continue;
    const n = charCount(item.str);
    all += n;
    if (test(item)) hit += n;
  }
  return all > 0 ? hit / all : 0;
}

// Nothing sits right above the line: no line, a paragraph gap (1.3 leading),
// or the line above in reading order closed another column, so this one
// opens its column (IEEE's "III. METHOD" atop the right column read as a
// paragraph).
function apartAbove(above: Line | undefined, line: Line, ctx: PageContext): boolean {
  return !above || above.y - line.y < line.size * 0.5 || above.y - line.y > line.size * ctx.leading * 1.3;
}

// Nothing sits right under the line: a gap past 1.15 leading, or the next
// line in reading order opens another column.
function apartBelow(line: Line, below: Line, ctx: PageContext): boolean {
  return line.y - below.y < line.size * 0.5 || line.y - below.y > line.size * ctx.leading * 1.15;
}

// A line set as far in from its column's right edge as from its left one,
// half an em or more: centered, where the test against the page's lines
// (isCentered) wants two ems in (REVTeX's "A. Spectral Form Factor
// Analytical Expression", 10 pt in from both edges of its column, read as
// a paragraph, and "1. Time for the beginning of the ramp for BRM: tdip"
// as a list item).
function symmetric(line: Line): boolean {
  const column = lineColumn(line);
  if (!column) return false;
  const [left, right] = [line.x - column[0], column[1] - line.xEnd];
  return left >= line.size * 0.5 && Math.abs(left - right) <= line.size * 0.3;
}

function sectionHeading(lines: Line[], i: number, ctx: PageContext): Step | null {
  const line = lines[i];
  const text = line.text.trim();
  if (line.cells.length !== 1 || [...text].length > 80 || /[.,;:]$/.test(text)) return null;
  if (line.size < ctx.bodySize * 0.85 || line.size > ctx.bodySize * 1.14) return null;
  const centered = isCentered(lines, i, ctx) || symmetric(line);
  const italic = (l: Line) => textShare(l, (item) => item.italic) > 0.9;
  const bold = (l: Line) => textShare(l, (item) => item.bold) > 0.9;
  const caps = (l: Line) => capsShare(l.text) >= 0.9;
  const look =
    ROMAN_SECTION_RE.test(text) && caps(line) ? caps
    : ROMAN_SECTION_RE.test(text) && bold(line) ? bold
    : LETTER_SECTION_RE.test(text) && italic(line) ? italic
    : LETTER_SECTION_RE.test(text) && centered && bold(line) ? bold
    : NUMBER_SECTION_RE.test(text) && centered && (italic(line) || bold(line)) ? (italic(line) ? italic : bold)
    : null;
  if (!look) return null;
  // A title wraps onto lines of its size and look: centered ones ("IV.
  // LONG-RANGE SPECTRAL STATISTICS OF" over "BRM"), or lines at its left
  // edge under a line that fills its column (the Federal Register's "C.
  // What is EPA's authority for taking" over "this action?", read as a
  // heading and an italic paragraph).
  const run: Line[] = [line];
  let j = i + 1;
  while (j < lines.length && run.length < 5) {
    const next = lines[j];
    const last = run[run.length - 1];
    const gap = last.y - next.y;
    if (next.cells.length !== 1 || Math.abs(next.size - line.size) > 0.5 || gap <= 0 || gap > line.size * ctx.leading * 1.3) break;
    if (!look(next) || NUMBER_SECTION_RE.test(next.text) || LETTER_SECTION_RE.test(next.text) || ROMAN_SECTION_RE.test(next.text)) break;
    const edge = lineColumn(last)?.[1];
    const wraps = centered ? isCentered(lines, j, ctx) : Math.abs(next.x - line.x) <= line.size * 0.5 && edge !== undefined && fillsMargin(last, next, edge);
    if (!wraps) break;
    run.push(next);
    j++;
  }
  // Set apart above, or over a paragraph's indented first line; a centered
  // title set apart below. A page may end under the title: a printed web
  // page set "IV. EXPERIMENTS" last on its page, its section on the next.
  const last = run[run.length - 1];
  const above = lines[i - 1];
  const below = lines[j];
  if (!below) return apartAbove(above, line, ctx) ? heading(run, j, centered) : null;
  const opens = below.x > line.x + line.size * 0.8 && below.x < line.x + line.size * 3 && textShare(below, (item) => item.italic) < 0.5;
  if (!apartAbove(above, line, ctx) && !opens && !(centered && apartBelow(last, below, ctx))) return null;
  return heading(run, j, centered);
}

// One heading of a run of lines, wrapped lines joined with spaces.
function heading(run: Line[], next: number, centered: boolean): Step {
  const { text, runs } = headingText(run, centered);
  return { segments: [headingOf(run, text, runs)], next };
}

// A heading's lines as one text: a wrap is a space, and in a centered
// heading a line the writer broke stays a line of its own: the upper line
// stops short of its column by more than the next line's first word, the
// test that splits bold centered lines into paragraphs (paragraphs.ts). A
// title of two centered lines drew as one line.
function headingText(run: Line[], centered: boolean): { text: string; runs: Run[] } {
  const builder = new TextBuilder();
  let from = 0;
  for (let k = 1; k <= run.length; k++) {
    const [prev, next] = [run[k - 1], run[k]];
    if (next && !(centered && prev.xEnd + prev.size * 1.28 + next.firstWordWidth < (lineColumn(prev)?.[1] ?? 0))) continue;
    const part = joinGroup(run.slice(from, k));
    builder.append({ text: part.text.replace(/\n/g, " "), runs: part.runs }, "\n");
    from = k;
  }
  return builder;
}

// An unnumbered title in capitals on a line of its own, centered in its
// column and set apart above and below: IEEE's "ACKNOWLEDGMENT" and
// "REFERENCES", a 1913 bulletin's "INTRODUCTION." (a scan's text layer
// has no bold to tell it by). A line of names ("DONALD J. TRUMP,
// PETITIONER v.", "ADA L. MERCER": an initial) and a chapter's label over
// its title ("CHAPTER 2") stay paragraphs.
const INITIAL_RE = /(?:^|\s)\p{Lu}\.(?=\s|$)/u;
const LABEL_RE = /^(?:chapter|part|book|appendix|section|lecture)\s+\S+$/i;
// A division's label alone on its line, set bold: an exhibit, a schedule, a
// section of a contract or a form ("EXHIBIT 3", "SCHEDULE 1", "ARTICLE IV").
const DIVISION_RE = /^(exhibit|schedule|annex|appendix|part|article|section)\s+[\p{L}\p{N}]{1,4}\.?$/iu;
// A division's depth by its kind: an exhibit holds sections.
const DIVISION_DEPTH: Record<string, number> = { exhibit: 1, schedule: 1, annex: 1, appendix: 1, part: 2, article: 2, section: 2 };
function capsHeading(lines: Line[], i: number, ctx: PageContext): Step | null {
  const caps = (line: Line) => {
    const text = line.text.trim();
    const letters = text.replace(/[^\p{L}]/gu, "").length;
    if (line.cells.length !== 1 || letters < 3 || [...text].length > 60 || capsShare(text) < 0.9) return false;
    // A scan's text layer sizes a line by its box: a line of capitals has no
    // descenders, and its box reads a sixth smaller than the text's (parse
    // loop finding: NACA Report 515's SUMMARY and INTRODUCTION read 8.5 pt
    // over 10.3 pt text, and were paragraphs).
    if (line.size < ctx.bodySize * (ctx.ocr ? 0.78 : 0.85) || line.size > ctx.bodySize * (ctx.ocr ? 1.3 : 1.14)) return false;
    return !(/[,;:]$/.test(text) || INITIAL_RE.test(text) || LABEL_RE.test(text) || CAPTION_RE.test(text));
  };
  const line = lines[i];
  if (!caps(line)) return null;
  // The title under a division's label runs on over lines as far apart as
  // the label stands from it (boldHeading).
  const run = [line];
  let j = i + 1;
  if (i > 0 && DIVISION_RE.test(lines[i - 1].text.trim())) {
    while (j < lines.length && run.length < 3 && caps(lines[j]) && !DIVISION_RE.test(lines[j].text.trim())) {
      if (Math.abs(lines[j].size - line.size) > 0.5 || run[run.length - 1].y - lines[j].y > line.size * ctx.leading * 2 || !isCentered(lines, j, ctx)) break;
      run.push(lines[j++]);
    }
  }
  const below = lines[j];
  if (!below || !isCentered(lines, i, ctx)) return null;
  // A statement's title in capitals, set tight between its company line and
  // its units line over its table, all centered: the 10-K's "CONSOLIDATED
  // STATEMENTS OF INCOME" read as a paragraph (real-sec-10k-goog-2024-p54).
  const above = lines[i - 1];
  const statement =
    above !== undefined &&
    isCentered(lines, i - 1, ctx) &&
    !caps(above) &&
    isCentered(lines, j, ctx) &&
    !caps(below) &&
    lines[j + 1]?.table !== undefined;
  if (!statement && (!apartAbove(above, line, ctx) || !apartBelow(run[run.length - 1], below, ctx))) return null;
  return heading(run, j, true);
}

// "Abstract" alone on its line, in any weight: a paper's abstract heading
// (LIPIcs sets it closer to its text than a section's gap and read as a
// paragraph, arxiv-2506-06752).
function abstractHeading(lines: Line[], i: number, ctx: PageContext): Step | null {
  const line = lines[i];
  if (line.cells.length !== 1 || !/^abstract[.:]?$/i.test(line.text.trim()) || line.size < ctx.bodySize * 0.85) return null;
  return { segments: [headingOf([line], line.text.trim(), line.runs)], next: i + 1 };
}

// Numbered heading at body size: "3.1 Results" — short, isolated, and
// bold, in small caps, centered, or set larger than body, or in a document
// with no bold flags at all. "1. Introduction" reads as a list item too:
// only its look tells it apart.
function numberedHeading(lines: Line[], i: number, ctx: PageContext, runOf: number[]): Step | null {
  const line = lines[i];
  const lineBold = boldShare(line.runs, line.text.length) > 0.6;
  const styled = styledShare(line) > 0.6;
  const centered = isCentered(lines, i, ctx) || symmetric(line);
  // amsart closes a subsection's title with a period; alone on its line,
  // over its paragraph, it is a heading ("3.2. Proofs of Propositions 3.2
  // and 3.3.", its number set plain and its title bold).
  const closed = /\.$/.test(line.text.trim()) && styledShare(line) > 0.8;
  if (
    !(
      line.cells.length === 1 &&
      (HEADING_NUM_STRICT_RE.test(line.text) || (lineBold && LETTER_HEADING_RE.test(line.text))) &&
      !(BULLET_RE.test(line.text) && !styled && !centered) &&
      !TOC_TAIL_RE.test(line.text) &&
      [...line.text].length < 120 &&
      (!/[.,;:]$/.test(line.text) || closed) &&
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
  // Or right over its first subsection's heading, set as it is ("4 …" over
  // "4.1 …": a Chinese paper's section and subsection read as one heading).
  const number = HEADING_NUMBER_RE.exec(line.text);
  const subsection = number !== null && below !== undefined && below.text.startsWith(`${number[1]}${number[2]}.`) && HEADING_NUM_STRICT_RE.test(below.text) && styledShare(below) > 0.6;
  // A page's first line has nothing over it: set in from the column, over
  // regular text, it is apart above (amsart's "2. Fractions and roots" atop
  // a page read as a list item).
  const apart = above === undefined ? line.x > ctx.columnLeft + line.size * 2 : above.y - line.y > line.size * ctx.leading * 1.3;
  const isolated =
    !below ||
    last.y - below.y > last.size * ctx.leading * 1.15 ||
    (!closed && styled && subsection) ||
    (styled && centered) ||
    (styled && apart && styledShare(below) < 0.5) ||
    (styled && below.x > last.x + last.size && last.xEnd < below.xEnd - last.size * 3);
  if (!isolated) return null;
  const { text, runs } = headingText(run, centered);
  // A question or two sentences under a number are an exercise, no heading
  // (OpenStax's "6.1 What is the z-score of x…?"), and a lead closed by a
  // period with a sentence after it opens a paragraph (amsart's "2.1. Case
  // of imaginary zj's. If n = 1 then", its number set upright).
  if (/[?!]$/.test(text.trim()) || SENTENCE_END_RE.test(text)) return null;
  return { segments: [headingOf(run, text, runs)], next: j };
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
    !wordless(text) &&
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
  const lead = line.text.slice(line.runs[0].start, line.runs[0].end);
  const boldLead = startsWithBoldLead(line) && /[:.]\s*$/.test(lead);
  const capsPeriod = boldLead && capsShare(text) >= 0.6 && /\.$/.test(text);
  // A label closed by a period opens its paragraph: amsthm's "Theorem 1.
  // If M is a Cartan-Hadamard manifold …, then" over its display, and a
  // paragraph's bold lead, read as headings. A heading's label takes a
  // colon ("Problem 3: Risk-neutral pricing"), or its line is set in
  // capitals (a thesis's "F. DESPOT").
  const labelled =
    boldLead &&
    (/:\s*$/.test(lead) || capsShare(text) >= 0.6) &&
    [...text].length < 90 &&
    !BULLET_RE.test(text) &&
    !CAPTION_RE.test(text) &&
    !/(?:\s*\.){3,}\s*\d{1,4}\s*$/.test(text) &&
    (!/[.,;:?!]$/.test(text) || capsPeriod);
  // A centered title's line may end with a colon where its next line goes
  // on in its look (tam-review p2: "Overview of the Technology Acceptance
  // Model:" over "Origins, Developments and Future Directions", bold and
  // centered, read as two paragraphs).
  const colonOn = (l: Line, n: Line | undefined) =>
    n !== undefined &&
    /:$/.test(l.text.trim()) &&
    titleLike({ ...l, text: l.text.trimEnd().slice(0, -1) }) &&
    titleLike(n) &&
    Math.abs(n.size - l.size) <= 0.5 &&
    l.y - n.y > 0 &&
    l.y - n.y <= l.size * ctx.leading * 1.3;
  const title = titleLike(line) || (colonOn(line, lines[i + 1]) && isCentered(lines, i, ctx) && isCentered(lines, i + 1, ctx));
  // A short label in bold capitals closed by a period, alone on its line,
  // heads the paragraph under it as a title does: a Frontiers case report
  // sets each case's initials, "H.V." and "G.A.", in bold italic over it,
  // and they read as paragraphs (parse loop finding).
  const capsLabel =
    styledShare(line) > 0.9 && endsStyled(line) && capsShare(text) >= 0.9 && /^\p{L}[\p{L}.\s]{1,10}\.$/u.test(text) && !CAPTION_RE.test(text);
  if (!title && !labelled && !capsLabel) return null;
  // A contents entry ends in leader dots and a page number; a title may end
  // in a number of its own ("Risk-neutral pricing 1").
  if (/(?:\s*\.){3,}\s*\d{1,4}\s*$/.test(text)) return null;
  const run: Line[] = [line];
  let j = i + 1;
  const centered = isCentered(lines, i, ctx);
  // A division's label ("EXHIBIT 3", "ARTICLE IV") is a heading of its own,
  // and the title under it goes on over a wider gap: a contract may set its
  // title's two lines as far apart as the label is from them.
  const division = DIVISION_RE.test(text);
  const underLabel = i > 0 && DIVISION_RE.test(lines[i - 1].text.trim());
  // Past three lines, a title goes on only where each line fills its
  // column: the Federal Register sets a rule's subject in five bold lines.
  while (j < lines.length && run.length < 6 && !boldLead && !division && runOf[j] === -1) {
    const next = lines[j];
    const prev = run[run.length - 1];
    const edge = lineColumn(prev)?.[1];
    if (
      (run.length >= 3 && (centered || edge === undefined || !fillsMargin(prev, next, edge))) ||
      !titleLike(next) ||
      HEADING_NUM_STRICT_RE.test(next.text) ||
      DIVISION_RE.test(next.text.trim()) ||
      Math.abs(next.size - line.size) > 0.5 ||
      run[run.length - 1].y - next.y > line.size * ctx.leading * (underLabel ? 2 : 1.3) ||
      !(centered ? isCentered(lines, j, ctx) : Math.abs(next.x - line.x) <= line.size)
    )
      break;
    run.push(next);
    j++;
  }
  const last = run[run.length - 1];
  const above = lines[i - 1];
  const below = lines[j];
  const gapAbove = apartAbove(above, line, ctx);
  const gapBelow = !below || apartBelow(last, below, ctx);
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
  // Over a paragraph's first line set in, a title set apart above needs no
  // gap under it: MMWR sets its subheads a size under the body, over the
  // indented first line ("Prescribers" read as a paragraph).
  const opensBelow = title && bodyBelow && below.x > last.x + last.size * 0.5 && below.x <= last.x + last.size * 3;
  // Over a list's first item likewise: OpenStax's "Solution 6.2" sits a
  // line over its "a. This z-score tells you …".
  const itemBelow = title && bodyBelow && readMarker(below) !== null;
  // Over a paragraph's first line flush with it, a short title set apart
  // above needs no gap under it either: a thesis's "Choice, Uncertainty,
  // and Entropy" and TAM Review's "Introduction" sit one line's pitch over
  // their paragraphs and read as paragraphs. The title stops well short of
  // its column's edge (a bold sentence wrapped fills it), and the line
  // under it is regular type at its size.
  const edge = lineColumn(last)?.[1];
  const flushBelow =
    (title || capsLabel) &&
    run.length === 1 &&
    bodyBelow &&
    Math.abs(below.x - last.x) <= last.size * 0.5 &&
    Math.abs(below.size - last.size) <= 0.5 &&
    edge !== undefined &&
    edge - last.xEnd > last.size * 4 &&
    below.xEnd - below.x > (edge - below.x) * 0.6;
  const small = line.size < ctx.bodySize * 0.98;
  // A title in capitals set a size under the body, apart above, over a
  // paragraph flush with it, is a subhead: a Frontiers article sets "CASE
  // REPORTS" and "PROCEDURES" in 8.5 pt bold capitals over its 9.5 pt body,
  // and they read as paragraphs (parse loop finding).
  const capsOver = (title || capsLabel) && run.length === 1 && capsShare(text) >= 0.9 && bodyBelow && Math.abs(below.x - last.x) <= last.size * 0.5;
  if (small && !(headingAbove && bodyBelow) && !(gapAbove && (headingBelow || opensBelow || capsOver))) return null;
  // A centered title set apart above needs no gap under it: a statement's
  // title sits 12.8 pt over its units line ("CONDENSED CONSOLIDATED
  // STATEMENTS OF OPERATIONS (Unaudited)" read as a paragraph).
  const centeredTitle = title && centered && gapAbove;
  if (!below || !(centeredTitle || ((gapAbove || headingAbove) && (gapBelow || headingBelow || opensBelow || (gapAbove && (itemBelow || flushBelow)) || (headingAbove && bodyBelow))))) return null;
  const { text: joined, runs } = headingText(run, centered);
  return { segments: [headingOf(run, joined, runs)], next: j };
}

// An italic line alone at the body's size, set apart above and below, over
// a paragraph of regular type at its left edge, on a page whose headings
// are bold: a subhead a level under them (the Earth Observer's "A
// Diversified Portfolio" under its bold "Twenty-fifth Anniversary
// Analysis", read as a paragraph). A byline ("By …"), a caption, and a line
// with a sentence's end stay words, and so does a TeX page's italic line:
// a theorem's words between two displays ("Then the inequality").
function italicHeading(lines: Line[], i: number, ctx: PageContext): Step | null {
  const line = lines[i];
  const text = line.text.trim();
  if (ctx.tex || line.cells.length !== 1 || !ctx.hasBold || textShare(line, (item) => item.italic) < 0.9 || textShare(line, (item) => item.bold) > 0.1) return null;
  if ([...text].length < 3 || [...text].length > 60 || /[.,;:?!]$/.test(text) || /^by\s/i.test(text) || CAPTION_RE.test(text) || wordless(text)) return null;
  if (Math.abs(line.size - ctx.bodySize) > ctx.bodySize * 0.1) return null;
  const above = lines[i - 1];
  const below = lines[i + 1];
  if (!below || !apartBelow(line, below, ctx)) return null;
  // A centered label over a centered title lines up with it by their
  // middles (parse loop finding: the Official Journal's "Article 6" over
  // "Classification rules for high-risk AI systems" read as a paragraph,
  // where "Article 1" over the shorter "Subject matter" read as a heading).
  const middles = (isCentered(lines, i, ctx) || symmetric(line)) && (isCentered(lines, i + 1, ctx) || symmetric(below)) && Math.abs(below.x + below.xEnd - line.x - line.xEnd) <= line.size * 2;
  // The page's first line has no line above it to stand apart from: a
  // centered label over its centered title is a heading there as well
  // (parse loop finding: the Official Journal's "Article 4" at the top of
  // its page read as a paragraph).
  if (above ? !apartAbove(above, line, ctx) : !middles) return null;
  if ((Math.abs(below.x - line.x) > line.size * 2 && !middles) || textShare(below, (item) => item.italic) > 0.5 || below.size < line.size * 0.9) return null;
  return { segments: [headingOf([line], text, line.runs)], next: i + 1 };
}

// ── Heading alignment ───────────────────────────────────────────────────────

/** A heading set at the middle of two or more centered headings of its size
    is centered too: on a page with no full line to read its column's right
    edge by (a sheet of formulas), "1. Scripts and accents" and "5. Fonts"
    read as flush left beside a centered "4. Delimiters". A run-in head's box
    is its paragraph's line: it is never centered so. */
export function centerLikeOthers(segments: Segment[]) {
  const centered = segments.filter((s) => s.type === "HEADING" && s.align === "center" && s.box && s.rawSize !== undefined);
  const middle = (s: Segment) => (s.box!.x1 + s.box!.x2) / 2;
  for (const s of segments) {
    if (s.type !== "HEADING" || s.align || !s.box || s.rawSize === undefined || RUN_IN_TOKEN_RE.test(s.html ?? "")) continue;
    const peers = centered.filter((c) => Math.abs(c.rawSize! - s.rawSize!) < 0.5 && Math.abs(middle(c) - middle(s)) <= s.rawSize! * 0.2);
    if (peers.length >= 2) s.align = "center";
  }
}

// ── Heading levels ──────────────────────────────────────────────────────────

// Ranked by size: the biggest heading size in the document gets the level its
// ratio to body earns (a modest largest heading starts at h2), and each
// smaller size steps one level down, to h6. Numbered headings take their level
// from the numbering's depth, counted from the document's shallowest number
// ("2.1" is a section where chapters number "2"; the title's own number, a
// chapter's "6 | THE NORMAL DISTRIBUTION", counts none), down to h6 (IEEE's
// "1)" under "A." under "III." is h4); an unnumbered heading the size of
// numbered ones ("Abstract", "References") takes their level. A slide deck
// ranks each slide apart: a slide fits its title to its box, so one deck's
// titles run from 20 to 40 pt, and a slide's subheadings ("Mission" under
// "OSDR Mission and Vision") read at its title's level. There a slide's
// biggest heading is h2 and a smaller one h3.
// A paper's unnumbered parts stand at its sections' level whatever their
// size: LIPIcs sets "Abstract" smaller than its numbered sections.
const PART_RE = /^(?:abstract|acknowledge?ments?|references|bibliography|appendix|appendices|contents|conclusions?)$/i;
// A form's part: its label and its name on one line ("Part I Taxpayer
// Identification Number (TIN)", "Part II Certification").
const FORM_PART_RE = /^part\s+(?:[IVXL]{1,4}|\d{1,2}|[A-Z])\.?\s+\S/i;

/** How a document's headings rank: a deck ranks each slide apart; the
    document's title (it leaves the blocks or reads as the Title) counts in
    no numbering; a scan's text layer sizes its words from the page, so its
    sizes rank no levels past the first under a numbered one. */
export type LevelOptions = { slides?: boolean; title?: Segment; scan?: boolean };

export function assignHeadingLevels(segments: Segment[], bodySize: number, { slides = false, title, scan = false }: LevelOptions = {}) {
  const clusters = (list: Segment[]) => {
    const sizes: number[] = [];
    for (const s of list) {
      if (s.type !== "HEADING" || s.rawSize === undefined) continue;
      if (!sizes.some((v) => Math.abs(v - s.rawSize!) < v * 0.05)) sizes.push(s.rawSize);
    }
    return sizes.sort((a, b) => b - a);
  };
  const sizes = clusters(segments);
  const topRatio = sizes.length > 0 ? sizes[0] / bodySize : 1;
  const base = topRatio > 1.5 ? 1 : topRatio > 1.18 ? 2 : 3;
  // Numbered headings take their level from the numbering's depth ("3" one
  // step under the title, "3.2" the next), so a 12pt section and a 12pt-bold
  // subsection do not land in one bucket.
  const numberedBase = sizes.length > 1 && base === 1 ? 2 : base;
  const clusterOf = (s: Segment, list = sizes) => list.findIndex((v) => s.rawSize !== undefined && Math.abs(v - s.rawSize) < v * 0.05);
  const heads = segments.filter((s) => s.type === "HEADING" && s !== title);
  // Where sections number in roman numerals ("II. RELATED WORK"), letters
  // number their subsections and arabic numbers the parts under those. An
  // "I." set as the lettered heads are and none of the roman ones is the
  // ninth letter (the Federal Register's italic "I. Executive Order 13211"
  // under its bold "V. Statutory and Executive Order Reviews").
  const lookOf = (s: Segment) => {
    const share = (flag: "bold" | "italic") => (s.runs ?? []).reduce((n, r) => n + (r[flag] ? r.end - r.start : 0), 0) / Math.max(1, s.text.length);
    return `${share("bold") > 0.5} ${share("italic") > 0.5} ${capsShare(s.text) >= 0.9} ${Math.round((s.rawSize ?? 0) * 2)}`;
  };
  const looks = (test: (s: Segment) => boolean) => new Set(heads.filter((s) => test(s) && !ROMAN_OR_LETTER_RE.test(s.text)).map(lookOf));
  const romanLooks = looks((s) => ROMAN_SECTION_RE.test(s.text));
  const letterLooks = looks((s) => LETTER_SECTION_RE.test(s.text));
  const isRoman = (s: Segment) =>
    ROMAN_SECTION_RE.test(s.text) && !(ROMAN_OR_LETTER_RE.test(s.text) && letterLooks.has(lookOf(s)) && !romanLooks.has(lookOf(s)));
  const roman = heads.some(isRoman);
  const depthOf = (s: Segment) =>
    !roman ? headingDepth(s.text)
    : isRoman(s) ? 1
    : LETTER_SECTION_RE.test(s.text) ? 2
    : /^\d{1,2}[.)]\s/.test(s.text) ? 3
    : headingDepth(s.text);
  // A capital alone before a title numbers it only beside a heading that
  // opens with the letter before or after it: "A Diversified Portfolio" is
  // a subhead, where "A Benchmarks" over "B Metrics" are appendices.
  const letterOf = (s: Segment) => (s.type === "HEADING" && s !== title ? /^([A-Z])\.?\s/.exec(s.text)?.[1] : undefined);
  const letters = new Set(segments.map(letterOf).filter((l): l is string => l !== undefined));
  const lone = (s: Segment) => {
    const l = letterOf(s);
    return l !== undefined && !roman && ![-1, 1].some((d) => letters.has(String.fromCharCode(l.charCodeAt(0) + d)));
  };
  const depths = segments.map((s) => (s.type === "HEADING" && s !== title && !lone(s) ? depthOf(s) : null));
  // A division's label stands at its kind's depth, and the title under it one
  // deeper (a contract's exhibits, sections, and their titles all read at
  // one level).
  segments.forEach((s, k) => {
    const kind = s.type === "HEADING" ? DIVISION_RE.exec(s.text.trim())?.[1].toLowerCase() : undefined;
    if (!kind) return;
    depths[k] = DIVISION_DEPTH[kind];
    const next = segments[k + 1];
    if (next?.type === "HEADING" && next.page === s.page && depths[k + 1] === null && !DIVISION_RE.test(next.text.trim())) depths[k + 1] = DIVISION_DEPTH[kind] + 1;
  });
  // A numbering that starts again at each level ("1" under "1", a Japanese
  // white paper's parts under its "第1節" section) sets its levels apart by
  // size: at one depth, each smaller size is one level deeper.
  const bySize = new Map<number, number[]>();
  const restarts = segments.some((s) => s.type === "HEADING" && CJK_PART_RE.test(s.text));
  segments.forEach((s, k) => {
    const depth = depths[k];
    if (!restarts || depth === null || s.rawSize === undefined) return;
    const list = bySize.get(depth) ?? [];
    if (!list.some((v) => Math.abs(v - s.rawSize!) < v * 0.1)) list.push(s.rawSize);
    bySize.set(depth, list.sort((a, b) => b - a));
  });
  segments.forEach((s, k) => {
    const depth = depths[k];
    if (!restarts || depth === null || s.rawSize === undefined) return;
    depths[k] = depth + Math.max(0, bySize.get(depth)!.findIndex((v) => Math.abs(v - s.rawSize!) < v * 0.1));
  });
  const minDepth = Math.min(...depths.filter((d): d is number => d !== null));
  // The parts that open a document's headings stand at the top level,
  // whatever their size: a form's "Part I" and "Part II" before its
  // instructions' larger "General Instructions" (IRS W-9).
  const leadParts = new Set<Segment>();
  for (const s of heads) {
    if (!FORM_PART_RE.test(s.text.trim())) break;
    leadParts.add(s);
  }
  // The level most numbered headings of each size take, a paper's parts
  // voting as its sections: "CCS Concepts" and "Keywords", set the size of
  // "Abstract", stand at its level.
  const part = (s: Segment) => s.type === "HEADING" && Number.isFinite(minDepth) && PART_RE.test(s.text.trim());
  // A number met before is no section's (OpenStax numbers an exercise "6.1"
  // under its section "6.1 | …"): it votes for no size's level.
  const seen = new Set<string>();
  const repeats = segments.map((s, k) => {
    const m = depths[k] !== null && s.type === "HEADING" ? HEADING_NUMBER_RE.exec(s.text) : null;
    const key = m ? m[1] + m[2] : undefined;
    if (!key) return false;
    const met = seen.has(key);
    seen.add(key);
    return met;
  });
  const votes = new Map<number, Map<number, number>>();
  segments.forEach((s, k) => {
    const depth = depths[k];
    if ((depth === null && !part(s)) || repeats[k]) return;
    const level = depth === null ? numberedBase : numberedBase + depth - minDepth;
    const row = votes.get(clusterOf(s)) ?? new Map<number, number>();
    row.set(level, (row.get(level) ?? 0) + 1);
    votes.set(clusterOf(s), row);
  });
  // Each slide's heading sizes, biggest first.
  const slideSizes = new Map<number, number[]>();
  if (slides) {
    for (const s of segments) if (s.type === "HEADING" && !slideSizes.has(s.page)) slideSizes.set(s.page, clusters(segments.filter((t) => t.page === s.page)));
  }
  // Each size's level: the one more than half of its numbered headings take.
  // Where they are half of its headings or more, that level stands whatever
  // the sizes over it take (a report's "Introduction" stands with its
  // numbered sections, under its front pages' larger headings); else it is
  // never above a larger size's (OpenStax's one "6.0 Introduction" among a
  // dozen labels at 10 pt set the labels, and the solutions a size under
  // them, over its examples). Over the first numbered size, each size a
  // heading takes stands a level over the next, and the lowest of them over
  // that size's highest numbered heading (a subscription agreement's
  // "Recitals" over its numbered sections, a Chinese paper's English title
  // over its numbered sections, a chapter's title over its "2.1" sections
  // where its "2.1.1" run-in heads, set at their size, outnumber them),
  // where the levels leave room; else, and with
  // no numbered size, a size takes its rank under the biggest, two levels
  // under it at most. Under the numbered sizes, a size none numbers stands a
  // level under the next larger size (OpenStax's "Z-Scores", "Example 6.1",
  // and "Solution 6.2" under "6.1 | …": a floor at h3 set them at one level).
  // A size that one heading alone takes, the biggest aside (a sidebar's
  // title, a page's subtitle), ranks no size under it: MMWR's "Prescriptions"
  // sat at its sections' level under a masthead's sizes. A scan's smaller
  // sizes all take the level under the nearest numbered one, or h3 at most: a
  // scan's words read in many sizes (USDA p. 3 set "INTRODUCTION." at h6).
  const voters = sizes.map((_, idx) => [...(votes.get(idx)?.values() ?? [])].reduce((n, count) => n + count, 0));
  const voted = sizes.map((_, idx) => {
    const row = [...(votes.get(idx) ?? [])].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
    return row.length > 0 && row[0][1] * 2 > voters[idx] ? row[0][0] : null;
  });
  const first = voted.findIndex((level) => level !== null);
  const counts = sizes.map((_, idx) => heads.filter((s) => clusterOf(s) === idx).length);
  const over = sizes.map((_, idx) => idx).filter((idx) => idx < first && counts[idx] > 0);
  const top = first >= 0 ? Math.min(...(votes.get(first)?.keys() ?? [])) : 0;
  const upward = first > 0 && over.length < top;
  const sizeLevels: number[] = [];
  let votedLevel: number | null = null;
  let ranked = 0;
  let rankedLevel = base;
  sizes.forEach((_, idx) => {
    const level = voted[idx];
    if (level !== null) votedLevel = level;
    sizeLevels[idx] =
      scan ? (level ?? (votedLevel !== null ? votedLevel + 1 : Math.min(3, base + idx)))
      : upward && idx < first ? top - over.filter((k) => k >= idx).length
      : first < 0 || idx < first ? base + Math.min(2, ranked)
      : level !== null ? (voters[idx] * 2 >= counts[idx] ? level : Math.max(level, rankedLevel))
      : Math.min(6, rankedLevel + 1);
    if (idx === 0 || counts[idx] >= 2) {
      ranked++;
      rankedLevel = sizeLevels[idx];
    }
  });
  // At one size, an italic heading stands a level under the bold ones (the
  // Earth Observer's italic subheads under its bold sections).
  const share = (s: Segment, flag: "bold" | "italic") => (s.runs ?? []).reduce((n, r) => n + (r[flag] ? r.end - r.start : 0), 0) / Math.max(1, s.text.length);
  const boldSizes = new Set(heads.filter((s) => share(s, "bold") > 0.5).map((s) => clusterOf(s)));
  segments.forEach((s, k) => {
    if (s.type !== "HEADING") return;
    const idx = clusterOf(s);
    const depth = depths[k];
    const under = depth === null && !part(s) && share(s, "italic") > 0.5 && share(s, "bold") < 0.5 && boldSizes.has(idx) ? 1 : 0;
    const level =
      slides ? Math.min(3, 2 + Math.max(0, clusterOf(s, slideSizes.get(s.page) ?? [])))
      : leadParts.has(s) ? base
      : depth !== null ? numberedBase + depth - minDepth
      : part(s) ? numberedBase
      : (sizeLevels[idx] ?? Math.min(3, base)) + under;
    const capped = Math.min(6, Math.max(1, level));
    // A run-in lead (runInHeading) keeps its token: the page editor draws it
    // as its paragraph's bold opening words.
    const tokens = [s.align ?? "", RUN_IN_TOKEN_RE.test(s.html ?? "") ? "run-in" : ""].filter(Boolean);
    s.html = `<h${capped}${tokens.length > 0 ? ` class="${tokens.join(" ")}"` : ""}>${escapeHtml(s.text)}</h${capped}>`;
  });
}
