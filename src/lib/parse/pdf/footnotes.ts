// Footnotes: the words a page sets at the foot of a column, smaller than its
// body, under a short rule or opening with a label the body raises. Census
// class 7: all 20 footnotes of the real documents read as body text, the
// rule's glyphs pasted into the first ("—————— 1 The Elections Clause…"),
// and a paragraph running from one page to the next stayed two blocks with
// the footnotes between its halves. So the footnotes' lines leave each page
// before it is segmented (cutFootnotes), the paragraph they cut joins across
// the break like any other, and each footnote comes back as its own block
// after the block that cites it, linked to its reference (placeFootnotes).

import type { Rule } from "@/lib/parse/pdf/drawing";
import { median } from "@/lib/parse/pdf/geometry";
import { firstPageOf } from "@/lib/parse/pdf/merge";
import { joinGroup } from "@/lib/parse/pdf/text";
import type { Line, Run, Segment } from "@/lib/parse/pdf/types";
import type { FootnoteRef } from "@/lib/parse/types";

/** A footnote line is set at most this share of the body's size: 0.77–0.83
    in the corpus (SCOTUS 9 on 11, arXiv 8.5 on 10.3, Word 9 on 11). */
const SMALL = 0.9;
/** The most a footnote area's lines stand apart, in their size: footnotes
    are set tight, a gap this wide means the lines above are not theirs. */
const GAP = 2.5;
/** The note symbols, in their order of use (*, †, ‡, §, ¶, ‖, then doubled).
    MNRAS sets ⋆ for the first and ∥ for the sixth: its six author notes
    read as one note and a line of the body (arXiv 2503.22874). */
const SYMBOLS = "*∗⋆†‡§¶‖∥";
const SYMBOL = `[${SYMBOLS}]`;
const SYMBOL_LABEL_RE = new RegExp(`^(${SYMBOL}{1,4})`);
/** A raised label: a number, a letter, or note symbols. */
const RAISED_LABEL_RE = new RegExp(`^[\\p{L}\\p{N}${SYMBOLS}]{1,4}$`, "u");
/** A table row's first cell that is a note's label. */
const CELL_LABEL_RE = new RegExp(`^(?:${SYMBOL}{1,4}|\\d{1,3}|\\p{L})$`, "u");
/** Where a note symbol set level stands: after a word ("testing***" in
    MMWR), or after a CJK character and a gap, as CJK text carries no
    spaces (a Japanese author line read "知希 †"). */
const AFTER_WORD = `(?:(?<=[^\\s${SYMBOLS}])|(?<=[\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Hangul}]\\s))`;
const LEVEL_SYMBOLS_RE = new RegExp(`${AFTER_WORD}${SYMBOL}{1,4}(?!${SYMBOL})`, "gu");
/** A mark or a group of marks ("†,††"), which TeX sets as one formula. */
const MARKS_RE = new RegExp(`^[\\s,${SYMBOLS}]+$`);
/** A note symbol after a space, where lastIndex stands. */
const SPACED_SYMBOLS_RE = new RegExp(`\\s{1,2}(${SYMBOL}{1,4})(?![${SYMBOLS}\\p{L}\\p{N}])`, "uy");
/** A rule set as glyphs: SCOTUS draws its footnote rule as "——————". */
const RULE_GLYPHS_RE = /^[—―─_‒–-]{3,}$/;

/** A footnote's layout token: the reader draws it small (block-view.tsx). */
const FOOTNOTE_HTML = '<p class="footnote">';

/** A footnote cut from a page, before its words are joined. */
type Cut = { label: string; lines: Line[] };

/** The label a footnote line opens with: a raised run ("1", "¶¶", "a"), a
    note symbol set level ("*", "***": MMWR's), or, under a rule, a number in
    a cell of its own; null when the line opens with words. */
function labelOf(line: Line, ruled: boolean): string | null {
  const first = line.runs[0];
  if (first?.sup && !first.zone && first.start === 0) {
    const label = line.text.slice(0, first.end).trim();
    if (RAISED_LABEL_RE.test(label)) return label;
  }
  const symbol = SYMBOL_LABEL_RE.exec(line.text)?.[1];
  if (symbol) return symbol;
  // A number set level is a label only in a cell of its own ("1⇥Text"):
  // MMWR's footnote went on "5 U.S.C. Sect. 552a" at a line's start.
  return ruled && line.cells.length > 1 && /^\d{1,3}$/.test(line.cells[0].text.trim()) ? line.cells[0].text.trim() : null;
}

