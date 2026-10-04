import { PDF_CMAPS } from "@/lib/pdf-runtime";
import { getDocumentProxy } from "unpdf";
import { pageLines } from "@/lib/parse/pdf/columns";
import { fitOcrItems, placeMarks } from "@/lib/parse/pdf/lines";
import { resolveContentsLinks } from "@/lib/parse/pdf/contents";
import { itemGlyphs, readDrawing, type FontLookup, type Glyph, type PageDrawing } from "@/lib/parse/pdf/drawing";
import { nameShape } from "@/lib/parse/pdf/faces";
import { attachFigureRegions, pageGraphics, type Graphic } from "@/lib/parse/pdf/figures";
import { ABSTRACT_RE, cutFootnotes, placeFootnotes } from "@/lib/parse/pdf/footnotes";
import { dropFurniture } from "@/lib/parse/pdf/furniture";
import { median, unionBox } from "@/lib/parse/pdf/geometry";
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
import { assignHeadingLevels, centerLikeOthers } from "@/lib/parse/pdf/headings";
import { lookItems, takeBodyFont } from "@/lib/parse/pdf/look";
import { displayEquations, displayLines, isTexPage } from "@/lib/parse/pdf/math/display";
import { mathSpans, resolveZones } from "@/lib/parse/pdf/math/zones";
import { firstPageOf, joinOnPage, mergeAcrossPages, shiftSpansInto } from "@/lib/parse/pdf/merge";
import { isOcrLayer, measureSpacing, pageLeading } from "@/lib/parse/pdf/paragraphs";
import { placeTables, ruledTables, takeTables } from "@/lib/parse/pdf/ruled";
import { segmentPage } from "@/lib/parse/pdf/segment";
import { attachTableCaptions, isWrappedRowLine } from "@/lib/parse/pdf/tables";
import { collectHyphenation, holdsFill, spansFromRuns, tabStopsOf } from "@/lib/parse/pdf/text";
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
//
// The pages the reader chose at the add (SPEC.md §15) are the parse's pages:
// it reads them as if the PDF held only them, and each block keeps the PDF's
// own number for its page.

/** pages: the PDF's pages the blocks come from, 1-based (the reader's
    choice at the add); absent or empty, every page. */
export type PdfParseOptions = { pages?: number[] };

// A choice of fewer pages than this reads the pages nearest it too, until
// it reads this many: page furniture drops only on evidence from other
// pages (furniture.ts). Their words are read for that and never kept.
const FURNITURE_PAGES = 6;

// ── Main ────────────────────────────────────────────────────────────────────

