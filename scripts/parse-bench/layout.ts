import { execFileSync } from "node:child_process";
import { regionBounds } from "@/lib/video/types";
import type { DocBlock } from "./adapt";
import { captionScores, captionSides, cropOverlaps, pictureScores, type CaptionScores, type CaptionSides, type CropOverlaps, type Picture, type PictureScores } from "./floats";
import { rowsOf, type PdfText } from "./free";
import type { InkBand, Rect } from "./paint";
import type { Flat } from "./metrics";
import { wordsOf } from "./text";

// Checks against the page's own lines (pdftotext's boxes) and fonts
// (pdftohtml's), with no reference: where the candidate's words stand on
// the page tells whether it read two columns across, set a paragraph in
// that the page sets flush, or set prose in a table's cells or a display's
// crop; the page's fonts tell the body's face.

type Line = PdfText["lines"][number];

// ── The candidate's words on the page's lines ──────────────────────────────

/** A CJK character, each a word of its own (text.ts), so a run of three is no key to a line. */
const CJK = /^[\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}]$/u;

/** Each of the candidate's units (a paragraph, a heading, a list item, a
    table's cell) as the page's lines its words stand on, in the order it
    reads them: a run of three words the page prints on one line (of six,
    where the three are CJK characters) places the words there; where
    several lines print it, the first at or after the last line placed (the
    reading goes on), else the nearest before it. A table's cell of one or
    two words is placed by its words whole, the same way (a table reads
    cell by cell, so the last line placed is its neighbor's). A caption's
    lines stand together: a run of a caption after its first is placed on a
    line within three line heights under the caption's last line, else on
    none (a caption's last words stand in the prose too, "production
    conversation archives" half a page under the table; placed there, the
    caption's reading runs on from the prose and the table's cells after it
    land on prose lines). A unit half of whose words no line holds (a script
    the text layer reads blind) is placed on none. */
export function linesOfUnits(pdf: PdfText, cand: Flat): number[][] {
  const runs = new Map<string, number[]>();
  const size = (words: string[], k: number) => (words.slice(k, k + 3).every((w) => CJK.test(w)) ? 6 : 3);
  pdf.lines.forEach((line, i) => {
    const words = wordsOf(line.text).map((w) => w.w);
    const add = (key: string) => {
      const list = runs.get(key);
      if (!list) runs.set(key, [i]);
      else if (list.at(-1) !== i) list.push(i);
    };
    for (const n of [1, 2]) for (let k = 0; k + n <= words.length; k++) add(`${n}:${words.slice(k, k + n).join(" ")}`);
    for (let k = 0; k + 3 <= words.length; k++) {
      const n = size(words, k);
      if (k + n <= words.length) add(`${n}:${words.slice(k, k + n).join(" ")}`);
    }
  });
  let last = 0;
  const next = (found: number[]) => found.find((l) => l >= last) ?? found.reduce((a, b) => (Math.abs(b - last) < Math.abs(a - last) ? b : a));
  // A caption's line after its first: on the page of the last line placed, from that line's top to three line heights under it.
  const together = (prev: Line, l: Line) => l.page === prev.page && l.top >= prev.top - 1 && l.top <= prev.top + 3 * (prev.bottom - prev.top);
  return cand.units.map((unit) => {
    const out: number[] = [];
    const words = cand.toks.slice(unit.first, unit.end).map((x) => x.w);
    const block = cand.blocks[unit.block];
    const caption = block.kind === "figure" || (block.kind === "table" && unit.index === -1) || (block.kind === "paragraph" && block.role === "caption");
    if (words.length > 0 && words.length < 3 && cand.blocks[unit.block].kind === "table") {
      const found = runs.get(`${words.length}:${words.join(" ")}`);
      if (found) out.push((last = next(found)));
      return out;
    }
    const before = last;
    const held = new Set<number>();
    for (let k = 0; k + 3 <= words.length; k++) {
      const n = size(words, k);
      const found = k + n <= words.length ? runs.get(`${n}:${words.slice(k, k + n).join(" ")}`) : undefined;
      if (!found) continue;
      const prev = caption && out.length > 0 ? pdf.lines[out[out.length - 1]] : undefined;
      const line = prev ? found.find((l) => together(prev, pdf.lines[l])) : next(found);
      if (line === undefined) continue;
      last = line;
      for (let t = k; t < k + n; t++) held.add(t);
      if (out.at(-1) !== line) out.push(line);
    }
    // A unit whose words the text layer mostly does not hold (a script it reads blind) stands on no line.
    if (held.size * 2 < words.length) {
      last = before;
      return [];
    }
    return out;
  });
}

/** Two lines on one row of a page: tops within half the smaller line's height. */
const sameRow = (a: Line, b: Line) => a.page === b.page && Math.abs(a.top - b.top) < 0.5 * Math.min(a.bottom - a.top, b.bottom - b.top);
/** Two lines side by side with a gap between them (a column's gutter, not a word space). */
const apart = (a: Line, b: Line) => a.right + 3 < b.left || b.right + 3 < a.left;
/** A line of prose, not a label or a table's cell: twenty characters and three words or more. */
const prose = (l: Line) => l.text.trim().length >= 20 && wordsOf(l.text).length >= 3;
/** The line right under another in its column: below it, most of the narrower's width shared. */
const under = (a: Line, b: Line) => a.page === b.page && b.top > a.top && Math.min(a.right, b.right) - Math.max(a.left, b.left) >= 0.5 * Math.min(a.right - a.left, b.right - b.left);

export type ColumnScores = { lines: number; across: number; pages: number[]; score: number | null; found: { page: number; text: string }[] };

/** Columns read across: the candidate's reading order (its units in order,
    a table's cells aside, where reading across a row is right) goes from a
    line to the line beside it across a gutter and back, row after row, on
    two lines of prose (IEEE's two columns interleaved line by line, a
    sidebar read into the main column). A line so read is read across;
    the score is the share of the candidate's prose lines read in order. */