/** Each column's lines in reading order: a line above the one before it
    starts the next column. */
function columnsOf(lines: Line[]): Line[][] {
  const columns: Line[][] = [];
  for (const line of lines) {
    const prev = columns.at(-1)?.at(-1);
    if (!prev || line.y > prev.y + Math.max(line.size, prev.size)) columns.push([line]);
    else columns.at(-1)?.push(line);
  }
  return columns;
}

/** A lone page number the furniture pass left under a column's foot. */
const NUMBER_LINE_RE = /^\d{1,4}$/;
/** A note's number as a scan's text layer reads it: 1 as I or l, 0 as O or
    o, its digits apart ("I I." for 11, "2 I." for 21), its period as "_".
    A number read with a letter takes its period or a tab after it: "I
    have" opens no note. */
const SCAN_LABEL_RE = /^([\dIlOo](?: ?[\dIlOo]){0,2}(?:[._]|(?=\t))|\d{1,3}(?= ))/;
/** A gap between a column's lines this many times their usual one sets a
    scan's notes apart from its body (36 pt under 11 pt lines). */
const WIDE = 2.2;
/** The most lines a footnote area may leave under it: a running foot and a
    page number. */
const UNDER = 2;

/** Where the small lines from `start` end: a footnote area's lines are set
    no larger than `size` and close together, and none is a table's row
    (cells after a first cell that is no label) or a line with no words (a
    table the page lifted out of the flow stands in its lines as one). */
function smallRun(column: Line[], start: number, size: number): number {
  let end = start;
  while (end < column.length) {
    const line = column[end];
    if (!line.text.trim() || textSize(line) > size || NUMBER_LINE_RE.test(line.text.trim())) break;
    if (end > start && column[end - 1].y - line.y > line.size * GAP) break;
    if (line.cells.length > 1 && !CELL_LABEL_RE.test(line.cells[0].text.trim())) break;
    end++;
  }
  return end;
}

/** The size most of a line's letters are set in: a symbol set larger than
    the words (Springer's ✉ at 11.6 pt before an 8 pt contact line) leaves
    the line at its words' size. */
function textSize(line: Line): number {
  const letters = new Map<number, number>();
  for (const item of line.items) {
    const n = item.str.match(/[\p{L}\p{N}]/gu)?.length ?? 0;
    if (n > 0) letters.set(item.size, (letters.get(item.size) ?? 0) + n);
  }
  return letters.size > 0 ? [...letters].reduce((a, b) => (b[1] > a[1] ? b : a))[0] : line.size;
}

/** A page's horizontal rules with the segments that meet end to end joined:
    MMWR draws a table's border one cell at a time, and its first cell's
    piece read as a short footnote rule. */
function joinedRules(rules: Rule[]): Rule[] {
  const out: Rule[] = [];
  for (const r of rules.filter((r) => r.dir === "h").sort((a, b) => a.y1 - b.y1 || a.x1 - b.x1)) {
    const last = out.at(-1);
    if (last && Math.abs(last.y1 - r.y1) <= 1 && r.x1 <= last.x2 + 1) last.x2 = Math.max(last.x2, r.x2);
    else out.push({ ...r });
  }
  return out;
}

/** A footnote rule: short (a footnote rule is a third to two fifths of the
    column; a table's border runs its width) and at the column's left edge. */
function isShortRule(x1: number, x2: number, left: number, right: number, size: number): boolean {
  return Math.abs(x1 - left) <= size * 2 && x2 - x1 >= size * 2 && x2 - x1 <= (right - left) * 0.6;
}

/** Lines as footnotes: a line with a label opens one; the first line without
    a label opens one with no label. */
function group(lines: Line[], ruled: boolean): Cut[] {
  const cuts: Cut[] = [];
  for (const line of lines) {
    const label = labelOf(line, ruled);
    const last = cuts.at(-1);
    if (label !== null || !last) cuts.push({ label: label ?? "", lines: [line] });
    else last.lines.push(line);
  }
  return cuts;
}

/** The number a scan's note label reads ("I I." is 11), or null. */
function scanNumber(label: string): number | null {
  const digits = label.replace(/[\s._]/g, "").replace(/[Il]/g, "1").replace(/[Oo]/g, "0");
  return /^[1-9]\d{0,2}$/.test(digits) ? Number(digits) : null;
}

