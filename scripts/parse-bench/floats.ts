import { regionBounds } from "@/lib/video/types";
import type { DocBlock } from "./adapt";
import type { PdfText } from "./free";
import type { Flat } from "./metrics";
import type { PagePaint, Rect } from "./paint";
import { wordsOf } from "./text";

// Figures, tables, and their captions against the page, with no reference:
// a picture the page shows that no figure of the candidate shows, a caption
// that stands apart from its figure or table, two crops of one figure, and
// a table's caption on the other side of its grid than the page sets it.

type Line = PdfText["lines"][number];
export type Placed = Rect & { page: number };

/** A figure's region on its page, in points. */
function regionOf(pdf: PdfText, at: NonNullable<DocBlock["at"]>): Placed | null {
  const size = pdf.sizes.get(at.page);
  if (!size) return null;
  const b = regionBounds(at.region);
  return { page: at.page, x1: (b.x1 / 100) * size.width, x2: (b.x2 / 100) * size.width, y1: (b.y1 / 100) * size.height, y2: (b.y2 / 100) * size.height };
}

const area = (r: Rect) => Math.max(0, r.x2 - r.x1) * Math.max(0, r.y2 - r.y1);
const overlap = (a: Rect, b: Rect) => Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1)) * Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1));

// ── Pictures no figure shows ────────────────────────────────────────────────

/** A picture: images that touch (a photo drawn in strips, a grid of photos
    set edge to edge) as one, their box and each image's. */
export type Picture = Placed & { images: Rect[] };

/** The pictures a page shows as its own content, on the pages scored: the
    images the page paints (paint.ts) 60 pt or more a side and under nine
    tenths of the page, those that touch as one picture, but not
    - an image at the same place on three pages or more (a slide's
      template, a logo on every page),
    - a banner across the page's head or foot (four fifths of its width, in
      its top or bottom quarter),
    - a ground under the page's words: a picture one of whose images holds
      most of a line of three words or more, or of a line set 20 pt or
      larger (a slide's background, a sidebar's tint, the plate under a
      chapter's number). A line in the gap between a picture's images (a
      caption in a photo grid's empty corner) is over none of them. */
export function contentImages(pdf: PdfText, paint: PagePaint[]): Picture[] {
  const last = pdf.first + pdf.raw.length - 1;
  const same = (a: Rect, b: Rect) => Math.abs(a.x1 - b.x1) <= 2 && Math.abs(a.y1 - b.y1) <= 2 && Math.abs(a.x2 - b.x2) <= 2 && Math.abs(a.y2 - b.y2) <= 2;
  const furniture = new Set(pdf.furniture);
  const out: Picture[] = [];
  for (let page = pdf.first; page <= last; page++) {
    const painted = paint[page - 1];
    if (!painted) continue;
    const { width, height } = painted;
    const kept = painted.images.filter((image) => {
      if (image.x2 - image.x1 < 60 || image.y2 - image.y1 < 60 || area(image) > 0.9 * width * height) return false;
      if (image.x2 - image.x1 >= 0.8 * width && (image.y2 <= 0.25 * height || image.y1 >= 0.75 * height)) return false;
      return paint.filter((other) => other.images.some((x) => same(x, image))).length < 3;
    });
    const pictures: Picture[] = [];
    for (const image of kept) {
      const touching = pictures.find((p) => image.x1 <= p.x2 + 1 && image.x2 >= p.x1 - 1 && image.y1 <= p.y2 + 1 && image.y2 >= p.y1 - 1);
      if (touching) {
        Object.assign(touching, { x1: Math.min(touching.x1, image.x1), y1: Math.min(touching.y1, image.y1), x2: Math.max(touching.x2, image.x2), y2: Math.max(touching.y2, image.y2) });
        touching.images.push(image);
      } else pictures.push({ page, ...image, images: [image] });
    }
    const words = pdf.lines
      .filter((l) => l.page === page && !furniture.has(l) && (wordsOf(l.text).length >= 3 || l.bottom - l.top >= 20))
      .map((l) => ({ x1: l.left, y1: l.top, x2: l.right, y2: l.bottom }));
    for (const p of pictures) if (!p.images.some((image) => words.some((l) => overlap(image, l) > 0.8 * area(l)))) out.push(p);
  }
  return out;
}