export function columnScores(pdf: PdfText, cand: Flat, placed: number[][]): ColumnScores {
  const sequence: number[] = [];
  cand.units.forEach((unit, u) => {
    if (cand.blocks[unit.block].kind === "table") return;
    for (const line of placed[u]) if (sequence.at(-1) !== line) sequence.push(line);
  });
  const lines = pdf.lines;
  const across = new Set<number>();
  const cross = (a: number, b: number) => sameRow(lines[a], lines[b]) && apart(lines[a], lines[b]) && prose(lines[a]) && prose(lines[b]);
  for (let k = 0; k + 3 < sequence.length; k++) {
    const [a1, b1, a2, b2] = sequence.slice(k, k + 4);
    if (cross(a1, b1) && cross(a2, b2) && under(lines[a1], lines[a2]) && under(lines[b1], lines[b2])) for (const l of [a1, b1, a2, b2]) across.add(l);
  }
  const read = new Set(sequence.filter((l) => prose(lines[l])));
  const pages = [...new Set([...across].map((l) => lines[l].page))].sort((a, b) => a - b);
  return {
    lines: read.size,
    across: across.size,
    pages,
    score: read.size > 0 ? 1 - across.size / read.size : null,
    found: [...across].sort((a, b) => a - b).slice(0, 12).map((l) => ({ page: lines[l].page, text: lines[l].text })),
  };
}

// ── Prose set in a table's cells ────────────────────────────────────────────

export type TableProse = { tables: number; words: number; prose: number; score: number | null; found: { rows: number; runs: number; words: number; text: string }[] };

/** The words that make up a quarter or more of English prose and few of a
    table's phrases ("real-world generalization", "task success"). */
const FUNCTION_WORDS = new Set("a an the of and or but nor to in on at by for with from into onto over under as than that which who whom whose this these those it its is are was were be been being has have had do does did can could will would may might must shall should not no so such then there their they we our you your he she his her him them".split(" "));

/** Prose set in a table's cells: a table whose cells run a sentence on from
    one row into the next, the page's lines read as rows (two columns of a
    page, a paragraph beside its label, a pull quote, a list of references,
    read as a table). A cell runs on when it is one line of the page of
    three words or more that ends with no stop, and the cell under it opens
    in lowercase (a table's own cells hold their wrapped lines whole; a
    header cell's words stop at its row). A table where a third of its rows
    or more run on, in words a quarter of which or more are English prose's
    own (FUNCTION_WORDS: not a column of short phrases), is prose; the score
    is the share of the candidate's table words in no such table. */
export function tableScores(cand: Flat, placed: number[][]): TableProse {
  let words = 0;
  let proseWords = 0;
  let tables = 0;
  const found: TableProse["found"] = [];
  cand.blocks.forEach((block, b) => {
    if (block.kind !== "table") return;
    tables++;
    const units = cand.unitsOf[b].filter((u) => cand.units[u].index >= 0);
    const cells = units.map((u) => cand.units[u]);
    const oneLine = new Set(units.filter((u) => placed[u].length === 1).map((u) => cand.units[u]));
    const count = cells.reduce((n, u) => n + u.end - u.first, 0);
    words += count;
    const at = new Map(cells.map((u) => [`${u.row},${u.col}`, u]));
    const rows = new Set(cells.map((u) => u.row));
    const running = new Set<number>();
    let said = 0;
    let own = 0;
    for (const u of cells) {
      const next = at.get(`${u.row + 1},${u.col}`);
      if (!next || !u.styled || u.end - u.first < 3 || !oneLine.has(u)) continue;
      const text = u.text.trim();
      if (/[.!?:;)\]"”’]$/.test(text) || !/^\p{Ll}/u.test(next.text.trim())) continue;
      running.add(u.row);
      for (const unit of [u, next]) {
        said += unit.end - unit.first;
        for (let t = unit.first; t < unit.end; t++) if (FUNCTION_WORDS.has(cand.toks[t].w)) own++;
      }
    }
    if (rows.size >= 2 && running.size >= 2 && running.size * 3 >= rows.size - 1 && own * 4 >= said) {
      proseWords += count;
      found.push({ rows: rows.size, runs: running.size, words: count, text: cells.slice(0, 4).map((u) => u.text).join(" | ").slice(0, 160) });
    }
  });
  return { tables, words, prose: proseWords, score: words > 0 ? 1 - proseWords / words : null, found };
}

// ── Indents the page does not set ───────────────────────────────────────────

export type IndentScores = { indented: number; judged: number; wrong: number; score: number | null; found: { page: number; left: number; shown: number; text: string }[] };

/** Each page's lines, by page (a whole book's pages are thousands of lines). */
const byPage = new WeakMap<PdfText, Map<number, Line[]>>();

/** Where a line's column starts: of the page's other lines (not its
    paragraph's, `own`) that span half its width or more, are 60% as wide as
    its paragraph's widest line (`measure`) or wider (its column's lines, a
    list's and a note's; not a table's cells), and start less than that
    measure left of it (not a line across two columns), the leftmost place
    where two of them or more start within a point; on another page
    (`page`), its lines at the line's place across the page. */
export function columnEdge(pdf: PdfText, line: Line, measure: number, own: Set<Line>, page = line.page): number | null {
  let pages = byPage.get(pdf);
  if (!pages) {
    pages = new Map();
    for (const l of pdf.lines) {
      const list = pages.get(l.page);
      if (list) list.push(l);
      else pages.set(l.page, [l]);
    }
    byPage.set(pdf, pages);
  }
  const column = (pages.get(page) ?? []).filter(
    (l) => !own.has(l) && l.right - l.left >= 0.6 * measure && l.left > line.left - measure && Math.min(l.right, line.right) - Math.max(l.left, line.left) >= 0.5 * (line.right - line.left),
  );
  const lefts = column.map((l) => l.left).sort((a, b) => a - b);
  const count = (x: number) => lefts.filter((y) => Math.abs(y - x) <= 1).length;
  return lefts.find((x) => count(x) >= 2) ?? null;
}

/** Indents the page does not set: a paragraph the candidate sets in from
    its column's edge (a block indent, or a hanging indent's wrapped lines)
    whose lines the page does not set in (within 2 pt, or a quarter of the
    candidate's indent): a block indent's lines against their column's edge
    (its one line, where its first line starts), a hanging indent's wrapped
    lines against its own first line. A line that starts left of the edge
    found is in another column: it tells nothing. A paragraph of one line
    that stands where the page's other lines start (a page of tables, their
    notes set in as far as its first lines) is judged by the column's edge
    on the pages two before and after too, which face the same way. The
    score is the share of the candidate's set-in paragraphs whose indent
    the page shows. */