/** A scan's numbered notes (a book under an OCR layer, NASA SP-4408): the
    layer sizes each line from the scan, so the notes read at the body's
    size, and it reads the body's raised marks as quote signs ("1945.'"),
    so no label is raised. The notes stand after the column's last wide
    gap, each opening with its number, and the numbers count: the first is
    1 (a chapter's first), or the one after the page before's last, or two
    in a row. A line that opens with another number is a note's line ("9
    or 10, 1945" inside note 2). The book's notes read as numbered lists
    and paragraphs of the body, their numbers lost. */
function cutScanNotes(column: Line[], end: number, continuing: boolean, counted: number): { kept: Line[]; cuts: Cut[] } | null {
  const gaps = column
    .slice(1, end)
    .map((line, k) => column[k].y - line.y)
    .filter((gap) => gap > 0)
    .sort((a, b) => a - b);
  const usual = gaps[Math.floor(gaps.length / 2)];
  if (usual === undefined) return null;
  let start = end - 1;
  while (start > 0 && column[start - 1].y - column[start].y <= usual * WIDE) start--;
  if (start <= 0) return null;
  // A number line set close under the notes is their last line ("1995"
  // ending a note), not the page's number.
  let stop = end;
  while (stop < column.length && column[stop - 1].y - column[stop].y <= usual) stop++;
  const cuts: Cut[] = [];
  const numbers: number[] = [];
  for (const line of column.slice(start, stop)) {
    const label = SCAN_LABEL_RE.exec(line.text)?.[1] ?? "";
    const n = scanNumber(label);
    if (n !== null && (numbers.length === 0 || n === numbers[numbers.length - 1] + 1)) {
      cuts.push({ label: label.trim(), lines: [line] });
      numbers.push(n);
    } else if (cuts.length > 0) cuts[cuts.length - 1].lines.push(line);
    else if (continuing) cuts.push({ label: "", lines: [line] });
    else return null;
  }
  const counts = numbers.length >= 2 || numbers[0] === 1 || numbers[0] === counted + 1 || (numbers.length === 0 && continuing);
  return counts ? { kept: [...column.slice(0, start), ...column.slice(stop)], cuts } : null;
}

/** Lines with no label as notes, one opening at each first-line indent
    (IEEE's title notes: "Manuscript received …", then each affiliation). */
function indentedNotes(lines: Line[]): Cut[] {
  const left = Math.min(...lines.map((l) => l.x));
  const cuts: Cut[] = [];
  for (const line of lines) {
    const last = cuts.at(-1);
    if (!last || line.x > left + line.size * 0.5) cuts.push({ label: "", lines: [line] });
    else last.lines.push(line);
  }
  return cuts;
}

/** The footnotes at the foot of one column, and the lines they leave.
    `continuing`: the page before ended in an unfinished footnote. `scan`:
    the page is a scan's text layer, `counted` the last number of its
    notes so far. `lead`: small lines above the foot's first labeled note
    are notes too (the first page, or a page after an unfinished note). */
function cutColumn(
  column: Line[],
  rules: Rule[],
  bodySize: number,
  raised: Set<string>,
  continuing: boolean,
  scan: boolean,
  counted: number,
  lead: boolean,
  titlePage: boolean,
): { kept: Line[]; cuts: Cut[] } {
  const left = Math.min(...column.map((l) => l.x));
  const right = Math.max(...column.map((l) => l.xEnd));
  // Under a rule, the small lines are footnotes: a rule of glyphs (it goes
  // with them), or a drawn one. Only a running foot and a page number may
  // stand under them, and they must open with a label or finish the page
  // before's footnote (a signature line has small words under it too).
  for (let k = 0; k < column.length; k++) {
    const line = column[k];
    const glyphs = RULE_GLYPHS_RE.test(line.text.replace(/\s/g, "")) && isShortRule(line.x, line.xEnd, left, right, line.size);
    const drawn =
      !glyphs &&
      rules.some(
        (r) =>
          r.dir === "h" &&
          r.y1 > line.y + line.size * 0.5 &&
          (k === 0 || r.y1 < column[k - 1].y) &&
          isShortRule(r.x1, r.x2, left, right, line.size),
      );
    if (!glyphs && !drawn) continue;
    const start = glyphs ? k + 1 : k;
    // Under a rule, a line that opens with a label is a footnote at any
    // size: a Chinese paper set its footnote larger than its body.
    const first = column[start];
    const size = first && labelOf(first, true) !== null ? Math.max(bodySize * SMALL, first.size * 1.02) : bodySize * SMALL;
    const end = smallRun(column, start, size);
    if (end === start || column.length - end > UNDER) continue;
    const cuts = group(column.slice(start, end), true);
    if (!cuts.some((c) => c.label) && !continuing) continue;
    return { kept: [...column.slice(0, k), ...column.slice(end)], cuts };
  }
  // No rule (IEEEtran, Word exports): the column's last small lines, from
  // the first whose label the page raises in its body.
  let end = column.length;
  while (end > 0 && NUMBER_LINE_RE.test(column[end - 1].text.trim())) end--;
  let from = end;
  while (from > 0 && smallRun(column, from - 1, bodySize * SMALL) >= end) from--;
  let start = from;
  while (start < end && !raised.has(labelOf(column[start], false) ?? "")) start++;
  if (start < end) {
    // The small lines above the first labeled note: on the first page the
    // title's own notes, which IEEE sets with no mark (all three of a
    // paper's read as body text); on a later page the end of the page
    // before's note.
    const top = lead ? from : start;
    const cuts = [...(top < start ? indentedNotes(column.slice(top, start)) : []), ...group(column.slice(start, end), false)];
    return { kept: [...column.slice(0, top), ...column.slice(end)], cuts };
  }
  return (titlePage && titleNotes(column, end, bodySize, raised)) || (scan && cutScanNotes(column, end, continuing, counted)) || { kept: column, cuts: [] };
}