export type PictureScores = { pictures: number; missed: number; score: number | null; found: { page: number; box: string }[] };

/** Pictures no figure shows: a content picture (contentImages) half of whose
    images' area no figure of the candidate covers. The page editor draws a
    figure as its crop of the page; a picture outside every crop is lost.
    The score is the share of the page's pictures some figure shows. */
export function pictureScores(pdf: PdfText, cand: Flat, pictures: Picture[]): PictureScores {
  const figures = cand.blocks.flatMap((b) => (b.kind === "figure" && b.at ? [regionOf(pdf, b.at)] : [])).filter((r): r is Placed => r !== null);
  const found: PictureScores["found"] = [];
  for (const p of pictures) {
    const shown = p.images.reduce((n, image) => n + Math.max(0, ...figures.filter((f) => f.page === p.page).map((f) => overlap(f, image))), 0);
    if (shown < 0.5 * p.images.reduce((n, image) => n + area(image), 0)) found.push({ page: p.page, box: [p.x1, p.y1, p.x2, p.y2].map((v) => Math.round(v)).join(" ") });
  }
  return { pictures: pictures.length, missed: found.length, score: pictures.length > 0 ? 1 - found.length / pictures.length : null, found };
}

// ── Captions apart from their figure or table ───────────────────────────────

/** A caption's opening: a figure's or a table's label, its number, and the
    stop after them ("Figure 3.", "Table 2:", "Photo 11.", "図表Ⅰ-2-1-3",
    German's "Abbildung 1.4:"); a sentence that names a figure ("Figure 3
    shows", "Figure 6.1 shows") has no stop there: a period before a digit
    is the number's. A label with no number takes a full stop
    ("Visualization. The …", a newsletter's "Photo."), as figures.ts
    CAPTION_RE reads it: a colon after it names a part of the text
    ("Visualization: …", PLOS's contributions; parse loop finding: a
    textbook's worked examples run "Model: …", "Visualization: …",
    "Solution: …", each a paragraph with a run-in lead and no figure beside
    it, and the two "Visualization:" paragraphs counted as captions apart
    from their figure). */
const NUMBER = "[\\dIVXLivxl]+(?:[.\\-–][\\dIVXLivxl]+)*[a-z]?";
const CAPTION_OPENING_RE = new RegExp(
  `^\\s*(?:(?:figure|table|photo|visualization|image|map|chart|plate|box|exhibit|scheme|abbildung|tabelle)\\s*(?:${NUMBER}\\s*[.:—–]|\\.)(?!\\d)|(?:fig|tab|abb)\\.\\s*${NUMBER}\\s*[.:—–](?!\\d)|(?:図表?|表)\\s*[\\dⅠ-Ⅻ]+(?:[.\\-–][\\dⅠ-Ⅻ]+)*)`,
  "iu",
);
/** A figure's or a table's caption opening with its label and number,
    with or without a stop after them ("Figure 2.6 Not all subsets …", the
    MML book's style): the candidate set it as a caption already. */
const LABELED_RE = new RegExp(`^\\s*(?:(?:figure|table|photo|image|map|chart|plate|box|exhibit|scheme|abbildung|tabelle|fig\\.|tab\\.|abb\\.)\\s*${NUMBER}|(?:図表?|表)\\s*[\\dⅠ-Ⅻ])`, "iu");

export type CaptionScores = { captions: number; alone: number; score: number | null; found: { text: string }[] };

/** Captions apart from their figure or table: a paragraph that opens as a
    caption does (CAPTION_OPENING_RE) is a caption the candidate did not
    give its figure or table (a figure's caption that runs into the page
    after, a table the candidate lost). The score is the share of the
    candidate's captions set with their figure or table. */
export function captionScores(cand: Flat): CaptionScores {
  const text = (b: number) => cand.unitsOf[b].map((u) => cand.units[u].text).join(" ");
  let kept = 0;
  const found: CaptionScores["found"] = [];
  cand.blocks.forEach((block, b) => {
    if (block.kind === "figure" || block.kind === "table") {
      const caption = block.caption?.map((s) => s.text).join("") ?? "";
      if (CAPTION_OPENING_RE.test(caption) || LABELED_RE.test(caption)) kept++;
    }
    if (block.kind === "paragraph" && CAPTION_OPENING_RE.test(text(b))) found.push({ text: text(b).slice(0, 100) });
  });
  const captions = kept + found.length;
  return { captions, alone: found.length, score: captions > 0 ? 1 - found.length / captions : null, found };
}