export function indentScores(pdf: PdfText, cand: Flat, placed: number[][]): IndentScores {
  let indented = 0;
  let judged = 0;
  let wrong = 0;
  const found: IndentScores["found"] = [];
  cand.blocks.forEach((block, b) => {
    if (block.kind !== "paragraph" || !block.indentPt || block.indentPt.left < 4 || block.align === "center" || block.align === "right") return;
    indented++;
    const { left, first } = block.indentPt;
    const units = cand.unitsOf[b];
    // The paragraph's lines follow its first on its page, each within two lines' height of the one before; its
    // words' other places (a book repeats "the markup language" on many pages) are not its lines.
    const lines: Line[] = [];
    for (const l of units.flatMap((u) => placed[u]).map((i) => pdf.lines[i])) {
      const prev = lines.at(-1);
      if (!prev || (l.page === prev.page && l.top > prev.top && l.top - prev.top <= 2.5 * (prev.bottom - prev.top))) lines.push(l);
    }
    if (lines.length === 0) return;
    // The first line placed must hold the paragraph's first words; a paragraph of one line placed is one
    // line only where that line holds its words (its wrapped lines may be too short to place).
    const words = units.flatMap((u) => cand.toks.slice(cand.units[u].first, cand.units[u].end).map((t) => t.w));
    const held = wordsOf(lines[0].text).map((w) => w.w).join(" ");
    if (!held.startsWith(words.slice(0, 3).join(" "))) return;
    if (lines.length === 1 && wordsOf(lines[0].text).length < 0.9 * words.length) return;
    const wrapped = lines.length > 1 ? lines.slice(1) : lines;
    const hanging = first < 0 && lines.length > 1;
    const want = hanging ? -first : lines.length > 1 ? left : left + first;
    const measure = Math.max(...lines.map((l) => l.right - l.left));
    const own = new Set(lines);
    const shown = wrapped.map((l) => {
      if (hanging) return l.left - lines[0].left;
      let edge = columnEdge(pdf, l, measure, own);
      if (lines.length === 1 && (edge === null || Math.abs(l.left - edge) <= 2)) {
        const beside = [l.page - 2, l.page + 2].map((p) => columnEdge(pdf, l, measure, own, p)).filter((x): x is number => x !== null);
        if (beside.length > 0) edge = Math.min(edge ?? Infinity, ...beside);
      }
      return edge === null || l.left - edge < -2 ? null : l.left - edge;
    });
    const known = shown.filter((x): x is number => x !== null);
    if (known.length === 0 || want < 4) return;
    judged++;
    const set = known.sort((a, c) => a - c)[Math.floor(known.length / 2)];
    if (set <= Math.max(2, 0.25 * want)) {
      wrong++;
      found.push({ page: lines[0].page, left: want, shown: Math.round(set * 10) / 10, text: cand.units[cand.unitsOf[b][0]].text.slice(0, 80) });
    }
  });
  return { indented, judged, wrong, score: judged > 0 ? 1 - wrong / judged : null, found };
}

// ── Pictures that hold what should be words ─────────────────────────────────

/** A figure's region on its page, in points. */
function boxOf(pdf: PdfText, at: NonNullable<DocBlock["at"]>): { page: number; x1: number; x2: number; y1: number; y2: number } | null {
  const size = pdf.sizes.get(at.page);
  if (!size) return null;
  const b = regionBounds(at.region);
  return { page: at.page, x1: (b.x1 / 100) * size.width, x2: (b.x2 / 100) * size.width, y1: (b.y1 / 100) * size.height, y2: (b.y2 / 100) * size.height };
}

/** The page's lines whose middle stands in a box. */
function linesIn(pdf: PdfText, box: { page: number; x1: number; x2: number; y1: number; y2: number }): Line[] {
  return pdf.lines.filter((l) => l.page === box.page && (l.left + l.right) / 2 >= box.x1 && (l.left + l.right) / 2 <= box.x2 && (l.top + l.bottom) / 2 >= box.y1 && (l.top + l.bottom) / 2 <= box.y2);
}

/** Operator names a display sets upright, which are no words of prose. */
const OPERATOR_NAMES = new Set("arg argmax argmin cos cosh cot coth csc deg det diag dim exp gcd hom inf ker lcm lg lim liminf limsup ln log max min mod pr sec sgn sign sin sinh sup tan tanh tr var cov".split(" "));

export type CropScores = { crops: number; prose: number; score: number | null; found: { page: number; text: string }[] };

/** Prose in a display's crop: a crop (a display the check failed, shown as
    its picture) holding a line of the paragraph, one that starts where the
    paragraph's lines do (at its column's edge, or a first line's indent of
    25 pt at most, where a display stands apart, centered) with three words
    of two letters or more, two of them of three letters or more and not in
    capitals, operator names aside ("For any 𝒮m ⊆ 𝒮̂, define 𝒰 = … and";
    not "hR(a) = da + 1 − a mod e and HSR(z)"): the words are a picture.
    The score is the share of the candidate's crops that hold none. */
export function cropScores(pdf: PdfText, cand: Flat): CropScores {
  let crops = 0;
  let prose = 0;
  const found: CropScores["found"] = [];
  for (const block of cand.blocks) {
    if (block.kind !== "figure" || block.mathImage === undefined || !block.at) continue;
    const box = boxOf(pdf, block.at);
    if (!box) continue;
    crops++;
    const line = linesIn(pdf, box).find((l) => {
      const words = (l.text.match(/\p{L}{2,}/gu) ?? []).filter((w) => !OPERATOR_NAMES.has(w.toLowerCase()));
      const long = words.filter((w) => w.length >= 3 && w !== w.toUpperCase());
      const edge = columnEdge(pdf, l, l.right - l.left, new Set([l]));
      return words.length >= 3 && long.length >= 2 && edge !== null && l.left - edge >= -3 && l.left - edge <= 25;
    });
    if (!line) continue;
    prose++;
    found.push({ page: line.page, text: line.text });
  }
  return { crops, prose, score: crops > 0 ? 1 - prose / crops : null, found };
}

