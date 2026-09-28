import "@/lib/pdf-runtime";
import { getDocumentProxy } from "unpdf";
import { pageLines } from "@/lib/parse/pdf/columns";
import { resolveContentsLinks } from "@/lib/parse/pdf/contents";
import { attachFigureRegions, imageBoxes, type PageDrawing } from "@/lib/parse/pdf/figures";
import { furnitureKeys } from "@/lib/parse/pdf/furniture";
import { median } from "@/lib/parse/pdf/geometry";
import { CONTROL_CHARS_RE, fontFlags, mapCmexGlyphs, normalizeGlyphs, type FontFlags } from "@/lib/parse/pdf/glyphs";
import { assignHeadingLevels } from "@/lib/parse/pdf/headings";
import { firstPageOf, mergeAcrossPages, shiftSpansInto } from "@/lib/parse/pdf/merge";
import { segmentPage } from "@/lib/parse/pdf/segment";
import { isWrappedRowLine } from "@/lib/parse/pdf/tables";
import { collectHyphenCompounds, spansFromRuns } from "@/lib/parse/pdf/text";
import type { Item, Line, Segment, UriRegion } from "@/lib/parse/pdf/types";
import type { ParsedBlock, ParsedDocument } from "@/lib/parse/types";

// pdf.js calls Math.sumPrecise while it rebuilds font programs. Node 22 has no
// such function, so every TrueType font translation failed with a warning and
// the fonts it dropped never resolved to a name — no bold or italic flags for
// their text (import compare loop finding).
const mathWithSum = Math as Math & { sumPrecise?: (values: Iterable<number>) => number };
if (typeof mathWithSum.sumPrecise !== "function") {
  mathWithSum.sumPrecise = (values) => {
    let sum = 0;
    for (const v of values) sum += v;
    return sum;
  };
}

// PDF → blocks. Deterministic, no AI passes. Beyond text and reading order, the
// parse keeps what the PDF's fonts and geometry say: bold/italic/monospace runs
// become style spans, monospace paragraphs become CODE, indent-and-gap groups
// become LIST (bullet glyphs are often vector art and never reach the text
// layer), wide-gap runs become TABLE with header rows, repeated page furniture
// drops, letter-spaced caps collapse, and Contents entries link to their
// section headings. And the pages: every block keeps the page it starts on, a
// block joined across a page break keeps where each later page begins, and
// the parse keeps the first page's size and the PDF's page labels — an
// import's page starts and page setup come from them.

// ── Main ────────────────────────────────────────────────────────────────────

