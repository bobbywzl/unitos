// Figures: display equations, captioned figures, and the page's graphics
// (images and vector drawings) become FIGURE blocks with a region to crop.
// The page's drawing (images and vector paths) comes from drawing.ts.

import type { PageDrawing, PathBox } from "@/lib/parse/pdf/drawing";
import { median, regionOf, unionBox } from "@/lib/parse/pdf/geometry";
import { lineColumn, type Placed } from "@/lib/parse/pdf/columns";
import { buildLines } from "@/lib/parse/pdf/lines";
import { resolveZones } from "@/lib/parse/pdf/math/zones";
import { cellParagraphs } from "@/lib/parse/pdf/ruled";
import { tableSegment, type TableRow } from "@/lib/parse/pdf/tables";
import { joinGroup, joinWrapped } from "@/lib/parse/pdf/text";
import type { Box, Item, Line, PageContext, Run, Segment } from "@/lib/parse/pdf/types";

// ── Figure regions ──────────────────────────────────────────────────────────
// A PDF carries no figure objects the text layer can name: a vector chart is
// its tick labels and legend, a display equation its glyphs, a raster image
// nothing at all. What the page shows at that spot is the figure, so the block
// becomes a FIGURE whose region the figure image route crops (SPEC.md §16):
// display equations by their math glyphs, captioned figures by the space and
// the debris above (or below) their "Figure N" caption. Import compare loop
// finding: charts read as tables of ticks, equations as tables, figures shown
// as whole pages.

// A float's label: a figure's ("Figure", "Fig.", and a newsletter's "Photo",
// "Visualization", "Map", …) or a table's. Earth Observer labels its photos
// "Photo 1." and "Photo.": 15 captions read as paragraphs, and two ran into
// the next page's text.
// A scan's OCR misreads "FIGURE" as "FLGURE", "F IGURE", "j'IGURE", and
// "\FIGURE" (parse loop finding: NACA Report 515's captions read as
// paragraphs and headings): those spellings are the label too. No
// typeset page spells them.
const LABEL = String.raw`fig\.?|figure|\\?f ?[il1!|]gure|j['’]igure|table|tab\.|photo|visualization|image|map|chart|plate|box|abbildung|abb\.|tabelle`;
// A caption's label and its stop: "Figure 2:", "Fig. 3a.", PLOS's "Fig 1.",
// "Table A1 |", "Photo 3.", and the roman numbers of REVTeX and IEEE ("TABLE
// II. Fitting parameters …", arXiv 2502.02648, read as a paragraph with no
// caption). A label with no number takes a full stop ("Photo. Dr. …"): a
// colon after it names a role ("Visualization: …", PLOS's contributions). A
// Chinese or Japanese label takes a space for its stop ("図表Ⅰ-2-1-1 避難所デ
// ータ…"), or a stop and a space ("図 9. コミットおよびそのツリー": the
// Japanese Pro Git's 20 captions read as paragraphs), and a caption there
// holds no full stop: "图 3 示意了…。" opens a paragraph (arXiv 2111.04880
// p10). German labels its floats "Abbildung",
// "Abb.", and "Tabelle" (parse loop finding: GeoTopo's "Abbildung 1.4:
// Wenn X₁, X₂ hausdorffsch sind, …" was a paragraph, and its figure's
// labels a table). A number with parts ("1.8a", "2-1") takes its stop
// after its last part: "Abbildung 1.8a veranschaulicht …" opens a
// sentence.
export const CAPTION_RE = new RegExp(
  String.raw`^(?:(?:${LABEL})\s*(?:\d+(?:[.‐–-]\d+)*[a-z]?|[A-Z][‐–-]?\d+[a-z]?|[IVXL]+\b)\s*[.:|–—-](?!\d)\s*|(?:figure|photo|visualization|image|map|chart|plate|abbildung)\.\s+\S|(?:図表|図|图|圖|表)\s*[0-9Ⅰ-Ⅻ]+(?:[-‐–.][0-9Ⅰ-Ⅻ]+)*[.:．：]?\s(?![^]*。))`,
  "i",
);
// "Table 3", "Table A1", an appendix's "Table A-1", IEEE's "TABLE IV", and
// "表 2".
const TABLE_CAPTION_RE = /^(?:(?:table|tab\.|tabelle)\s*(?:\d+|[A-Z][‐–-]?\d+|[IVXL]+\b)|表\s*[0-9Ⅰ-Ⅻ])/i;
// A float's label at a line's start, with a stop after it or none.
const LABEL_START_RE = new RegExp(String.raw`^(?:(?:${LABEL})\s*(?:\d+|[A-Z]\d+|[IVXL]+\b)|(?:図表|図|图|圖|表)\s*[0-9Ⅰ-Ⅻ])`, "i");
const LABEL_RE = new RegExp(String.raw`^(${LABEL})\s*(\d+|[A-Z]\d+)[a-z]?(?=\s)`, "i");

/** A figure's or a table's caption: its label and a stop ("Figure 2:",
    "Fig. 3.", "Table 1 |"), or a label set bold or in small caps with no
    stop and the words after it plain. LIPIcs and Springer set a caption so
    ("Figure 2 Mapped circuit …", arXiv 2506.06752: every caption read as a
    paragraph and its figure lost it), where a sentence that opens with
    "Figure 2 shows …" is plain throughout. */
export function isCaption(text: string, runs: Run[] | undefined): boolean {
  if (CAPTION_RE.test(text)) return true;
  const label = LABEL_RE.exec(text)?.[0].length;
  if (label === undefined || !runs?.some((r) => r.start === 0)) return false;
  const styled = (r: Run) => r.bold || r.smallCaps;
  const words = runs.filter((r) => r.end > label && /\p{L}/u.test(text.slice(Math.max(r.start, label), r.end)));
  return runs.filter((r) => r.start < label).every(styled) && words.length > 0 && !styled(words[0]);
}

// ── Panel captions ──────────────────────────────────────────────────────────
// A figure of panels captions each panel under it ("(a) Round 1: k × k × k
// cube", "(B) d = 3, e = 3", "b. Random walk in two dimensions.") and may
// add a note or its source under the figure ("Note: The dashed line is …",
// "（出典）…"). They are the figure's caption, before or after its own as
// the page reads (arXiv 2302.12627 p18, 2410.04586 p9, 2506.08209 p12,
// Grinstead–Snell p16: their words were in no block). A letter alone is
// the panel's label, which the figure's caption names; a symbol and its
// script is a caption ("(c) Ω₃", GeoTopo's Abbildung 1.12: it was lost).
const PANEL_RE = /^(?:\(\p{L}\)|\p{L}[.)])\s+(?=[^]*\p{L})[^]{2,}/u;
const NOTE_RE = /^(?:(?:notes?|sources?)\s*[:.]\s+\S|[（(](?:出典|注|資料|来源|來源)[）)]|(?:出典|注|来源|來源)[:：])/i;
// Panel letters alone ("(c) (d)") are a chart's labels, no caption.
const LETTERS_RE = /^(?:\s*(?:\(\p{L}\)|\p{L}[.)]))+\s*$/u;
const isSubCaption = (text: string) => (PANEL_RE.test(text.trim()) && !LETTERS_RE.test(text)) || NOTE_RE.test(text.trim());

type CaptionPart = { text: string; runs: Run[]; box: Box };

// Rows from the top of the page, each row from the left.
function readingOrder(a: CaptionPart, b: CaptionPart): number {
  const overlap = Math.min(a.box.y2, b.box.y2) - Math.max(a.box.y1, b.box.y1);
  const shorter = Math.min(a.box.y2 - a.box.y1, b.box.y2 - b.box.y1);
  return overlap > shorter * 0.5 ? a.box.x1 - b.box.x1 : b.box.y2 - a.box.y2;
}

// A figure's caption with its panels' captions, in reading order.
function withPanels(figure: Segment, panels: CaptionPart[]) {
  const own: CaptionPart = { text: figure.text, runs: figure.runs ?? [], box: figure.captionBox ?? figure.box! };
  const parts = [...panels, own].filter((p) => p.text.trim() !== "").sort(readingOrder);
  let text = "";
  const runs: Run[] = [];
  for (const part of parts) {
    if (text !== "") text += " ";
    const offset = text.length;
    text += part.text;
    runs.push(...part.runs.map((r) => ({ ...r, start: r.start + offset, end: r.end + offset })));
  }
  figure.text = text;
  figure.runs = runs;
  figure.captionBox = parts.map((p) => p.box).reduce((a, b) => unionBox(a, b));
}

// Chart text, equation glyphs, ticks: what a figure leaves in the text layer.
// A panel's letter alone ("(b)") is its figure's label whatever it read as:
// set bold, it read as a heading, and every label over it stayed text
// (Grinstead–Snell p. 163, Figure 4.6).
function isFigureDebris(s: Segment, ctx: PageContext): boolean {
  if (!s.region && LETTERS_RE.test(s.text)) return true;
  if (s.region || s.type === "HEADING" || s.type === "CODE" || s.type === "EQUATION") return false;
  if (isCaption(s.text, s.runs)) return false;
  if (s.type === "FIGURE") return !s.region;
  if (s.type === "TABLE") return true;
  if ((s.lineSize ?? ctx.bodySize) < ctx.bodySize * 0.92) return true;
  const text = s.text.trim();
  if (text.length <= 12) return true;
  // An OCR layer sizes each mark from the scan: a chart's ticks and the
  // specks read beside them come out at any size. On an OCR page a line of
  // more marks and digits than letters is a figure's at any size (parse
  // loop finding: NACA Report 515 p. 7, "24 .6 ~ W D ~ D '. 6" read at 15
  // pt over a 10.3 pt body, and the chart's labels over it stayed text).
  const letters = text.replace(/[^\p{L}]/gu, "").length;
  if (ctx.ocr && text.length <= 60 && !s.text.includes("\n") && letters * 2 < text.replace(/\s/g, "").length) return true;
  // A panel title or axis label at body size: short, no sentence end. A
  // Chinese or Japanese sentence ends with "。" (MIC white paper p9: a
  // paragraph's last line over a caption read as its figure's).
  return (
    text.length <= 60 &&
    !/[.!?:;,。．！？：；，、]$/.test(text) &&
    (s.lineSize ?? ctx.bodySize) <= ctx.bodySize * 1.05 &&
    !s.text.includes("\n")
  );
}

// ── Embedded images ─────────────────────────────────────────────────────────
// The images a captioned figure's band takes in (drawing.ts reads them all):
// icons and bullet glyphs are too small to count; a page-sized image is a
// scan or a background, whose text layer stays text.
function figureImages(images: Box[], pageWidth: number, pageHeight: number): Box[] {
  const boxes = images.filter((box) => {
    const w = box.x2 - box.x1;
    const h = box.y2 - box.y1;
    return w >= pageWidth * 0.12 && h >= pageHeight * 0.04 && w * h <= pageWidth * pageHeight * 0.85;
  });
  // Images on one row (a left and a right chart) are one figure.
  const merged: Box[] = [];
  for (const box of boxes.sort((a, b) => b.y2 - a.y2 || a.x1 - b.x1)) {
    const near = merged.find((m) => {
      const overlap = Math.min(m.y2, box.y2) - Math.max(m.y1, box.y1);
      const shorter = Math.min(m.y2 - m.y1, box.y2 - box.y1);
      const gap = Math.max(box.x1 - m.x2, m.x1 - box.x2);
      return overlap > shorter * 0.5 && gap < pageWidth * 0.08;
    });
    if (near) {
      near.x1 = Math.min(near.x1, box.x1);
      near.y1 = Math.min(near.y1, box.y1);
      near.x2 = Math.max(near.x2, box.x2);
      near.y2 = Math.max(near.y2, box.y2);
    } else merged.push({ ...box });
  }
  return merged;
}

type Drawn = { images: Box[]; paths: PathBox[] };

// ── Graphics ────────────────────────────────────────────────────────────────
// What the page draws that is a graphic: an image, or a vector drawing (a
// diagram, a chart). Found before the page's lines are built, so a graphic's
// labels (a chart's ticks, a diagram's names) never join the text beside it
// and never become text: the figure's crop shows them. Census class 10: a
// slide's diagram labels were pasted into its bullets. Text over a graphic
// that reads as the page's own (a title, a quotation, a paragraph) stays
// text, and a panel or banner that holds it is a background, not a graphic.
// Census class 2: a photo and the quotation's panel beside it merged into
// one box that deleted the slide's title, quotation, and citation.

// pictures: the images a graphic is made of (none for a vector drawing),
// each of which a caption set beside it may take (attachFigureRegions).
export type Graphic = Placed & { labels: Item[]; caption: Item[]; pictures: Box[] };

// A glyph's fill as light as white.
const WHITE_RE = /^#(?:f[0-9a-f]){3}$/i;

// A run of text: the items on one baseline that follow each other with no
// wider gap than a word's.
type TextRun = { items: Item[]; box: Box; size: number; chars: number; italic: number };