export type FigureScores = { figures: number; split: number; score: number | null; found: { page: number; text: string }[] };

/** A caption's label and number: "Figure 3.", "Fig. 2:", "Table IV", "Abbildung 1.4:", "Abb. 2", "Tabelle 1", "図表Ⅰ-2-1-3", "表 1". */
const CAPTION_LABEL_RE = /^\s*(?:fig(?:ure)?\.?|table|tab\.|scheme|chart|exhibit|plate|abbildung|abb\.|tabelle|図表?|表)\s*[\dIVXLivxlⅠ-Ⅻ]/iu;

/** A figure in two pieces: two of the candidate's figures on one page, one
    over the other with no line of the page between them, sharing most of
    their width, only one of them with a caption ("Figure 1." …; the other
    a display's crop, or a picture whose caption is its own labels): a
    drawing's top read apart from the captioned rest, which the page editor
    draws as two pictures, on two pages at times. The score is the share of
    the candidate's figures that are no such piece. */
export function figureScores(pdf: PdfText, cand: Flat): FigureScores {
  const figures = cand.blocks.flatMap((block) => (block.kind === "figure" && block.at ? [{ block, box: boxOf(pdf, block.at) }] : [])).filter((f) => f.box !== null);
  const captioned = (b: DocBlock) => b.kind === "figure" && b.mathImage === undefined && CAPTION_LABEL_RE.test((b.caption ?? []).map((s) => s.text).join(""));
  const pieces = new Set<number>();
  const found: FigureScores["found"] = [];
  figures.forEach((a, i) => {
    figures.forEach((b, j) => {
      if (i === j || !a.box || !b.box || a.box.page !== b.box.page || a.box.y1 > b.box.y1) return;
      const gap = b.box.y1 - a.box.y2;
      const shared = Math.min(a.box.x2, b.box.x2) - Math.max(a.box.x1, b.box.x1);
      if (gap < -6 || gap > 12 || shared < 0.5 * Math.min(a.box.x2 - a.box.x1, b.box.x2 - b.box.x1)) return;
      if (captioned(a.block) === captioned(b.block)) return;
      const between = pdf.lines.some((l) => l.page === a.box?.page && l.top >= (a.box?.y2 ?? 0) && l.bottom <= (b.box?.y1 ?? 0) && Math.min(l.right, a.box?.x2 ?? 0) > Math.max(l.left, a.box?.x1 ?? 0));
      if (between) return;
      pieces.add(i).add(j);
      const whole = captioned(a.block) ? a.block : b.block;
      found.push({ page: a.box.page, text: whole.kind === "figure" ? (whole.caption ?? []).map((span) => span.text).join("").slice(0, 80) : "" });
    });
  });
  return { figures: figures.length, split: pieces.size, score: figures.length > 0 ? 1 - pieces.size / figures.length : null, found };
}

// ── The body's face ─────────────────────────────────────────────────────────

/** A font's subset prefix: six capitals ("HAAAAA+", the standard's tag) or
    six hex digits (asciidoctor-pdf's "6ec323+"; parse bench finding: a
    Chinese book set in one CJK face subset per page counted each subset as a
    family of its own, and its code font, one subset, as the body's face). */
export const SUBSET_PREFIX_RE = /^(?:[A-Z]{6}|[0-9a-f]{6})\+/;

/** A face's shape by its name, as a reader tells it: a typewriter face, a
    sans-serif face, else a serif face, by the families a PDF names (a subset
    prefix and a style suffix aside); null for a name none of these tell (a
    symbol font, a face with a trade name only). TeX's own: CMR/ECRM/SFRM and
    Latin Modern Roman serif, CMSS/ECSS/SFSS sans, CMTT/ECTT/SFTT mono. */
export function faceShape(name: string): "serif" | "sans" | "mono" | null {
  const n = name.replace(SUBSET_PREFIX_RE, "").toLowerCase();
  if (/mono|courier|consol|menlo|inconsolata|typewriter|lucidaconsole|andale|sourcecode|firacode|^(?:cm|ec|sf|lm)tt|nimbusmon|txtt|beramono|cursor/.test(n)) return "mono";
  if (/sans|arial|helvetica|verdana|tahoma|calibri|segoe|frutiger|myriad|gill|futura|univers|roboto|lato|avenir|biolinum|^(?:cm|ec|sf|lm)ss|arimo|carlito|trebuchet|franklin|gothic|meiryo|swiss|optima|montserrat|poppins|raleway|ubuntu|cantarell|heros|avantgarde|candara|corbel|klavika|akzidenz|hei|yahei|dengxian|malgun|dotum|gulim/.test(n)) return "sans";
  if (/serif|times|roman|minion|garamond|palatino|palladio|pagella|georgia|cambria|libertin|charis|utopia|baskerville|caslon|bookman|century|antiqua|^(?:cm|ec|sf)(?:r|bx|ti|sl|csc|cc|rm|u|b)\d|^lmroman|nimbusrom|termes|stix|tinos|caladea|mincho|song|ming|batang|sabon|janson|bembo|plantin|joanna|scala|lucidabright|newton|charter|fourier|dutch|constantia|goudy|didot|bodoni|cochin|hoefler|baskervville|spectral|merriweather|crimson|noto ?serif|source ?serif/.test(n)) return "serif";
  return null;
}

export type FaceTally = { shape: "serif" | "sans" | "mono" | null; family: string; chars: number };
const faceMemo = new Map<string, FaceTally | null>();

/** The face that sets most of a PDF's characters on its pages (pdftohtml's
    fonts, by family), with its shape: the body's own face. */