/** The first words of a note on a paper's title: its subject
    classification, keywords, date, support, and IEEE's editor ("The
    associate editor coordinating the review of this manuscript and
    approving it for publication was …", unmarked at the first column's
    foot). */
const TITLE_NOTE_RE =
  /^(?:(?:19|20)\d\d )?Mathematics Subject Classification|^Key ?words(?: and phrases)?\b|^Date:|^Received\b|^(?:This (?:work|research) (?:was|is) )?(?:partially |partly )?(?:supported|funded) by\b|^The associate editor coordinating the review\b/i;

/** The notes a first page sets at a column's foot about the title and its
    authors, with no mark in the text: amsart's subject classification,
    keywords, and date (arXiv 2506.08494, 2410.04586: read as paragraphs),
    and acmart's note on the authors over their contact block, a gap
    between them (arXiv 2609.29669). The column's last small lines, notes
    apart by a gap as wide as three of their lines at most, when one opens
    with a label the page raises or the first reads as such a note. Each
    labeled line opens a note, and so does a line after a gap. */
function titleNotes(column: Line[], end: number, bodySize: number, raised: Set<string>): { kept: Line[]; cuts: Cut[] } | null {
  // Against the page's own body where it is set larger than the document's:
  // a survey's 7 pt tables and references outnumber its 9 pt text.
  const prose = column.filter((l) => l.cells.length === 1 && l.text.length > 40).map((l) => l.size);
  const body = Math.max(bodySize, prose.length >= 5 ? median(prose) : 0);
  let top = end;
  while (top > 0 && column[top - 1].text.trim() && column[top - 1].size <= body * SMALL && (top === end || column[top - 1].y - column[top].y <= column[top].size * 4)) top--;
  const area = column.slice(top, end);
  if (area.length === 0 || (!area.some((l) => raised.has(labelOf(l, false) ?? "")) && !TITLE_NOTE_RE.test(area[0].text))) return null;
  const cuts: Cut[] = [];
  area.forEach((line, k) => {
    const label = labelOf(line, false);
    const apart = k > 0 && area[k - 1].y - line.y > line.size * 2;
    if (k === 0 || (label !== null && raised.has(label)) || apart) cuts.push({ label: label !== null && raised.has(label) ? label : "", lines: [line] });
    else cuts[cuts.length - 1].lines.push(line);
  });
  return { kept: [...column.slice(0, top), ...column.slice(end)], cuts };
}

/** Runs cut to [from, to) and moved by `shift`. */
function clipRuns(runs: Run[], from: number, to: number, shift: number): Run[] {
  return runs
    .filter((r) => r.end > from && r.start < to)
    .map((r) => ({ ...r, start: Math.max(r.start, from) + shift, end: Math.min(r.end, to) + shift }));
}

/** A footnote's words: the label, a space, and the words after it. The
    label is a mark, never a formula: TeX sets † and ‡ in a math font, and
    a label read as a formula lost its words in the import (arXiv
    2503.22874's author notes). */
function wordsOf(cut: Cut): { text: string; runs: Run[] } {
  const joined = joinGroup(cut.lines, true);
  const after = joined.text.slice(cut.label.length);
  const from = cut.label.length + (after.length - after.trimStart().length);
  const head = cut.label ? cut.label.length + 1 : 0;
  const label = clipRuns(joined.runs, 0, cut.label.length, 0).map((r) => ({ ...r, zone: undefined }));
  return {
    text: (cut.label ? `${cut.label} ` : "") + joined.text.slice(from),
    runs: [...label, ...clipRuns(joined.runs, from, joined.text.length, head - from)],
  };
}