// ── Crops of one figure ─────────────────────────────────────────────────────

export type CropOverlaps = { figures: number; overlapping: number; score: number | null; found: { page: number; text: string }[] };

/** Crops that overlap: two figures of the candidate on one page whose
    regions share a quarter of the smaller one or more (a photo grid read as
    a crop per row and one of a block of it, the page editor drawing the
    same photo twice). The score is the share of the candidate's figures
    that overlap none. */
export function cropOverlaps(pdf: PdfText, cand: Flat): CropOverlaps {
  const figures = cand.blocks.flatMap((block) => {
    const box = block.kind === "figure" && block.at ? regionOf(pdf, block.at) : null;
    return box ? [{ block, box }] : [];
  });
  const over = new Set<number>();
  const found: CropOverlaps["found"] = [];
  figures.forEach((a, i) => {
    figures.forEach((b, j) => {
      if (j <= i || a.box.page !== b.box.page) return;
      if (overlap(a.box, b.box) < 0.25 * Math.min(area(a.box), area(b.box))) return;
      over.add(i).add(j);
      const caption = [a.block, b.block].map((x) => (x.kind === "figure" ? (x.caption ?? []).map((s) => s.text).join("") : "")).find(Boolean) ?? "";
      found.push({ page: a.box.page, text: caption.slice(0, 80) });
    });
  });
  return { figures: figures.length, overlapping: over.size, score: figures.length > 0 ? 1 - over.size / figures.length : null, found };
}

// ── A table caption's side ──────────────────────────────────────────────────

export type CaptionSides = { tables: number; wrong: number; score: number | null; found: { page: number; text: string; set: string; drawn: string }[] };

/** A table caption's side: the page sets a caption over its table's grid or
    under it (a paper's style sets it under), and the page editor draws it
    where the candidate says; a stack of tables with their captions under
    them reads each caption as the next table's when drawn over. The page's
    side: the caption's first line against the lines of the table's cells
    (linesOfUnits), on one page. The score is the share of the candidate's
    captioned tables judged whose caption stands on the page's side. */
export function captionSides(pdf: PdfText, cand: Flat, placed: number[][]): CaptionSides {
  let tables = 0;
  let wrong = 0;
  const found: CaptionSides["found"] = [];
  cand.blocks.forEach((block, b) => {
    if (block.kind !== "table" || !block.caption || !block.captionSide) return;
    const units = cand.unitsOf[b];
    const captionLines = units.filter((u) => cand.units[u].index === -1).flatMap((u) => placed[u]).map((i) => pdf.lines[i]);
    const first = captionLines[0];
    if (!first) return;
    const cellUnits = units.filter((u) => cand.units[u].index >= 0 && cand.units[u].text.trim() !== "");
    const cells: Line[] = cellUnits.flatMap((u) => placed[u]).map((i) => pdf.lines[i]).filter((l) => l.page === first.page);
    if (cells.length < 2) return;
    // A table whose cells the text layer mostly does not place is not
    // judged: pdftotext (-nodiag) drops a table whose head is set
    // diagonal, rows and all, and the few cells placed land on the body's
    // lines that cite the same words (parse benchmark finding: an IEEE
    // paper's Table I, its head rotated 60°, placed "LangChain [5]" and
    // "GPTCache [6]" on the paragraph over the table that cites them, and
    // the caption set over the table read as under it).
    if (cells.length * 3 < cellUnits.length) return;
    const top = Math.min(...cells.map((l) => l.top));
    const bottom = Math.max(...cells.map((l) => l.top));
    const side = first.top < top ? "above" : first.top > bottom ? "below" : null;
    if (!side) return;
    tables++;
    if (side === block.captionSide) return;
    wrong++;
    found.push({ page: first.page, text: block.caption.map((s) => s.text).join("").slice(0, 80), set: side, drawn: block.captionSide });
  });
  return { tables, wrong, score: tables > 0 ? 1 - wrong / tables : null, found };
}