function textRuns(items: Item[]): TextRun[] {
  const sorted = items.filter((i) => i.str.trim().length > 0).sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: Item[][] = [];
  for (const item of sorted) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(row[0].y - item.y) < Math.max(row[0].size, item.size) * 0.35) row.push(item);
    else rows.push([item]);
  }
  const runs: TextRun[] = [];
  for (const row of rows) {
    row.sort((a, b) => a.x - b.x);
    let run: Item[] = [];
    const flush = () => {
      if (run.length === 0) return;
      const size = Math.max(...run.map((i) => i.size));
      const chars = run.reduce((n, i) => n + i.str.trim().length, 0);
      const italic = run.filter((i) => i.italic).reduce((n, i) => n + i.str.trim().length, 0);
      runs.push({
        items: run,
        size,
        chars,
        italic,
        box: {
          x1: Math.min(...run.map((i) => i.x)),
          x2: Math.max(...run.map((i) => i.x + i.w)),
          y1: Math.min(...run.map((i) => i.y)) - size * 0.25,
          y2: Math.max(...run.map((i) => i.y)) + size * 0.8,
        },
      });
      run = [];
    };
    for (const item of row) {
      const last = run[run.length - 1];
      if (last && item.x - (last.x + last.w) > Math.max(last.size, item.size)) flush();
      run.push(item);
    }
    flush();
  }
  return runs;
}

// The share of a box's area inside another.
function shareInside(inner: Box, outer: Box): number {
  const w = Math.max(0, Math.min(inner.x2, outer.x2) - Math.max(inner.x1, outer.x1));
  const h = Math.max(0, Math.min(inner.y2, outer.y2) - Math.max(inner.y1, outer.y1));
  const area = (inner.x2 - inner.x1) * (inner.y2 - inner.y1);
  return area > 0 ? (w * h) / area : 0;
}

const area = (b: Box) => Math.max(0, b.x2 - b.x1) * Math.max(0, b.y2 - b.y1);
const grow = (b: Box, by: number): Box => ({ x1: b.x1 - by, y1: b.y1 - by, x2: b.x2 + by, y2: b.y2 + by });