/** The note symbols set after a raised run and a space: TeX sets an author's
    note mark in a math font after the affiliation's number ("Sahu¹ ⋆",
    "Qi,³ ⁴ ∗"), and a math glyph is never flagged raised (lines.ts), so the
    mark reads level. MNRAS's and REVTeX's author notes lost their marks. */
function marksAfterRaised(text: string, runs: Run[]): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  for (const r of runs) {
    if (!r.sup || r.zone) continue;
    SPACED_SYMBOLS_RE.lastIndex = r.end;
    const m = SPACED_SYMBOLS_RE.exec(text);
    if (m) out.push({ start: r.end + m[0].length - m[1].length, end: r.end + m[0].length });
  }
  return out;
}

/** The labels a page's body lines raise: the texts of their raised runs,
    their note symbols set level after a word ("testing***" in MMWR), and
    the symbols set after a raised run. */
function raisedLabels(lines: Line[]): Set<string> {
  const labels = new Set<string>();
  for (const line of lines) {
    for (const r of line.runs) if (r.sup && !r.zone) labels.add(line.text.slice(r.start, r.end).trim());
    for (const m of line.text.matchAll(LEVEL_SYMBOLS_RE)) labels.add(m[0]);
    for (const m of marksAfterRaised(line.text, line.runs)) labels.add(line.text.slice(m.start, m.end));
  }
  return labels;
}

/** Endnotes: footnotes a document sets after its last words, their
    references on earlier pages (a web page printed from a browser). */
const endnotes = new WeakSet<Segment>();
/** A table's notes: they follow their table and link to no reference. */
const tableNotes = new WeakSet<Segment>();

/** The notes under each table of a column: its small lines right under the
    table, from the first that opens with a label ("*", "†", a raised "a").
    A table lifted out of the flow stands in its column as one line with no
    words. MMWR's notes read as a list ("*" taken for a bullet) and as
    paragraphs cut from their symbols; a line before the first label
    ("Abbreviations: …") stays words of the page. The notes start within
    about two lines under the table's bottom edge, with no footnote rule
    between: the page's footnote under its rule, below a table that ends
    the page, read as the table's note and lost its mark (Word's footnote
    under Table 2 of the synthetic tables document). */
function cutTableNotes(column: Line[], rules: Rule[], bodySize: number): { kept: Line[]; cuts: Cut[] } {
  const left = Math.min(...column.map((l) => l.x));
  const right = Math.max(...column.map((l) => l.xEnd));
  const kept: Line[] = [];
  const cuts: Cut[] = [];
  for (let k = 0; k < column.length; k++) {
    kept.push(column[k]);
    if (column[k].text.trim()) continue;
    const end = smallRun(column, k + 1, bodySize * SMALL);
    let first = k + 1;
    while (first < end && labelOf(column[first], false) === null) first++;
    if (first >= end) continue;
    const bottom = column[k].yMin;
    const top = column[k + 1];
    const ruled = rules.some((r) => r.y1 < bottom && r.y1 > top.y + top.size * 0.5 && isShortRule(r.x1, r.x2, left, right, top.size));
    if (bottom - top.y > top.size * 3 || ruled) continue;
    kept.push(...column.slice(k + 1, first));
    cuts.push(...group(column.slice(first, end), false));
    k = end - 1;
  }
  return { kept, cuts };
}

/** Notes set under a short rule inside a column rather than at its foot:
    REVTeX sets the author notes (∗ † ‡ and the authors' e-mails) at the
    head of the bibliography, under a centered rule, and they read as a
    bulleted list (arXiv 2504.02736). The lines right under the rule that
    open with a note symbol another page raises (`raised`), each note with
    its lines set in from its label; the lines after them stay. A label
    the page itself raises is a page's footnote, a table's note, or a
    title's note, which the foot's own rules read. */
