import "@/lib/pdf-runtime";
import { getDocumentProxy } from "unpdf";
import { pageLines } from "@/lib/parse/pdf/columns";
import { resolveContentsLinks } from "@/lib/parse/pdf/contents";
import { itemGlyphs, readDrawing, type FontLookup, type Glyph, type PageDrawing } from "@/lib/parse/pdf/drawing";
import { attachFigureRegions, pageGraphics, type Graphic } from "@/lib/parse/pdf/figures";
import { cutFootnotes, placeFootnotes } from "@/lib/parse/pdf/footnotes";
import { dropFurniture } from "@/lib/parse/pdf/furniture";
import { median } from "@/lib/parse/pdf/geometry";
import {
  CONTROL_CHARS_RE,
  fontFlags,
  glyphTexts,
  itemText,
  normalizeGlyphs,
  standingBaseline,
  unreadRuns,
  type FontFlags,
} from "@/lib/parse/pdf/glyphs";
import { assignHeadingLevels } from "@/lib/parse/pdf/headings";
import { displayEquations, displayLines, isTexPage } from "@/lib/parse/pdf/math/display";
import { mathSpans, resolveZones } from "@/lib/parse/pdf/math/zones";
import { firstPageOf, mergeAcrossPages, shiftSpansInto } from "@/lib/parse/pdf/merge";
import { isOcrLayer } from "@/lib/parse/pdf/paragraphs";
import { placeTables, ruledTables, takeTables } from "@/lib/parse/pdf/ruled";
import { segmentPage } from "@/lib/parse/pdf/segment";
import { isWrappedRowLine } from "@/lib/parse/pdf/tables";
import { collectHyphenation, joinWrapped, spansFromRuns } from "@/lib/parse/pdf/text";
import type { Box, Item, Line, Segment, UriRegion } from "@/lib/parse/pdf/types";
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
  const pageFlags: { tex: boolean; ocr: boolean }[] = [];
  const graphics: Graphic[][] = [];
  const flagsByFont = new Map<string, FontFlags>();
  const unnamedFonts = new Set<string>();

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    // Font programs resolve during operator-list building; afterwards the
    // real font names (Carlito-Bold, DejaVuSansMono, …) are readable.
    let drawing: PageDrawing = { glyphs: [], rules: [], fills: [], images: [], paths: [] };
    try {
      const ops = (await page.getOperatorList()) as { fnArray: number[]; argsArray: unknown[] };
      const fonts: FontLookup = (id) => {
        try {
          const font = page.commonObjs.get(id) as { name?: string; fontMatrix?: number[]; vertical?: boolean } | null;
          return font ? { name: font.name ?? "", fontMatrix: font.fontMatrix, vertical: font.vertical } : null;
        } catch {
          return null;
        }
      };
      const [vx1, vy1, vx2, vy2] = page.view;
      drawing = readDrawing(ops, fonts, viewport.width, viewport.height, { x1: vx1, y1: vy1, x2: vx2, y2: vy2 });
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

    // Each text item's glyphs in the drawing, by the item's origin, and what
    // each TeX math glyph reads as by its code.
    const textItems = content.items.filter(
      (raw): raw is typeof raw & { str: string; fontName: string; transform: number[]; width: number } =>
        "str" in raw && typeof raw.str === "string" && raw.str.trim() !== "",
    );
    const glyphRuns = itemGlyphs(
      textItems.map((raw) => ({
        font: String(raw.fontName ?? ""),
        x: raw.transform[4],
        y: raw.transform[5],
        w: raw.width,
        size: Math.hypot(raw.transform[2], raw.transform[3]),
      })),
      drawing.glyphs,
    );
    const runOf = new Map(textItems.map((raw, i) => [raw, glyphRuns[i]]));
    const glyphText = glyphTexts(drawing.glyphs);
    const flagsOf = (fontName: string): FontFlags => {
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
      return flags;
    };
    const hrefAt = (x: number, y: number, w: number, size: number) => {
      const cx = x + w / 2;
      const cy = y + size * 0.3;
      return uriRegions.find((r) => cx >= r.x1 && cx <= r.x2 && cy >= r.y1 && cy <= r.y2)?.href ?? null;
    };
    const items: Item[] = [];
    for (const raw of content.items) {
      if (!("str" in raw) || typeof raw.str !== "string") continue;
      const fontName = String(raw.fontName ?? "");
      const flags = flagsOf(fontName);
      const t = raw.transform as number[];
      const size = Math.hypot(t[0], t[1]) || Math.hypot(t[2], t[3]) || 10;
      // Text under a point both ways is not on the page for a reader: LaTeXiT
      // stores a formula's source as text at 3e-7 pt, and its glyph advance
      // made a code line's indent hundreds of millions of spaces (arXiv
      // 2006.11239 failed). An OCR layer squeezes words to fit (0.9 wide, 6
      // tall): those stay.
      if (Math.max(size, Math.hypot(t[2], t[3])) < 1) continue;
      if (Math.abs(t[1]) > size * 0.3) continue; // rotated text (margin watermarks)
      // A math glyph reads as its code names it, and so does a text glyph a
      // composite or an accent takes part in (≠ is a slash over "=").
      const glyphs = runOf.get(raw);
      // Text a clip hides or set off the page shows nothing: arXiv
      // 2411.19946 p4's figure labels past the figure's crop glued into the
      // body lines. An item with any glyph shown stays.
      if (glyphs !== undefined && glyphs.length > 0 && glyphs.every((g) => g.hidden)) continue;
      const read =
        glyphText.size > 0 && glyphs?.some((g) => glyphText.has(g))
          ? itemText(glyphs, glyphText)
          : { str: raw.str, x: t[4], w: raw.width };
      if (!read) continue;
      // Control characters are not text: a chart glyph mapped to NUL broke the
      // save (Postgres rejects 0x00 in text).
      const str = normalizeGlyphs(read.str.replace(CONTROL_CHARS_RE, ""));
      if (str.length === 0) continue;
      // Word and Google Docs draw a font with no bold face in bold by
      // stroking its outline as well as filling it (text render mode 2):
      // the font's name says regular (census class 12: an arXiv paper's
      // title and headings read as plain text).
      const strokedBold = glyphs !== undefined && glyphs.every((g) => g.mode === 2);
      // A sized delimiter hangs from its origin: it stands on the baseline
      // its box gives, with the formula it encloses.
      const hung = glyphs !== undefined && glyphs.length > 0 && glyphs.every((g) => g.family === "omx");
      const y = hung ? t[5] + standingBaseline(glyphs[0], drawing.glyphs) - glyphs[0].y : t[5];
      items.push({
        str,
        x: read.x,
        y,
        w: read.w,
        size,
        ...flags,
        bold: flags.bold || strokedBold,
        href: hrefAt(read.x, y, read.w, size),
        font: fontName,
        glyphs,
      });
    }
    // Math glyphs the text layer never read (it drops a code it takes for a
    // space: ⊖ ⊘ ⊙ in a CMSY font with no Unicode map, a \big⟨) become items
    // of their own, on the baseline they stand on.
    const [viewX1, viewY1, viewX2, viewY2] = page.view;
    // The math glyphs items read (unreadRuns asks only of those).
    const read = new Set<Glyph>();
    for (const run of glyphRuns) for (const g of run ?? []) if (g.family !== null && g.family !== "ot1") read.add(g);
    for (const run of unreadRuns(drawing.glyphs, read, glyphText)) {
      const first = run[0];
      if (run.every((g) => g.hidden)) continue;
      const text = itemText(run, glyphText);
      const y = standingBaseline(first, drawing.glyphs);
      if (!text || first.x < viewX1 || first.x > viewX2 || y < viewY1 || y > viewY2) continue;
      const flags = flagsOf(first.font);
      items.push({
        str: normalizeGlyphs(text.str),
        x: text.x,
        y,
        w: text.w,
        size: first.size,
        ...flags,
        href: hrefAt(text.x, y, text.w, first.size),
        font: first.font,
        glyphs: run,
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
    // The tables the page's rules draw leave the text flow before the column
    // split, and before the graphics: a table's shaded cells never read as a
    // drawing, its words never as a drawing's labels. Each table comes back
    // as one line at its place in the reading order.
    const tables = ruledTables(items, drawing, viewport.width, viewport.height);
    const tableItems = new Set(tables.flatMap((t) => t.items));
    const text = items.filter((i) => !tableItems.has(i));
    const inTable = (b: Box) => tables.some((t) => b.x1 >= t.box.x1 - 2 && b.x2 <= t.box.x2 + 2 && b.y1 >= t.box.y1 - 2 && b.y2 <= t.box.y2 + 2);
    // A graphic's labels and caption leave the text before lines are built.
    const found = pageGraphics({ ...drawing, paths: drawing.paths.filter((b) => !inTable(b)) }, text, viewport.width, viewport.height);
    graphics.push(found);
    const inGraphics = new Set(found.flatMap((graphic) => [...graphic.labels, ...graphic.caption]));
    pages.push(placeTables(pageLines(takeTables(text.filter((i) => !inGraphics.has(i)), tables), viewport.width, p - 1, found)));
    // Each inline formula's LaTeX, from its glyphs and the page's rules.
    resolveZones(pages[pages.length - 1], drawing);
    // From here on only a TeX page's display equations read the page's
    // glyphs (math/display.ts), and a ruled table's and a caption's items,
    // which keep theirs: their lines are built again when the page is
    // segmented. Any other page lets its glyphs go (a scanned book of 517
    // pages held its 1.67M glyphs, 300 MB, to the end of the parse).
    const tex = isTexPage(drawing.glyphs);
    pageFlags.push({ tex, ocr: isOcrLayer(drawing.glyphs) });
    if (!tex) {
      for (const line of pages[pages.length - 1]) {
        for (const item of line.items) {
          item.glyphs = undefined;
          if (item.zone) item.zone.glyphs = [];
        }
      }
      drawing.glyphs = [];
    }
    // pdf.js keeps each page's operator list until the page is cleaned up.
    page.cleanup();
  }

  // The document's words and compounds, for its line-end hyphens.
  collectHyphenation(pages);

  // Running heads, feet, and page numbers drop before anything is segmented.
  const cleaned = dropFurniture(pages, pageHeights);

  // Document metrics. A ruled table's rows count as lines of its page, as
  // they did before tables left the text flow: a statement made of tables
  // took its body size from its titles alone.
  const measured = cleaned.map((lines) => lines.flatMap((l) => l.table?.lines ?? [l]));
  const allBodySizes: number[] = [];
  const leadingRatios: number[] = [];
  for (const lines of measured) {
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
  const hasBold = measured.some((lines) => lines.some((l) => l.runs.some((r) => r.bold)));
  // Footnotes leave the pages before they are segmented, so a paragraph
  // they cut joins across the page break (footnotes.ts).
  const footnotes = cutFootnotes(cleaned, pageDrawings.map((d) => d.rules), bodySize);

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
    const ctx = { bodySize, leading, columnLeft, hasBold, pageMinX, labelColumn, frames, drawing: pageDrawings[p], ...pageFlags[p] };
    // A TeX page's display equations join into one line each (math/display.ts).
    const shown = displayLines(lines, ctx);
    const pageSegments = segmentPage(shown, ctx);
    const withEquations = displayEquations(pageSegments, shown, ctx, pageWidths[p], pageHeights[p]);
    const withFigures = attachFigureRegions(withEquations, lines, ctx, pageWidths[p], pageHeights[p], graphics[p], p);
    // Then a TeX page's displays its display lines missed, once the figures
    // took their own words.
    const missed = { graphics: graphics[p].map((g) => g.box) };
    segments.push(...(ctx.tex ? displayEquations(withFigures, shown, ctx, pageWidths[p], pageHeights[p], missed) : withFigures));
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
      shiftSpansInto(prev, segment, joinWrapped(prev, segment.text));
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

  // A slide deck: every page wider than tall, two or more of them (a slide
  // program's 960 × 540, beamer's 364 × 272).
  const slides = pageWidths.length >= 2 && pageWidths.every((w, p) => w > pageHeights[p]);
  assignHeadingLevels(segments, bodySize, slides);

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
  segments = placeFootnotes(segments, footnotes);
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
    if ((s.type === "FIGURE" || s.type === "EQUATION") && s.region) block.region = s.region;
    const allLinks = [...(s.links ?? []), ...links];
    if (styles.length > 0) block.styles = styles;
    const math = s.type === "PARAGRAPH" || s.type === "LIST" || s.type === "HEADING" ? mathSpans(s.text, s.runs) : [];
    if (math.length > 0) block.math = math;
    if (allLinks.length > 0) block.links = allLinks;
    if (s.footnote) block.footnote = s.footnote;
    if (s.footnoteRefs) block.footnoteRefs = s.footnoteRefs;
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