export function pageGraphics(drawing: PageDrawing, items: Item[], pageWidth: number, pageHeight: number): Graphic[] {
  const pageArea = pageWidth * pageHeight;
  const onPage = (b: Box): Box => ({
    x1: Math.max(0, b.x1),
    y1: Math.max(0, b.y1),
    x2: Math.min(pageWidth, b.x2),
    y2: Math.min(pageHeight, b.y2),
  });
  const runs = textRuns(items);
  // The page's text size: the size most of its characters are set in, away
  // from the running heads and feet (a slide deck's footline in 6 pt made a
  // diagram's 8 pt names read as large). Text set well above it (a title, a
  // big number) is the page's own.
  const body = runs.filter((r) => r.box.y1 > pageHeight * 0.07 && r.box.y2 < pageHeight * 0.93);
  const bySize = (body.length > 0 ? body : runs).flatMap((r) => r.items.map((i) => ({ size: i.size, n: i.str.trim().length })));
  bySize.sort((a, b) => a.size - b.size);
  const half = bySize.reduce((n, x) => n + x.n, 0) / 2;
  let seen = 0;
  let textSize = 10;
  for (const x of bySize) {
    seen += x.n;
    if (seen >= half) {
      textSize = x.size;
      break;
    }
  }
  // Page text: a run set large, or a line's worth of words. A label is short:
  // a tick, a name in a diagram, a legend entry.
  // Words filled in white over a picture show only on it: they are its
  // label, never the page's text (parse loop finding: a PowerPoint deck
  // sets "Iris Versicolor" in white 24 pt bold over its photo; read as the
  // page's text, it made the photo a background and the label a heading).
  const white = (r: TextRun) => r.items.every((i) => i.glyphs !== undefined && i.glyphs.length > 0 && i.glyphs.every((g) => g.color !== undefined && WHITE_RE.test(g.color)));
  const onPicture = (r: TextRun) => drawing.images.some((img) => shareInside(r.box, img) >= 0.7);
  const isPageText = (r: TextRun) => (r.size >= textSize * 1.3 || r.chars >= 40) && !(white(r) && onPicture(r));
  const runsIn = (box: Box) => runs.filter((r) => shareInside(r.box, box) >= 0.7);
  const textOf = (r: TextRun) => r.items.map((i) => i.str).join(" ");
  // A number alone on its line at the page's head or foot is the page's
  // number, never a label of a picture under it (a slide's number over its
  // photo, AGU slides p. 6, drew in the crop). A drawn chart's tick there
  // is its own (arXiv 2502.02648 p4).
  const isPageNumber = (r: TextRun) =>
    /^\d{1,4}$/.test(textOf(r).trim()) &&
    (r.box.y1 < pageHeight * 0.07 || r.box.y2 > pageHeight * 0.93) &&
    !runs.some((o) => o !== r && Math.abs(o.box.y1 - r.box.y1) < r.size * 0.5 && /\d/.test(textOf(o)));
  // A box that holds the page's text (a panel behind a quotation, a banner
  // behind a paragraph): a background, never a graphic.
  const holdsText = (box: Box) => {
    const inside = runsIn(box);
    return inside.some(isPageText) || inside.filter((r) => r.chars >= 20).length >= 3;
  };

  type Part = { box: Box; image: boolean; thin: boolean };
  const parts: Part[] = [];
  // The boxes that hold the page's text: backgrounds, or a chart's panel
  // (below).
  const frames: Box[] = [];
  // A picture the size of the page is a scan or a background; one that
  // leaves the page a margin or a title is the page's own (AGU slides p. 15:
  // a screenshot under the slide's title, 87% of the slide).
  for (const raw of drawing.images) {
    const box = onPage(raw);
    if (area(box) < pageArea * 0.0005 || area(box) > pageArea * 0.97) continue;
    if (holdsText(box)) continue;
    parts.push({ box, image: true, thin: false });
  }
  for (const raw of drawing.paths) {
    if (raw.clip) continue;
    const box = onPage(raw);
    if (box.x2 < box.x1 || box.y2 < box.y1) continue;
    // A rule is thin and long. A dot is a shape: a chart's markers are
    // hundreds of them, and so are a table's letters drawn as outlines
    // (arXiv 2502.02648: four charts read as rules; Grinstead–Snell p8: a
    // chart's ticks became a code block; IEEE Access 3721067: four tables
    // showed nothing at all).
    const thin = Math.min(box.x2 - box.x1, box.y2 - box.y1) < 1.5 && Math.max(box.x2 - box.x1, box.y2 - box.y1) >= 1.5;
    if (!thin && box.x2 - box.x1 > textSize * 2 && box.y2 - box.y1 > textSize * 2 && holdsText(box)) {
      frames.push(box);
      continue;
    }
    parts.push({ box, image: false, thin });
  }

  // Clusters: parts within 6 pt of each other. Two such parts, each grown
  // by 3 pt, meet in a cell of a 12 pt grid, so only a cell's parts are
  // paired. A cell crowded past 200 parts is one drawing. Paired along x
  // alone, a mesh plot's 108,035 paths took 46 s on one page (a NASA
  // report, NASA-TM-20230014463 p25).
  const parent = parts.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  const cells = new Map<number, number[]>();
  parts.forEach(({ box }, i) => {
    for (let cx = Math.floor((box.x1 - 3) / 12); cx <= Math.floor((box.x2 + 3) / 12); cx++) {
      for (let cy = Math.floor((box.y1 - 3) / 12); cy <= Math.floor((box.y2 + 3) / 12); cy++) {
        const key = (cx + 1) * 8192 + cy + 1;
        const cell = cells.get(key);
        if (cell) cell.push(i);
        else cells.set(key, [i]);
      }
    }
  });
  // A rule beside a picture, its end near the picture's edge, is the
  // page's (a slide's line under its title, ending 3 pt short of the
  // picture beside it, joined the picture, and the bullets under the line
  // read as the picture's labels: a PowerPoint deck's p. 9 lost its
  // bullets). A rule pairs with a picture when half of it lies over the
  // picture.
  const apart = (p: Part, q: Part) => {
    const [rule, picture] = p.thin && q.image ? [p.box, q.box] : q.thin && p.image ? [q.box, p.box] : [null, null];
    if (!rule || !picture) return false;
    const across = rule.x2 - rule.x1 >= rule.y2 - rule.y1;
    const [a1, a2, b1, b2] = across ? [rule.x1, rule.x2, picture.x1, picture.x2] : [rule.y1, rule.y2, picture.y1, picture.y2];
    const at = across ? (rule.y1 + rule.y2) / 2 : (rule.x1 + rule.x2) / 2;
    const within = across ? at >= picture.y1 && at <= picture.y2 : at >= picture.x1 && at <= picture.x2;
    const over = within ? Math.max(0, Math.min(a2, b2) - Math.max(a1, b1)) : 0;
    return over < (a2 - a1) * 0.5;
  };
  for (const cell of cells.values()) {
    for (let a = 0; a < cell.length; a++) {
      const p = parts[cell[a]].box;
      for (let b = a + 1; b < cell.length; b++) {
        const q = parts[cell[b]].box;
        if (cell.length > 200 || (q.x1 <= p.x2 + 6 && p.x1 <= q.x2 + 6 && q.y1 <= p.y2 + 6 && p.y1 <= q.y2 + 6 && !apart(parts[cell[a]], parts[cell[b]]))) {
          parent[find(cell[a])] = find(cell[b]);
        }
      }
      if (cell.length > 200) break;
    }
  }
  const clusters = new Map<number, Part[]>();
  parts.forEach((part, i) => {
    const root = find(i);
    const list = clusters.get(root);
    if (list) list.push(part);
    else clusters.set(root, [part]);
  });

  // A float's label line ("TABLE 3.", "Figure 2") just over or under a box.
  const nearLabel = (box: Box) =>
    runs.some(
      (r) =>
        r.box.x1 < box.x2 &&
        r.box.x2 > box.x1 &&
        Math.max(r.box.y1 - box.y2, box.y1 - r.box.y2) <= textSize * 3 &&
        LABEL_START_RE.test(textOf(r)),
    );
  // A table or a figure whose words are outlines is shapes in rows, and the
  // gaps between its rows and cells cut it into clusters (IEEE Access
  // 3721067: Tables 2, 3, and 5 showed only their captions, Table 1 its top
  // rows). Clusters of words drawn as shapes (no taller than a line, most
  // of them) with no text over them, stacked less than a line apart with no
  // text between, are one drawing when a float's label stands just over or
  // under them. A slide's bars stay apart (AGU slides p. 39: the bars and
  // the words between them read as one figure).
  const groups = [...clusters.values()];
  const boxOf = (members: Part[]) => members.map((m) => m.box).reduce((a, b) => unionBox(a, b));
  const meetsText = (b: Box) => runs.some((r) => r.box.x1 < b.x2 && r.box.x2 > b.x1 && r.box.y1 < b.y2 && r.box.y2 > b.y1);
  const lettered = (g: Part[]) => {
    const shapes = g.filter((m) => !m.image && !m.thin);
    return shapes.length > 0 && shapes.filter((m) => m.box.y2 - m.box.y1 <= textSize * 1.5).length >= shapes.length * 0.8;
  };
  const bare = groups.filter((g) => g.every((m) => !m.image) && lettered(g) && !meetsText(boxOf(g)));
  if (bare.length > 1 && bare.length <= 2000) {
    const boxes = bare.map(boxOf);
    const up = bare.map((_, i) => i);
    const top = (i: number): number => {
      while (up[i] !== i) i = up[i] = up[up[i]];
      return i;
    };
    for (let a = 0; a < boxes.length; a++) {
      for (let b = a + 1; b < boxes.length; b++) {
        const [p, q] = [boxes[a], boxes[b]];
        const x1 = Math.max(p.x1, q.x1);
        const x2 = Math.min(p.x2, q.x2);
        if (x2 <= x1 || Math.max(p.y1 - q.y2, q.y1 - p.y2) > textSize) continue;
        const gap = { x1, x2, y1: Math.min(p.y2, q.y2), y2: Math.max(p.y1, q.y1) };
        if (gap.y2 > gap.y1 && meetsText(gap)) continue;
        up[top(a)] = top(b);
      }
    }
    const sets = new Map<number, Part[][]>();
    bare.forEach((g, i) => sets.set(top(i), [...(sets.get(top(i)) ?? []), g]));
    const alone = new Set(bare);
    const joined = [...sets.values()].flatMap((set) => (set.length > 1 && nearLabel(boxOf(set.flat())) ? [set.flat()] : set));
    groups.splice(0, groups.length, ...groups.filter((g) => !alone.has(g)), ...joined);
  }

  // Inside a vector drawing, its own words (a chart's title, a legend) are
  // set large or run long as often as a slide's; only a line of body text
  // is the page's (arXiv 2609.29669 p9: a chart's 40-character title kept
  // the chart from being a figure, and its caption lost its figure).
  const isBodyLine = (r: TextRun) => r.chars >= 60;
  // The right edge of the page's text column: where its rightmost line
  // of page text ends, when four lines or more end within an em and a
  // half of it (a column set ragged right ends most lines a word short
  // of the edge). null on any other page.
  const textEdge = (() => {
    const ends = runs.filter(isPageText).map((r) => r.box.x2);
    const edge = Math.max(...ends);
    return ends.filter((e) => edge - e <= textSize * 1.5).length >= 4 ? edge : null;
  })();
  // A chart's ticks: three numbers or more in a row, or right-aligned in a
  // column, on the box or within a line of it.
  const ticked = (box: Box) => {
    const numbers = runs.filter((r) => shareInside(r.box, grow(box, textSize)) >= 0.7 && /^[-−–+]?\d[\d.,]*%?$/.test(textOf(r).trim()));
    const lined = (at: (r: TextRun) => number, by: number) => numbers.some((a) => numbers.filter((b) => Math.abs(at(a) - at(b)) <= by).length >= 3);
    return lined((r) => r.box.y1, 1) || lined((r) => r.box.x2, 2);
  };
  // caption: the lines in a picture grid's empty corner (picturesOf).
  // panel: a box around a chart and its words (below), whose words are all its own.
  type Found = { box: Box; drawn: boolean; pictures: Box[]; caption?: TextRun[]; panel?: boolean };
  const found: Found[] = [];
  // A caption set apart from the text: smaller than it, or italic.
  const setApart = (r: TextRun) => r.size < textSize * 0.95 || r.italic >= r.chars * 0.6;
  const touch = (a: Box, b: Box) => b.x1 <= a.x2 + 6 && a.x1 <= b.x2 + 6 && b.y1 <= a.y2 + 6 && a.y1 <= b.y2 + 6;
  const figureSized = (b: Box) => b.x2 - b.x1 >= pageWidth * 0.12 && b.y2 - b.y1 >= pageHeight * 0.04;
  // The pictures of a cluster whose box takes in the page's text, one by one:
  // a line over no picture is not over the picture. A slide's title bar
  // joined its screenshot, and the title made the screenshot a background
  // (AGU slides pp. 12, 15, 18, 19); a slide's bullets stood in the box of
  // the photos around them (NASA pptx pp. 1–3). Pictures that touch are one
  // figure while their box takes in no page text. Lines in the grid's empty
  // corner, over none of its pictures and set apart from the text, are its
  // caption (Earth Observer p13: a collage of three photos and the caption
  // in the fourth corner). Any other group falls apart into the pieces
  // whose boxes take in no page text, the largest pictures first. A picture
  // under the page's text is its background: a line of it lies over the
  // picture, or words cover a quarter of it (a cover slide's glow behind
  // each line of its authors).
  const covered = (r: TextRun, pictures: Box[]) => pictures.reduce((n, p) => n + shareInside(r.box, p), 0);
  const underText = (p: Box) =>
    runs.some((r) => isPageText(r) && shareInside(r.box, p) >= 0.3) ||
    runs.reduce((n, r) => n + shareInside(r.box, p) * area(r.box), 0) >= area(p) * 0.25;
  // The first picture of the list, the ones that touch it, and the ones that
  // touch those, while ok says so, taken from the list.
  const gather = (list: Box[], ok: (at: Box, b: Box) => boolean): Box[] => {
    const piece = [list.shift()!];
    let at = piece[0];
    for (let grew = true; grew; ) {
      grew = false;
      for (let k = 0; k < list.length; k++) {
        if (!piece.some((p) => touch(p, list[k])) || !ok(at, list[k])) continue;
        at = unionBox(at, list[k]);
        piece.push(...list.splice(k, 1));
        k--;
        grew = true;
      }
    }
    return piece;
  };
  const picturesOf = (images: Box[]): Found[] => {
    const out: Found[] = [];
    const left = images.filter((p) => !underText(p)).sort((a, b) => area(b) - area(a));
    while (left.length > 0) {
      const group = gather(left, () => true);
      const box = group.reduce((a, b) => unionBox(a, b));
      const text = runsIn(box).filter(isPageText);
      const hole = runsIn(box).filter((r) => covered(r, group) < 0.3);
      const caption = text.every((r) => hole.includes(r)) && hole.every(setApart) && hole.length <= 15 && hole.reduce((n, r) => n + r.chars, 0) <= 800;
      if (text.length === 0 || caption) {
        if (figureSized(box)) out.push({ box, drawn: false, pictures: group, caption: text.length > 0 ? hole : undefined });
        continue;
      }
      const rest = [...group].sort((a, b) => area(b) - area(a));
      while (rest.length > 0) {
        const piece = gather(rest, (at, b) => !runsIn(unionBox(at, b)).some(isPageText));
        const at = piece.reduce((a, b) => unionBox(a, b));
        if (figureSized(at)) out.push({ box: at, drawn: false, pictures: piece });
      }
    }
    return out;
  };
  for (const members of groups) {
    const box = boxOf(members);
    const w = box.x2 - box.x1;
    const h = box.y2 - box.y1;
    const images = members.filter((m) => m.image);
    const paths = members.filter((m) => !m.image);
    const inside = runsIn(box);
    // An image of a figure's size (icons and bullet glyphs are too small).
    const image = images.length > 0 && figureSized(box) && images.reduce((n, m) => n + area(m.box), 0) >= area(box) * 0.25;
    // A vector drawing: ten or more painted paths, most of them shapes
    // rather than rules, with little text among them, over 3% of the page
    // or across half its width and two lines tall (a textbook's banner, its
    // title drawn as outlines: OpenStax's "Collaborative Exercise"). A ruled
    // table or a framed listing is rules around dense text. A chart drawn
    // in rules (a line chart's grid and axes) is a drawing when numbers in
    // a row or a column along it are its ticks (ACM DaMoN p5: Figure 3's
    // two line charts read as their ticks and their legends' words). A
    // drawing with no text over it at all, ten shapes or more, just under or
    // over a float's label, is that float's whatever its size (IEEE Access
    // 3721067: Table 5, its words outlines between double rules).
    const ink = inside.reduce((n, r) => n + r.items.reduce((m, i) => m + i.w * i.size, 0), 0);
    const shapes = paths.filter((m) => !m.thin).length;
    const sized = area(box) >= pageArea * 0.03 || (w >= pageWidth * 0.5 && h >= textSize * 2);
    // A drawing of a few shapes (a region, two circles, a box: five or
    // more, nearly all of its paths), over 3% of the page, with no line of
    // the page's text and next to no ink inside it, is a drawing too
    // (parse loop finding: GeoTopo p. 17's uncaptioned picture of a
    // compact set, eight shapes, was no figure: its labels read as an
    // equation and two crops).
    const sparse = shapes >= 5 && shapes >= paths.length * 0.8 && sized && ink < area(box) * 0.05 && !inside.some(isPageText);
    // A drawing in the margin beside the text column: three paths or
    // more, a shape among them, a figure's width and a line tall at the
    // least, its box an em or more past the column's right edge, with no
    // page text inside it (parse loop finding: a Tufte textbook's margin
    // figures, an axis and a potential step in six paths, were no figure;
    // their labels read as a table's cells beside the paragraph and as
    // math crops).
    const margin =
      textEdge !== null &&
      paths.length >= 3 &&
      shapes >= 1 &&
      box.x1 >= textEdge + textSize &&
      w >= pageWidth * 0.12 &&
      h >= textSize &&
      ink < area(box) * 0.12 &&
      !inside.some(isPageText);
    const drawn =
      (paths.length >= 10 && (shapes > paths.length * 0.5 || (shapes >= 2 && ticked(box))) && sized && ink < area(box) * 0.12) ||
      sparse ||
      margin ||
      (shapes >= 10 && images.length === 0 && !meetsText(box) && nearLabel(box));
    if (image && !inside.some(isPageText)) found.push({ box, drawn: false, pictures: images.map((m) => m.box) });
    else if (image) found.push(...picturesOf(images.map((m) => m.box)));
    else if (drawn && !inside.some(isBodyLine)) found.push({ box, drawn: true, pictures: [] });
  }

  // Captions: the short lines right under a graphic, inside its width, set
  // apart from the text (smaller, italic, or centered under it) — a photo
  // grid's names, a newsletter's caption, a panel's "(a) …". A line that
  // opens with a float's label, with a stop or none ("Figure 2:", "Figure 2
  // Mapped …", "Table 1"), is the captioned figures' own (attachFigureRegions)
  // or a table's. Inside its width: within an em of its edges, or 60% of the
  // line under it — a circuit's caption starts under its wire labels, left of
  // its drawing (arXiv 2506.06752 p4).
  const taken = new Set<TextRun>();
  const within = (r: TextRun, graphic: Box) =>
    (r.box.x1 >= graphic.x1 - r.size && r.box.x2 <= graphic.x2 + r.size) ||
    Math.min(r.box.x2, graphic.x2) - Math.max(r.box.x1, graphic.x1) >= (r.box.x2 - r.box.x1) * 0.6;
  const captionOf = (graphic: Box): TextRun[] => {
    const under = runs
      .filter((r) => !taken.has(r) && within(r, graphic) && r.box.y2 <= graphic.y1 + r.size * 0.5)
      .sort((a, b) => b.box.y2 - a.box.y2);
    const out: TextRun[] = [];
    let bottom = graphic.y1;
    // A step's number, set larger, beside the first line under the graphic:
    // the lines are the step's text, no caption (parse loop finding: The
    // MagPi's step boxes set "01" beside "If you want to make your own
    // pinball machine," under the step's photo, and the line read as the
    // photo's caption, the step's other lines as an item of their own).
    // The number may stand on the first line's baseline or on the second's.
    const besideNumber = (first: TextRun, r: TextRun) =>
      r.items.some(
        (i) => i.size >= textSize * 1.3 && /^\d{1,2}$/.test(i.str.trim()) && i.x + i.w <= first.box.x1 + i.size * 0.5 && i.y + i.size * 0.7 > first.box.y1 && i.y < first.box.y2,
      );
    for (const r of under) {
      if (out.length > 0 && besideNumber(out[0], r)) return [];
      if (bottom - r.box.y2 > r.size * (out.length === 0 ? 1.2 : 0.8)) break;
      if (out.length >= 3 || r.size >= textSize * 1.3 || LABEL_START_RE.test(textOf(r))) break;
      out.push(r);
      bottom = r.box.y1;
    }
    const chars = out.reduce((n, r) => n + r.chars, 0);
    if (out.length === 0 || chars > 200) return [];
    // A caption is words: a row of numbers under a chart is its axis.
    const letters = out.reduce((n, r) => n + r.items.reduce((m, i) => m + (i.str.match(/\p{L}/gu)?.length ?? 0), 0), 0);
    if (letters < 4 || letters < chars * 0.5) return [];
    const size = Math.max(...out.map((r) => r.size));
    const italic = out.reduce((n, r) => n + r.italic, 0) >= chars * 0.6;
    // Centered: each line as far in from both edges, give or take a fifth
    // of the two, and one line clearly narrower than the graphic (a
    // justified paragraph fills it). A body line under a graphic flush with
    // the column starts where the graphic does and ends short of it: it is
    // no caption (a line under two pictures, set as the text around it,
    // read as their caption).
    const margins = out.map((r) => [r.box.x1 - graphic.x1, graphic.x2 - r.box.x2, r.size]);
    const centered =
      margins.every(([l, r, sz]) => l >= -sz * 0.5 && r >= -sz * 0.5 && Math.abs(l - r) <= Math.max(sz * 2, (l + r) * 0.2)) &&
      margins.some(([l, r, sz]) => l + r >= sz);
    return size < textSize * 0.95 || italic || centered ? out : [];
  };

  // Graphics on one row (a left and a right chart) are one figure, unless
  // each has a caption of its own, text runs between them, or the two
  // together would take in the page's text that neither holds (arXiv
  // 2411.19946 p13: a picture grid in one column and two charts in the
  // other took the charts' caption, a heading, and every superscript of
  // the column under the charts for the figure's labels). A float's label
  // line under each, inside its width, is a caption of its own (Elsevier
  // pp. 13–14: two charts side by side, "Fig. 12." under one and "Fig. 13."
  // under the other, drew as one crop, and the second chart twice).
  const ownLabel = (b: Box) =>
    runs.some((r) => {
      const cx = (r.box.x1 + r.box.x2) / 2;
      const gap = Math.max(r.box.y1 - b.y2, b.y1 - r.box.y2);
      return cx > b.x1 && cx < b.x2 && gap >= -textSize && gap <= textSize * 2.5 && LABEL_START_RE.test(textOf(r));
    });
  // A panel: a box around a chart and its words (its title, its labels),
  // none of them a line of the text, is one figure (AGU slides p16: a
  // dashboard's pies' labels read as tables, its bar and line charts' words
  // as paragraphs). The chart is a graphic found inside it, or one drawn in
  // a few paths with its ticks. Words with two lowercase words in a line
  // are the text's (AGU slides p23: "Members have the / option to join
  // more" beside a bar chart in its box).
  const prose = (r: TextRun) => textOf(r).split(/\s+/).filter((w) => /^\p{Ll}+[,.;:]?$/u.test(w)).length >= 2;
  for (const frame of frames) {
    const words = runsIn(frame);
    if (area(frame) > pageArea * 0.5 || words.some((r) => r.chars >= 40 || prose(r)) || words.filter((r) => r.chars >= 20).length >= 3) continue;
    const held = found.filter((f) => shareInside(f.box, frame) >= 0.7);
    const shapes = parts.filter((m) => !m.image && !m.thin && shareInside(m.box, frame) >= 0.9).length;
    if (held.length === 0 && !(shapes >= 3 && ticked(frame))) continue;
    found.splice(0, found.length, ...found.filter((f) => !held.includes(f)), { box: frame, drawn: true, pictures: held.flatMap((f) => f.pictures), panel: true });
  }
  found.sort((a, b) => b.box.y2 - a.box.y2 || a.box.x1 - b.box.x1);
  const merged: Found[] = [];
  for (const { box, drawn, pictures, caption, panel } of found) {
    // The nearest of them (NASA pptx p2: a photo between a picture and a
    // group of pictures joined the picture across the gap, not the group it
    // stands in).
    const gapTo = (m: Box) => Math.max(box.x1 - m.x2, m.x1 - box.x2);
    const near = merged
      .filter(({ box: m, caption: own, panel: framed }) => {
        if (caption || own || panel || framed) return false;
        const overlap = Math.min(m.y2, box.y2) - Math.max(m.y1, box.y1);
        const shorter = Math.min(m.y2 - m.y1, box.y2 - box.y1);
        if (!(overlap > shorter * 0.5 && gapTo(m) < pageWidth * 0.08)) return false;
        const between = { x1: Math.min(m.x2, box.x2), x2: Math.max(m.x1, box.x1), y1: Math.max(m.y1, box.y1), y2: Math.min(m.y2, box.y2) };
        if (between.x2 > between.x1 && runs.some((r) => shareInside(r.box, between) >= 0.5)) return false;
        const union = unionBox(m, box);
        const outside = (r: TextRun) => shareInside(r.box, m) < 0.7 && shareInside(r.box, box) < 0.7;
        if (runs.some((r) => isPageText(r) && shareInside(r.box, union) >= 0.7 && outside(r))) return false;
        return (captionOf(m).length === 0 || captionOf(box).length === 0) && !(ownLabel(m) && ownLabel(box));
      })
      .sort((a, b) => gapTo(a.box) - gapTo(b.box))[0];
    if (near) {
      near.box = unionBox(near.box, box);
      near.drawn = near.drawn && drawn;
      near.pictures = [...near.pictures, ...pictures];
    } else merged.push({ box: { ...box }, drawn, pictures, caption, panel });
  }

  // A chart's axis labels sit just outside its plot: the ticks under it and
  // beside it, a short word or number each, the first and the last centered
  // on the axis's ends, no farther off than a line and a half (arXiv
  // 2609.29669 p7: a bar chart's years read as its caption and as a
  // paragraph; Grinstead–Snell p8: the last tick, "10000", stayed text and
  // cut Figure 1.5's crop; R sets its ticks a line and a half under the
  // axis, and a statistics book's "−2 −1 0 1 2" stayed text).
  const axisOf = (plot: Box): TextRun[] =>
    runs.filter((r) => {
      if (taken.has(r) || r.chars > 12 || shareInside(r.box, plot) >= 0.7 || LABEL_START_RE.test(textOf(r))) return false;
      if (/[.!?;:,]$/.test(r.items.map((i) => i.str).join("").trim())) return false;
      const reach = Math.max(r.size, textSize) * 1.7;
      const cx = (r.box.x1 + r.box.x2) / 2;
      const cy = (r.box.y1 + r.box.y2) / 2;
      const across = cx > plot.x1 - r.size && cx < plot.x2 + r.size;
      const along = cy > plot.y1 && cy < plot.y2;
      return (
        (across && r.box.y2 <= plot.y1 + r.size && r.box.y2 >= plot.y1 - reach) ||
        (across && r.box.y1 >= plot.y2 - r.size && r.box.y1 <= plot.y2 + reach) ||
        (along && r.box.x2 <= plot.x1 + r.size && r.box.x2 >= plot.x1 - reach) ||
        (along && r.box.x1 >= plot.x2 - r.size && r.box.x1 <= plot.x2 + reach)
      );
    });
  // A chart's title over its plot and its axis titles under it: a run
  // centered on the plot (its middle within an em of the plot's), inside
  // its width, set in the face of the plot's ticks, a face no line of the
  // page's text is set in, within three lines of the plot or of its ticks,
  // and short of a sentence (parse loop finding: a statistics book's R
  // plots: "Histogram of residuals(cars.lm)" over a chart and
  // "residuals(cars.lm)" under its ticks read as headings, and each
  // caption stood apart from its figure, with the chart's words between).
  // A run's face: the face most of its characters are set in (a body
  // line that opens with a formula's glyph is the body's face).
  const faceOf = (r: TextRun): string | undefined => {
    const chars = new Map<string, number>();
    for (const i of r.items) if (i.look) chars.set(i.look.face, (chars.get(i.look.face) ?? 0) + i.str.trim().length);
    return [...chars].sort((a, b) => b[1] - a[1])[0]?.[0];
  };
  // The body's faces: a face two long lines or more are set in. One long
  // line alone is no body: a chart's title can run past 40 characters
  // (parse loop finding: a statistics book's "95% confidence and
  // prediction intervals for cars.lm" over its plot made its own face the
  // body's, and read as a heading).
  const faceLines = new Map<string, number>();
  for (const r of runs) {
    const face = faceOf(r);
    if (face !== undefined && r.chars >= 40 && !r.items.every((i) => i.mono)) faceLines.set(face, (faceLines.get(face) ?? 0) + 1);
  }
  const bodyFaces = new Set([...faceLines].filter(([, n]) => n >= 2).map(([face]) => face));
  const titlesOf = (plot: Box, axis: TextRun[]): TextRun[] => {
    const faces = new Set([...axis, ...runsIn(plot).filter((r) => !isPageText(r))].map(faceOf));
    const mid = (plot.x1 + plot.x2) / 2;
    // A chart's title is centered on its plot, or on the chart's whole
    // device: the plot, its axis labels, its sideways axis title (a glyph
    // drawn with no advance along the page, level with the plot, within
    // four lines of its edge), and the shape level with it (its legend,
    // drawn in a frame of its own beside the plot). R centers a title on
    // the device, not the plot (parse loop finding: a statistics book's
    // title over a plot with its legend read as a heading, its middle off
    // the plot's by four ems).
    const sideways = drawing.glyphs
      .filter((g) => !g.hidden && g.w === 0 && /\p{L}/u.test(g.unicode) && g.y > plot.y1 && g.y < plot.y2 && g.x > plot.x1 - textSize * 4 && g.x < plot.x2 + textSize * 4)
      .map((g): Box => ({ x1: g.x - g.size * 0.85, y1: g.y, x2: g.x + g.size * 0.3, y2: g.y }));
    const row = parts
      .filter(({ box: m, thin }) => !thin && m.x2 - m.x1 >= textSize && m.y2 - m.y1 >= textSize && shareInside(m, plot) < 0.5)
      .map(({ box: m }) => m)
      .filter((m) => Math.min(m.y2, plot.y2) - Math.max(m.y1, plot.y1) > Math.min(m.y2 - m.y1, plot.y2 - plot.y1) * 0.5 && Math.max(m.x1 - plot.x2, plot.x1 - m.x2) < pageWidth * 0.1);
    const wide = [...axis.map((r) => r.box), ...sideways, ...row].reduce((b, m) => unionBox(b, m), plot);
    const wideMid = (wide.x1 + wide.x2) / 2;
    const under = Math.min(plot.y1, ...axis.filter((r) => r.box.y2 <= plot.y1 + r.size).map((r) => r.box.y1));
    const over = Math.max(plot.y2, ...axis.filter((r) => r.box.y1 >= plot.y2 - r.size).map((r) => r.box.y2));
    return runs.filter((r) => {
      if (taken.has(r) || axis.includes(r) || r.chars > 60 || LABEL_START_RE.test(textOf(r))) return false;
      const face = faceOf(r);
      if (face === undefined || !faces.has(face) || bodyFaces.has(face)) return false;
      if (/[.!?;:,]$/.test(textOf(r).trim())) return false;
      const reach = Math.max(r.size, textSize) * 3;
      const cx = (r.box.x1 + r.box.x2) / 2;
      const centered = (Math.abs(cx - mid) <= r.size && r.box.x1 >= plot.x1 - r.size && r.box.x2 <= plot.x2 + r.size) || (Math.abs(cx - wideMid) <= r.size && r.box.x1 >= wide.x1 - r.size && r.box.x2 <= wide.x2 + r.size);
      if (!centered) return false;
      return (r.box.y2 <= under + r.size * 0.5 && r.box.y2 >= under - reach) || (r.box.y1 >= over - r.size * 0.5 && r.box.y1 <= over + reach);
    });
  };

  return merged.map(({ box: plot, drawn, pictures, caption: corner, panel }) => {
    // A caption set on a bar across the drawing, or started across its
    // edge, is the figure's caption: never its labels, its ticks, or its own
    // caption, and the crop stops at it (a Japanese white paper's "図表
    // Ⅰ-2-1-1 避難所データ…" bar over a picture was in no block; Nature's
    // "Fig. 1 | Example spectra. …", its first line across the chart's foot,
    // lost its next three lines to the chart and its superscripts to the
    // ticks). A caption's row: the runs beside its label, scripts included.
    const heads = runs.filter((r) => shareInside(r.box, grow(plot, textSize * 1.5)) > 0 && LABEL_START_RE.test(textOf(r)));
    const bars = heads.map((h) => {
      const row = runs.filter((r) => r.box.x1 >= h.box.x1 - 1 && (r.box.y1 + r.box.y2) / 2 >= h.box.y1 && (r.box.y1 + r.box.y2) / 2 <= h.box.y2);
      return { row, box: row.reduce((b, r) => unionBox(b, r.box), h.box) };
    });
    const onBar = (r: TextRun) => bars.some((bar) => bar.row.includes(r));
    // A panel takes its axis labels and titles too: R's lattice and grid
    // graphics frame the plot and set its ticks and axis titles outside the
    // frame (parse loop finding: a statistics book's quantile-quantile plot
    // left its ticks "−2 −1 0 1 2" out of the crop, read its axis title "t
    // Quantiles" as a heading, and its caption, under the heading, stood
    // apart as a paragraph).
    const axis = drawn ? axisOf(plot).filter((r) => !onBar(r)) : [];
    const titles = drawn ? titlesOf(plot, axis).filter((r) => !onBar(r)) : [];
    for (const r of [...axis, ...titles]) taken.add(r);
    let box = [...axis, ...titles].reduce((b, r) => unionBox(b, r.box), plot);
    // Arrows drawn by the drawing's labels are the drawing's, and so are
    // the short labels by those arrows: an arrow is a line with a small
    // head at one end, a cluster of its own a line or two off the drawing,
    // touched by a label the drawing holds (parse loop finding: a quantum
    // mechanics book's margin figure of a potential step set its currents
    // J_inc, J_trans, and J_ref by arrows 28 pt under its axis; the crop
    // stopped at J_inc, cut the arrows, and J_ref read as a paragraph).
    if (drawn) {
      const arrows = groups
        .filter((g) => {
          if (g.length > 4 || g.some((m) => m.image)) return false;
          const b = boxOf(g);
          if (b.y2 - b.y1 > textSize || shareInside(b, box) >= 0.5 || merged.some((m) => m.box !== plot && shareInside(b, m.box) >= 0.5)) return false;
          const line = g.find((m) => m.thin && m.box.x2 - m.box.x1 >= textSize * 1.5);
          return (
            line !== undefined &&
            g.some(
              (m) =>
                !m.thin &&
                m.box.x2 - m.box.x1 <= textSize * 0.6 &&
                m.box.y2 - m.box.y1 <= textSize * 0.6 &&
                (Math.abs(m.box.x1 - line.box.x1) < textSize * 0.3 || Math.abs(m.box.x2 - line.box.x2) < textSize * 0.3),
            )
          );
        })
        .map(boxOf);
      const by = (r: Box, m: Box) => r.x1 < m.x2 && r.x2 > m.x1 && Math.max(r.y1 - m.y2, m.y1 - r.y2) <= textSize * 0.5;
      const words = [...axis, ...titles, ...runsIn(box).filter((r) => !isPageText(r) && !taken.has(r))];
      const held = new Set<Box>();
      for (let grew = arrows.length > 0; grew; ) {
        grew = false;
        for (const m of arrows) {
          if (held.has(m) || !words.some((r) => by(r.box, m))) continue;
          held.add(m);
          box = unionBox(box, m);
          grew = true;
        }
        for (const r of runs) {
          if (held.size === 0 || taken.has(r) || words.includes(r) || isPageText(r) || r.chars > 12 || LABEL_START_RE.test(textOf(r))) continue;
          if (![...held].some((m) => by(r.box, m))) continue;
          words.push(r);
          box = unionBox(box, r.box);
          grew = true;
        }
      }
    }
    for (const { box: bar } of bars) {
      if (bar.x1 >= box.x2 || bar.x2 <= box.x1 || bar.y1 >= box.y2 || bar.y2 <= box.y1) continue;
      if ((bar.y1 + bar.y2) / 2 > (box.y1 + box.y2) / 2) box = { ...box, y2: Math.min(box.y2, bar.y1) };
      else box = { ...box, y1: Math.max(box.y1, bar.y2) };
    }
    const caption = corner ?? captionOf(box);
    for (const r of caption) taken.add(r);
    const labels = [...axis, ...titles, ...runsIn(box).filter((r) => !(drawn ? isBodyLine(r) : isPageText(r) || isPageNumber(r)) && !taken.has(r) && !onBar(r))];
    // Page text that reaches over one side of the graphic (a slide's
    // quotation over the dark half of its photo) leaves that side out of
    // the crop, when at least half the graphic is left.
    const over = runs.filter(
      (r) =>
        isPageText(r) &&
        !labels.includes(r) &&
        !taken.has(r) &&
        !isPageNumber(r) &&
        r.box.x1 < box.x2 &&
        r.box.x2 > box.x1 &&
        r.box.y1 < box.y2 &&
        r.box.y2 > box.y1,
    );
    const middle = (box.x1 + box.x2) / 2;
    const cut = { ...box };
    if (over.length > 0 && over.every((r) => (r.box.x1 + r.box.x2) / 2 < middle)) cut.x1 = Math.max(...over.map((r) => r.box.x2)) + 2;
    if (over.length > 0 && over.every((r) => (r.box.x1 + r.box.x2) / 2 > middle)) cut.x2 = Math.min(...over.map((r) => r.box.x1)) - 2;
    const kept = !panel && cut.x2 - cut.x1 >= (box.x2 - box.x1) * 0.5 ? cut : box;
    return { box: kept, labels: labels.flatMap((r) => r.items), caption: caption.flatMap((r) => r.items), pictures };
  });
}

