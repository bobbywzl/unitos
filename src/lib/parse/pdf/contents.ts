// Contents lists: the label that opens one, its entries, and the links from
// each entry to the heading it names.

import { geom } from "@/lib/parse/pdf/geometry";
import { TextBuilder, lineAsPart } from "@/lib/parse/pdf/text";
import type { Line, Run, Segment } from "@/lib/parse/pdf/types";
import type { LinkSpan } from "@/lib/parse/types";

export const TOC_LABEL_RE = /^((appendix )?contents|table of contents|inside|outline|in this issue)$/i;
export const TOC_ENTRY_RE = /^(\d{1,2}|[A-Z])(?:\.\d{1,2})*[.)]?\s+\S/;
// Leader dots and the page number at the end of a contents entry: the reader
// has no pages to turn to.
export const TOC_TAIL_RE = /(?:\s*\.){3,}\s*\d{1,4}\s*$|\s+\d{1,4}\s*$/;
export function tocEntryPart(line: Line): { text: string; runs: Run[] } {
  const part = lineAsPart(line);
  const text = part.text.replace(TOC_TAIL_RE, "").trimEnd();
  return { text, runs: part.runs.map((r) => ({ ...r, end: Math.min(r.end, text.length) })).filter((r) => r.end > r.start) };
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
  return { type: "LIST", text: builder.text, page: run[0].page, runs: builder.runs, tocEntries: entries, ...geom(run) };
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