export function bodyFace(path: string, pages: [number, number] | undefined): FaceTally | null {
  const key = `${path}|${pages?.join("-") ?? ""}`;
  if (faceMemo.has(key)) return faceMemo.get(key) ?? null;
  const range = pages ? ["-f", String(pages[0]), "-l", String(pages[1])] : [];
  let xml = "";
  try {
    xml = execFileSync("pdftohtml", ["-xml", "-i", "-stdout", "-q", "-zoom", "1", ...range, path], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    xml = "";
  }
  const families = new Map<string, string>();
  for (const m of xml.matchAll(/<fontspec id="(\d+)"[^>]*family="([^"]*)"/g)) families.set(m[1], m[2].replace(SUBSET_PREFIX_RE, ""));
  const chars = new Map<string, number>();
  for (const m of xml.matchAll(/<text [^>]*font="(\d+)"[^>]*>([\s\S]*?)<\/text>/g)) {
    const family = families.get(m[1]);
    if (!family) continue;
    const text = m[2].replace(/<[^>]+>/g, "").replace(/&[a-z]+;|&#\d+;/g, "x").replace(/\s+/g, "");
    chars.set(family, (chars.get(family) ?? 0) + text.length);
  }
  const [family, count] = [...chars].sort((a, b) => b[1] - a[1])[0] ?? ["", 0];
  const out = count > 0 ? { family, chars: count, shape: faceShape(family) } : null;
  if (faceMemo.size > 200) faceMemo.clear();
  faceMemo.set(key, out);
  return out;
}

// ── Page labels ─────────────────────────────────────────────────────────────

/** A page label's place in its series: an arabic or a roman number with the
    words around it ("A-3", "xii"); null for a label that counts nothing. */
function labelValue(label: string): { series: string; n: number } | null {
  const arabic = /^(.*?)(\d{1,5})(\D*)$/.exec(label.trim());
  if (arabic) return { series: `${arabic[1]}#${arabic[3]}`, n: Number(arabic[2]) };
  const roman = /^(?=[ivxlcdm]+$)m{0,3}(cm|cd|d?c{0,3})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})$/i.exec(label.trim());
  if (!roman || !label.trim()) return null;
  const value: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };
  const s = label.trim().toLowerCase();
  let n = 0;
  for (let k = 0; k < s.length; k++) n += value[s[k]] < (value[s[k + 1]] ?? 0) ? -value[s[k]] : value[s[k]];
  return { series: `roman ${label.trim() === s ? "lower" : "upper"}`, n };
}

export type LabelScores = { pairs: number; wrong: number; score: number | null; found: { page: number; labels: string }[] };

/** Page labels in order: the page editor draws each page's label in the
    margin ("p. 7"; the PDF's own label, nothing for an empty one, the
    page's number past the labels: page-start.ts), so two pages one after
    the other must count on in their series: a label that repeats or runs
    backwards (a scan's unnamed pages given their PDF numbers among named
    ones: 1, 3, 2, 3) is wrong. A page drawn with no label pairs with none.
    The scored pages are judged with a page on each side. A slide deck
    (`deck`: every page wider than tall) labels its pages by frame, and a
    frame of several overlay steps repeats its label on each (beamer's
    alerts frame, 6, 6, 6): a repeat in a deck is the PDF's own, and only a
    label that runs backwards is wrong. */
export function labelScores(labels: string[] | undefined, pageCount: number, pages: [number, number] | undefined, deck = false): LabelScores {
  if (!labels || labels.length === 0) return { pairs: 0, wrong: 0, score: null, found: [] };
  const name = (p: number) => labels[p - 1] ?? String(p);
  const [from, to] = pages ? [Math.max(1, pages[0] - 1), Math.min(pageCount, pages[1] + 1)] : [1, pageCount];
  let pairs = 0;
  let wrong = 0;
  const found: LabelScores["found"] = [];
  for (let p = from; p < to; p++) {
    const [a, b] = [labelValue(name(p)), labelValue(name(p + 1))];
    if (!a || !b || a.series !== b.series) continue;
    pairs++;
    if (b.n > a.n || (deck && b.n === a.n)) continue;
    wrong++;
    found.push({ page: p + 1, labels: `${name(p)} → ${name(p + 1)}` });
  }
  return { pairs, wrong, score: pairs > 0 ? 1 - wrong / pairs : null, found };
}

/** The page's ink as poppler draws it (paint.ts): the bands of rows in a box, and the rightmost ink in one. */
export type PageInk = { bands: (page: number, box: Rect) => InkBand[]; right: (page: number, box: Rect) => number | null };

// ── The Title's marks ───────────────────────────────────────────────────────

export type TitleMarks = { marks: number; wrong: number; score: number | null; found: { text: string }[] };

/** A note mark the page does not print on its title: a candidate's Title
    that carries a footnote mark (the page editor draws its number) where the
    page's title lines (linesOfUnits) print none after the title's words (a
    raised number, "∗", "†", …). A note the page prints with no mark (a first
    page's "Mathematics Subject Classification") keeps none on the Title. The
    score is the share of the candidate's marked titles whose mark the page
    prints. */