// The drawing inside a band of a column: the union of the paths and images
// whose vertical center lies in the band and that reach into the column. A
// clip paints nothing (the synthetic paper's page-wide clip made a caption's
// figure span both columns and swallow the left one), and a box reaching a
// quarter of the column past its edge is a figure's white ground, not its
// drawing (arXiv 2411.19946 p4: a left-column figure's crop took in the
// right column's words). keep: which paths and images count.
function drawingIn(drawing: Drawn, y1: number, y2: number, x1: number, x2: number, keep: (b: Box) => boolean = () => true): Box | null {
  let box: Box | null = null;
  const reach = (x2 - x1) * 0.25;
  for (const b of [...drawing.paths, ...drawing.images]) {
    const cy = (b.y1 + b.y2) / 2;
    if (("clip" in b && b.clip) || cy < y1 || cy > y2 || b.x2 < x1 || b.x1 > x2) continue;
    if (b.x1 < x1 - reach || b.x2 > x2 + reach || !keep(b)) continue;
    box = box ? unionBox(box, b) : { ...b };
  }
  return box;
}

// A clip paints nothing: Chromium clips a printed page's text to its column,
// and every short paragraph over a caption read as a legend inside the
// figure (synth-paper-html p1: "where x is the article … Fig. 1 shows the
// whole model." went into Fig. 1's crop and left the text). A drawing
// around the caption as well is a frame or the page's white ground, no
// figure over the caption (MIC white paper p2: a white box under the whole
// text took the paragraph over a caption into its figure). With `framed`,
// a drawing around the box whole is the box's own ground: a code listing
// on its shaded box is no label inside a figure (parse loop finding: the
// Japanese Pro Git p. 72, a listing over Figure 20 went into its crop).
function overlapsDrawing(box: Box, drawing: Drawn, cap: Box, framed = false): boolean {
  return [...drawing.paths, ...drawing.images].some(
    (b) =>
      !("clip" in b && b.clip) &&
      !(b.x1 <= cap.x1 && b.x2 >= cap.x2 && b.y1 <= cap.y1 && b.y2 >= cap.y2) &&
      !(framed && b.x1 <= box.x1 + 1 && b.x2 >= box.x2 - 1 && b.y1 <= box.y1 + 1 && b.y2 >= box.y2 - 1) &&
      b.x1 < box.x2 && b.x2 > box.x1 && b.y1 < box.y2 && b.y2 > box.y1 && (b.x2 - b.x1 > 2 || b.y2 - b.y1 > 2),
  );
}