export async function parsePdf(data: Uint8Array, opts: PdfParseOptions = {}): Promise<PdfParse> {
  // pdf.js transfers (detaches) the buffer it receives — parse a copy so callers keep theirs.
  // fontExtraProperties keeps each font's encoding (its glyph names) for the
  // drawing: a font with no Unicode map reads by its names (glyphs.ts
  // namedGlyphs).
  const pdf = await getDocumentProxy(new Uint8Array(data), { ...PDF_CMAPS, fontExtraProperties: true });
  // The chosen pages (chosen[i] is the PDF's number for the parse's page i),
  // and the pages read.
  const chosen = chosenPages(pdf.numPages, opts.pages);
  const kept = new Set(chosen);
  const read = pagesToRead(chosen, pdf.numPages);
  // Every page read, for the furniture: its lines, height, and 0-based number.
  const readLines: Line[][] = [];
  const readHeights: number[] = [];
  const readPages: number[] = [];
  const readScans: boolean[] = [];

  const pages: Line[][] = [];
  const pageHeights: number[] = [];
  const pageWidths: number[] = [];
  const pageDrawings: PageDrawing[] = [];
  const pageFlags: { tex: boolean; ocr: boolean }[] = [];
  const graphics: Graphic[][] = [];
  const flagsByFont = new Map<string, FontFlags>();
  const unnamedFonts = new Set<string>();
  const realNames = new Map<string, string>();

  for (const pageNumber of read) {
    const keep = kept.has(pageNumber);
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    // Font programs resolve during operator-list building; afterwards the
    // real font names (Carlito-Bold, DejaVuSansMono, …) are readable.
    let drawing: PageDrawing = { glyphs: [], rules: [], fills: [], images: [], paths: [], shades: [] };
    try {
      const ops = (await page.getOperatorList()) as { fnArray: number[]; argsArray: unknown[] };
      const fonts: FontLookup = (id) => {
        try {
          const font = page.commonObjs.get(id) as { name?: string; fontMatrix?: number[]; vertical?: boolean; differences?: (string | null)[] } | null;
          return font ? { name: font.name ?? "", fontMatrix: font.fontMatrix, vertical: font.vertical, differences: font.differences } : null;
        } catch {
          return null;
        }
      };
      const [vx1, vy1, vx2, vy2] = page.view;
      drawing = readDrawing(ops, fonts, viewport.width, viewport.height, { x1: vx1, y1: vy1, x2: vx2, y2: vy2 });
    } catch {
      // Broken page resources: fall back to no style flags and no drawing.
    }
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
    // A space item stands where the page draws a space, unless TeX set the
    // page: TeX draws none (columns.ts markSpaces).
    const drawsSpaces = !isTexPage(drawing.glyphs);
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
        if (realName !== null) realNames.set(fontName, realName);
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
    const rotated: Item[] = [];
    // Text set in a vertical font on a page of horizontal text (a
    // chapter's tab at the page's edge, in a Japanese white paper) is no
    // line of the text: read as horizontal, its characters joined the body's
    // lines as a table's cells.
    const styles = content.styles as Record<string, { vertical?: boolean }>;
    const vertical = (raw: object) => "fontName" in raw && styles[String(raw.fontName)]?.vertical === true;
    const verticalShare = content.items.filter(vertical).length / Math.max(1, content.items.length);
    // The glyphs the text layer's items took, and the others by their
    // origin's whole points.
    const taken = new Set(glyphRuns.flatMap((run) => run ?? []));
    const untaken = new Map<string, number[]>();
    drawing.glyphs.forEach((g, k) => {
      if (taken.has(g)) return;
      const key = `${Math.round(g.x)} ${Math.round(g.y)}`;
      untaken.set(key, [...(untaken.get(key) ?? []), k]);
    });
    // An OCR layer stretches each word across to the scan's word: a word
    // stretched a third wider than it is tall takes its height as its size.
    // Taken across, a short word stretched wide read as large type (parse
    // loop finding: NACA Report 515 sets "It" 15.3 pt across and 10 pt tall
    // in a 10.3 pt line, and five lines of its body read as headings:
    // "conditions. It is thought that the accurate determi-").
    const scanned = isOcrLayer(drawing.glyphs);
    for (const raw of content.items) {
      if (!("str" in raw) || typeof raw.str !== "string") continue;
      if (verticalShare < 0.25 && vertical(raw)) continue;
      const t = raw.transform as number[];
      // A text item whose font the page never draws at its place, where a
      // run of drawn glyphs no item took spells its letters, reads as that
      // run: its words, width, and font (the Earth Observer's masthead read
      // "The Earth O b server" in a regular font, at a fourth of its drawn
      // width).
      const drawn = runOf.get(raw) === undefined ? drawnRunAt(raw.str, t[4], t[5], drawing.glyphs, taken, untaken) : undefined;
      const fontName = drawn ? drawn[0].font : String(raw.fontName ?? "");
      const flags = flagsOf(fontName);
      const across = Math.hypot(t[0], t[1]);
      const tall = Math.hypot(t[2], t[3]);
      const size = (scanned && tall > 0 && across > tall * 1.3 ? tall : across || tall) || 10;
      // Text under a point both ways is not on the page for a reader: LaTeXiT
      // stores a formula's source as text at 3e-7 pt, and its glyph advance
      // made a code line's indent hundreds of millions of spaces (arXiv
      // 2006.11239 failed). An OCR layer squeezes words to fit (0.9 wide, 6
      // tall): those stay.
      if (Math.max(size, Math.hypot(t[2], t[3])) < 1) continue;
      // Rotated text (a margin watermark, an axis label) is no line of the
      // page. A ruled table's head set aslant is its column heads: the item
      // is kept aside, upright at its drawn box (uprightItem), and joins
      // the table whose rules hold it (ruledTables). PDF parse loop finding:
      // an IEEE paper's Table I lost its five heads rotated 60°, and its
      // rows of ✓ and ✗ read under no column name.
      if (Math.abs(t[1]) > size * 0.3) {
        const fontName = String(raw.fontName ?? "");
        const str = normalizeGlyphs(raw.str.replace(CONTROL_CHARS_RE, ""));
        if (str.trim() !== "") rotated.push(uprightItem(str, t, raw.width, size, { ...flagsOf(fontName), href: null, font: fontName }));
        continue;
      }
      // A math glyph reads as its code names it, and so does a text glyph a
      // composite or an accent takes part in (≠ is a slash over "=").
      const glyphs = drawn ?? runOf.get(raw);
      // Text a clip hides or set off the page shows nothing: arXiv
      // 2411.19946 p4's figure labels past the figure's crop glued into the
      // body lines. An item with any glyph shown stays.
      if (glyphs !== undefined && glyphs.length > 0 && glyphs.every((g) => g.hidden)) continue;
      const read =
        drawn ? drawnText(drawn)
        : glyphText.size > 0 && glyphs?.some((g) => glyphText.has(g)) ? itemText(glyphs, glyphText)
        : { str: raw.str, x: t[4], w: raw.width };
      if (!read) continue;
      // Control characters are not text: a chart glyph mapped to NUL broke the
      // save (Postgres rejects 0x00 in text).
      const str = normalizeGlyphs(read.str.replace(CONTROL_CHARS_RE, ""), glyphs);
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
      // One item may hold stroked and filled glyphs (a Chinese paper's
      // "中图分类号：" stroked but for its colon, "文献标识码：Ａ" with a
      // regular "Ａ"): it is cut where the stroke starts or stops.
      for (const part of strokeParts(str, glyphs) ?? [{ str, x: read.x, w: read.w, glyphs, stroked: strokedBold }]) {
        items.push({
          str: part.str,
          x: part.x,
          y,
          w: part.w,
          size,
          ...flags,
          bold: flags.bold || part.stroked,
          href: hrefAt(part.x, y, part.w, size),
          font: fontName,
          glyphs: part.glyphs,
          ...(drawsSpaces && part.str.trim() === "" ? { space: true as const } : {}),
        });
      }
    }
    // Math glyphs the text layer never read (it drops a code it takes for a
    // space: ⊖ ⊘ ⊙ in a CMSY font with no Unicode map, a \big⟨) become items
    // of their own, on the baseline they stand on.
    const [viewX1, viewY1, viewX2, viewY2] = page.view;
    // The math glyphs items read, and the glyphs read by name (unreadRuns
    // asks only of those): the text layer drops a named glyph whose code it
    // takes for a space (Cambria's "o" at code 9, a tab).
    const read = new Set<Glyph>();
    for (const run of glyphRuns) for (const g of run ?? []) if ((g.family !== null && g.family !== "ot1") || g.named) read.add(g);
    for (const run of unreadRuns(drawing.glyphs, read, glyphText)) {
      const first = run[0];
      if (run.every((g) => g.hidden)) continue;
      const text = itemText(run, glyphText);
      const y = standingBaseline(first, drawing.glyphs);
      if (!text || first.x < viewX1 || first.x > viewX2 || y < viewY1 || y > viewY2) continue;
      const flags = flagsOf(first.font);
      items.push({
        str: normalizeGlyphs(text.str, run),
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
    // A named font whose name says no shape, and whose glyphs all advance
    // the same, a narrow letter or mark (i, l, t, r, a stop) and a wide
    // letter (n, e, m) alike, is monospace too: txfonts' and newtx's
    // typewriter fonts are named txtt and t1xtt (parse loop finding: a
    // statistics book's every R listing read as paragraphs, and its tables
    // of fitted values as prose). Eight characters at least, so a subset
    // of a few glyphs says nothing; a text font sets its digits at one
    // width, so digits alone say nothing; a CJK face sets its Latin
    // letters at one width too, and its name says its shape (faces.ts).
    const widthsByFont = new Map<string, Map<string, number>>();
    for (const it of items) {
      if (!it.font || it.mono || unnamedFonts.has(it.font) || !it.glyphs || nameShape(realNames.get(it.font) ?? "") !== null) continue;
      const widths = widthsByFont.get(it.font) ?? new Map<string, number>();
      for (const g of it.glyphs) {
        const ch = g.unicode.normalize("NFKC");
        if (ch.trim().length !== 1 || g.w <= 0 || widths.has(ch)) continue;
        widths.set(ch, g.w / g.size);
      }
      widthsByFont.set(it.font, widths);
    }
    for (const [font, widths] of widthsByFont) {
      const chars = [...widths.keys()];
      if (chars.length < 8 || !chars.some((c) => /[ijlftrsIJ.,;:'|!()[\]]/.test(c)) || !chars.some((c) => /[abdeghknopquvxyzmwABDEGHKNOPQUVXYZMW]/.test(c))) continue;
      const m = median([...widths.values()]);
      if ([...widths.values()].every((w) => Math.abs(w - m) <= m * 0.05)) {
        for (const it of items) if (it.font === font) it.mono = true;
      }
    }
    // Each item's face and size and what the drawing marks on it: its
    // color, a highlight, an underline, a strikethrough (look.ts). An item
    // that looks two ways is cut where its look changes.
    lookItems(items, drawing, (id) => page.commonObjs.get(id) as { name?: string; fallbackName?: string } | null, hrefAt);
    // An OCR layer sets each word where the scan shows it, in a stock font
    // whose advances need not span the word: a scanned book's words run a
    // third wider than their text, and the gaps between them read as a
    // table's cells (its prose read as tables, a quotation as rows).
    const ocr = scanned;
    if (ocr) fitOcrItems(items, drawing.glyphs);
    // A scan's lone mark set three times the size of its words is a stroke
    // of a drawing the OCR read as a character: NACA Report 515 p. 10 reads
    // a contour plot's curve as a 30 pt "(" between two columns, and its
    // size made the captions under the plots one row across the gutter.
    if (ocr) {
      const size = median(items.filter((i) => /\p{L}{2}/u.test(i.str)).map((i) => i.size));
      for (let k = items.length - 1; k >= 0; k--) if (/^[^\p{L}\p{N}]$/u.test(items[k].str.trim()) && items[k].size >= size * 3) items.splice(k, 1);
    }
    // The same words drawn twice at one place and size read once, whatever
    // font each copy names: InDesign draws a running head set over a photo
    // a second time over itself, in a second copy of its font (parse loop
    // finding: The MagPi's "Project showcase" and "Odyssey Lights" read
    // "Project showcaseProject showcase", and the doubled head never
    // matched the other pages' heads, so it stayed in the text as a
    // heading).
    // The copy drawn last reads, in its look: it stands over the other. The
    // MagPi's p. 44 draws its head twice, the second copy in white over its
    // photo; read in the first copy's color, the head made the photo hold
    // the page's text, a background with no figure.
    const drawnAt = new Map<string, Item[]>();
    for (let k = 0; k < items.length; k++) {
      const it = items[k];
      if (it.str.trim() === "") continue;
      const key = `${it.str}\u0000${it.size.toFixed(2)}`;
      const same = drawnAt.get(key) ?? [];
      const under = same.findIndex((o) => Math.abs(o.x - it.x) <= it.size * 0.05 && Math.abs(o.y - it.y) <= it.size * 0.05);
      if (under >= 0) {
        items.splice(items.indexOf(same[under]), 1);
        same[under] = it;
        k--;
        continue;
      }
      same.push(it);
      drawnAt.set(key, same);
    }
    placeMarks(items);
    // From here on a position is taken from the page box's corner, as the
    // figure route renders the page: a region is a share of the page box.
    // The MIC white paper's box starts at (36.85, 36.85); read in the PDF's
    // own coordinates, every crop sat 4.4% too high and 6.2% too far right,
    // and 19 lines at figures' feet were in neither the text nor a crop.
    if (viewX1 !== 0 || viewY1 !== 0) toPageBox([...items, ...rotated], drawing, viewX1, viewY1);
    // The tables the page's rules draw leave the text flow before the column
    // split, and before the graphics: a table's shaded cells never read as a
    // drawing, its words never as a drawing's labels. Each table comes back
    // as one line at its place in the reading order.
    const tables = ruledTables(items, drawing, viewport.width, viewport.height, rotated);
    const tableItems = new Set(tables.flatMap((t) => t.items));
    const text = items.filter((i) => !tableItems.has(i));
    const inTable = (b: Box) => tables.some((t) => b.x1 >= t.box.x1 - 2 && b.x2 <= t.box.x2 + 2 && b.y1 >= t.box.y1 - 2 && b.y2 <= t.box.y2 + 2);
    // A graphic's labels and caption leave the text before lines are built.
    const found = pageGraphics({ ...drawing, paths: drawing.paths.filter((b) => !inTable(b)) }, text, viewport.width, viewport.height);
    const inGraphics = new Set(found.flatMap((graphic) => [...graphic.labels, ...graphic.caption]));
    // A kept page's lines count their page among the kept pages; a page read
    // for the furniture's evidence alone counts none.
    // The frames the page draws (a listing's box): a third of the page wide
    // and a line tall at the least.
    const frames = drawing.paths.filter((b) => !b.clip && !inTable(b) && b.x2 - b.x1 >= viewport.width * 0.3 && b.y2 - b.y1 >= 10);
    const lines = placeTables(pageLines(takeTables(text.filter((i) => !inGraphics.has(i)), tables), viewport.width, keep ? pages.length : -1, found, drawing.rules.filter((r) => r.dir === "h" && !inTable(r)), frames, drawing.rules.filter((r) => r.dir === "v" && !inTable(r))));
    // Each inline formula's LaTeX, from its glyphs and the page's rules.
    resolveZones(lines, drawing);
    // From here on only a TeX page's display equations read the page's
    // glyphs (math/display.ts), and a ruled table's and a caption's items,
    // which keep theirs: their lines are built again when the page is
    // segmented. Any other page lets its glyphs go (a scanned book of 517
    // pages held its 1.67M glyphs, 300 MB, to the end of the parse).
    const tex = isTexPage(drawing.glyphs);
    if (!tex) {
      for (const line of lines) {
        for (const item of line.items) {
          item.glyphs = undefined;
          if (item.zone) item.zone.glyphs = [];
        }
      }
      drawing.glyphs = [];
    }
    // pdf.js keeps each page's operator list until the page is cleaned up.
    page.cleanup();
    readLines.push(lines);
    readHeights.push(viewport.height);
    readPages.push(pageNumber - 1);
    readScans.push(ocr);
    if (!keep) continue;
    pages.push(lines);
    pageHeights.push(viewport.height);
    pageWidths.push(viewport.width);
    pageDrawings.push(drawing);
    graphics.push(found);
    pageFlags.push({ tex, ocr });
  }

  // The document's words and compounds, for its line-end hyphens.
  collectHyphenation(readLines);

  // Running heads, feet, and page numbers drop before anything is segmented,
  // on the evidence of every page read; then the kept pages go on alone.
  // The lines that dropped, and the first cell of a line of cells, name the
  // publication a masthead names (titleOf, mastheadOf: PLOS's running head
  // sets its name and the paper's title as one line of two cells).
  const furnished = dropFurniture(readLines, readHeights, readPages, readScans);
  const running = new Set(
    readLines.flatMap((lines, k) => {
      const stays = new Set(furnished[k]);
      return lines.filter((l) => !stays.has(l)).flatMap((l) => (l.cells.length > 1 ? [l.text, l.cells[0].text] : [l.text]).map(squash));
    }),
  );
  const cleaned = furnished.filter((_, k) => kept.has(readPages[k] + 1));

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
  const footnotes = cutFootnotes(cleaned, pageDrawings.map((d) => d.rules), bodySize, pageFlags.map((f) => f.ocr));

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
    // A page measures its lines against its own body where that is set
    // larger than the document's: a survey's 7 pt bibliography and tables
    // outnumber its 9 pt text, and every line of that text read as larger
    // than the body, so as a heading (arxiv-2609-29669). An OCR layer sizes
    // its words page by page from the scan (a scanned book's body reads
    // 8 pt on one page and 7 pt on the next): its page is measured against
    // its own body, and its headings' sizes ranked at the document's scale.
    const prose = lines.filter((l) => !l.table && l.cells.length === 1 && l.text.length > 40).map((l) => l.size);
    const pageBody = prose.length >= 5 ? median(prose) : bodySize;
    const ocr = pageFlags[p].ocr;
    const ctx = { bodySize: ocr ? pageBody : Math.max(bodySize, pageBody), leading: pageLeading(lines, leading), columnLeft, hasBold, pageMinX, labelColumn, frames, drawing: pageDrawings[p], ...pageFlags[p] };
    // A TeX page's display equations join into one line each (math/display.ts).
    const shown = displayLines(lines, ctx);
    const pageSegments = segmentPage(shown, ctx);
    if (ocr) for (const s of pageSegments) if (s.rawSize !== undefined) s.rawSize *= bodySize / pageBody;
    const withEquations = displayEquations(pageSegments, shown, ctx, pageWidths[p], pageHeights[p]);
    const withFigures = attachFigureRegions(withEquations, lines, ctx, pageWidths[p], pageHeights[p], graphics[p], p, pages[p]);
    // Then a TeX page's displays its display lines missed, once the figures
    // took their own words.
    const missed = { graphics: graphics[p].map((g) => g.box) };
    const done = ctx.tex ? displayEquations(withFigures, shown, ctx, pageWidths[p], pageHeights[p], missed) : withFigures;
    // The space after each text block, from the page's own gaps.
    measureSpacing(done, ctx, shown);
    segments.push(...done);
  }
  // A FIGURE with a region and no caption is an embedded image; every other
  // empty segment drops.
  segments = segments.filter((s) => s.text.trim().length > 0 || holdsFill(s) || (s.type === "FIGURE" && s.region));
  // A slide deck: every page wider than tall, two or more of them (a slide
  // program's 960 × 540, beamer's 364 × 272).
  const slides = pageWidths.length >= 2 && pageWidths.every((w, p) => w > pageHeights[p]);
  // A deck's frame printed on several pages reads once (collapseOverlaySteps).
  if (slides) segments = collapseOverlaySteps(segments, graphics, pageDrawings);
  // Vector-figure debris: chart axis ticks read as tiny numeric-only lines.
  // Inline-math debris: a sum limit or exponent too far from its base line
  // to join it reads as a paragraph of one or two math glyphs. The numbers
  // right after a listing, on its page, are the output it typesets, no
  // ticks (columns.ts listingPair). A number of three parts or more
  // ("1.3.150") is a section's or a sheet's, no tick (parse loop finding:
  // DTIC's Helicopter Design Datcom lost the 56 sheet numbers of its
  // contents, each on a line of its own).
  const output = new Set<Segment>();
  segments.forEach((s, k) => {
    const prev = segments[k - 1];
    if (prev && prev.page === s.page && (prev.type === "CODE" || output.has(prev)) && s.type === "PARAGRAPH" && /^[\d\s.,%()/−–-]+$/.test(s.text)) output.add(s);
  });
  segments = segments.filter(
    (s) =>
      !(
        s.type === "PARAGRAPH" &&
        !output.has(s) &&
        !holdsFill(s) &&
        s.text.length <= 14 &&
        /^[\d\s.,%−–-]+$/.test(s.text) &&
        !/\d\.$/.test(s.text.trim()) &&
        !/^\d+(?:\.\d+){2,}$/.test(s.text.trim())
      ) &&
      !(
        s.type === "PARAGRAPH" &&
        s.text.replace(/\s/g, "").length <= 3 &&
        (s.mathShare ?? 0) >= 0.5
      ),
  );

  // A paragraph's halves join, on its page (a column break, a float
  // between) and across pages, but never across pages the choice left out.
  segments = runsOfPages(joinOnPage(segments), chosen).flatMap(mergeAcrossPages);
  // A table's caption is the table's, once its rows joined across pages.
  segments = attachTableCaptions(segments);

  // A long title wraps across layout lines: consecutive equal-size HEADING
  // segments at the top of page 0 are one title, not several headings. A
  // line set apart under it (a cover's author, 45 pt under a 14 pt title)
  // is no wrap; a double-spaced title's lines sit twice its size apart.
  const wrapGap = Math.max(1.7, leading * 1.15) - 1.15;
  while (
    segments.length >= 2 &&
    segments[0].page === 0 &&
    segments[1].page === 0 &&
    segments[0].type === "HEADING" &&
    segments[1].type === "HEADING" &&
    segments[0].rawSize !== undefined &&
    segments[1].rawSize !== undefined &&
    Math.abs(segments[0].rawSize - segments[1].rawSize) < 0.5 &&
    !(segments[0].box && segments[1].box && segments[0].box.y1 - segments[1].box.y2 > segments[0].rawSize * wrapGap)
  ) {
    const offset = segments[0].text.length + 1;
    segments[0].text = `${segments[0].text} ${segments[1].text}`;
    shiftSpansInto(segments[0], segments[1], offset);
    if (segments[0].box && segments[1].box) segments[0].box = unionBox(segments[0].box, segments[1].box);
    segments.splice(1, 1);
  }

  // The title, on the first page with words that is no library's notice
  // (a scan's archive notice gave its title), read on a scan's page only in
  // words the document uses elsewhere (a masthead in display type read as
  // "USDEPARTNENT OPAGRICULLURE").
  const scan = pageFlags.filter((f) => f.ocr).length * 2 > pageFlags.length;
  const notice = noticePage(segments);
  const titlePage = notice < 0 ? 0 : (segments.find((s) => s.page > notice && s.text.trim())?.page ?? 0);
  const clues: TitleClues = { page: titlePage, running, words: scan ? wordCounts(segments) : undefined };
  const deckTitle = slides ? titleSlideOf(segments, bodySize, clues) : undefined;
  const titleSegment = deckTitle ?? titleOf(segments, bodySize, clues);

  // The masthead over a paper's title (mastheadOf). Its side column waits
  // for the front matter's end.
  const masthead = titleSegment && !deckTitle ? mastheadOf(segments, titleSegment, running, bodySize) : { segments, side: [] };
  segments = masthead.segments;

  // Front matter. Before the title, on its page or a notice's, a heading is
  // a paragraph: a masthead's lines, a report's number, a rule's agency and
  // docket lines. After it, a heading before the abstract (its heading, or a
  // paragraph that opens with it) names an author or a place, and is a
  // paragraph (a paper's authors, set large and bold, read as headings:
  // arxiv-2506-06752). A title slide's headings under its title are its
  // subtitle and credits (real-gslides-oer-5rs p2).
  const titleAt = titleSegment ? segments.indexOf(titleSegment) : -1;
  const abstracts = segments.flatMap((s, k) => (s.page === titlePage && (s.type === "HEADING" || s.type === "PARAGRAPH") && ABSTRACT_RE.test(s.text) ? [k] : []));
  const abstractAt = abstracts[0] ?? -1;
  const frontEnd = deckTitle ? segments.findIndex((s, k) => k > titleAt && s.page !== deckTitle.page) : abstractAt;
  const frontMatter = segments.slice(0, Math.max(0, titleAt)).filter((s) => s.page === titleSegment?.page || s.page <= notice);
  if (titleAt >= 0 && (deckTitle !== undefined || abstractAt > titleAt)) {
    frontMatter.push(...segments.slice(titleAt + 1, frontEnd < 0 ? segments.length : frontEnd));
    // A paper in two languages sets its title again over its second
    // abstract (a Chinese paper's English title, authors, and "Abstract",
    // arXiv 2111.04880): that title stays a heading, and the headings
    // between it and its abstract are its front matter.
    for (let n = 1; n < abstracts.length; n++) {
      const again = segments.findIndex((s, k) => k > abstracts[n - 1] && k < abstracts[n] && s.type === "HEADING");
      if (again >= 0) frontMatter.push(...segments.slice(again + 1, abstracts[n]));
    }
  }
  // A heading right under a centered title, centered too, set smaller and
  // not bold, is its subtitle ("Kestrel Energy Group" under a report's
  // title, "Lecture notes for a first graduate course" under a course's):
  // a paragraph, not a section.
  const subtitle = titleAt >= 0 && !deckTitle ? segments[titleAt + 1] : undefined;
  if (subtitle?.type === "HEADING" && subtitle.page === titleSegment?.page && titleSegment.align === "center" && subtitle.align === "center" && (subtitle.rawSize ?? 0) < (titleSegment.rawSize ?? 0) && !boldHeadingText(subtitle)) frontMatter.push(subtitle);
  for (const s of frontMatter) {
    if (s.type !== "HEADING") continue;
    s.type = "PARAGRAPH";
    s.html = s.align ? `<p class="${s.align}"></p>` : undefined;
  }

  centerLikeOthers(segments);
  assignHeadingLevels(segments, bodySize, { slides, title: titleSegment, scan });

  // The title's look and alignment (the import's Title), read before the
  // heading it came from leaves the blocks: the look of its largest letters
  // (a title that took the line under it as its scripts read as that
  // line's size).
  // One line: the title is the document's name in every add path. A line
  // break the writer set stays in the heading's own text.
  const title = titleSegment?.text.replace(/\s*[\n\t]\s*/g, " ") ?? null;
  const titleRuns = titleSegment?.runs?.filter((r) => (r.look?.size ?? 0) >= (titleSegment.rawSize ?? 0) - 0.5);
  const titleFont = titleSegment ? spansFromRuns(titleSegment.text, titleRuns?.length ? titleRuns : titleSegment.runs).font : undefined;

  // The reader shows the title above the blocks; the heading it came from
  // would show it twice, where it opens the document or stands under lines
  // that are no heading (a journal's label over a paper's title), and on a
  // deck's title slide.
  const titleHeading = titleSegment ? segments.indexOf(titleSegment) : -1;
  // Where the front matter ends: at the body's first heading on the title's
  // page, the parts of the front matter aside (an abstract, an author
  // summary, keywords).
  const bodyStart = titleSegment ? segments.slice(titleHeading + 1).find((s) => s.type === "HEADING" && s.page === titleSegment.page && !FRONT_PART_RE.test(s.text)) : undefined;
  if (titleHeading >= 0 && (deckTitle !== undefined || segments.slice(0, titleHeading).every((s) => s.type !== "HEADING"))) segments.splice(titleHeading, 1);

  // The segments are the blocks now, in their order: a contents entry links
  // to its heading by that order. Resolved before the title merge and the
  // title's removal, every link pointed past its heading.
  segments = segments.filter((s) => s.text.trim().length > 0 || holdsFill(s) || (s.type === "FIGURE" && s.region));
  // The masthead's side column and the title's notes with no mark stand at
  // the front matter's end, else after the title page's last words.
  const front = titleSegment ? { page: titleSegment.page, before: bodyStart } : undefined;
  if (front && masthead.side.length > 0) segments.splice(frontEndAt(segments, front), 0, ...masthead.side);
  segments = placeFootnotes(segments, footnotes, front);
  resolveContentsLinks(segments);

  // A scan's heading holds no tab: the typist's spaces between a number and
  // its title read as a gap between two cells, and the gap as a tab stop
  // (parse loop finding: the DTIC Datcom's "2.\tANGLE-OF-ATTACK"). A
  // typeset heading keeps its tab: Word sets a number and its title so.
  for (const s of segments) {
    if (s.type !== "HEADING" || !pageFlags[firstPageOf(s)]?.ocr || !s.text.includes("\t")) continue;
    s.text = s.text.replace(/\t/g, " ");
    s.runs = s.runs?.map((run) => {
      const copy = { ...run };
      delete copy.tab;
      return copy;
    });
  }
  const blocks: ParsedBlock[] = segments.map((s) => {
    const { styles, links, font } = spansFromRuns(s.text, s.runs, {
      skipBold: s.type === "HEADING",
      skipMono: s.type === "CODE",
    });
    // Every block keeps the page its first words are on (the PDF's own
    // number, 1-based), and a block joined across page breaks where each
    // later page begins. FIGURE blocks keep their region for the figure
    // image route.
    const block: ParsedBlock = { type: s.type, text: s.text, page: chosen[firstPageOf(s)] };
    if (s.html) block.html = s.html;
    if (s.breaks && s.breaks.length > 0) {
      block.pageStarts = s.breaks.map((b) => ({ offset: b.offset, page: chosen[b.page] }));
    }
    if ((s.type === "FIGURE" || s.type === "EQUATION") && s.region) block.region = s.region;
    if (s.type === "FIGURE" && s.mathCrop) block.mathCrop = true;
    const allLinks = [...(s.links ?? []), ...links];
    if (styles.length > 0) block.styles = styles;
    // Inline formulas: a figure's words are its caption's (a display's crop
    // keeps its glyphs and no formula), and a table's caption formulas come
    // from attachTableCaptions.
    const math =
      s.type === "PARAGRAPH" || s.type === "LIST" || s.type === "HEADING" || (s.type === "FIGURE" && !s.mathCrop) ? mathSpans(s.text, s.runs)
      : s.type === "TABLE" ? (s.math ?? [])
      : [];
    if (math.length > 0) block.math = math;
    if (allLinks.length > 0) block.links = allLinks;
    if (s.footnote) block.footnote = s.footnote;
    if (s.footnoteRefs) block.footnoteRefs = s.footnoteRefs;
    if (font && (s.type === "PARAGRAPH" || s.type === "HEADING" || s.type === "LIST")) block.font = font;
    if (s.spaceAfter !== undefined) block.spaceAfter = s.spaceAfter;
    if (s.lineSpacing !== undefined) block.lineSpacing = s.lineSpacing;
    if (s.indent) block.indent = s.indent;
    if (s.listIndents) block.listIndents = s.listIndents;
    if (s.itemSpace !== undefined) block.itemSpace = s.itemSpace;
    // Tabs: the stops their runs carry, a fill-in rule's underline.
    const tabs = s.type === "PARAGRAPH" || s.type === "HEADING" || s.type === "LIST" ? tabStopsOf(s.text, s.runs) : null;
    if (tabs && tabs.stops.length > 0) block.tabStops = tabs.stops;
    if (tabs && tabs.fills.length > 0) block.styles = [...(block.styles ?? []), ...tabs.fills];
    return block;
  });

  const parsed: PdfParse = { title, blocks };
  if (pageWidths.length > 0) parsed.pageSize = { width: points(pageWidths[0]), height: points(pageHeights[0]) };
  const labels = pageLabelsOf(await pdf.getPageLabels().catch(() => null), pdf.numPages);
  if (labels) parsed.pageLabels = labels;
  // The page's look: the body's (Normal text) and the title's.
  const bodyFont = takeBodyFont(blocks);
  if (bodyFont) parsed.bodyFont = bodyFont;
  if (titleFont) parsed.titleFont = titleFont;
  if (titleSegment?.align) parsed.titleAlign = titleSegment.align;
  // The import's Title opens the page the title stands on, where words of
  // an earlier page come first (a scan's archive notice, a deck's first slide).
  const titleOn = titleSegment ? chosen[firstPageOf(titleSegment)] : undefined;
  if (titleOn !== undefined && blocks.some((b) => (b.page ?? titleOn) < titleOn)) parsed.titlePage = titleOn;
  const titleLines = titleSegment?.text.split(/\s*\n\s*/).map((line) => line.trim()).filter(Boolean) ?? [];
  if (titleLines.length > 1) parsed.titleLines = titleLines;
  return parsed;
}

type PdfParse = Pick<ParsedDocument, "title" | "blocks" | "pageSize" | "pageLabels" | "bodyFont" | "titleFont" | "titleAlign" | "titleLines" | "titlePage">;

// The drawn glyphs no item took that start at a text item's origin, in one
// font on its baseline, while they spell the item's letters (spaces aside);
// or undefined. `untaken`: the glyphs no item took, by their origin's whole
// points.
function drawnRunAt(str: string, x: number, y: number, glyphs: Glyph[], taken: Set<Glyph>, untaken: Map<string, number[]>): Glyph[] | undefined {
  const letters = str.replace(/\s/g, "");
  const near = [-1, 0, 1].flatMap((dx) => [-1, 0, 1].flatMap((dy) => untaken.get(`${Math.round(x) + dx} ${Math.round(y) + dy}`) ?? []));
  const start = near.sort((a, b) => a - b).find((k) => !taken.has(glyphs[k]) && Math.abs(glyphs[k].x - x) <= 0.01 && Math.abs(glyphs[k].y - y) <= 0.01);
  if (!letters || start === undefined) return undefined;
  const run: Glyph[] = [];
  let spelled = "";
  for (let k = start; k < glyphs.length && spelled.length < letters.length; k++) {
    const g = glyphs[k];
    if (taken.has(g) || g.font !== glyphs[start].font || Math.abs(g.y - y) > 0.01) break;
    run.push(g);
    spelled += g.unicode.replace(/\s/g, "");
  }
  if (spelled !== letters) return undefined;
  for (const g of run) taken.add(g);
  return run;
}

// An item's parts where its glyphs are stroked in some places and only
// filled in others, one glyph to each of its characters; null where they
// are drawn alike, or its text does not map onto its glyphs one to one.
function strokeParts(str: string, glyphs: Glyph[] | undefined): { str: string; x: number; w: number; glyphs: Glyph[]; stroked: boolean }[] | null {
  const chars = [...str];
  if (!glyphs || glyphs.length < 2 || chars.length !== glyphs.length) return null;
  const stroked = glyphs.map((g) => g.mode === 2);
  if (stroked.every((b) => b === stroked[0])) return null;
  const parts: { str: string; x: number; w: number; glyphs: Glyph[]; stroked: boolean }[] = [];
  glyphs.forEach((g, k) => {
    const last = parts.at(-1);
    if (last && last.stroked === stroked[k]) {
      last.str += chars[k];
      last.glyphs.push(g);
      last.w = g.x + g.w - last.x;
    } else parts.push({ str: chars[k], x: g.x, w: g.w, glyphs: [g], stroked: stroked[k] });
  });
  return parts;
}

// A drawn run's words and extent: a space where it draws one or leaves a
// gap of a fifth of an em.
function drawnText(run: Glyph[]): { str: string; x: number; w: number } {
  let str = "";
  run.forEach((g, k) => {
    const prev = run[k - 1];
    if (prev && prev.unicode.trim() && g.unicode.trim() && g.x - (prev.x + prev.w) > g.size * 0.2) str += " ";
    str += g.unicode;
  });
  const last = run[run.length - 1];
  return { str, x: run[0].x, w: last.x + last.w - run[0].x };
}

// A page's items and drawing moved by the page box's corner, so (0, 0) is
// the box's bottom left. The corner is rounded to whole steps of 2^-20 pt:
// such a shift is exact for every position on the page, so every distance
// between two positions stays what it was. Shifted by 36.85 itself, a
// bracket set exactly half an em left of its paragraph's other lines
// (Japanese hanging punctuation) crossed the indent test's threshold by
// rounding, and two first-line indents of the MIC white paper were lost.
// Each glyph and box moves once: an item holds glyphs of the drawing, and
// one box may stand in two lists.
function toPageBox(items: Item[], drawing: PageDrawing, cornerX: number, cornerY: number) {
  const dx = Math.round(cornerX * 2 ** 20) / 2 ** 20;
  const dy = Math.round(cornerY * 2 ** 20) / 2 ** 20;
  for (const g of new Set([...drawing.glyphs, ...items.flatMap((i) => i.glyphs ?? [])])) {
    g.x -= dx;
    g.y -= dy;
  }
  for (const b of new Set<Box>([...drawing.rules, ...drawing.fills, ...drawing.images, ...drawing.paths])) {
    b.x1 -= dx;
    b.x2 -= dx;
    b.y1 -= dy;
    b.y2 -= dy;
  }
  for (const i of items) {
    i.x -= dx;
    i.y -= dy;
  }
}

// A rotated text item set upright: at the box its glyphs draw on the page
// (the string run along the item's direction, the glyphs' ascent and
// descent across it), its baseline the origin's. A head rotated 90° stands
// in a box its size wide; one rotated 60° leans across half its length.
function uprightItem(str: string, t: number[], width: number, size: number, flags: Omit<Item, "str" | "x" | "y" | "w" | "size" | "math">): Item {
  const [a, b, c, d, x, y] = t;
  const across = Math.hypot(c, d) || size;
  const corners = [0, 1].flatMap((along) => [-0.2, 0.8].map((up) => [x + (a / size) * along * width + (c / across) * up * size, y + (b / size) * along * width + (d / across) * up * size]));
  const x1 = Math.min(...corners.map((p) => p[0]));
  const x2 = Math.max(...corners.map((p) => p[0]));
  return { ...flags, str, x: x1, y, w: x2 - x1, size, math: false };
}

// The pages the blocks come from: the chosen pages the PDF holds, in order,
// else every page.
function chosenPages(pageCount: number, pages: number[] | undefined): number[] {
  const within = [...new Set(pages ?? [])].filter((p) => Number.isInteger(p) && p >= 1 && p <= pageCount).sort((a, b) => a - b);
  return within.length > 0 ? within : Array.from({ length: pageCount }, (_, i) => i + 1);
}

// The pages a parse reads: the chosen pages, and while they are fewer than
// FURNITURE_PAGES, the nearest pages around them (the earlier of two as
// near), in the PDF's order.
function pagesToRead(chosen: number[], pageCount: number): number[] {
  if (chosen.length >= Math.min(FURNITURE_PAGES, pageCount)) return chosen;
  const kept = new Set(chosen);
  const distance = (p: number) => Math.min(...chosen.map((c) => Math.abs(c - p)));
  const others = Array.from({ length: pageCount }, (_, i) => i + 1)
    .filter((p) => !kept.has(p))
    .sort((a, b) => distance(a) - distance(b) || a - b);
  return [...chosen, ...others.slice(0, FURNITURE_PAGES - chosen.length)].sort((a, b) => a - b);
}

// A slide deck's frame printed on several pages, read once. Beamer prints
// a frame once per overlay step, each page showing what the page before it
// shows and more (a list item per click, an alert's color per click), and
// a frame that continues sets its title again over the next page. A reader
// wants the frame once, whole:
// - a page whose segments open the next page's, in order, each the same
//   kind with the same words (a figure the same region, the page's drawn
//   labels and images the same), is an overlay step of that page, and
//   drops: the next page holds all of it (parse loop finding: a beamer
//   deck's alerts frame, printed three times, read as three frames, and
//   the bench counted its lines as furniture leaking seven times);
// - a page that opens with the heading the last kept page opened with
//   continues that page's frame ("one figure per click", a frame that
//   breaks), and drops the heading.
// The pages the kept segments stand on stay their own: a figure's region
// crops its own page.
function collapseOverlaySteps(segments: Segment[], graphics: Graphic[][], drawings: PageDrawing[]): Segment[] {
  const byPage = new Map<number, Segment[]>();
  for (const s of segments) byPage.set(s.page, [...(byPage.get(s.page) ?? []), s]);
  const pages = [...byPage.keys()].sort((a, b) => a - b);
  const squash = (t: string) => t.replace(/\s+/g, " ").trim();
  // What the page draws beyond its words: its graphics' labels and
  // captions, and its images' boxes. A figure that changes under one title
  // changes these (a chart's axis labels), and the pages are two frames.
  const drawnOf = (p: number) => {
    const labels = (graphics[p] ?? []).flatMap((g) => [...g.labels, ...g.caption].map((i) => i.str.trim())).filter(Boolean);
    const images = (drawings[p]?.images ?? []).map((b) => [b.x1, b.y1, b.x2, b.y2].map((v) => Math.round(v)).join(","));
    return `${labels.join(" ")}|${images.join(";")}`;
  };
  const keyOf = (s: Segment) => {
    // The region's points in percent of the page, to half a percent.
    const region = s.region ? JSON.stringify(s.region, (_, v: unknown) => (typeof v === "number" ? Math.round(v * 2) / 2 : v)) : "";
    return `${s.type}|${squash(s.text)}|${region}`;
  };
  const keys = new Map<number, string[]>();
  for (const p of pages) keys.set(p, [drawnOf(p), ...(byPage.get(p) ?? []).map(keyOf)]);
  const dropped = new Set<Segment>();
  const stepPages = new Set<number>();
  for (let k = 0; k + 1 < pages.length; k++) {
    const [p, q] = [pages[k], pages[k + 1]];
    if (q !== p + 1) continue;
    const [a, b] = [keys.get(p)!, keys.get(q)!];
    if (a.length < 2 || a.length > b.length || !a.every((key, i) => key === b[i])) continue;
    stepPages.add(p);
    for (const s of byPage.get(p) ?? []) dropped.add(s);
  }
  let last: Segment | undefined;
  for (const p of pages) {
    if (stepPages.has(p)) continue;
    const first = byPage.get(p)![0];
    if (first.type === "HEADING" && last?.type === "HEADING" && squash(first.text) === squash(last.text) && Math.abs((first.rawSize ?? 0) - (last.rawSize ?? 0)) < 0.5) dropped.add(first);
    last = first;
  }
  return dropped.size > 0 ? segments.filter((s) => !dropped.has(s)) : segments;
}

// The segments in runs of pages that follow one another in the PDF: a
// segment's page is its index among the chosen pages, and a run ends where
// the choice leaves pages out.
function runsOfPages(segments: Segment[], chosen: number[]): Segment[][] {
  const runs: Segment[][] = [];
  let prev: Segment | undefined;
  for (const s of segments) {
    const apart = prev !== undefined && chosen[s.page] - chosen[prev.page] !== s.page - prev.page;
    if (!prev || apart) runs.push([]);
    runs[runs.length - 1].push(s);
    prev = s;
  }
  return runs;
}

// What the title rests on besides the headings: its page (the first with
// words that is no library's notice), the running heads and feet the
// furniture pass dropped, and on a scan each word's count in the document.
type TitleClues = { page: number; running: Set<string>; words?: Map<string, number> };

// The title: the first of the biggest headings on the title page. A title
// is set larger than the body text; a body-size bold heading on the first
// page ("Problem 1: …") is the first section, not the title. A paper that
// sets its title in two languages, one under the other at one size, has the
// first for its title (a Japanese paper's English title a tenth of a point
// larger took the title). With no heading on the first page set larger
// than the body, a centered heading that opens the first page is the title:
// amsart sets its title in bold capitals at the body's size (arXiv
// 2506.08494, 2410.04586), and a Word contract in bold centered lines.
const SECTION_NUMBER_RE = /^\d{1,2}(?:\.\d{1,2})*\.?\s+[\p{Lu}\p{Lo}\p{N}]/u;
function titleOf(segments: Segment[], bodySize: number, clues: TitleClues, pages = 1): Segment | undefined {
  const onPages = (s: Segment) => s.page >= clues.page && s.page < clues.page + pages;
  // Most of a title's letters are set large: the W-9's form number, "W-9"
  // at 24 pt after "Form" at 7 pt, stood over the form's 14 pt "Request for
  // Taxpayer Identification Number and Certification". A heading whose runs
  // carry no size counts as large.
  const large = (s: Segment) => {
    let big = 0;
    let all = 0;
    for (const r of s.runs ?? []) {
      if (!r.look) return true;
      const letters = s.text.slice(r.start, r.end).match(/\p{L}/gu)?.length ?? 0;
      all += letters;
      if (r.look.size >= bodySize * 1.14) big += letters;
    }
    return all === 0 || big * 2 > all;
  };
  // A title is words: a report's number set large ("NASA/TM—20220005496")
  // is no title. On a scan, most of its words are the document's own.
  const wordy = (s: Segment) => (s.text.match(/\p{L}/gu)?.length ?? 0) * 2 >= s.text.replace(/\s/g, "").length;
  const known = (s: Segment) => {
    if (!clues.words) return true;
    const words = wordsOf(s.text);
    const own = new Map<string, number>();
    for (const w of words) own.set(w, (own.get(w) ?? 0) + 1);
    return words.filter((w) => (clues.words!.get(w) ?? 0) > own.get(w)!).length * 2 >= words.length;
  };
  // parse loop finding: a page that opens with its first section ("1 A
  // small example", a LaTeX article with no \maketitle) has no title: a
  // numbered heading set flush left under half again the body's size is a
  // section's. A title set off with a number ("10 Simple Rules for …") is
  // set larger, or centered.
  const section = (s: Segment) => s.align !== "center" && s.rawSize! < bodySize * 1.5 && SECTION_NUMBER_RE.test(s.text);
  let heads = segments.filter(
    (s) => onPages(s) && s.type === "HEADING" && s.rawSize !== undefined && s.rawSize >= bodySize * 1.14 && s.text.length > 4 && large(s) && wordy(s) && known(s) && !section(s),
  );
  if (heads.length === 0 && pages === 1) {
    const at = segments.findIndex((s) => s.page === clues.page && s.text.trim().length > 0);
    const first = segments[at];
    // Prose under it before any table: a statement's title stands over its
    // table (Apple's statements, a heading of the page).
    const prose = (s: Segment) => s.type === "TABLE" || (s.type === "PARAGRAPH" && !/\bcenter\b/.test(s.html ?? "") && s.text.length >= 100);
    const under = segments.slice(at + 1).find((s) => s.page === clues.page && prose(s));
    if (first?.type === "HEADING" && first.align === "center" && first.text.length > 4 && wordy(first) && known(first) && under?.type === "PARAGRAPH") return first;
    // Else a heading of ten words or more before the page's prose: the
    // Federal Register's subject, bold at the body's size under the
    // agency's and the docket's lines.
    const before = segments.slice(at, segments.findIndex((s, k) => k >= at && s.page === clues.page && prose(s)));
    return before.find((s) => s.type === "HEADING" && s.page === clues.page && (s.text.match(/\S+/g)?.length ?? 0) >= 10 && wordy(s) && known(s));
  }
  // The publication's name set over a paper's title (a journal's masthead,
  // "Applied Energy" at 13.95 pt over the paper's 13.45 pt title) opens the
  // running heads of the pages after it: it yields to a longer heading
  // within a tenth of its size (a title the running heads repeat stays). A
  // newsletter's masthead has none near it.
  const top = Math.max(0, ...heads.map((s) => s.rawSize!));
  const rivals = heads.filter((s) => s.rawSize! >= top * 0.9);
  const opens = (s: Segment) => [...clues.running].some((line) => line.startsWith(squash(s.text)));
  const others = rivals.filter((s) => !opens(s));
  const names = rivals.filter((s) => opens(s) && others.some((o) => o.text.length > s.text.length));
  if (names.length > 0) heads = heads.filter((s) => !names.includes(s));
  const biggest = Math.max(0, ...heads.map((s) => s.rawSize!));
  return heads.find((s) => s.rawSize! >= biggest * 0.97);
}

// A deck's title slide: one of its first three, its title set a fifth
// larger than every heading of the other two (a deck may open with a slide
// on how to use it: real-gslides-oer-5rs).
function titleSlideOf(segments: Segment[], bodySize: number, clues: TitleClues): Segment | undefined {
  const title = titleOf(segments, bodySize, clues, 3);
  if (!title) return undefined;
  const others = segments.filter((s) => s.page >= clues.page && s.page < clues.page + 3 && s.page !== title.page && s.type === "HEADING" && s.rawSize !== undefined);
  return others.every((s) => s.rawSize! * 1.2 <= title.rawSize!) ? title : undefined;
}

// A library's notice set before a scan's first page ("Historic, archived
// document. Do not assume content reflects current scientific knowledge,
// policies, or practices.", the USDA's on its Internet Archive scans): the
// page it opens, or -1.
const NOTICE_RE = /^historic,? archived document\b/i;
function noticePage(segments: Segment[]): number {
  const first = segments.find((s) => s.text.trim());
  return first && NOTICE_RE.test(first.text.trim()) ? first.page : -1;
}

// A text's words of three letters or more, in lower case.
function wordsOf(text: string): string[] {
  return text.toLowerCase().match(/\p{L}{3,}/gu) ?? [];
}

// How often each word stands in the document's blocks.
function wordCounts(segments: Segment[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const s of segments) for (const w of wordsOf(s.text)) counts.set(w, (counts.get(w) ?? 0) + 1);
  return counts;
}

// A line's text as a masthead compares it: lower case, one space.
function squash(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

// The parts of a paper's front matter that its headings name.
const FRONT_PART_RE =
  /^\s*(?:(?:abstract|author summary|lay summary|significance(?: statement)?|highlights|graphical abstract|key ?words|index terms|article info|ccs concepts)\b|摘\s*要|要\s*旨|关\s*键\s*词|キーワード)/i;

// The masthead over a paper's title, on its page, in the lines read before
// it: a line the running heads repeat drops (PLOS's "PLOS COMPUTATIONAL
// BIOLOGY", Nature's "Article" and DOI, Elsevier's journal line); short lines
// set over the title are its kicker, which the import sets over the Title (a
// journal's name and dates, a report's number, "RESEARCH ARTICLE"), and a
// rule between them drops; a side column set small under the title's foot
// goes to the front matter's end (PLOS's citation, editor, and dates): read
// in the page's order, all of them stood between the Title and its
// authors, PLOS's masthead with 292 pt of space after it. Lines over the
// title that are more than a masthead (a 10-K cover's check boxes, a
// court's notice, more than four blocks: the Federal Register's page opens
// with the end of the rule before and this one's agency and docket lines)
// stay as they are, and so do words at the body's size under it. Lines
// beside the title, stacked with no paragraph gap, are one paragraph
// (joinBeside); a side column runs down the page, and lines that end a few
// lines under the title's foot are no side column.
function mastheadOf(segments: Segment[], title: Segment, running: Set<string>, bodySize: number): { segments: Segment[]; side: Segment[] } {
  const at = segments.indexOf(title);
  const tb = title.box;
  if (at <= 0 || !tb) return { segments, side: [] };
  const before = segments.slice(0, at).filter((s) => s.page === title.page);
  const drop = new Set(before.filter((s) => (s.type === "PARAGRAPH" || s.type === "HEADING") && isRunning(s.text, running)));
  for (const s of joinBeside(before.filter((s) => !drop.has(s)), tb, bodySize)) drop.add(s);
  const under = before.filter((s) => !drop.has(s) && s.type !== "FIGURE" && s.box !== undefined && s.box.y2 <= tb.y1 + 2);
  const deep = under.some((s) => s.box!.y1 < tb.y1 - bodySize * 6);
  const side = deep && under.every((s) => (s.lineSize ?? bodySize) < bodySize * 0.95) ? under : [];
  const over = before.filter((s) => !drop.has(s) && s.type !== "FIGURE" && s.type !== "SEPARATOR" && s.box !== undefined && s.box.y1 >= tb.y2 - 2);
  if (over.length <= 4 && over.every((s) => (s.type === "PARAGRAPH" || s.type === "HEADING") && [...s.text].length <= 150)) {
    for (const s of before) if (s.type === "SEPARATOR") drop.add(s);
    for (const s of over) {
      const align = s.type === "HEADING" ? s.align : (/\b(center|right)\b/.exec(s.html ?? "")?.[1] as Segment["align"]);
      s.type = "PARAGRAPH";
      s.html = `<p class="kicker${align ? ` ${align}` : ""}"></p>`;
    }
  }
  return { segments: segments.filter((s) => !drop.has(s) && !side.includes(s)), side };
}

// Lines beside the title, stacked at one left edge with no paragraph gap
// between them, are one paragraph of the masthead, a line apiece: a form's
// number, revision, and agency ("Form W-9", "(Rev. March 2024)",
// "Department of the Treasury", "Internal Revenue Service"). The first line
// stands in the title's band; the lines under it follow it down. Returns
// the lines joined into the first.
function joinBeside(before: Segment[], tb: Box, bodySize: number): Segment[] {
  const joined: Segment[] = [];
  const line = (s: Segment) => s.type === "PARAGRAPH" && s.box !== undefined && !s.text.includes("\n") && s.box.y2 - s.box.y1 <= (s.lineSize ?? bodySize) * 1.6;
  for (let k = 0; k < before.length; k++) {
    const head = before[k];
    const hb = head.box;
    if (!line(head) || !hb || !(hb.x2 <= tb.x1 || hb.x1 >= tb.x2) || hb.y1 >= tb.y2 || hb.y2 <= tb.y1) continue;
    let last = head;
    while (k + 1 < before.length) {
      const next = before[k + 1];
      const nb = next.box;
      const lb = last.box!;
      if (!line(next) || !nb || Math.abs(nb.x1 - hb.x1) > 2 || nb.y2 > lb.y2 || lb.y1 - nb.y2 > (next.lineSize ?? bodySize) * 0.6) break;
      const offset = head.text.length + 1;
      head.text = `${head.text}\n${next.text}`;
      shiftSpansInto(head, next, offset);
      head.box = unionBox(head.box!, nb);
      if (head.lineBox && next.lineBox) head.lineBox = unionBox(head.lineBox, next.lineBox);
      head.spaceAfter = next.spaceAfter;
      joined.push(next);
      last = next;
      k++;
    }
  }
  return joined;
}

// A heading set bold, most of its words: a section's look, no subtitle's.
function boldHeadingText(s: Segment): boolean {
  const bold = (s.runs ?? []).reduce((n, r) => n + (r.bold ? r.end - r.start : 0), 0);
  return bold * 2 > s.text.length;
}

// A line the running heads repeat: one of them, or two of them side by side
// (Nature's "Article" and its DOI).
function isRunning(text: string, running: Set<string>): boolean {
  const line = squash(text);
  return running.has(line) || [...running].some((head) => head.length >= 3 && line.startsWith(`${head} `) && running.has(line.slice(head.length + 1)));
}

// Where the front matter's leftovers go: before the body's first heading
// on the title's page, else after the page's last block that is no heading.
function frontEndAt(segments: Segment[], front: { page: number; before?: Segment }): number {
  const at = front.before ? segments.indexOf(front.before) : -1;
  if (at >= 0) return at;
  const last = segments.findLastIndex((s) => s.type !== "HEADING" && (s.breaks?.at(-1)?.page ?? s.page) === front.page);
  return last >= 0 ? last + 1 : segments.length;
}

// A size in points, to a hundredth: A4 is 595.28 × 841.89.
function points(value: number): number {
  return Math.round(value * 100) / 100;
}

// The PDF's page labels (pdf.js getPageLabels: one per page, "" where the
// PDF names a page with no number), kept only when they name the pages
// otherwise than 1..n — as pdf.js's own viewer does. An unnamed page
// between two numbered pages that imply the same number takes it; any
// other unnamed page among named ones keeps "": it has no number (a scan's
// cover, the archive's notice, a plate between two pages; with its PDF
// number, an Internet Archive bulletin's margin read p. 1, 3, 2, 3). With
// no page named, each reads as its number. A label is a margin note
// ("xii", "A-12"): a longer one is cut, so a crafted prefix cannot swell
// the page data, and cut by characters: the database refuses a string that
// holds half of a surrogate pair, and the add with it.
const PAGE_LABEL_MAX = 24;
function pageLabelsOf(labels: string[] | null, pageCount: number): string[] | undefined {
  if (!labels || labels.length !== pageCount) return undefined;
  const cut = labels.map((label) => Array.from(label.trim().toWellFormed()).slice(0, PAGE_LABEL_MAX).join(""));
  if (cut.every((label) => !label)) return undefined;
  const number = (k: number) => (/^\d{1,6}$/.test(cut[k] ?? "") ? Number(cut[k]) : null);
  const named = cut.map((label, i) => {
    if (label) return label;
    const before = cut.slice(0, i).findLastIndex(Boolean);
    const after = cut.findIndex((l, k) => k > i && l !== "");
    const [a, b] = [before >= 0 ? number(before) : null, after >= 0 ? number(after) : null];
    return a !== null && b !== null && a + (i - before) === b - (after - i) ? String(a + (i - before)) : "";
  });
  return named.every((label, i) => label === String(i + 1)) ? undefined : named;
}