export function titleMarks(pdf: PdfText, cand: Flat, placed: number[][]): TitleMarks {
  let marks = 0;
  let wrong = 0;
  const found: TitleMarks["found"] = [];
  const SYMBOLS = /[*∗†‡§¶⋆✉#]/u;
  cand.blocks.forEach((block, b) => {
    if (block.kind !== "title") return;
    for (const u of cand.unitsOf[b]) {
      const unit = cand.units[u];
      if (unit.marks.length === 0) continue;
      const lines = placed[u].map((i) => pdf.lines[i]);
      if (lines.length === 0) continue;
      marks++;
      const own = cand.toks.slice(unit.first, unit.end).filter((t) => !t.note);
      const left = new Map<string, number>();
      for (const t of own) left.set(t.w, (left.get(t.w) ?? 0) + 1);
      const take = (w: string) => {
        const n = left.get(w) ?? 0;
        if (n <= 0) return false;
        left.set(w, n - 1);
        return true;
      };
      const printed = lines.map((l) => l.text).join(" ");
      const textOwn = own.map((t) => unit.text.slice(t.start, t.end)).join(" ");
      const marked =
        [...printed].some((ch) => SYMBOLS.test(ch) && !textOwn.includes(ch)) ||
        wordsOf(printed).some((w) => {
          if (take(w.w)) return false;
          const glued = /^(.*?\D)(\d{1,2})$/u.exec(w.w);
          return /^\d{1,2}$/.test(w.w) || (glued !== null && take(glued[1]));
        });
      if (marked) continue;
      wrong++;
      found.push({ text: unit.text.slice(0, 80) });
    }
  });
  return { marks, wrong, score: marks > 0 ? 1 - wrong / marks : null, found };
}

// ── A block's space after ───────────────────────────────────────────────────

export type FarSpace = { blocks: number; wrong: number; score: number | null; found: { page: number; space: number; shown: number | null; text: string }[] };

/** Space after a block over 48 pt with no block following closely: a
    paragraph or a list the candidate gives 48 pt or more of space under it,
    unless the page leaves that blank (within a quarter of the larger, 12
    pt at least) under its last line, in its column, down to the
    candidate's next block (its first line, or the crop of a figure).
    Measured to a block far down the column (past a figure the candidate
    lost, across a sidebar, to the notes at the page's foot), the space is a
    blank half a page tall in the page editor. The page's ink (poppler's
    drawing: words, a picture, a rule) tells where something follows. The
    score is the share of such blocks whose space the page leaves. */
export function farSpace(pdf: PdfText, ink: PageInk, cand: Flat, placed: number[][]): FarSpace {
  let blocks = 0;
  let wrong = 0;
  const found: FarSpace["found"] = [];
  cand.blocks.forEach((block, b) => {
    if ((block.kind !== "paragraph" && block.kind !== "list") || (block.spaceAfter ?? 0) < 48) return;
    const lines = cand.unitsOf[b].flatMap((u) => placed[u]).map((i) => pdf.lines[i]);
    const last = lastLine(pdf, cand, b, lines);
    if (!last) return;
    const size = pdf.sizes.get(last.page);
    if (!size) return;
    const mine = [last, ...lines.filter((l) => l.page === last.page && Math.abs(l.bottom - last.bottom) < 200)];
    const box = { x1: Math.max(0, Math.min(...mine.map((l) => l.left)) - 2), x2: Math.min(size.width, Math.max(...mine.map((l) => l.right)) + 2), y1: last.bottom + 1, y2: size.height };
    if (box.y2 - box.y1 < 4) return;
    blocks++;
    const next = ink.bands(last.page, box).find((band) => band.bottom - band.top >= 0.5);
    const space = block.spaceAfter ?? 0;
    const shown = next ? next.top - last.bottom : null;
    // The blank is the page's own where the candidate's next block starts right under it (a title page's gap):
    // its first line at the next ink, or a figure whose crop holds the next ink's top.
    const after = cand.blocks.findIndex((x, k) => k > b && (x.at !== undefined || cand.unitsOf[k].some((u) => placed[u].length > 0)));
    const crop = after >= 0 && cand.blocks[after].at ? boxOf(pdf, cand.blocks[after].at) : null;
    const first = after >= 0 && !crop ? cand.unitsOf[after].flatMap((u) => placed[u]).map((i) => pdf.lines[i])[0] : undefined;
    const follows =
      next !== undefined &&
      (crop ? crop.page === last.page && crop.y1 <= next.top + 3 && crop.y2 >= next.top : first !== undefined && first.page === last.page && first.top >= next.top - 3 && first.top <= next.bottom + 3);
    if (shown !== null && follows && Math.abs(shown - space) <= Math.max(12, 0.25 * Math.max(space, shown))) return;
    wrong++;
    found.push({ page: last.page, space: Math.round(space), shown: shown === null ? null : Math.round(shown), text: cand.units[cand.unitsOf[b][0]].text.slice(0, 80) });
  });
  return { blocks, wrong, score: blocks > 0 ? 1 - wrong / blocks : null, found };
}

/** A block's last line on the page: of the page's lines that hold the
    block's last three words, the one with the fewest words the block does
    not hold, on a page its other lines stand on where one does (a running
    foot repeats a masthead's words; a line on another page repeats a
    common phrase). */
function lastLine(pdf: PdfText, cand: Flat, b: number, placed: Line[]): Line | null {
  const words = cand.unitsOf[b].flatMap((u) => cand.toks.slice(cand.units[u].first, cand.units[u].end).map((t) => t.w));
  const tail = words.slice(-3);
  if (tail.length === 0) return null;
  const own = new Set(words);
  const pages = new Set(placed.map((l) => l.page));
  let best: Line | null = null;
  let bestKey = Infinity;
  for (const l of pdf.lines) {
    const lw = wordsOf(l.text).map((w) => w.w);
    let at = -1;
    for (let k = 0; k + tail.length <= lw.length && at < 0; k++) if (tail.every((w, j) => lw[k + j] === w)) at = k;
    if (at < 0) continue;
    const key = lw.filter((w) => !own.has(w)).length + (pages.size === 0 || pages.has(l.page) ? 0 : 1000);
    if (key < bestKey) [best, bestKey] = [l, key];
  }
  return best;
}

// ── A run-in head's indent ──────────────────────────────────────────────────

export type RunInIndents = { heads: number; wrong: number; score: number | null; found: { page: number; set: number; drawn: number; text: string }[] };

/** A run-in head's indent: a run-in heading (a paragraph's bold lead,
    "3.2.1. Two examples.") stands where the page starts its line, its
    column's edge plus the paragraph's first-line indent (amsbook sets it
    18 pt in), and the candidate sets it at its own indent (runIn). Right
    within 2 pt or a quarter. The score is the share of the run-in heads
    judged that stand at the page's indent. */
export function runInIndents(pdf: PdfText, cand: Flat, placed: number[][]): RunInIndents {
  let heads = 0;
  let wrong = 0;
  const found: RunInIndents["found"] = [];
  cand.blocks.forEach((block, b) => {
    if (block.kind !== "heading" || !block.runIn) return;
    const u = cand.unitsOf[b][0];
    const line = u === undefined ? undefined : pdf.lines[placed[u][0]];
    if (!line) return;
    const words = cand.toks.slice(cand.units[u].first, cand.units[u].end).map((t) => t.w);
    if (!wordsOf(line.text).map((w) => w.w).join(" ").startsWith(words.slice(0, 3).join(" "))) return;
    const edge = columnEdge(pdf, line, line.right - line.left, new Set([line]));
    if (edge === null || line.left < edge - 2) return;
    heads++;
    const set = line.left - edge;
    if (Math.abs(block.runIn.indent - set) <= Math.max(2, 0.25 * set)) return;
    wrong++;
    found.push({ page: line.page, set: Math.round(set * 10) / 10, drawn: block.runIn.indent, text: cand.units[u].text.slice(0, 60) });
  });
  return { heads, wrong, score: heads > 0 ? 1 - wrong / heads : null, found };
}

// ── The end-of-proof box ────────────────────────────────────────────────────

export type ProofBoxes = { boxes: number; wrong: number; score: number | null; found: { page: number; text: string }[] };

/** A box that ends a proof (□ ∎ ■, a formula \square, \Box, \blacksquare, \qed). */
const BOX_CHAR_RE = /[□∎■◻▪]\s*$/u;
const BOX_LATEX_RE = /^\s*\\(?:square|Box|blacksquare|qed|qedsymbol|openbox)\s*$/;

/** The end-of-proof box's place: where the page sets a proof's closing box
    at its column's right edge (amsthm's \qed, drawn as a glyph or as rules),
    a clear gap after the line's last word, the candidate sets it there: a
    tab right before the box (to a right tab stop at the column's edge). A
    box set right after the last word by the candidate draws there. The
    page's box: its word on the line (pdftotext), else its ink (poppler's
    drawing). The score is the share of such boxes the candidate sets at
    the right edge. */
export function proofBoxes(pdf: PdfText, ink: PageInk, cand: Flat, placed: number[][]): ProofBoxes {
  let boxes = 0;
  let wrong = 0;
  const found: ProofBoxes["found"] = [];
  const boxAt = (u: number): number | null => {
    const unit = cand.units[u];
    const text = unit.text.replace(/\s+$/, "");
    if (BOX_CHAR_RE.test(text)) return text.length - 1;
    const last = cand.math.filter((m) => m.unit === u && !m.display).at(-1);
    return last && last.latex !== undefined && BOX_LATEX_RE.test(last.latex) && (last.to ?? 0) >= text.length && last.from !== undefined ? last.from : null;
  };
  cand.blocks.forEach((block, b) => {
    if (block.kind !== "paragraph" && block.kind !== "list") return;
    const u = cand.unitsOf[b].at(-1);
    if (u === undefined) return;
    const at = boxAt(u);
    if (at === null) return;
    const lines = cand.unitsOf[b].flatMap((x) => placed[x]).map((i) => pdf.lines[i]);
    const last = lastLine(pdf, cand, b, lines);
    if (!last) return;
    // The column's right edge: the right end most of the page's lines in this column reach.
    const column = pdf.lines.filter((l) => l.page === last.page && Math.abs(l.left - Math.min(last.left, ...lines.map((x) => x.left))) <= 3);
    const right = Math.max(last.right, ...column.map((l) => l.right));
    const words = (last.words ?? []).filter((w) => /[\p{L}\p{N}]/u.test(w.text));
    const wordsEnd = words.at(-1)?.right ?? last.right;
    const boxWord = (last.words ?? []).find((w) => BOX_CHAR_RE.test(w.text) && w.left > wordsEnd);
    const boxRight = boxWord ? boxWord.right : ink.right(last.page, { x1: wordsEnd + 2, x2: right + 6, y1: last.top, y2: last.bottom });
    if (boxRight === null || boxRight < right - 3 || boxRight - wordsEnd < 12) return;
    boxes++;
    const unit = cand.units[u];
    if (/\t\s*$/.test(unit.text.slice(0, at)) || (block.kind === "paragraph" && block.align === "right" && unit.text.trim().length <= 2)) return;
    wrong++;
    found.push({ page: last.page, text: unit.text.slice(Math.max(0, at - 50), at + 1) });
  });
  return { boxes, wrong, score: boxes > 0 ? 1 - wrong / boxes : null, found };
}

// ── A grid of numbers read as prose ─────────────────────────────────────────

export type GridProse = { grids: number; prose: number; score: number | null; found: { page: number; text: string }[] };

/** A number as a table's cell prints it: "120", "0.25", ".922", "1,024", "(565)", "−3", "-3", "12%", "$ 5". */
const NUMBER_RE = /^[-−–+($]?\.?\d[\d,.]*\)?%?$/u;

/** Grids of numbers the candidate reads as prose: three rows of the page or
    more, one under the next, each split by wide gaps (6 pt or more between
    two words, 4 pt between two numbers) into cells, two side by side and
    half of all or more numbers, the number cells ending at the same places
    (within 3 pt, two columns or more): a table set without rules (a
    factorial's values beside n). The candidate's reading of a grid: the
    longest run of its words (in reading order, across units) that repeats
    the grid's words row by row, half of them or more; the grid is read as
    prose when most of that run stands in paragraphs or list items, not in
    a table's cells or a code listing (a program's printed array keeps its
    rows and columns there: ThinkDSP's matrices). A grid whose words the candidate holds in no such run
    is not judged. The score is the share of the page's grids read as a
    table. */
export function gridProse(pdf: PdfText, cand: Flat): GridProse {
  // The candidate's word pairs, each at the places it starts.
  let pairs: Map<string, number[]> | null = null;
  const pairsOf = () => {
    if (pairs) return pairs;
    pairs = new Map();
    for (let t = 0; t + 1 < cand.toks.length; t++) {
      const key = `${cand.toks[t].w} ${cand.toks[t + 1].w}`;
      const list = pairs.get(key);
      if (!list) pairs.set(key, [t]);
      else if (list.length < 2000) list.push(t);
    }
    return pairs;
  };
  // The longest run of the candidate's words that repeats a stretch of `words`: its start and length.
  const longest = (words: string[]) => {
    let best = { at: -1, length: 0 };
    for (let j = 0; j + 1 < words.length; j++) {
      for (const t of pairsOf().get(`${words[j]} ${words[j + 1]}`) ?? []) {
        let n = 2;
        while (j + n < words.length && t + n < cand.toks.length && cand.toks[t + n].w === words[j + n]) n++;
        if (n > best.length) best = { at: t, length: n };
      }
    }
    return best;
  };
  let grids = 0;
  let prose = 0;
  const found: GridProse["found"] = [];
  const pages = [...new Set(pdf.lines.map((l) => l.page))];
  for (const page of pages) {
    const rows = rowsOf(pdf.lines.filter((l) => l.page === page));
    // A row's cells: its words split where the gap passes 6 pt, or 4 pt between two numbers (a column
    // of numbers set a little over a word space apart).
    const cellsOf = (row: Line[]) => {
      const words = row.flatMap((l) => l.words ?? []).sort((a, c) => a.left - c.left);
      const cells: { right: number; text: string[] }[] = [];
      words.forEach((w, k) => {
        const gap = k === 0 ? Infinity : w.left - words[k - 1].right;
        if (gap >= 6 || (gap >= 4 && NUMBER_RE.test(w.text) && NUMBER_RE.test(words[k - 1].text))) cells.push({ right: w.right, text: [w.text] });
        else Object.assign(cells[cells.length - 1], { right: w.right, text: [...cells[cells.length - 1].text, w.text] });
      });
      return cells;
    };
    const numeric = rows.map((row) => {
      const cells = cellsOf(row);
      const isNumber = cells.map((c) => c.text.every((t) => NUMBER_RE.test(t)));
      const numbers = cells.filter((_, k) => isNumber[k]);
      const sideBySide = isNumber.some((x, k) => x && isNumber[k + 1]);
      return { row, cells, ends: numbers.map((c) => c.right), ok: sideBySide && numbers.length * 2 >= cells.length };
    });
    for (let k = 0; k < numeric.length; ) {
      let j = k;
      while (j < numeric.length && numeric[j].ok && (j === k || numeric[j].row[0].top - numeric[j - 1].row[0].top <= 3 * (numeric[j - 1].row[0].bottom - numeric[j - 1].row[0].top))) j++;
      const run = numeric.slice(k, j);
      k = Math.max(j, k + 1);
      if (run.length < 3) continue;
      // Two columns or more whose number cells end at one place in three rows or more.
      const ends = run.flatMap((r) => r.ends);
      const columns = new Set(ends.filter((e) => run.filter((r) => r.ends.some((x) => Math.abs(x - e) <= 3)).length >= 3).map((e) => Math.round(e / 6)));
      if (columns.size < 2) continue;
      const words = run.flatMap((r) => r.cells.flatMap((c) => wordsOf(c.text.join(" ")).map((w) => w.w)));
      const reading = longest(words);
      if (reading.length * 2 < words.length) continue;
      grids++;
      const kinds = cand.toks.slice(reading.at, reading.at + reading.length).map((t) => cand.blocks[cand.units[t.unit].block].kind);
      if (kinds.filter((kind) => kind !== "table" && kind !== "code").length * 2 <= kinds.length) continue;
      prose++;
      found.push({ page, text: run.map((r) => r.row.map((l) => l.text).join("  ")).join(" | ").slice(0, 120) });
    }
  }
  return { grids, prose, score: grids > 0 ? 1 - prose / grids : null, found };
}

// ── The checks together ─────────────────────────────────────────────────────

type Shape = "serif" | "sans" | "mono";

export type FaceCheck = { family: string | null; want: Shape | null; drawn: Shape | null; score: number | null };

export type LayoutScores = {
  columns: ColumnScores;
  indents: IndentScores;
  tables: TableProse;
  figures: FigureScores;
  crops: CropScores;
  labels: LabelScores;
  face: FaceCheck;
  pictures: PictureScores;
  captions: CaptionScores;
  overlaps: CropOverlaps;
  sides: CaptionSides;
  marks: TitleMarks;
  spaces: FarSpace;
  grids: GridProse;
  runIns: RunInIndents;
  proofs: ProofBoxes;
  /** The reference-free composite's parts (free.ts): reading order across columns; the page's structure (no
      prose in a table's cells or a crop, no figure in pieces, every picture in a figure, every caption with its
      figure or table and on its table's side, no crops over each other, no mark on the Title the page lacks,
      no grid of numbers read as prose); the page's look the parse reads (indents, the body's face, page
      labels, the space under a block, a run-in head's indent, the end-of-proof box at the right edge). */
  order: number | null;
  structure: number | null;
  layout: number | null;
};

const meanOf = (list: (number | null)[]) => {
  const known = list.filter((x): x is number => x !== null);
  return known.length > 0 ? known.reduce((a, b) => a + b, 0) / known.length : null;
};

/** The checks against the page's lines and fonts for one candidate:
    `drawn`, the shape of the face it draws its body in; `face`, the PDF's
    body face (bodyFace); `labels`, its page labels judged (labelScores);
    `pictures`, the pictures the pages show (floats.ts contentImages);
    `ink`, the page's ink (paint.ts). */
export function layoutScores(pdf: PdfText, cand: Flat, placed: number[][], input: { drawn?: Shape; face: FaceTally | null; labels: LabelScores; pictures: Picture[]; ink: PageInk }): LayoutScores {
  const columns = columnScores(pdf, cand, placed);
  const indents = indentScores(pdf, cand, placed);
  const tables = tableScores(cand, placed);
  const figures = figureScores(pdf, cand);
  const crops = cropScores(pdf, cand);
  const pictures = pictureScores(pdf, cand, input.pictures);
  const captions = captionScores(cand);
  const overlaps = cropOverlaps(pdf, cand);
  const sides = captionSides(pdf, cand, placed);
  const marks = titleMarks(pdf, cand, placed);
  const spaces = farSpace(pdf, input.ink, cand, placed);
  const grids = gridProse(pdf, cand);
  const runIns = runInIndents(pdf, cand, placed);
  const proofs = proofBoxes(pdf, input.ink, cand, placed);
  const want = input.face?.shape ?? null;
  const drawn = input.drawn ?? null;
  const face: FaceCheck = { family: input.face?.family ?? null, want, drawn, score: want && drawn ? (want === drawn ? 1 : 0) : null };
  return {
    columns,
    indents,
    tables,
    figures,
    crops,
    labels: input.labels,
    face,
    pictures,
    captions,
    overlaps,
    sides,
    marks,
    spaces,
    grids,
    runIns,
    proofs,
    order: columns.score,
    structure: meanOf([tables.score, figures.score, crops.score, pictures.score, captions.score, overlaps.score, sides.score, marks.score, grids.score]),
    layout: meanOf([indents.score, face.score, input.labels.score, spaces.score, runIns.score, proofs.score]),
  };
}