// The box stands under a drawing: across its width, the nearest drawing
// over it is nearer than the nearest drawing under it. A panel's caption
// stands under its panel; a panel's title stands over it (arXiv 2609.29669
// p7: "(a) Benchmarks per year" over its bars is the figure's own words).
function underDrawing(box: Box, drawing: Drawn): boolean {
  let over = Infinity;
  let under = Infinity;
  for (const b of [...drawing.paths, ...drawing.images]) {
    if (("clip" in b && b.clip) || b.x2 <= box.x1 || b.x1 >= box.x2) continue;
    if (b.y1 >= box.y2 - 1) over = Math.min(over, b.y1 - box.y2);
    else if (b.y2 <= box.y1 + 1) under = Math.min(under, box.y1 - b.y2);
  }
  return over < under;
}

// A box a diagram is drawn in: a picture, or a shape a word fits in (1.5
// em each way), reaches into it and does not frame it whole (a box around
// a display frames it); or a line of the drawing runs on out of its foot
// within its width (a chart's axis under the crop of its top labels,
// Grinstead–Snell Fig. 5.7).
function inDiagram(box: Box, drawing: Drawn, em: number): boolean {
  const meets = (b: Box) => b.x1 < box.x2 && b.x2 > box.x1 && b.y1 < box.y2 && b.y2 > box.y1;
  const frames = (b: Box) => b.x1 <= box.x1 && b.x2 >= box.x2 && b.y1 <= box.y1 && b.y2 >= box.y2;
  const runsOut = (b: Box) => b.y1 < box.y1 - 1 && b.y2 > box.y1 + 1 && b.x1 >= box.x1 - em && b.x2 <= box.x2 + em;
  return (
    drawing.images.some((b) => meets(b) && !frames(b)) ||
    drawing.paths.some((b) => !b.clip && meets(b) && !frames(b) && ((b.x2 - b.x1 >= em * 1.5 && b.y2 - b.y1 >= em * 1.5) || runsOut(b)))
  );
}

// A chart's ticks and its title read as lines of text: most words are
// numbers.
function isTicks(text: string): boolean {
  const words = text.split(/\s+/).filter((w) => w !== "");
  return words.length >= 4 && words.filter((w) => /^[-−–+]?\d[\d.,]*%?$/.test(w)).length >= words.length * 0.6;
}

// A caption's lines as one line of text, and where they sit.
function captionPart(lines: Line[]): CaptionPart {
  const { text, runs } = joinGroup(lines, true);
  const box = lines
    .map((l) => ({ x1: l.x, x2: l.xEnd, y1: l.yMin - l.size * 0.3, y2: l.yMax + l.size * 0.85 }))
    .reduce((a, b) => unionBox(a, b));
  return { text: text.replace(/\n/g, " "), runs, box };
}