function cutHeadNotes(column: Line[], rules: Rule[], bodySize: number, raised: Set<string>): { kept: Line[]; cuts: Cut[] } {
  const left = Math.min(...column.map((l) => l.x));
  const right = Math.max(...column.map((l) => l.xEnd));
  // Under a rule a labeled line is a note at the body's size or under it:
  // REVTeX sets its notes at 9 pt under a 10 pt body.
  const note = (line: Line) => {
    const label = SYMBOL_LABEL_RE.exec(line.text)?.[1];
    return label && raised.has(label) && line.size < bodySize ? label : null;
  };
  for (let k = 1; k < column.length; k++) {
    const first = column[k];
    if (!note(first)) continue;
    const size = first.size;
    const ruled = rules.some(
      (r) =>
        r.dir === "h" &&
        r.y1 > first.y + size * 0.5 &&
        r.y1 < column[k - 1].y &&
        r.x1 >= left - size &&
        r.x2 <= right + size &&
        r.x2 - r.x1 >= size * 2 &&
        r.x2 - r.x1 <= (right - left) * 0.6,
    );
    if (!ruled) continue;
    const cuts: Cut[] = [];
    let end = k;
    for (; end < column.length; end++) {
      const line = column[end];
      const label = note(line);
      const open = cuts.at(-1);
      if (label) cuts.push({ label, lines: [line] });
      else if (open && line.size <= open.lines[0].size * 1.02 && line.x > open.lines[0].x + line.size * 0.5) open.lines.push(line);
      else break;
    }
    if (end < column.length) return { kept: [...column.slice(0, k), ...column.slice(end)], cuts };
  }
  return { kept: column, cuts: [] };
}

/** Cut the footnotes out of every page's lines (the pages keep the rest) and
    return them as blocks in reading order, a footnote that runs onto the
    next page joined with its end there. `rules` are each page's drawn rules;
    `scans` says which pages are a scan's text layer. */
export function cutFootnotes(pages: Line[][], rules: Rule[][], bodySize: number, scans: boolean[]): Segment[] {
  const footnotes: Segment[] = [];
  // The last number of a scan's notes: the next page's notes count on.
  let counted = 0;
  // The labels each page's body raises: the lines above each column's
  // small ones. On the last page with words, a label raised on any page:
  // the notes there may be endnotes.
  const pageColumns = pages.map(columnsOf);
  const raisedOn = pageColumns.map((columns) =>
    raisedLabels(
      columns.flatMap((column) => {
        let from = column.length;
        while (from > 0 && column[from - 1].size <= bodySize * SMALL) from--;
        return column.slice(0, from);
      }),
    ),
  );
  const lastPage = pages.findLastIndex((lines) => lines.length > 0);
  const raisedAnywhere = new Set(raisedOn.flatMap((labels) => [...labels]));
  // The labels other pages raise and a page does not.
  const raisedElsewhere = (page: number) => new Set([...raisedAnywhere].filter((label) => !raisedOn[page].has(label)));
  pages.forEach((lines, p) => {
    const columns = pageColumns[p];
    const raised = p === lastPage ? raisedAnywhere : raisedOn[p];
    const pageRules = joinedRules(rules[p] ?? []);
    const kept: Line[] = [];
    columns.forEach((column) => {
      const last = footnotes.at(-1);
      const continuing = last !== undefined && (last.breaks?.at(-1)?.page ?? last.page) === p - 1 && !/[.!?)\]”"’]$/.test(last.text.trim());
      const notes = cutTableNotes(column, pageRules, bodySize);
      for (const one of notes.cuts) {
        const { text, runs } = wordsOf(one);
        const note: Segment = { type: "PARAGRAPH", text, html: FOOTNOTE_HTML, page: p, runs, footnote: { label: one.label } };
        tableNotes.add(note);
        footnotes.push(note);
      }
      // Notes under a rule inside the column whose labels another page
      // raises: endnotes, their references on earlier pages.
      const head = cutHeadNotes(notes.kept, pageRules, bodySize, raisedElsewhere(p));
      for (const one of head.cuts) {
        const { text, runs } = wordsOf(one);
        const note: Segment = { type: "PARAGRAPH", text, html: FOOTNOTE_HTML, page: p, runs, footnote: { label: one.label } };
        endnotes.add(note);
        footnotes.push(note);
      }
      const cut = cutColumn(head.kept, pageRules, bodySize, raised, continuing, scans[p] === true, counted, continuing || p === 0, p === 0);
      kept.push(...cut.kept);
      if (scans[p]) counted = cut.cuts.reduce((n, one) => scanNumber(one.label) ?? n, counted);
      for (const one of cut.cuts) {
        const { text, runs } = wordsOf(one);
        // Words with no label at the top of a foot finish the last footnote
        // of the page before (LaTeX splits a long footnote).
        if (!one.label && continuing && last) {
          const offset = last.text.length + 1;
          last.breaks = [...(last.breaks ?? []), { offset, page: p }];
          last.text = `${last.text} ${text}`;
          last.runs = [...(last.runs ?? []), ...runs.map((r) => ({ ...r, start: r.start + offset, end: r.end + offset }))];
          continue;
        }
        const footnote: Segment = { type: "PARAGRAPH", text, html: FOOTNOTE_HTML, page: p, runs, footnote: { label: one.label } };
        if (p === lastPage && one.label && !raisedOn[p].has(one.label)) endnotes.add(footnote);
        footnotes.push(footnote);
      }
    });
    pages[p] = kept;
  });
  return footnotes;
}

