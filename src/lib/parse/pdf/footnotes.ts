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
/** The note symbols, in their order of use (*, †, ‡, §, ¶, ‖, then doubled). */
const SYMBOLS = "*∗†‡§¶‖";
const SYMBOL_LABEL_RE = /^([*∗†‡§¶‖]{1,4})/;
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
  if (first?.sup && first.start === 0) {
    const label = line.text.slice(0, first.end).trim();
    if (/^[\p{L}\p{N}*∗†‡§¶‖]{1,4}$/u.test(label)) return label;
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
    if (!line.text.trim() || line.size > size || NUMBER_LINE_RE.test(line.text.trim())) break;
    if (end > start && column[end - 1].y - line.y > line.size * GAP) break;
    if (line.cells.length > 1 && !/^(?:[*∗†‡§¶‖]{1,4}|\d{1,3}|\p{L})$/u.test(line.cells[0].text.trim())) break;
    end++;
  }
  return end;
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

/** The footnotes at the foot of one column, and the lines they leave.
    `continuing`: the page before ended in an unfinished footnote. */
function cutColumn(
  column: Line[],
  rules: Rule[],
  bodySize: number,
  raised: Set<string>,
  continuing: boolean,
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
  if (start >= end) return { kept: column, cuts: [] };
  return { kept: [...column.slice(0, start), ...column.slice(end)], cuts: group(column.slice(start, end), false) };
}

/** Runs cut to [from, to) and moved by `shift`. */
function clipRuns(runs: Run[], from: number, to: number, shift: number): Run[] {
  return runs
    .filter((r) => r.end > from && r.start < to)
    .map((r) => ({ ...r, start: Math.max(r.start, from) + shift, end: Math.min(r.end, to) + shift }));
}

/** A footnote's words: the label, a space, and the words after it. */
function wordsOf(cut: Cut): { text: string; runs: Run[] } {
  const joined = joinGroup(cut.lines, true);
  const after = joined.text.slice(cut.label.length);
  const from = cut.label.length + (after.length - after.trimStart().length);
  const head = cut.label ? cut.label.length + 1 : 0;
  return {
    text: (cut.label ? `${cut.label} ` : "") + joined.text.slice(from),
    runs: [...clipRuns(joined.runs, 0, cut.label.length, 0), ...clipRuns(joined.runs, from, joined.text.length, head - from)],
  };
}

/** The labels a page's body lines raise: the texts of their raised runs, and
    their note symbols set level after a word ("testing***" in MMWR). */
function raisedLabels(lines: Line[]): Set<string> {
  const labels = new Set<string>();
  for (const line of lines) {
    for (const r of line.runs) if (r.sup) labels.add(line.text.slice(r.start, r.end).trim());
    for (const m of line.text.matchAll(/(?<=[^\s*∗†‡§¶‖])[*∗†‡§¶‖]{1,4}(?![*∗†‡§¶‖])/g)) labels.add(m[0]);
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

/** Cut the footnotes out of every page's lines (the pages keep the rest) and
    return them as blocks in reading order, a footnote that runs onto the
    next page joined with its end there. `rules` are each page's drawn rules. */
export function cutFootnotes(pages: Line[][], rules: Rule[][], bodySize: number): Segment[] {
  const footnotes: Segment[] = [];
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
      const cut = cutColumn(notes.kept, pageRules, bodySize, raised, continuing);
      kept.push(...cut.kept);
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
    ? new RegExp(`(?<=[^\\s*∗†‡§¶‖])${escaped}(?![*∗†‡§¶‖])`, "g")
    : new RegExp(`(?<=[\\p{Ll})\\]])${escaped}(?![\\p{L}\\p{N}])`, "gu");
}

/** The places that may be a footnote's reference, best first: a raised run
    that reads its label and stands before a space or a stop (the 2 of
    "SRe²L", a method's name, is no reference), one after a word before one
    after a digit ("10³" is none either); for a note symbol, then, the symbol
    set level after a word. */
function referencesTo(hosts: Segment[], label: string, free: (host: Segment, start: number) => boolean): Found[] {
  const afterWord: Found[] = [];
  const afterDigit: Found[] = [];
  for (const host of hosts) {
    for (const r of host.runs ?? []) {
      if (!r.sup) continue;
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
      for (const m of host.text.matchAll(levelLabel(label))) {
        if (m.index !== undefined && free(host, m.index)) level.push({ host, start: m.index, end: m.index + label.length });
      }
    }
  }
  return [...afterWord, ...afterDigit, ...level];
}

/** Put each footnote after the block that cites it, in the order of their
    references, and give that block its references. A footnote's reference
    is on its page; an endnote's on any page before, and only one place in
    the document may read its label (a web page's formulas raise digits
    too). A table's notes, and a footnote cited in a table's cell, follow
    the table with no reference (the import builds a table from its html);
    a footnote whose reference is not found stays where its page's words
    end. Runs after every pass
    that drops or moves blocks: a reference names its footnote's place in
    the blocks. */
export function placeFootnotes(segments: Segment[], footnotes: Segment[]): Segment[] {
  if (footnotes.length === 0) return segments;
  // The blocks that can hold a reference on each page, its tables, and the
  // last block that begins on each page or before it.
  const onPage = new Map<number, Segment[]>();
  const tablesOn = new Map<number, Segment[]>();
  const lastBy: number[] = [];
  segments.forEach((s, i) => {
    const first = firstPageOf(s);
    lastBy[first] = i;
    const into = holdsReferences(s) ? onPage : s.type === "TABLE" ? tablesOn : null;
    const last = s.breaks?.at(-1)?.page ?? first;
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
    const found = endnote ? (places.length === 1 ? places[0] : null) : (places[0] ?? null);
    let index = -1;
    if (found) {
      used.set(found.host, (used.get(found.host) ?? new Set<number>()).add(found.start));
      refs.set(found.host, [...(refs.get(found.host) ?? []), { start: found.start, end: found.end, note }]);
      index = segments.indexOf(found.host);
    } else {
      const tables = tablesOn.get(page) ?? [];
      const table = (label ? tables.find((t) => levelLabel(label).test(t.text)) : undefined) ?? (tableNotes.has(note) ? tables.at(-1) : undefined);
      if (table) index = segments.indexOf(table);
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