export function attachFigureRegions(
  segments: Segment[],
  lines: Line[],
  ctx: PageContext,
  pageWidth: number,
  pageHeight: number,
  graphics: Graphic[],
  page: number, // 0-based
  allLines: Line[], // the page's lines before its furniture and footnotes left
): Segment[] {
  const images = figureImages(ctx.drawing.images, pageWidth, pageHeight);
  const drawing: Drawn = { images, paths: ctx.drawing.paths };
  const toRegion = (box: Box) => regionOf(box, pageWidth, pageHeight);
  const rowGap = ctx.bodySize * ctx.leading;

  // 1. Display equations are math/display.ts's: index.ts reads them first.
  const withMath = segments;

  // 2. Captioned figures.
  const textLeft = lines.length > 0 ? Math.min(...lines.map((l) => l.x)) : 0;
  const textRight = lines.length > 0 ? Math.max(...lines.map((l) => l.xEnd)) : pageWidth;
  // The column the caption sits in: the extent of the page's lines that
  // overlap it horizontally (the whole text width on a one-column page),
  // leaving out the few that reach well past the others — a title across
  // both columns made a right-column figure swallow the left column.
  const columnOf = (cap: Box): [number, number] => {
    // The column pageLines read the caption in, when it knows it, unless a
    // line level with the caption stands beside it there: pageLines read
    // the two as a row across the page (MIC white paper p13: a caption bar
    // beside a paragraph's first line, whose crop took the line).
    const own = lines.find((l) => l.x >= cap.x1 - 1 && l.xEnd <= cap.x2 + 1 && l.y >= cap.y1 && l.y <= cap.y2);
    const read = own ? lineColumn(own) : undefined;
    const level = (l: Line) => l !== own && l.y >= cap.y1 && l.y <= cap.y2 && (l.xEnd <= cap.x1 || l.x >= cap.x2);
    if (read && !lines.some((l) => level(l) && l.x < read[1] && l.xEnd > read[0])) return read;
    const overlapping = lines.filter((l) => l.x < cap.x2 && l.xEnd > cap.x1);
    if (overlapping.length === 0) return [textLeft, textRight];
    const left = median(overlapping.map((l) => l.x)) - ctx.bodySize * 2;
    const right = median(overlapping.map((l) => l.xEnd)) + ctx.bodySize * 2;
    const column = overlapping.filter((l) => l.x >= left && l.xEnd <= right);
    const kept = column.length > 0 ? column : overlapping;
    return [Math.min(...kept.map((l) => l.x)), Math.max(...kept.map((l) => l.xEnd))];
  };
  const pageTop = pageHeight * 0.94;
  const pageBottom = pageHeight * 0.06;
  // The lines the page lost before segmentation: its furniture (running
  // heads, running feet, page numbers) and its footnotes. No figure's band
  // takes one in.
  const inText = new Set(lines);
  const dropped = allLines.filter((l) => !inText.has(l)).map((l) => ({ x1: l.x, x2: l.xEnd, y1: l.yMin - l.size * 0.3, y2: l.yMax + l.size * 0.85 }));
  // Each graphic's caption, as a line of text.
  const captions = new Map(
    graphics.map((g) => {
      const lines = buildLines(g.caption, page);
      return [g, lines.length > 0 ? { ...captionPart(lines), size: lines[0].size } : null] as const;
    }),
  );
  // A graphic with the words its crop shows: its labels, and the caption
  // under it unless that is a panel's caption or a note, which the
  // figure's caption holds (arXiv 2506.08209 p12: the note under the chart
  // was in the crop and in the caption).
  const graphicExtent = (g: Graphic): Box => {
    const caption = captions.get(g);
    const words = caption && isSubCaption(caption.text) ? g.labels : [...g.labels, ...g.caption];
    return words.reduce((b, i) => unionBox(b, { x1: i.x, x2: i.x + i.w, y1: i.y - i.size * 0.25, y2: i.y + i.size * 0.8 }), g.box);
  };
  // A box drawn close around a segment: a frame no more than three times
  // the segment's size.
  const framed = (s: Segment) =>
    s.type === "PARAGRAPH" &&
    s.box !== undefined &&
    drawing.paths.some(
      (b) =>
        !b.clip &&
        Math.min(b.x2 - b.x1, b.y2 - b.y1) >= 1.5 &&
        b.x1 <= s.box!.x1 + 1 &&
        b.x2 >= s.box!.x2 - 1 &&
        b.y1 <= s.box!.y1 + 1 &&
        b.y2 >= s.box!.y2 - 1 &&
        area(b) <= area(s.box!) * 3,
    );
  const out: Segment[] = [];
  // Segments a figure took below its caption: debris, and the caption's
  // second paragraph.
  const consumed = new Set<Segment>();
  // Each figure's panel captions and notes (Panel captions above), joined to
  // its caption once every graphic has its figure. Among the words a figure
  // takes, a panel's caption opens with its letter and stands under a
  // drawing; a note is the figure's wherever it stands (MIC white paper
  // p13: a source line stood nearer the photo under it than the one over
  // it, and the caption left it out).
  const panels = new Map<Segment, CaptionPart[]>();
  const addPanel = (figure: Segment, part: CaptionPart) => panels.set(figure, [...(panels.get(figure) ?? []), part]);
  const panelOf = (s: Segment): CaptionPart | null =>
    s.box &&
    (s.type === "PARAGRAPH" || s.type === "LIST" || s.type === "HEADING") &&
    isSubCaption(s.text) &&
    (NOTE_RE.test(s.text.trim()) || underDrawing(s.box, drawing))
      ? { text: s.text.replace(/\n/g, " "), runs: s.runs ?? [], box: s.box }
      : null;
  // A graphic's pictures in rows, from the top: pictures side by side are
  // one row, and an icon is none.
  const rowsOf = (g: Graphic): Box[] => {
    const rows: Box[] = [];
    const pictures = g.pictures.filter((p) => p.x2 - p.x1 >= pageWidth * 0.12 && p.y2 - p.y1 >= pageHeight * 0.04);
    for (const p of pictures.sort((a, b) => b.y2 - a.y2)) {
      const row = rows.find((r) => Math.min(r.y2, p.y2) - Math.max(r.y1, p.y1) > Math.min(r.y2 - r.y1, p.y2 - p.y1) * 0.5);
      if (row) Object.assign(row, unionBox(row, p));
      else rows.push({ ...p });
    }
    return rows.sort((a, b) => b.y2 - a.y2);
  };
  // The row a caption beside the pictures is level with: the one its middle
  // stands in, else the nearest.
  const rowAt = (rows: Box[], at: Box): number => {
    const middle = (at.y1 + at.y2) / 2;
    const off = rows.map((r) => Math.max(0, middle - r.y2, r.y1 - middle));
    return off.indexOf(Math.min(...off));
  };
  // The graphics with captions set beside them (sideGraphic), and each
  // one's captions. Captions beside one graphic take a row of its pictures
  // each (Earth Observer p14: three photos one over another, a caption
  // level with each).
  const sideCaptions = new Map<Graphic, Segment[]>();
  const sideGraphic = (cap: Segment, x1: number, x2: number): Graphic | undefined => {
    const at = cap.box!;
    const reach = pageHeight * 0.25;
    // A shape in the caption's column counts, a rule does not, and neither
    // does a part of a graphic that reaches into the column (Earth Observer
    // p32: a map's legend over the column's edge made a crop of the map's
    // edge for the caption beside it).
    const inGraphic = (b: Box) => graphics.some((g) => shareInside(b, grow(g.box, 1)) >= 0.9);
    if (drawingIn(drawing, at.y1 - reach, at.y2 + reach, x1, x2, (b) => Math.min(b.x2 - b.x1, b.y2 - b.y1) >= 1.5 && !inGraphic(b))) return undefined;
    const middle = (at.y1 + at.y2) / 2;
    const near = (gap: number) => gap >= -ctx.bodySize && gap <= pageWidth * 0.1;
    // A wider gap, up to a quarter of the page, with no line of the page
    // between the graphic and the caption's column at the graphic's rows:
    // a margin caption beside a figure centered in the text column (parse
    // loop finding: a Tufte textbook's "Figure 24.1:" stood 97 pt from
    // its circle, and read as a figure of its own with nothing in it).
    const clear = (g: Graphic) => {
      const [a, b] = x1 > g.box.x2 ? [g.box.x2, x1] : [x2, g.box.x1];
      return !lines.some((l) => l.y >= g.box.y1 && l.y <= g.box.y2 && l.x < b && l.xEnd > a);
    };
    return graphics.find((g) => {
      if (g.caption.length > 0) return false;
      // Beside the caption's column, level with the graphic; or, where the
      // graphic reaches into the column, beside the caption itself and its
      // middle within the graphic's height (a caption under a picture's
      // corner is under it).
      const gap = Math.max(x1 - g.box.x2, g.box.x1 - x2);
      const own = Math.max(at.x1 - g.box.x2, g.box.x1 - at.x2);
      const beside =
        ((near(gap) || (gap <= pageWidth * 0.25 && clear(g))) && middle >= g.box.y1 - rowGap && middle <= g.box.y2 + rowGap) ||
        (gap < -ctx.bodySize && near(own) && middle >= g.box.y1 && middle <= g.box.y2);
      if (!beside) return false;
      const others = sideCaptions.get(g);
      const rows = others ? rowsOf(g) : [];
      if (others && (rows.length < 2 || others.some((o) => rowAt(rows, o.box!) === rowAt(rows, at)))) return false;
      // A caption of its own stands over or under it.
      return !withMath.some(
        (s) =>
          s !== cap &&
          s.type === "PARAGRAPH" &&
          s.box !== undefined &&
          isCaption(s.text, s.runs) &&
          s.box.x1 < g.box.x2 &&
          s.box.x2 > g.box.x1 &&
          Math.max(s.box.y1 - g.box.y2, g.box.y1 - s.box.y2) < rowGap * 2,
      );
    });
  };
  // A graphic's box leaves out a line the page dropped at its edge (a
  // slide's number over the corner of a picture the height of the slide,
  // AGU slides p. 6), cut on the side that keeps the most of the box, nine
  // tenths of it at least.
  const clearOfDropped = (box: Box): Box => {
    let kept = box;
    for (const d of dropped) {
      if (d.x2 <= kept.x1 || d.x1 >= kept.x2 || d.y2 <= kept.y1 || d.y1 >= kept.y2) continue;
      const cuts = [
        { ...kept, y1: d.y2 },
        { ...kept, y2: d.y1 },
        { ...kept, x1: d.x2 },
        { ...kept, x2: d.x1 },
      ];
      const best = cuts.reduce((a, b) => (area(b) > area(a) ? b : a));
      if (area(best) >= area(kept) * 0.9) kept = best;
    }
    return kept;
  };
  // A caption wrapped into a second paragraph: the same (smaller) font a
  // line below the caption continues it. One set at the body's size
  // continues it only where its lines stand: from the caption's left edge,
  // or centered under it. The text's next paragraph starts at its own
  // indent (parse loop finding: GeoTopo's "Die Umkehrabbildung g ist nicht
  // stetig, …" under its centered caption read into it). The follower's
  // size may be the caption's last run's, not its line's: a caption set
  // smaller than its label (parse loop finding: a statistics book sets
  // "Figure 11.2:" in 10 pt and its words in 9 pt; the caption's line
  // reads 10 pt, so its second line, "is approximately linear.", read as
  // a paragraph of its own). A line hung under the caption's words, past
  // its label, continues it when the caption ends mid-sentence and the
  // line opens in lower case (parse loop finding: GeoTopo's "Abbildung
  // 1.10: … die be-" hangs "schränkte äußeres genannt." under "Die", 80 pt
  // in, which read as a paragraph of its own).
  const withFollower = (cap: Segment, follow: Segment | undefined): { text: string; runs: Run[] | undefined; box: Box } => {
    const box = cap.box!;
    const tail = [...(cap.runs ?? [])].reverse().find((r) => r.look)?.look?.size;
    const hung = (f: Segment, fb: Box) => fb.x1 > box.x1 && fb.x1 < (box.x1 + box.x2) / 2 && !/[.!?:;]\s*$/.test(cap.text) && /^\s*\p{Ll}/u.test(f.text);
    const aligned = (f: Box, size: number) => Math.abs(f.x1 - box.x1) < size || Math.abs((f.x1 + f.x2) / 2 - (box.x1 + box.x2) / 2) < size;
    if (
      !follow ||
      follow.type !== "PARAGRAPH" ||
      !follow.box ||
      follow.page !== cap.page ||
      follow.lineSize === undefined ||
      cap.lineSize === undefined ||
      (Math.abs(follow.lineSize - cap.lineSize) >= 0.6 && !(tail !== undefined && Math.abs(follow.lineSize - tail) < 0.6)) ||
      box.y1 - follow.box.y2 > cap.lineSize * ctx.leading * 0.9 ||
      (cap.lineSize >= ctx.bodySize * 0.98 && follow.text.length >= 240 && box.y1 - follow.box.y2 > cap.lineSize * 0.35) ||
      (cap.lineSize >= ctx.bodySize * 0.98 && !aligned(follow.box, cap.lineSize) && !hung(follow, follow.box))
    ) {
      return { text: cap.text, runs: cap.runs, box };
    }
    consumed.add(follow);
    // A word the line's end breaks loses the typesetter's hyphen ("be-" | "schränkte").
    const joined: { text: string; runs?: Run[] } = { text: cap.text, runs: cap.runs };
    const offset = joinWrapped(joined, follow.text);
    return {
      text: joined.text,
      runs: [...(joined.runs ?? []), ...(follow.runs ?? []).map((r) => ({ ...r, start: r.start + offset, end: r.end + offset }))],
      box: unionBox(box, follow.box),
    };
  };
  // A table with no rules whose rows hold pictures between their words (a
  // formula, a drawing of it, and lines on it in each row) is a table of
  // the words: the rows over its "Table N" caption, each beside pictures,
  // three rows of pictures at least, the lowest a row's space or two over
  // the caption. Each row's words left of the pictures are its first cell,
  // the words right of them its second; the pictures are no cell (a table
  // cell holds no crop), and the caption joins the table (tables.ts). Parse
  // loop finding: The Art of Linear Algebra's Table 1, "The Five
  // Factorization", read as scattered paragraphs, a table of two of its
  // rows, and an empty picture, its caption apart; a crop of it lost its
  // words.
  const pictureTables: Box[] = [];
  const picturedTable = (before: Segment[], cap: Box, x1: number, x2: number): { table: Segment; rows: Segment[] } | null => {
    const pictures = [...drawing.paths, ...drawing.images].filter(
      (b) => !("clip" in b && b.clip) && b.x1 >= x1 - 1 && b.x2 <= x2 + 1 && b.x2 - b.x1 > 2 && b.y2 - b.y1 > 2 && b.x2 - b.x1 < (x2 - x1) * 0.5 && b.y1 >= cap.y2 - 1,
    );
    const column = before.filter((s) => s.box !== undefined && s.box.x1 < x2 && s.box.x2 > x1);
    const rows: Segment[] = [];
    const level = new Set<Box>();
    for (let k = column.length - 1; k >= 0; k--) {
      const s = column[k];
      const box = s.box!;
      const short =
        s.type === "TABLE" ||
        (s.type === "EQUATION" && !/\\tag\*?\{/.test(s.text)) ||
        (s.type === "FIGURE" && !s.region) ||
        (s.type === "PARAGRAPH" && s.text.split("\n").every((l) => l.trim().length <= 60 && !/[.!?:;。．！？：；]["”’)」』）]?$/.test(l.trim())));
      const beside = pictures.filter((b) => b.y1 < box.y2 + rowGap && b.y2 > box.y1 - rowGap);
      if (!short || beside.length === 0) break;
      for (const b of beside) level.add(b);
      rows.push(s);
    }
    if (rows.length < 3 || rows[0].box!.y1 - cap.y2 > rowGap * 2) return null;
    // The rows of pictures: pictures over each other's height are one row.
    const bands: Box[] = [];
    for (const b of [...level].sort((p, q) => q.y2 - p.y2)) {
      const last = bands[bands.length - 1];
      if (last && b.y2 > last.y1) bands[bands.length - 1] = unionBox(last, b);
      else bands.push({ ...b });
    }
    if (bands.length < 3) return null;
    const px1 = Math.min(...[...level].map((b) => b.x1));
    const px2 = Math.max(...[...level].map((b) => b.x2));
    const box = [...rows.map((s) => s.box!), ...bands].reduce((a, b) => unionBox(a, b));
    const held = lines.filter((l) => l.y >= box.y1 - 1 && l.y <= box.y2 + 1 && l.x < x2 && l.xEnd > x1);
    // The words left of the pictures and right of them, each side read as
    // lines of its own (a row's big formula pulled its words' lines into
    // one: "Gaussian eliminationLU decomposition from"), each line in the
    // row of pictures whose middle is nearest. A word among the pictures (a
    // label) or a line no row is near leaves the rows as they read.
    const sides = { left: [] as Item[], right: [] as Item[] };
    for (const it of held.flatMap((l) => l.items)) {
      if (it.str.trim() === "") continue;
      if (it.x + it.w <= px1 + 1) sides.left.push(it);
      else if (it.x >= px2 - 1) sides.right.push(it);
      else return null;
    }
    const cells = bands.map(() => ({ left: [] as Line[], right: [] as Line[] }));
    // A row's middle: its formula's baseline when the row has one left of
    // the pictures (its words center on it), else its pictures' middle.
    const middles = bands.map((b) => (b.y1 + b.y2) / 2);
    for (const side of ["left", "right"] as const) {
      if (side === "right") {
        cells.forEach(({ left }, k) => {
          if (left.length > 0) middles[k] = left.reduce((n, l) => n + l.y, 0) / left.length;
        });
      }
      for (const l of buildLines(sides[side], held[0].page)) {
        const away = middles.map((m) => Math.abs(l.y - m));
        const k = away.indexOf(Math.min(...away));
        if (away[k] > rowGap * 2.5) return null;
        cells[k][side].push(l);
      }
    }
    // The lines' formulas read as the page's lines' are (ruled.ts reads a
    // grid's cells so).
    resolveZones(
      cells.flatMap((c) => [...c.left, ...c.right]),
      ctx.drawing,
    );
    const byTop = (a: Line, b: Line) => b.y - a.y || a.x - b.x;
    // A side's cell starts where its words start: the space beside the
    // pictures is no indent.
    const from = (ls: Line[], fallback: number) => (ls.length > 0 ? Math.min(...ls.map((l) => l.x)) : fallback);
    const leftFrom = from(cells.flatMap((c) => c.left), x1);
    const rightFrom = from(cells.flatMap((c) => c.right), px2);
    const tableRows: TableRow[] = cells.map(({ left, right }) => ({
      cells: [
        cellParagraphs(left.sort(byTop), { x1: leftFrom, x2: px1, y1: box.y1, y2: box.y2 }, { left: 0, right: 0 }),
        cellParagraphs(right.sort(byTop), { x1: rightFrom, x2, y1: box.y1, y2: box.y2 }, { left: 0, right: 0 }),
      ],
    }));
    if (tableRows.some((r) => r.cells.every((c) => c.text.trim() === ""))) return null;
    const words = cells.flatMap((c) => c.right);
    const size = words.length > 0 ? Math.round(median(words.map((l) => l.size)) * 2) / 2 : ctx.bodySize;
    const table = tableSegment(tableRows, 0, rows[0].page, { box, lineSize: size, mathShare: 0 }, { size, columns: [px1 - x1, x2 - px2] });
    return { table, rows };
  };
  for (let c = 0; c < withMath.length; c++) {
    const cap = withMath[c];
    if (consumed.has(cap)) continue;
    if (cap.type === "PARAGRAPH" && cap.box && isCaption(cap.text, cap.runs) && TABLE_CAPTION_RE.test(cap.text)) {
      const [x1, x2] = columnOf(cap.box);
      const found = picturedTable(out, cap.box, x1, x2);
      if (found) {
        const at = out.indexOf(found.rows[found.rows.length - 1]);
        const kept = out.filter((s) => !found.rows.includes(s));
        out.length = 0;
        out.push(...kept.slice(0, at), found.table, ...kept.slice(at));
        if (found.table.box) pictureTables.push(found.table.box);
      }
    }
    if (
      cap.type !== "PARAGRAPH" ||
      !cap.box ||
      !isCaption(cap.text, cap.runs) ||
      TABLE_CAPTION_RE.test(cap.text)
    ) {
      out.push(cap);
      continue;
    }
    // The caption's neighbors are in its column: on a page read as columns,
    // the segment before it may end the other column (a synthetic paper's
    // caption took the left column's last line for the figure's top).
    const [x1, x2] = columnOf(cap.box);
    const inColumn = (s: Segment) => s.box !== undefined && s.box.x1 < x2 && s.box.x2 > x1;
    // Above the caption: debris up to the previous body segment. A table
    // under its own "Table N" caption is data, not debris.
    const column = out.filter(inColumn);
    const swept: Segment[] = [];
    const steps = column.filter(framed).length;
    while (column.length > 0) {
      const prev = column[column.length - 1];
      // A legend or a hidden title inside the drawing is debris whatever it
      // read as, a long title too when it is one line (a panel figure's
      // title bar, arXiv 2609.29669 p15), and a chart's ticks read as lines
      // of their own (Grinstead–Snell p. 8: Fig. 1.5's labels, set in a
      // typewriter face, read as code); an attached figure never is.
      const oneLine = prev.box !== undefined && prev.box.y2 - prev.box.y1 <= (prev.lineSize ?? ctx.bodySize) * 1.8;
      // A drawing's label set in TeX's math fonts ("W_i", "U_{x,y}") reads
      // as a display with no number: a short one over the drawing is its
      // label, within an em of it (parse loop finding: GeoTopo's
      // Abbildung 1.7 kept its axes' labels as equations, and its figure was
      // a sliver over the caption).
      const label = prev.type === "EQUATION" && !/\\tag\*?\{/.test(prev.text) && prev.text.length <= 24;
      const inDrawing =
        prev.box !== undefined &&
        !(prev.type === "FIGURE" && prev.region) &&
        (prev.type !== "EQUATION" || label) &&
        (prev.text.length < 80 || oneLine || isTicks(prev.text)) &&
        overlapsDrawing(label ? grow(prev.box, ctx.bodySize) : prev.box, drawing, cap.box, prev.type === "CODE");
      // A display's crop inside a diagram (over its boxes, arrows, and
      // pictures, or over a chart's lines) is a part of it: TeX's fonts in
      // its labels read as an equation, and the figure drew in two pieces
      // (arXiv 2411.19946 Figures 1 and 3).
      const diagramPart = prev.type === "FIGURE" && prev.mathCrop === true && prev.box !== undefined && inDiagram(prev.box, drawing, ctx.bodySize);
      // A line set just outside a drawn graphic (a chart's ticks, its axis
      // years, its title above the plot: arXiv 2609.29669 p9 read them as
      // headings) is the graphic's too. Over the figure's top picture, a line
      // no drawing reaches is the text's (Earth Observer p1: "continued on
      // page 2" over a photo read as its label).
      const byGraphic =
        oneLine &&
        prev.type !== "FIGURE" &&
        graphics.some((g) => g.pictures.length === 0 && shareInside(prev.box!, grow(g.box, ctx.bodySize * 2)) >= 0.7);
      const shown = graphics.filter((g) => g.pictures.length > 0 && g.box.x1 < x2 && g.box.x2 > x1 && g.box.y1 >= cap.box!.y2 - 1);
      if (shown.length > 0 && prev.box && prev.box.y1 >= Math.max(...shown.map((g) => g.box.y2)) && !overlapsDrawing(prev.box, drawing, cap.box)) break;
      // Words between the caption and a graphic over it in the column, up to
      // a title just over the graphic, short and with no sentence end, are
      // the figure's: panel names and panel titles run together (arXiv
      // 2609.29669 p7). A paragraph of the text is longer (2411.19946 p4).
      const underGraphic =
        (prev.type === "PARAGRAPH" || prev.type === "SEPARATOR") &&
        prev.text.length <= 100 &&
        !/[.!?:;。．！？：；]["”’)」』）]?$/.test(prev.text.trim()) &&
        graphics.some(
          (g) =>
            g.box.x1 < x2 &&
            g.box.x2 > x1 &&
            g.box.y1 >= cap.box!.y2 &&
            prev.box!.y1 >= cap.box!.y2 &&
            prev.box!.y1 <= g.box.y2 + ctx.bodySize * 2,
        );
      // A diagram's step, framed in a box of its own, is the diagram's
      // however long its words, where two such boxes or more stand over the
      // caption (arXiv 2609.29669 p5: a flowchart's steps, a sentence in
      // each box, read as paragraphs and its caption as one).
      const step = framed(prev) && steps >= 2;
      // A figure set in TeX's math fonts and nothing drawn (an array of
      // matrices with labels beside them) reads as displays with no number,
      // equations or crops, right over its caption: they are the figure's
      // (parse loop finding: ThinkDSP's Figure 6.1, "Synthesis with
      // arrays", read as two crops, an equation ".f_k..", and its caption
      // as a paragraph). A figure's caption only, with nothing drawn between
      // it and the display, and no graphic under it.
      const mathFigure =
        (prev.type === "EQUATION" ? !/\\tag\*?\{/.test(prev.text) : prev.type === "FIGURE" && prev.mathCrop === true && !/\(\d{1,3}(?:\.\d{1,3})*[a-z]?\)/.test(prev.text)) &&
        !TABLE_CAPTION_RE.test(cap.text) &&
        prev.box !== undefined &&
        drawingIn(drawing, cap.box.y2, prev.box.y1, x1, x2) === null &&
        !graphics.some((g) => g.box.x1 < x2 && g.box.x2 > x1 && g.box.y1 >= cap.box!.y2 - 1 && g.box.y2 <= prev.box!.y1 + 1) &&
        !graphics.some((g) => g.box.x1 < x2 && g.box.x2 > x1 && g.box.y2 <= cap.box!.y1 + 1 && cap.box!.y1 - g.box.y2 < rowGap * 2);
      if (!isFigureDebris(prev, ctx) && !inDrawing && !byGraphic && !underGraphic && !diagramPart && !step && !mathFigure) break;
      // What reaches well past the column (a table across both columns) is
      // no debris of a figure in it.
      if (prev.box && (prev.box.x1 < x1 - ctx.bodySize * 2 || prev.box.x2 > x2 + ctx.bodySize * 2)) break;
      if (prev.type === "TABLE" && column.length >= 2 && TABLE_CAPTION_RE.test(column[column.length - 2].text)) break;
      swept.unshift(column.pop()!);
    }
    const above = column[column.length - 1];
    // The band ends under the previous segment, its caption included (a
    // figure's box leaves its caption out). With none, it ends under the
    // lowest line the page dropped over the caption in its column, and at 94%
    // of the page at most.
    const capBox = cap.box;
    const centeredIn = (b: Box, y1: number, y2: number) => b.x1 < x2 && b.x2 > x1 && (b.y1 + b.y2) / 2 >= y1 && (b.y1 + b.y2) / 2 <= y2;
    const roof = Math.min(Infinity, ...dropped.filter((b) => b.y1 >= capBox.y2 && b.x1 < x2 && b.x2 > x1).map((b) => b.y1));
    const top = above?.box
      ? Math.min(above.box.y1, above.captionBox?.y1 ?? Infinity) - ctx.bodySize * 0.6
      : Math.min(pageTop, roof - ctx.bodySize * 0.6);
    let box: Box | null = null;
    const drawnAbove = drawingIn(drawing, cap.box.y2, top, x1, x2);
    const next = withMath.slice(c + 1).filter((s) => inColumn(s) && !consumed.has(s));
    const taken: Segment[] = [];
    // A caption in a side column with nothing of a figure in its own
    // column, level with a graphic beside it that has no caption of its
    // own, is that graphic's (Earth Observer pp. 8–9: each side caption made
    // a crop of the blank margin over it, and its chart drew with none).
    const side = swept.length === 0 ? sideGraphic(cap, x1, x2) : undefined;
    if (side) {
      sideCaptions.set(side, [...(sideCaptions.get(side) ?? []), { ...cap, ...withFollower(cap, next[0]) }]);
      continue;
    }
    if (swept.length > 0 || top - cap.box.y2 > rowGap * 3 || drawnAbove) {
      for (const s of swept) out.splice(out.indexOf(s), 1);
      taken.push(...swept);
      box = { x1, x2, y1: cap.box.y2 + ctx.bodySize * 0.2, y2: top };
      // With nothing of the text over it, a figure's top is its own: the top
      // of its drawing, of its graphics with their words, and of the words it
      // swept (a chart's title, an axis name). It never reaches the line the
      // page dropped over it (with none, 94% of the page). arXiv 2506.06752
      // pp. 4, 5, 15: the band ran to 94% of the page, and each crop showed
      // the running head. Under another figure, its top is its own too
      // (Grinstead–Snell p. 8: Fig. 1.5's crop began under Fig. 1.4's
      // caption, a blank band over the chart).
      if (!above?.box || above.type === "FIGURE") {
        const own = [drawnAbove, ...graphics.filter((g) => centeredIn(g.box, capBox.y2, top)).map(graphicExtent), ...swept.map((s) => s.box)];
        const tops = own.flatMap((b) => (b ? [b.y2] : []));
        const ceiling = Math.min(above?.box ? top : Infinity, Number.isFinite(roof) ? roof : pageTop);
        if (tops.length > 0) box.y2 = Math.min(ceiling, Math.max(...tops) + ctx.bodySize * 0.2);
      }
      for (const s of swept) if (s.box) box = unionBox(box, s.box);
      // The drawing sets the width: a chart wider than the text column keeps
      // its axis labels.
      if (drawnAbove) box = unionBox(box, { ...drawnAbove, y1: Math.max(drawnAbove.y1, box.y1), y2: Math.min(drawnAbove.y2, box.y2) });
    } else {
      // Below the caption: debris down to the next body segment. The
      // figure's note or source is its last line, and under a drawing its
      // words stand close: a line more than a row and a half below the
      // drawing and the lines taken is the page's (MIC white paper: each
      // chart ends with "（出典）…", and the sub-heading and the links under
      // it went into the figure). The floor is the figure's lowest point so
      // far: its graphics and the lines it took.
      const capBottom = cap.box.y1;
      const drawn = graphics.filter((g) => g.box.x1 < x2 && g.box.x2 > x1 && g.box.y2 <= capBottom + ctx.bodySize);
      let floor = capBottom;
      const reach = () => {
        for (let grew = true; grew; ) {
          grew = false;
          for (const g of drawn) {
            if (g.box.y1 >= floor || floor - g.box.y2 > rowGap * 1.5) continue;
            floor = g.box.y1;
            grew = true;
          }
        }
      };
      reach();
      const onDrawing = floor < capBottom;
      let m = 0;
      let end: number | undefined;
      // The note is the caption's words, and the band stops over it.
      let note: Segment | undefined;
      while (m < next.length && isFigureDebris(next[m], ctx)) {
        const s = next[m];
        if (onDrawing && s.box && floor - s.box.y2 > rowGap * 1.5) break;
        m++;
        if (s.box && s.box.y1 < floor) {
          floor = s.box.y1;
          reach();
        }
        if (NOTE_RE.test(s.text.trim())) {
          note = s;
          end = s.box ? s.box.y2 + ctx.bodySize * 0.2 : undefined;
          break;
        }
      }
      const below = next[m];
      // With nothing of the text under it, the band ends over the highest
      // line the page dropped under the caption in its column, and at 6% of
      // the page at least.
      const ground = Math.max(-Infinity, ...dropped.filter((b) => b.y2 <= capBottom && b.x1 < x2 && b.x2 > x1).map((b) => b.y2));
      const foot = Math.max(pageBottom, ground + ctx.bodySize * 0.6);
      let bottom = end ?? (below?.box ? below.box.y2 + ctx.bodySize * 0.6 : foot);
      let open = end === undefined && !below?.box;
      const drawnBelow = drawingIn(drawing, bottom, cap.box.y1, x1, x2);
      // Debris is a figure's only where something is drawn near it: a
      // graphic under the caption, or paths or an image among the lines.
      // With nothing drawn, the lines are text. Those set in the caption's
      // font right under it go on with it, and so does the next such line,
      // as a figure's caption takes its second paragraph. NPS thesis pp.
      // 12–13: a List of Figures entry's middle line became a crop of its
      // own words. Nature p. 4: Fig. 3's caption stands under its chart, and
      // its next lines, merged with the right column's, became one crop
      // across both columns. Earth Observer p. 26: a caption beside its
      // chart lost its last lines and its credit to a crop of them.
      if (m > 0 && !onDrawing && !drawnBelow) {
        let k = 0;
        for (; k <= m && k < next.length; k++) {
          const s = next[k];
          if (s.type !== "PARAGRAPH" || !s.box || s.lineSize === undefined || cap.lineSize === undefined) break;
          const gap = cap.box.y1 - s.box.y2;
          if (Math.abs(s.lineSize - cap.lineSize) >= 0.6 || gap > cap.lineSize * ctx.leading * 0.9) break;
          if (cap.lineSize >= ctx.bodySize * 0.98 && s.text.length >= 240 && gap > cap.lineSize * 0.35) break;
          const offset = cap.text.length + 1;
          cap.text = `${cap.text} ${s.text}`;
          cap.runs = [...(cap.runs ?? []), ...(s.runs ?? []).map((r) => ({ ...r, start: r.start + offset, end: r.end + offset }))];
          cap.box = unionBox(cap.box, s.box);
          consumed.add(s);
        }
        next.splice(0, k);
        m = 0;
        bottom = next[0]?.box ? next[0].box.y2 + ctx.bodySize * 0.6 : foot;
        open = !next[0]?.box;
      }
      if (m > 0 || cap.box.y1 - bottom > rowGap * 3 || drawnBelow) {
        box = { x1, x2, y1: bottom, y2: cap.box.y1 - ctx.bodySize * 0.2 };
        // With nothing of the text under it, a figure's foot is its own: the
        // foot of its drawing, of its graphics with their words, and of the
        // words it took. It never reaches the line the page dropped under it
        // (with none, 6% of the page). arXiv 2506.08209 p. 12: the band ran
        // to 6% of the page, and the crop showed half the page number.
        if (open) {
          const capFoot = cap.box.y1;
          const own = [drawnBelow, ...graphics.filter((g) => centeredIn(g.box, bottom, capFoot)).map(graphicExtent), ...next.slice(0, m).map((s) => s.box)];
          const feet = own.flatMap((b) => (b ? [b.y1] : []));
          if (feet.length > 0) box.y1 = Math.max(Number.isFinite(ground) ? ground : pageBottom, Math.min(...feet) - ctx.bodySize * 0.2);
        }
        for (const s of next.slice(0, m)) {
          if (s.box && s !== note) box = unionBox(box, s.box);
          consumed.add(s);
          taken.push(s);
        }
        if (drawnBelow) box = unionBox(box, { ...drawnBelow, y1: Math.max(drawnBelow.y1, box.y1), y2: Math.min(drawnBelow.y2, box.y2) });
        next.splice(0, m);
      }
    }
    if (!box) {
      out.push(cap);
      continue;
    }
    // The graphics the band meets set its width, and the figure takes the
    // lines among them when they are a figure's (MIC white paper p13: the
    // caption bar's words stand over the left column, and its grid of six
    // photos across the page drew as a crop of the left half and one of
    // each row, the source line under the grid alone).
    const band = box;
    const wide = graphics
      .filter((g) => g.box.x1 < band.x2 && g.box.x2 > band.x1 && (g.box.y1 + g.box.y2) / 2 > band.y1 && (g.box.y1 + g.box.y2) / 2 < band.y2)
      .reduce((b, g) => ({ ...b, x1: Math.min(b.x1, g.box.x1), x2: Math.max(b.x2, g.box.x2) }), band);
    if (wide.x1 < band.x1 - 1 || wide.x2 > band.x2 + 1) {
      const among = withMath.filter((s) => s !== cap && s.box && !consumed.has(s) && !taken.includes(s) && shareInside(s.box, wide) >= 0.7 && shareInside(s.box, band) < 0.7);
      if (among.every((s) => isFigureDebris(s, ctx) || NOTE_RE.test(s.text.trim()))) {
        box = wide;
        for (const s of among) {
          if (out.includes(s)) out.splice(out.indexOf(s), 1);
          consumed.add(s);
          taken.push(s);
        }
      }
    }
    let { text, runs, box: captionBox } = withFollower(cap, next.find((s) => !consumed.has(s)));
    // A figure's own link printed under its caption (PLOS prints each
    // figure's DOI there) ends the caption: a paragraph of its own, it ran
    // into the next page's first words ("….g007 durations are …").
    const link = next.find((s) => !consumed.has(s));
    if (
      link?.type === "PARAGRAPH" &&
      link.box &&
      link.page === cap.page &&
      /^https?:\/\/\S+$/.test(link.text.trim()) &&
      captionBox.y1 - link.box.y2 <= (cap.lineSize ?? ctx.bodySize) * ctx.leading * 2
    ) {
      const offset = text.length + 1;
      text = `${text} ${link.text}`;
      runs = [...(runs ?? []), ...(link.runs ?? []).map((r) => ({ ...r, start: r.start + offset, end: r.end + offset }))];
      captionBox = unionBox(captionBox, link.box);
      consumed.add(link);
    }
    const figure: Segment = {
      type: "FIGURE",
      text,
      page: cap.page,
      runs,
      box,
      captionBox,
      region: toRegion(box),
      lineSize: cap.lineSize,
      mathShare: 0,
    };
    out.push(figure);
    for (const s of taken) {
      const part = panelOf(s);
      if (part) addPanel(figure, part);
    }
  }

  // 3. Graphics (images and vector drawings). One a captioned figure already
  // covers extends it; any other becomes a FIGURE of its own, with the
  // caption found under it, at its place in the reading order (pageLines
  // put it after a line: the FIGURE follows that line's segment).
  const inside = (inner: Box, outer: Box) => shareInside(inner, outer) >= 0.7;
  let placed = out;
  const own = new Set<Segment>();
  // Every image and path the page paints, small ones too (a diagram's arrow).
  const painted: Drawn = { images: ctx.drawing.images, paths: ctx.drawing.paths };
  for (const graphic of [...graphics].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))) {
    // A picture among a table's rows is no figure of its own (picturedTable).
    if (pictureTables.some((t) => inside(graphic.box, t))) continue;
    let box = clearOfDropped(graphic.box);
    // A display's crop a quarter or more inside a graphic, on its drawing, is
    // one of the graphic's labels: the graphic's crop takes it in (NASA pptx
    // p7: a diagram's "ṁ" by its arrow drew as an equation's crop over the
    // diagram's crop).
    const labels = placed.filter((s) => s.type === "FIGURE" && s.mathCrop === true && s.box !== undefined && shareInside(s.box, box) >= 0.25 && inDiagram(s.box, painted, ctx.bodySize));
    if (labels.length > 0) {
      box = labels.reduce((b, s) => (s.box ? unionBox(b, s.box) : b), box);
      placed = placed.filter((s) => !labels.includes(s));
    }
    const caption = captions.get(graphic) ?? null;
    // A graphic inside a captioned figure is one of its panels: its caption
    // joins the figure's when it is a panel's or a note (Panel captions
    // above). Any other words under it are the drawing's own, which the crop
    // shows (arXiv 2411.19946 p1: "Early-optimized image" under a row of
    // pictures).
    const host =
      placed.find((s) => s.type === "FIGURE" && s.box && inside(box, s.box)) ??
      placed.find((s) => s.type === "FIGURE" && s.box && inside(s.box, box));
    // A caption set beside the graphic takes the place of one under it.
    const sides = sideCaptions.get(graphic) ?? [];
    if (host?.box) {
      if (!inside(box, host.box)) {
        host.box = unionBox(host.box, box);
        host.region = toRegion(host.box);
      }
      if (caption && isSubCaption(caption.text)) addPanel(host, caption);
      for (const side of sides) if (side.box) addPanel(host, { text: side.text, runs: side.runs ?? [], box: side.box });
      continue;
    }
    // Captions beside rows of pictures cut the graphic: each takes its row,
    // and a row with none goes with the caption over it (or under it).
    const rows = sides.length > 1 ? rowsOf(graphic) : [];
    const byRow = rows.map((_, k) => sides.find((s) => rowAt(rows, s.box!) === k));
    for (let k = 1; k < rows.length; k++) byRow[k] ??= byRow[k - 1];
    for (let k = rows.length - 2; k >= 0; k--) byRow[k] ??= byRow[k + 1];
    const parts =
      rows.length > 0
        ? sides.map((side) => ({ side, box: clearOfDropped(rows.filter((_, k) => byRow[k] === side).reduce((a, b) => unionBox(a, b), rows[rowAt(rows, side.box!)])) }))
        : [{ side: sides[0] as Segment | undefined, box }];
    for (const { side, box } of parts) {
      const figure: Segment = {
        type: "FIGURE",
        text: side?.text ?? caption?.text ?? "",
        // The page's own number: a page with no text has no segment to read it from.
        page,
        runs: side?.runs ?? caption?.runs ?? [],
        box,
        region: toRegion(box),
        lineSize: side?.lineSize ?? caption?.size ?? ctx.bodySize,
        mathShare: 0,
      };
      if (side?.box || caption) figure.captionBox = side?.box ?? caption?.box;
      own.add(figure);
      placed = [...placed];
      placed.splice(placeOf(placed, graphic, own), 0, figure);
    }
  }
  // A table drawn as a picture, its words outlines and none in the text
  // layer, is a figure, and the "TABLE 6." caption right over or under it
  // is its caption (IEEE Access 3721067: each table was a crop with no
  // caption under its caption's paragraph).
  for (const figure of own) {
    const at = figure.box;
    if (figure.text !== "" || !at) continue;
    const k = placed.indexOf(figure);
    const cap = [placed[k - 1], placed[k + 1]].find(
      (s) =>
        s?.type === "PARAGRAPH" &&
        s.box !== undefined &&
        s.page === figure.page &&
        TABLE_CAPTION_RE.test(s.text) &&
        isCaption(s.text, s.runs) &&
        s.box.x1 < at.x2 &&
        s.box.x2 > at.x1 &&
        Math.max(s.box.y1 - at.y2, at.y1 - s.box.y2) <= rowGap * 2,
    );
    if (!cap) continue;
    Object.assign(figure, { text: cap.text, runs: cap.runs, captionBox: cap.box, lineSize: cap.lineSize });
    placed = placed.filter((s) => s !== cap);
  }
  // Text inside a figure's box (a hidden chart title, a stray label) is part
  // of the graphic, and a panel's caption there part of its caption. A
  // graphic's labels never became text, and what text is left over it is the
  // page's own (census class 2).
  const hosts = placed.filter((s) => s.type === "FIGURE" && s.region && s.box && !own.has(s));
  const kept = placed.filter((s) => {
    if ((s.type === "FIGURE" && s.region) || !s.box) return true;
    const host = hosts.find((f) => inside(s.box!, f.box!));
    if (!host) return true;
    const part = panelOf(s);
    if (part) addPanel(host, part);
    return false;
  });
  for (const [figure, parts] of panels) {
    withPanels(figure, parts);
    // The panels' captions at the crop's foot, nothing drawn under them,
    // are the caption's words, not the crop's (arXiv 2506.06752 Figure 1:
    // "(a) …" and "(b) …" drew in the crop and again in the caption).
    const at = figure.box;
    const within = parts.filter((p) => at && shareInside(p.box, at) >= 0.7);
    if (!at || within.length === 0) continue;
    const lowest = within.reduce((a, b) => (b.box.y1 < a.box.y1 ? b : a));
    const rowTop = Math.max(...within.filter((p) => p.box.y1 < lowest.box.y2).map((p) => p.box.y2));
    if (rowTop < at.y2 - ctx.bodySize * 2 && !drawingIn(drawing, at.y1 - 1, rowTop, at.x1, at.x2)) {
      figure.box = { ...at, y1: rowTop + ctx.bodySize * 0.2 };
      figure.region = toRegion(figure.box);
    }
  }
  return kept;
}

// Where a graphic's FIGURE goes: after the segment that holds the line read
// just before it, and after the figures already placed there.
function placeOf(segments: Segment[], graphic: Graphic, own: Set<Segment>): number {
  const line = graphic.after;
  if (!line) {
    let k = 0;
    while (k < segments.length && own.has(segments[k])) k++;
    return k;
  }
  let best = -1;
  let bestArea = Infinity;
  segments.forEach((s, k) => {
    const b = s.box;
    if (!b || own.has(s) || s.page !== line.page) return;
    const x = Math.min(line.xEnd, line.x + line.size);
    if (x < b.x1 - 0.5 || x > b.x2 + 0.5 || line.y < b.y1 - 0.5 || line.y > b.y2 + 0.5) return;
    if (area(b) < bestArea) [best, bestArea] = [k, area(b)];
  });
  if (best < 0) {
    // The line left the page (running furniture, a footnote): by position.
    const center = (graphic.box.y1 + graphic.box.y2) / 2;
    const at = segments.findIndex((s) => s.box && !own.has(s) && (s.box.y1 + s.box.y2) / 2 < center);
    return at < 0 ? segments.length : at;
  }
  let k = best + 1;
  while (k < segments.length && own.has(segments[k])) k++;
  return k;
}
