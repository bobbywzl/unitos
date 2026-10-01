import { z } from "zod";

// The pages of a PDF the reader chose at the add (SPEC.md §15): the Pages
// field on a PDF in the add dialog's queue reads "45–60" or "3, 7–9", and
// the add imports those pages alone (SPEC.md §30). A range is [from, to],
// 1-based, from ≤ to; the ranges are sorted and apart. Null = every page.

export type PageRange = [number, number];

/** The most ranges one add takes, and the highest page it names. */
const MAX_RANGES = 100;
const MAX_PAGE = 100_000;

const pageSchema = z.number().int().min(1).max(MAX_PAGE);

/** The chosen pages in a request: sorted ranges, none touching the next.
    The PDF's page count checks them once the PDF is read (PdfPagesError). */
export const pageRangesSchema = z
  .array(z.tuple([pageSchema, pageSchema]))
  .min(1)
  .max(MAX_RANGES)
  .refine((ranges) => ranges.every(([from, to], i) => from <= to && (i === 0 || ranges[i - 1][1] + 1 < from)), {
    message: "Ranges run low to high, in order, apart",
  });

/** What Document.pdfPages holds: the chosen ranges and the PDF's page count. */
export const pdfPagesSchema = z.object({ ranges: pageRangesSchema, count: pageSchema });
export type PdfPages = z.infer<typeof pdfPagesSchema>;

/** A document's chosen pages (its pdfPages column, read as untrusted), or
    null: every page. */
export function storedPdfPages(document: object): PdfPages | null {
  const parsed = pdfPagesSchema.safeParse("pdfPages" in document ? document.pdfPages : null);
  return parsed.success ? parsed.data : null;
}

/** The chosen pages as a document stores them: null when they hold every
    page of the PDF. */
export function pdfPagesOf(ranges: PageRange[] | null | undefined, count: number): PdfPages | null {
  if (!ranges || ranges.length === 0) return null;
  if (ranges.length === 1 && ranges[0][0] === 1 && ranges[0][1] >= count) return null;
  return { ranges, count };
}

/** Whether two documents hold the same pages of one PDF. */
export function samePdfPages(a: PdfPages | null, b: PdfPages | null): boolean {
  return JSON.stringify(a?.ranges ?? null) === JSON.stringify(b?.ranges ?? null);
}

/** The page numbers the ranges hold, in order. */
export function rangePages(ranges: PageRange[]): number[] {
  return ranges.flatMap(([from, to]) => Array.from({ length: to - from + 1 }, (_, i) => from + i));
}

/** The ranges as the Pages field and the import line write them: "45–60",
    "3, 7–9". */
export function pageRangesLabel(ranges: PageRange[]): string {
  return ranges.map(([from, to]) => (from === to ? String(from) : `${from}–${to}`)).join(", ");
}

/** Why the Pages field's words are no pages: "format", a part that is no
    page or range; "past", a page past the PDF's last. */
export type PageRangesError = "format" | "past";

/** The Pages field's words read. An empty field, or every page of a PDF
    whose count is known, is every page (null); else the ranges, sorted and
    joined. A range written high to low reads low to high. count: the PDF's
    page count, null while it is not known. */
export function readPageRanges(text: string, count: number | null): { ranges: PageRange[] | null } | { error: PageRangesError } {
  const parts = text
    .replace(/\s*[-–—~～至]\s*/g, "-")
    .split(/[\s,，、;；]+/)
    .filter(Boolean);
  if (parts.length === 0) return { ranges: null };
  const read: PageRange[] = [];
  for (const part of parts) {
    const match = /^(\d{1,6})(?:-(\d{1,6}))?$/.exec(part);
    if (!match) return { error: "format" };
    const a = Number(match[1]);
    const b = match[2] === undefined ? a : Number(match[2]);
    if (Math.min(a, b) < 1) return { error: "format" };
    read.push([Math.min(a, b), Math.max(a, b)]);
  }
  read.sort((x, y) => x[0] - y[0]);
  const ranges: PageRange[] = [];
  for (const range of read) {
    const last = ranges.at(-1);
    if (last && range[0] <= last[1] + 1) last[1] = Math.max(last[1], range[1]);
    else ranges.push([range[0], range[1]]);
  }
  const top = ranges[ranges.length - 1][1];
  if (count !== null && top > count) return { error: "past" };
  if (top > MAX_PAGE || ranges.length > MAX_RANGES) return { error: "format" };
  return { ranges: count !== null && pdfPagesOf(ranges, count) === null ? null : ranges };
}

/** An add's chosen pages past the PDF's last page. */
export class PdfPagesError extends Error {
  constructor(readonly pageCount: number) {
    super(`The PDF has ${pageCount} pages`);
    this.name = "PdfPagesError";
  }
}