export async function parsePdf(data: Uint8Array): Promise<PdfParse> {
  // pdf.js transfers (detaches) the buffer it receives — parse a copy so callers keep theirs.
  const pdf = await getDocumentProxy(new Uint8Array(data));

  const pages: Line[][] = [];
  const pageHeights: number[] = [];
  const pageWidths: number[] = [];
  const pageDrawings: PageDrawing[] = [];
  const flagsByFont = new Map<string, FontFlags>();
  const unnamedFonts = new Set<string>();

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    // Font programs resolve during operator-list building; afterwards the
    // real font names (Carlito-Bold, DejaVuSansMono, …) are readable.
    let drawing: PageDrawing = { images: [], paths: [] };
    try {
      const ops = (await page.getOperatorList()) as { fnArray: number[]; argsArray: unknown[] };
      drawing = imageBoxes(ops, viewport.width, viewport.height);
    } catch {
      // Broken page resources: fall back to no style flags and no drawing.
    }
    pageDrawings.push(drawing);
    let uriRegions: UriRegion[] = [];
    try {
      const annots = (await page.getAnnotations()) as Array<Record<string, unknown>>;
      uriRegions = annots
        .filter((a) => a.subtype === "Link" && typeof a.url === "string" && Array.isArray(a.rect))
        .map((a) => {
          const rect = a.rect as number[];
          return {
            href: a.url as string,
            x1: Math.min(rect[0], rect[2]),
            y1: Math.min(rect[1], rect[3]),
            x2: Math.max(rect[0], rect[2]),
            y2: Math.max(rect[1], rect[3]),
          };
        });
    } catch {
      uriRegions = [];
    }

    const items: Item[] = [];
    for (const raw of content.items) {
      if (!("str" in raw) || typeof raw.str !== "string") continue;
      const fontName = String(raw.fontName ?? "");
      let flags = flagsByFont.get(fontName);
      if (!flags) {
        let realName: string | null = null;
        try {
          const font = page.commonObjs.get(fontName) as { name?: string } | null;
          realName = font?.name ?? null;
        } catch {
          realName = null;
        }
        flags = fontFlags(realName);
        flagsByFont.set(fontName, flags);
        if (realName === null || /^Type3/i.test(realName)) unnamedFonts.add(fontName);
      }
      // Control characters are not text: a chart glyph mapped to NUL broke the
      // save (Postgres rejects 0x00 in text). The math extension font is the
      // exception: its codes name big operators and delimiters.
      const mapped = flags.cmex ? mapCmexGlyphs(raw.str) : raw.str;
      const str = normalizeGlyphs(mapped.replace(CONTROL_CHARS_RE, ""));
      if (str.length === 0) continue;
      const t = raw.transform as number[];
      const size = Math.hypot(t[0], t[1]) || Math.hypot(t[2], t[3]) || 10;
      // Text under a point both ways is not on the page for a reader: LaTeXiT
      // stores a formula's source as text at 3e-7 pt, and its glyph advance
      // made a code line's indent hundreds of millions of spaces (arXiv
      // 2006.11239 failed). An OCR layer squeezes words to fit (0.9 wide, 6
      // tall): those stay.
      if (Math.max(size, Math.hypot(t[2], t[3])) < 1) continue;
      if (Math.abs(t[1]) > size * 0.3) continue; // rotated text (margin watermarks)
      const x = t[4];
      const y = t[5];
      const cx = x + raw.width / 2;
      const cy = y + size * 0.3;
      const region = uriRegions.find((r) => cx >= r.x1 && cx <= r.x2 && cy >= r.y1 && cy <= r.y2);
      const { cmex: _cmex, ...itemFlags } = flags;
      void _cmex;
      items.push({
        str,
        x,
        y,
        w: raw.width,
        size,
        ...itemFlags,
        href: region?.href ?? null,
        font: fontName,
      });
    }
    // A Type3 (bitmap) font has no name to read weight or shape from. A
    // fixed advance per glyph across its strings says monospace (import
    // compare loop finding: a verbatim block in a bitmap typewriter font
    // read as prose).
    const advancesByFont = new Map<string, number[]>();
    for (const it of items) {
      if (!it.font || unnamedFonts.has(it.font) === false || it.str.length < 4 || it.w <= 0) continue;
      const list = advancesByFont.get(it.font) ?? [];
      list.push(it.w / it.str.length);
      advancesByFont.set(it.font, list);
    }
    for (const [font, list] of advancesByFont) {
      if (list.length < 3) continue;
      const m = median(list);
      if (list.every((a) => Math.abs(a - m) <= m * 0.05)) {
        for (const it of items) if (it.font === font) it.mono = true;
      }
    }
    pageHeights.push(viewport.height);
    pageWidths.push(viewport.width);
    pages.push(
      pageLines(items, viewport.width, p - 1).filter(
        (l) =>
          !(
            /^\d{1,4}$/.test(l.text) &&
            (l.y < viewport.height * 0.08 || l.y > viewport.height * 0.92)
          ),
      ),
    );
  }

  // The compounds the document hyphenates inside a line (for the wrap rule).
  collectHyphenCompounds(pages);

  // Repeated headers and footers drop before anything is segmented.
  const furniture = furnitureKeys(pages, pageHeights);
  const cleaned = pages.map((lines, p) => {
    const h = pageHeights[p];
    return lines.filter((l) => {
      if (l.y > h * 0.085 && l.y < h * 0.915) return true;
      const key = l.text.toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ").trim();
      return !furniture.has(key);
    });
  });

  // Document metrics.
  const allBodySizes: number[] = [];
  const leadingRatios: number[] = [];
  for (const lines of cleaned) {
    for (let k = 0; k < lines.length; k++) {
      if (lines[k].text.length > 40) allBodySizes.push(lines[k].size);
      if (k > 0) {
        const gap = lines[k - 1].y - lines[k].y;
        const size = lines[k].size;
        if (Math.abs(lines[k - 1].size - size) < 0.6 && gap > size * 1.05 && gap < size * 2.0) {
          leadingRatios.push(gap / size);
        }
      }
    }
  }
  const bodySize = median(allBodySizes);
  const leading = leadingRatios.length >= 3 ? median(leadingRatios) : 1.45;
  const hasBold = cleaned.some((lines) => lines.some((l) => l.runs.some((r) => r.bold)));

  let segments: Segment[] = [];
  for (const lines of cleaned) {
    // The column's left edge: the smallest x that body lines regularly start
    // at. The mode is wrong on list-heavy pages, where indented item lines
    // outnumber flush body lines.
    const bodyXs = lines
      .filter((l) => l.cells.length === 1 && l.text.length > 30)
      .map((l) => Math.round(l.x));
    const counts = new Map<number, number>();
    for (const x of bodyXs) counts.set(x, (counts.get(x) ?? 0) + 1);
    const prominent = Math.max(2, Math.ceil(bodyXs.length * 0.12));
    let columnLeft = Infinity;
    for (const [x, count] of counts) {
      if (count >= prominent && x < columnLeft) columnLeft = x;
    }
    if (!Number.isFinite(columnLeft)) {
      columnLeft = lines.length > 0 ? Math.min(...lines.map((l) => l.x)) : 0;
    }
    // A label column (times, dates, step numbers) beside the content column:
    // two-cell lines whose short first cell sits at the page's left edge and
    // whose second cell starts where the page's body lines start, well right
    // of the edge. Two or more make the content column the column and those
    // lines label lines.
    const pageMinX = lines.length > 0 ? Math.min(...lines.map((l) => l.x)) : 0;
    const prominentXs = new Set([...counts].filter(([, c]) => c >= prominent).map(([x]) => x));
    const labelXs: number[] = [];
    for (const l of lines) {
      if (l.cells.length !== 2 || l.x > pageMinX + 4 || l.cells[0].text.length > 12) continue;
      const bodyX = Math.round(l.cells[1].x);
      if (bodyX - pageMinX < 24 || !prominentXs.has(bodyX)) continue;
      // A table row whose first column wrapped reads exactly like a label
      // line: a short first cell at the left edge, the rest of the row under
      // a column the page's lines regularly start at. It is a row, not a
      // label — the page carries rows of three or more cells at those same
      // columns (import compare loop finding: a three-column table whose
      // first column wrapped broke into paragraphs at every wrapped row).
      if (isWrappedRowLine(l, lines)) continue;
      labelXs.push(bodyX);
    }
    let labelColumn: number | null = null;
    if (labelXs.length >= 2) {
      labelColumn = median(labelXs);
      columnLeft = labelColumn;
    }
    const p = cleaned.indexOf(lines);
    // Frames: drawn rectangles wide enough for text and taller than a rule.
    const frames = pageDrawings[p].paths.filter(
      (b) => b.x2 - b.x1 >= pageWidths[p] * 0.4 && b.y2 - b.y1 >= bodySize * 3,
    );
    const ctx = { bodySize, leading, columnLeft, hasBold, pageMinX, labelColumn, frames };
    const pageSegments = segmentPage(lines, ctx);
    const withFigures = attachFigureRegions(pageSegments, lines, ctx, pageWidths[p], pageHeights[p], pageDrawings[p], p);
    // Text inside a figure's box (a hidden chart title, a stray label) is
    // part of the picture.
    const figureBoxes = withFigures.filter((s) => s.type === "FIGURE" && s.region && s.box).map((s) => s.box!);
    segments.push(
      ...withFigures.filter((s) => {
        if ((s.type === "FIGURE" && s.region) || !s.box) return true;
        const b = s.box;
        return !figureBoxes.some((f) => {
          const w = Math.max(0, Math.min(b.x2, f.x2) - Math.max(b.x1, f.x1));
          const h = Math.max(0, Math.min(b.y2, f.y2) - Math.max(b.y1, f.y1));
          return (w * h) / Math.max(1, (b.x2 - b.x1) * (b.y2 - b.y1)) >= 0.7;
        });
      }),
    );
  }
  // A FIGURE with a region and no caption is an embedded image; every other
  // empty segment drops.
  segments = segments.filter((s) => s.text.trim().length > 0 || (s.type === "FIGURE" && s.region));
  // Vector-figure debris: chart axis ticks read as tiny numeric-only lines.
  // Inline-math debris: a sum limit or exponent too far from its base line
  // to join it reads as a paragraph of one or two math glyphs.
  segments = segments.filter(
    (s) =>
      !(
        s.type === "PARAGRAPH" &&
        s.text.length <= 14 &&
        /^[\d\s.,%−–-]+$/.test(s.text) &&
        !/\d\.$/.test(s.text.trim())
      ) &&
      !(
        s.type === "PARAGRAPH" &&
        s.text.replace(/\s/g, "").length <= 3 &&
        (s.mathShare ?? 0) >= 0.5
      ),
  );

  // Same-page paragraph fragments that end mid-sentence join the next paragraph.
  const fused: Segment[] = [];
  for (const segment of segments) {
    const prev = fused[fused.length - 1];
    if (
      segment.type === "PARAGRAPH" &&
      prev &&
      prev.type === "PARAGRAPH" &&
      segment.page === prev.page &&
      !prev.listItem &&
      !segment.listItem &&
      !prev.text.includes("\n") &&
      /[a-z,;\-–—]$/.test(prev.text) &&
      /^[a-z(]/.test(segment.text)
    ) {
      const glue = /[A-Za-z0-9][-–]$/.test(prev.text) && /^[A-Za-z0-9(]/.test(segment.text) ? "" : " ";
      const offset = prev.text.length + glue.length;
      prev.text = prev.text + glue + segment.text;
      shiftSpansInto(prev, segment, offset);
      continue;
    }
    fused.push(segment);
  }

  segments = mergeAcrossPages(fused);

  // A long title wraps across layout lines: consecutive equal-size HEADING
  // segments at the top of page 0 are one title, not several headings.
  while (
    segments.length >= 2 &&
    segments[0].page === 0 &&
    segments[1].page === 0 &&
    segments[0].type === "HEADING" &&
    segments[1].type === "HEADING" &&
    segments[0].rawSize !== undefined &&
    segments[1].rawSize !== undefined &&
    Math.abs(segments[0].rawSize - segments[1].rawSize) < 0.5
  ) {
    const offset = segments[0].text.length + 1;
    segments[0].text = `${segments[0].text} ${segments[1].text}`;
    shiftSpansInto(segments[0], segments[1], offset);
    segments.splice(1, 1);
  }

  assignHeadingLevels(segments, bodySize);

  // Title: the biggest heading on the first page.
  let title: string | null = null;
  let titleSize = 0;
  for (const s of segments) {
    if (s.page !== 0 || s.type !== "HEADING" || s.rawSize === undefined) continue;
    // A title is set larger than the body text; a body-size bold heading on
    // the first page ("Problem 1: …") is the first section, not the title.
    if (s.rawSize > titleSize && s.rawSize >= bodySize * 1.14 && s.text.length > 4) {
      title = s.text;
      titleSize = s.rawSize;
    }
  }

  // The reader shows the title above the blocks; the heading it came from
  // would show it twice.
  if (title && segments[0]?.type === "HEADING" && segments[0].text === title) segments = segments.slice(1);

  // The segments are the blocks now, in their order: a contents entry links
  // to its heading by that order. Resolved before the title merge and the
  // title's removal, every link pointed past its heading.
  segments = segments.filter((s) => s.text.trim().length > 0 || (s.type === "FIGURE" && s.region));
  resolveContentsLinks(segments);

  const blocks: ParsedBlock[] = segments.map((s) => {
    const { styles, links } = spansFromRuns(s.text, s.runs, {
      skipBold: s.type === "HEADING",
      skipMono: s.type === "CODE",
    });
    // Every block keeps the page its first words are on (1-based), and a
    // block joined across page breaks where each later page begins. FIGURE
    // blocks keep their region for the figure image route.
    const block: ParsedBlock = { type: s.type, text: s.text, page: firstPageOf(s) + 1 };
    if (s.html) block.html = s.html;
    if (s.breaks && s.breaks.length > 0) {
      block.pageStarts = s.breaks.map((b) => ({ offset: b.offset, page: b.page + 1 }));
    }
    if (s.type === "FIGURE" && s.region) block.region = s.region;
    const allLinks = [...(s.links ?? []), ...links];
    if (styles.length > 0) block.styles = styles;
    if (allLinks.length > 0) block.links = allLinks;
    return block;
  });

  const parsed: PdfParse = { title, blocks };
  if (pageWidths.length > 0) parsed.pageSize = { width: points(pageWidths[0]), height: points(pageHeights[0]) };
  const labels = pageLabelsOf(await pdf.getPageLabels().catch(() => null), pdf.numPages);
  if (labels) parsed.pageLabels = labels;
  return parsed;
}

type PdfParse = Pick<ParsedDocument, "title" | "blocks" | "pageSize" | "pageLabels">;

// A size in points, to a hundredth: A4 is 595.28 × 841.89.
function points(value: number): number {
  return Math.round(value * 100) / 100;
}

// The PDF's page labels (pdf.js getPageLabels: one per page, "" where the
// PDF names a page with no number), kept only when they name the pages
// otherwise than 1..n — as pdf.js's own viewer does. A page left unnamed
// reads as its number. A label is a margin note ("xii", "A-12"): a longer
// one is cut, so a crafted prefix cannot swell the page data.
const PAGE_LABEL_MAX = 24;
function pageLabelsOf(labels: string[] | null, pageCount: number): string[] | undefined {
  if (!labels || labels.length !== pageCount) return undefined;
  const named = labels.map((label, i) => label.trim().slice(0, PAGE_LABEL_MAX) || String(i + 1));
  return named.every((label, i) => label === String(i + 1)) ? undefined : named;
}