// ── Placing ─────────────────────────────────────────────────────────────────

/** The page (0-based) the words at `offset` of a segment stand on. */
function pageAt(s: Segment, offset: number): number {
  let page = firstPageOf(s);
  for (const b of s.breaks ?? []) if (b.offset <= offset) page = b.page;
  return page;
}

/** A block that can hold a reference: words a reader reads in their place. */
function holdsReferences(s: Segment): boolean {
  return (s.type === "PARAGRAPH" || s.type === "HEADING" || s.type === "LIST") && !s.footnote;
}

type Found = { host: Segment; start: number; end: number };

const isSymbols = (label: string) => [...label].every((ch) => SYMBOLS.includes(ch));

/** A label set level after a word: a note symbol after anything but a space
    ("testing***" in MMWR), a number or a letter after a lowercase letter or
    a closing bracket ("renewal2" in a Word table's cell). */
function levelLabel(label: string): RegExp {
  const escaped = label.replaceAll("*", "\\*");
  return isSymbols(label)
    ? new RegExp(`${AFTER_WORD}${escaped}(?!${SYMBOL})`, "gu")
    : new RegExp(`(?<=[\\p{Ll})\\]])${escaped}(?![\\p{L}\\p{N}])`, "gu");
}

/** The places that may be a footnote's reference, best first: a raised run
    that reads its label and stands before a space or a stop (the 2 of
    "SRe²L", a method's name, is no reference), one after a word before one
    after a digit ("10³" is none either); for a note symbol, then, the symbol
    set level after a word or after a raised run and a space. */
function referencesTo(hosts: Segment[], label: string, free: (host: Segment, start: number) => boolean): Found[] {
  const afterWord: Found[] = [];
  const afterDigit: Found[] = [];
  // A formula's script is no mark: a formula that failed its check keeps its
  // scripts raised (math/zones.ts part).
  for (const host of hosts) {
    for (const r of host.runs ?? []) {
      if (!r.sup || r.zone) continue;
      const raw = host.text.slice(r.start, r.end);
      if (raw.trim() !== label) continue;
      const start = r.start + (raw.length - raw.trimStart().length);
      const end = start + label.length;
      if (!free(host, start) || /[\p{L}\p{N}]/u.test(host.text[end] ?? "")) continue;
      (/\d/.test(host.text[start - 1] ?? "") ? afterDigit : afterWord).push({ host, start, end });
    }
  }
  const level: Found[] = [];
  if (isSymbols(label)) {
    for (const host of hosts) {
      const spaced = marksAfterRaised(host.text, host.runs ?? []).filter((m) => host.text.slice(m.start, m.end) === label);
      const starts = [...[...host.text.matchAll(levelLabel(label))].map((m) => m.index ?? -1), ...spaced.map((m) => m.start)];
      for (const start of starts.sort((a, b) => a - b)) {
        if (start >= 0 && free(host, start)) level.push({ host, start, end: start + label.length });
      }
    }
  }
  return [...afterWord, ...afterDigit, ...level];
}

/** Put each footnote after the block that cites it, in the order of their
    references, and give that block its references. A footnote's reference
    is on its page; an endnote's on any page before, and only one place in
    the document may read its label (a web page's formulas raise digits
    too). A footnote cited in a table's cell follows the table, which holds
    its reference; a table's own notes follow it with no reference; a
    footnote whose reference is not found stays after the last block that
    ends on its page, else where its page's words end. Runs after every pass
    that drops or moves blocks: a reference names its footnote's place in
    the blocks. */
