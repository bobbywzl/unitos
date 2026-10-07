// Contents lists: the label that opens one, its entries, and the links from
// each entry to the heading it names.

import { geom } from "@/lib/parse/pdf/geometry";
import { TextBuilder, lineAsPart } from "@/lib/parse/pdf/text";
import type { Line, Run, Segment, Step } from "@/lib/parse/pdf/types";
import type { LinkSpan } from "@/lib/parse/types";

export const TOC_LABEL_RE = /^((appendix )?contents|table of contents|inside|outline|in this issue)$/i;
export const TOC_ENTRY_RE = /^(\d{1,2}|[A-Z])(?:\.\d{1,2})*[.)]?\s+\S/;
// Leader dots and the page number at the end of a contents entry: the reader
// has no pages to turn to.
export const TOC_TAIL_RE = /(?:\s*\.){3,}\s*\d{1,4}\s*$|\s+\d{1,4}\s*$/;
function tocEntryPart(line: Line): { text: string; runs: Run[] } {
  const part = lineAsPart(line);
  const text = part.text.replace(TOC_TAIL_RE, "").trimEnd();
  return { text, runs: part.runs.map((r) => ({ ...r, end: Math.min(r.end, text.length) })).filter((r) => r.end > r.start) };
}

// An entry: a numbered title ("4.2 Soil samples …"), or a title with its
// page number in a cell of its own ("Glossary  88").
export function isContentsEntry(line: Line): boolean {
  return (line.cells.length <= 2 || TOC_TAIL_RE.test(line.text)) && (TOC_ENTRY_RE.test(line.text) || (line.cells.length === 2 && /^\d{1,4}$/.test(line.cells[1].text.trim())));
}

// A contents list reads as one in the reader and the import (the converter
// makes each entry a paragraph that links to its heading).
const CONTENTS_HTML = '<ol class="contents"></ol>';

// An entry's depth is its number's: "2" and "B" 0, "2.1" 1, "2.1.3" 2.
function entryDepth(text: string): number {
  return (/^(?:\d{1,2}|[A-Z])((?:\.\d{1,2})*)/.exec(text)?.[1].match(/\./g) ?? []).length;
}

// The entries after a contents label, one LIST with an entry per line, two
// spaces per depth; each numbered entry links to its heading once the blocks
// exist. A title too long for its line wraps onto the next, which carries
// the page number: the wrap finishes its entry, a line's pitch under it
// (`leading`, the page's: a double-spaced paper's contents set its wrap two
// lines' height under the entry, and the entries after it read as
// paragraphs).
export function readContentsEntries(lines: Line[], i: number, leading: number): Step {
  const builder = new TextBuilder();
  const entries: { start: number; end: number; num: number }[] = [];
  let j = i;
  while (j < lines.length) {
    const entry = lines[j];
    const last = entries[entries.length - 1];
    // A line with no cells is a ruled table taken out of the flow, never
    // an entry's wrap; an unnumbered line under an entry with no page
    // number is its wrap, its own page number or not ("…Subdivi-" over
    // "sions  49").
    const wrap =
      j > i &&
      entry.cells.length > 0 &&
      !TOC_ENTRY_RE.test(entry.text) &&
      !TOC_TAIL_RE.test(lines[j - 1].text) &&
      entry.x > lines[j - 1].x &&
      entry.y < lines[j - 1].y &&
      lines[j - 1].y - entry.y <= entry.size * Math.max(1.6, leading * 1.2);
    if (wrap) {
      const part = tocEntryPart(entry);
      builder.append(part, " ");
      if (last) last.end = builder.text.length;
      j++;
      continue;
    }
    // A line set larger than the first entry is the heading after the
    // list (parse loop finding: The Art of Linear Algebra's contents took
    // the 14 pt "1 Viewing a Matrix – 4 Ways" under it, and its first
    // paragraph as that entry's wrap).
    if (!isContentsEntry(entry) || (j > i && entry.size > lines[i].size * 1.14)) break;
    const indent = "  ".repeat(entryDepth(entry.text));
    const part = tocEntryPart(entry);
    const start = (builder.text.length === 0 ? 0 : builder.text.length + 1) + indent.length;
    builder.append({ text: indent + part.text, runs: part.runs.map((r) => ({ ...r, start: r.start + indent.length, end: r.end + indent.length })) }, "\n");
    const m = TOC_ENTRY_RE.exec(entry.text);
    if (m && /^\d+$/.test(m[1])) entries.push({ start, end: start + part.text.length, num: Number(m[1]) });
    j++;
  }
  const list: Segment = {
    type: "LIST",
    text: builder.text,
    html: CONTENTS_HTML,
    page: lines[i].page,
    runs: builder.runs,
    tocEntries: entries,
    ...geom(lines.slice(i, j)),
  };
  return { segments: [list], next: j };
}

// A two-column run of numbered entries is a contents list read column-wise,
// not a table: left column top to bottom, then right column.
export function twoColumnList(run: Line[]): Segment | null {
  if (run.length < 2 || !run.every((l) => l.cells.length === 2)) return null;
  const cells = run.flatMap((l) => l.cells);
  const numbered = cells.filter((c) => TOC_ENTRY_RE.test(c.text)).length;
  if (numbered < cells.length * 0.7) return null;
  const ordered = [...run.map((l) => l.cells[0]), ...run.map((l) => l.cells[1])];
  const builder = new TextBuilder();
  const entries: { start: number; end: number; num: number }[] = [];
  for (const cell of ordered) {
    const start = builder.text.length === 0 ? 0 : builder.text.length + 1;
    builder.append({ text: cell.text, runs: cell.runs }, "\n");
    const m = TOC_ENTRY_RE.exec(cell.text);
    if (m) entries.push({ start, end: start + cell.text.length, num: Number(m[1]) });
  }
  return { type: "LIST", text: builder.text, html: CONTENTS_HTML, page: run[0].page, runs: builder.runs, tocEntries: entries, ...geom(run) };
}

// ── Contents links ──────────────────────────────────────────────────────────

export function resolveContentsLinks(segments: Segment[]) {
  const numToOrder = new Map<number, number>();
  segments.forEach((s, idx) => {
    if (s.type === "HEADING" && s.headingNum !== undefined && !numToOrder.has(s.headingNum)) {
      numToOrder.set(s.headingNum, idx);
    }
  });
  segments.forEach((s, idx) => {
    if (!s.tocEntries) return;
    const links: LinkSpan[] = [];
    for (const entry of s.tocEntries) {
      const target = numToOrder.get(entry.num);
      if (target === undefined || target === idx) continue;
      links.push({
        start: entry.start,
        end: entry.end,
        quotedText: s.text.slice(entry.start, entry.end),
        targetOrder: target,
      });
    }
    if (links.length > 0) s.links = [...(s.links ?? []), ...links];
  });
}