export function placeFootnotes(segments: Segment[], footnotes: Segment[]): Segment[] {
  if (footnotes.length === 0) return segments;
  // The blocks that can hold a reference on each page, its tables, the
  // last block that begins on each page or before it, and the last block
  // that ends on each page, a heading aside (a note stood between a
  // heading and its paragraph).
  const onPage = new Map<number, Segment[]>();
  const tablesOn = new Map<number, Segment[]>();
  const lastBy: number[] = [];
  const endsOn = new Map<number, number>();
  segments.forEach((s, i) => {
    const first = firstPageOf(s);
    lastBy[first] = i;
    const into = holdsReferences(s) ? onPage : s.type === "TABLE" ? tablesOn : null;
    const last = s.breaks?.at(-1)?.page ?? first;
    if (s.type !== "HEADING") endsOn.set(last, i);
    for (let p = first; into && p <= last; p++) into.set(p, [...(into.get(p) ?? []), s]);
  });
  const used = new Map<Segment, Set<number>>();
  // What goes after each block (-1: before the first), at its reference's
  // offset, or at the block's end.
  const after = new Map<number, { at: number; note: Segment }[]>();
  const refs = new Map<Segment, { start: number; end: number; note: Segment }[]>();
  const hosts = segments.filter(holdsReferences);
  for (const note of footnotes) {
    const page = firstPageOf(note);
    const label = note.footnote?.label ?? "";
    const endnote = endnotes.has(note);
    const free = (host: Segment, start: number) =>
      !used.get(host)?.has(start) && (endnote ? pageAt(host, start) <= page : pageAt(host, start) === page);
    const places = label && !tableNotes.has(note) ? referencesTo(endnote ? hosts : (onPage.get(page) ?? []), label, free) : [];
    let found = endnote ? (places.length === 1 ? places[0] : null) : (places[0] ?? null);
    // A footnote cited in a table's cell ("renewal2" in a Word table): the
    // table holds its reference, set level after a word, so the import puts
    // the number in the cell (synth-report-docx). A table stands apart from
    // its page's lines, so a note on the last page that the table cites
    // counts as an endnote: it takes the table's place when that is the one
    // place that reads its label. A table's own notes ("*", "a") link to
    // none: a table cites them from many cells.
    if (!found && label && !tableNotes.has(note) && !(endnote && places.length > 0)) {
      const tables = endnote ? segments.filter((s) => s.type === "TABLE") : (tablesOn.get(page) ?? []);
      const cells = tables.flatMap((t) =>
        [...t.text.matchAll(levelLabel(label))].flatMap((m) => (m.index !== undefined && free(t, m.index) ? [{ host: t, start: m.index, end: m.index + label.length }] : [])),
      );
      if (endnote ? cells.length === 1 : cells.length > 0) found = cells[0];
    }
    let index = -1;
    if (found) {
      // A mark read as a formula (TeX sets § and ¶, and a group "†,††", in
      // a math font) is words again: the import puts a footnote's number
      // only where words stand.
      const { host, start, end } = found;
      host.runs = host.runs?.map((r) => (r.zone && r.start < end && start < r.end && MARKS_RE.test(host.text.slice(r.start, r.end)) ? { ...r, zone: undefined } : r));
      used.set(found.host, (used.get(found.host) ?? new Set<number>()).add(found.start));
      refs.set(found.host, [...(refs.get(found.host) ?? []), { start: found.start, end: found.end, note }]);
      index = segments.indexOf(found.host);
    } else {
      const tables = tablesOn.get(page) ?? [];
      const table = (label ? tables.find((t) => levelLabel(label).test(t.text)) : undefined) ?? (tableNotes.has(note) ? tables.at(-1) : undefined);
      // A note with no reference stands before a paragraph that runs on to
      // the next page: after it, the import read the note on that next page
      // (a scanned book's notes, whose marks its text layer cannot read).
      const ending = endsOn.get(page);
      if (table) index = segments.indexOf(table);
      else if (ending !== undefined) index = ending;
      else for (let p = 0; p <= page; p++) if (lastBy[p] !== undefined) index = Math.max(index, lastBy[p]);
    }
    after.set(index, [...(after.get(index) ?? []), { at: found?.start ?? Infinity, note }]);
  }
  const out: Segment[] = [];
  const emit = (i: number) => {
    for (const { note } of [...(after.get(i) ?? [])].sort((a, b) => a.at - b.at)) out.push(note);
  };
  emit(-1);
  segments.forEach((s, i) => {
    out.push(s);
    emit(i);
  });
  const order = new Map(out.map((s, i) => [s, i]));
  for (const [host, list] of refs) {
    const own: FootnoteRef[] = list.map((r) => ({ start: r.start, end: r.end, targetOrder: order.get(r.note) ?? 0 }));
    host.footnoteRefs = own.sort((a, b) => a.start - b.start);
  }
  return out;
}
