import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { figureCropSize } from "@/lib/figure-crop";
import { attr, child, descendants, parseXmlPart, unzipOffice } from "@/lib/parse/office";
import { regionBounds } from "@/lib/video/types";
import type { RichNode } from "@/lib/docs/schema";
import type { Doc, DocBlock, Side } from "./adapt";
import { brokenNumbers, checklistWraps, displayGaps, markerPlaces, rowHeights } from "./drawn";
import type { GlyphScores } from "./glyphs";
import type { LayoutScores } from "./layout";
import { inkBands, type PagePaint } from "./paint";
import { ROOT } from "./load";
import { mathLeaves } from "./math";
import { FREE_WEIGHTS, furnitureMatches, type Flat, type MathItem } from "./metrics";
import { garblesOf, normText, PAGE_NUMBER_RE, pageNumberOf, wordsOf } from "./text";

// Checks that need no reference: the PDF's own text (pdftotext) against the
// candidate's words, and detectors for what should never be in a parse.

/** A line of the page: its box, its text, and its words' boxes (pdftotext -tsv). */
type Line = { page: number; top: number; bottom: number; left: number; right: number; text: string; words?: { left: number; right: number; text: string }[] };

/** A word pdftotext reads with a symbol font's characters in it, as it
    reads it and as the page draws it, on its line (layoutOf, symbolChars). */
type SymbolWord = { page: number; word: string; reads: string; line: Line };

/** The PDF's text by pdftotext: each page's lines in content order (-raw:
    the words to cover), each line with its place (-tsv) with the furniture
    lines among them (layoutOf), and the words it reads out of symbol fonts. */
export type PdfText = {
  first: number;
  pages: number;
  raw: string[][];
  lines: Line[];
  furniture: Line[];
  sizes: Map<number, { width: number; height: number }>;
  symbols: SymbolWord[];
  /** The text pdftotext cannot read, which pdf.js reads (blindText): words to cover. */
  blind?: { page: number; text: string }[];
};

function run(args: string[]): string {
  return execFileSync("pdftotext", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
}

const keyOf = (text: string) => normText(text).replace(/\d+/g, "#");
/** A line's letters and its words of four letters or more, read once per text (a book's heads repeat). */
const readings = new Map<string, { letters: string; words: string[] }>();
function readingOf(text: string): { letters: string; words: string[] } {
  let hit = readings.get(text);
  if (!hit) {
    const norm = normText(text);
    if (readings.size > 50_000) readings.clear();
    readings.set(text, (hit = { letters: norm.replace(/[^\p{L}]/gu, ""), words: norm.split(/[^\p{L}]+/u).filter((w) => w.length >= 4) }));
  }
  return hit;
}
const lettersOf = (text: string) => readingOf(text).letters;
/** A caption's label opening a line ("図表Ⅰ-2-1-3", "Figure 4", "TABLE II"):
    a report sets every chart's caption at one height, so the label repeats
    with its number changed, but it is the figure's, never the page's. */
const CAPTION_LABEL_RE = /^\s*(?:図表|図|表|fig(?:ure)?\.?|table)\s*[\dⅠ-Ⅻivxlc]/iu;
const CJK_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
/** A line's length in words, a CJK character a quarter word (wordsOf makes
    each a word, so a chart's label "インターネット利用率" read as ten words). */
function labelWords(text: string): number {
  const words = wordsOf(text);
  const cjk = words.filter((w) => CJK_RE.test(w.w)).length;
  return words.length - cjk + cjk / 4;
}
/** A math letter (Unicode's math alphanumerics, Greek) twice in a row: the
    text layer of Word's Cambria Math reads each such glyph twice, where the
    parse reads it once (the NPS thesis's "𝑝𝑝00"). */
const DOUBLED_RE = /([\u{1D400}-\u{1D7FF}\p{Script=Greek}])\1/gu;
/** A long table's foot on each page it breaks at (LaTeX's longtable, Word). */
const CONTINUED_RE = /^\(?continued (?:on (?:the )?next page|overleaf)\)?\.?$/i;

type Layout = { lines: Line[]; furniture: Line[]; sizes: Map<number, { width: number; height: number }>; symbols: SymbolWord[] };
type Sizes = Layout["sizes"];

/** Fonts that draw symbols at the codes of letters: pdftotext reads a code
    as its letter where the font maps none (Wingdings' "u" for ◆, ZapfDingbats'
    "4" for ✔, MarVoSym's "B" for ✉, Advent's math symbols' "ð" and "Þ" for
    the parentheses and "0" for the prime) or as a private-use character
    U+F000 past it (Symbol's U+F061 for α). */
const SYMBOL_FONT_RE = /^(?:Symbol(?:MT)?|StandardSym(?:L|bolsPS)|Wingdings(?:-Regular)?|(?:ITC)?(?:Zapf)?Dingbats|MarVoSym|AdvMacMthSy\w*)$/i;
/** Adobe Symbol's letters: its codes of A–Z and a–z draw Greek. */
const SYMBOL_GREEK: Record<string, string> = Object.fromEntries(
  [..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"].map((ch, i) => [ch, [..."ΑΒΧΔΕΦΓΗΙϑΚΛΜΝΟΠΘΡΣΤΥςΩΞΨΖαβχδεφγηιϕκλμνοπθρστυϖωξψζ"][i]]),
);

/** A character pdftotext reads in a symbol font, as the page draws it where
    that is a letter (Symbol's Greek), else nothing: the other fonts draw no
    letters or digits, and a symbol is no word. */
function symbolDrawn(ch: string, symbol: boolean): string {
  const cp = ch.codePointAt(0) ?? 0;
  const code = cp >= 0xf020 && cp <= 0xf0ff ? String.fromCharCode(cp - 0xf000) : ch;
  if (symbol) return SYMBOL_GREEK[code] ?? (cp >= 0xf020 && cp <= 0xf0ff ? "" : ch);
  return /[\p{L}\p{N}\uE000-\uF8FF]/u.test(ch) ? "" : ch;
}

/** The characters pdftotext reads in symbol fonts, with their place
    (pdftohtml's runs, each split evenly among its characters), by page;
    none where pdffonts finds no symbol font. */
function symbolChars(pdf: string): Map<number, { x: number; top: number; bottom: number; ch: string; symbol: boolean }[]> {
  const out = new Map<number, { x: number; top: number; bottom: number; ch: string; symbol: boolean }[]>();
  const tool = (name: string, args: string[]) => {
    try {
      return execFileSync(name, args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
    } catch {
      return "";
    }
  };
  const named = tool("pdffonts", [pdf])
    .split("\n")
    .slice(2)
    .some((line) => SYMBOL_FONT_RE.test((line.split(/\s+/)[0] ?? "").replace(/^[A-Z]{6}\+/, "")));
  if (!named) return out;
  const xml = tool("pdftohtml", ["-xml", "-i", "-stdout", "-q", "-zoom", "1", "-fontfullname", pdf]);
  const fonts = new Map<string, boolean>();
  for (const m of xml.matchAll(/<fontspec id="(\d+)"[^>]*family="([^"]*)"/g)) {
    const family = m[2].replace(/^[A-Z]{6}\+/, "");
    if (SYMBOL_FONT_RE.test(family)) fonts.set(m[1], /^(?:Symbol|StandardSym)/i.test(family));
  }
  if (fonts.size === 0) return out;
  const unescape = (t: string) =>
    t
      .replace(/<[^>]+>/g, "")
      .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, "&");
  for (const part of xml.split(/<page number="/).slice(1)) {
    const page = Number(/^(\d+)/.exec(part)?.[1]);
    for (const m of part.matchAll(/<text top="([\d.-]+)" left="([\d.-]+)" width="([\d.-]+)" height="([\d.-]+)" font="(\d+)"[^>]*>([\s\S]*?)<\/text>/g)) {
      const symbol = fonts.get(m[5]);
      if (symbol === undefined) continue;
      const [top, left, width, height] = [1, 2, 3, 4].map((i) => Number(m[i]));
      const chars = [...unescape(m[6])];
      const list = out.get(page) ?? [];
      chars.forEach((ch, k) => {
        if (ch.trim()) list.push({ x: left + ((k + 0.5) * width) / chars.length, top, bottom: top + height, ch, symbol });
      });
      out.set(page, list);
    }
  }
  return out;
}

/** Every page's lines with their place (pdftotext -tsv), and the furniture
    lines among them (furnitureOf). Diagonal text (a "Sample" watermark
    across the page) is no line of the page: -nodiag leaves it out, here and
    in the words to cover. */
function layoutOf(pdf: string): Layout {
  const sizes: Sizes = new Map();
  const byKey = new Map<string, Line>();
  const chars = symbolChars(pdf);
  const symbols: SymbolWord[] = [];
  for (const row of run(["-tsv", "-nodiag", pdf, "-"]).split("\n").slice(1)) {
    const f = row.split("\t");
    if (f.length < 12) continue;
    const [level, page, par, block, line] = f.slice(0, 5).map(Number);
    const [left, top, width, height] = [6, 7, 8, 9].map((i) => Number(f[i]));
    if (level === 1) sizes.set(page, { width, height });
    const key = `${page}|${par}|${block}|${line}`;
    if (level === 4) byKey.set(key, { page, top, bottom: top + height, left, right: left + width, text: "", words: [] });
    const entry = byKey.get(key);
    if (level === 5 && entry) {
      entry.text = entry.text ? `${entry.text} ${f[11]}` : f[11];
      (entry.words ??= []).push({ left, right: left + width, text: f[11] });
    }
    // A word with a symbol font's characters in it: each, in its place, becomes what the page draws.
    const own = level === 5 ? (chars.get(page) ?? []).filter((c) => c.x >= left - 1 && c.x <= left + width + 1 && c.top < top + height && c.bottom > top) : [];
    if (own.length === 0) continue;
    let reads = f[11];
    let at = 0;
    for (const c of own.sort((a, b) => a.x - b.x)) {
      const k = reads.indexOf(c.ch, at);
      if (k < 0) continue;
      const drawn = symbolDrawn(c.ch, c.symbol);
      reads = reads.slice(0, k) + drawn + reads.slice(k + c.ch.length);
      at = k + drawn.length;
      chars.set(page, (chars.get(page) ?? []).filter((x) => x !== c));
    }
    const said = (t: string) => wordsOf(t).map((w) => w.w).join(" ");
    if (entry && said(reads) !== said(f[11])) symbols.push({ page, word: f[11], reads, line: entry });
  }
  const lines = [...byKey.values()].filter((l) => l.text.trim());
  return { lines, furniture: furnitureOf(lines, sizes), sizes, symbols };
}

/** A line set sideways: over 30 pt tall and three times as tall as wide. */
const sideways = (l: Line) => l.bottom - l.top > 30 && l.bottom - l.top > 3 * (l.right - l.left);

/** Each page's rows: lines whose tops lie within 3 pt, left to right, the
    pages in their order. */
export function rowsOf(lines: Line[]): Line[][] {
  const byPage = new Map<number, Line[]>();
  for (const l of lines) {
    const list = byPage.get(l.page);
    if (list) list.push(l);
    else byPage.set(l.page, [l]);
  }
  const rows: Line[][] = [];
  for (const page of [...byPage.keys()].sort((a, b) => a - b)) {
    const start = rows.length;
    for (const l of (byPage.get(page) ?? []).sort((a, b) => a.top - b.top)) {
      const row = rows.length > start ? rows[rows.length - 1] : null;
      if (row && Math.abs(row[0].top - l.top) < 3) row.push(l);
      else rows.push([l]);
    }
    for (const row of rows.slice(start)) row.sort((a, b) => a.left - b.left);
  }
  return rows;
}

/** The furniture lines among a document's lines. Furniture stands in a
    page's first or last two rows, wherever those rows are (heads sit 12–19%
    down a page, a scan's foot at 81–83%, census class 4), and shows it on
    other pages of the whole document, a range's pages or not:
    - a page number: a lone number (arabic, or lowercase roman in the front
      matter) that keeps its distance from the page's index at one height on
      several pages (2302.12627 prints them 85% down the page), or a lone
      number in the page's outer 8%; "I." over a chapter is its number;
    - a repeat: the same words at the same height (3% of the page) and the
      same place across the page (its left edge, right edge, or middle
      within 2% of the page's width), OCR's misreadings forgiven
      ("CHALLENGE TO APOLLO", "CHALLENGE TO _POLLO"), with its numbers the
      same or counting with the pages ("Page 3 of 12"; not the 10-K's "Note
      2." and "Note 11." that open pages, nor a figure's DOI), on several
      pages each within two pages of the next: a head stands on every page
      or every other one, where a chapter's first heading ("Introduction" in
      the Math Guide) or a box's label ("Tip") stands at one place by chance
      on pages far apart. Once found, the same words at that height and size
      are furniture on every page (facing pages set a head at the other
      side), but a first page's title set larger is no running head;
    - "Continued on next page" in the last rows;
    - a short line on a row half made of those: the head that names each
      page's section beside its page number, the Supreme Court's "(Slip
      Opinion)" beside its first page's head;
    - text set sideways in the page's margin (arXiv's identifier, a
      newsletter's section tab at the page's edge), which the parse never
      reads as text.
    The parse's finder (lib/parse/pdf/furniture.ts) reads the same kinds of
    evidence from pdf.js's lines; this one reads pdftotext's boxes. */
export function furnitureOf(lines: Line[], sizes: Sizes): Line[] {
  const furniture = new Set<Line>();
  const size = (l: Line) => sizes.get(l.page) ?? { width: 612, height: 792 };
  const needed = sizes.size <= 8 ? 2 : 3;
  for (const l of lines) {
    const middle = (l.left + l.right) / 2;
    if (sideways(l) && (middle < 0.1 * size(l).width || middle > 0.9 * size(l).width)) furniture.add(l);
  }
  // Each page's rows (lines whose tops lie within 3 pt, left to right), its
  // first and last two, and its first and last.
  const edgeRows: Line[][] = [];
  const lastRows: Line[][] = [];
  const outermost = new Set<Line>();
  const allRows = rowsOf(lines.filter((l) => !furniture.has(l)));
  for (let i = 0; i < allRows.length; ) {
    let j = i;
    while (j < allRows.length && allRows[j][0].page === allRows[i][0].page) j++;
    const rows = allRows.slice(i, j);
    edgeRows.push(...new Set([...rows.slice(0, 2), ...rows.slice(-2)]));
    lastRows.push(...rows.slice(-2));
    for (const l of [...(rows[0] ?? []), ...(rows.at(-1) ?? [])]) outermost.add(l);
    i = j;
  }
  const candidates = edgeRows.flat();
  const near = (a: { page: number; top: number }, b: { top: number }) => Math.abs(a.top - b.top) <= 0.03 * (sizes.get(a.page)?.height ?? 792);
  const outer = (l: Line) => l.bottom < 0.08 * size(l).height || l.top > 0.92 * size(l).height;

  // Page numbers: a lone number whose distance from the page's index repeats
  // at its height on `needed` pages (a figure's axis label "1" on page 1
  // stands apart from the page numbers' height); a lone number at that
  // distance in a page's first or last row (a paper sets its first page's
  // number at the foot, the others' in the head); a lone number in the
  // page's outer 8%. Roman numbers count apart from arabic ones.
  const numbered = candidates.flatMap((l) => {
    const n = pageNumberOf(l.text);
    const roman = !/\d/.test(l.text);
    if (n === null || (roman && l.text !== l.text.toLowerCase())) return [];
    return [{ line: l, offset: `${roman ? "roman" : "arabic"} ${n - l.page}` }];
  });
  for (const { line, offset } of numbered) {
    const pages = new Set(numbered.filter((o) => o.offset === offset && near(o.line, line)).map((o) => o.line.page));
    if (pages.size >= needed) furniture.add(line);
  }
  const offsets = new Set(numbered.filter((n) => furniture.has(n.line)).map((n) => n.offset));
  for (const { line, offset } of numbered) if (offsets.has(offset) && outermost.has(line)) furniture.add(line);
  for (const l of candidates) if (outer(l) && PAGE_NUMBER_RE.test(l.text.trim())) furniture.add(l);

  // Repeats: a line or a whole row of three letters or more (a diagram's
  // label "o3" tops pages too). A row, since pdftotext cuts a head at its
  // gaps where OCR reads it whole on other pages ("CHALLENGE", "TO",
  // "P, POLLO").
  type Unit = { lines: Line[]; text: string; key: string; letters: string; page: number; top: number; left: number; right: number; height: number; numbers: number[] };
  const unitOf = (ls: Line[], text: string): Unit => ({
    lines: ls,
    text,
    key: keyOf(text),
    letters: lettersOf(text),
    page: ls[0].page,
    top: ls[0].top,
    left: Math.min(...ls.map((l) => l.left)),
    right: Math.max(...ls.map((l) => l.right)),
    height: Math.max(...ls.map((l) => l.bottom - l.top)),
    numbers: (text.match(/\d+/g) ?? []).map(Number),
  });
  const units: Unit[] = [
    ...candidates.map((l) => unitOf([l], l.text)),
    ...edgeRows.filter((r) => r.length > 1).map((r) => unitOf(r, r.map((l) => l.text.trim()).join(" "))),
  ]
    .filter((u) => u.letters.length >= 3 && !CAPTION_LABEL_RE.test(u.text))
    .sort((a, b) => a.top - b.top);
  // The units near a unit's height, from the list sorted by height (a book's thousands of rows).
  const reach = 0.03 * Math.max(792, ...[...sizes.values()].map((x) => x.height));
  const nearby = (u: Unit): Unit[] => {
    let lo = 0;
    for (let hi = units.length; lo < hi; ) {
      const mid = (lo + hi) >> 1;
      if (units[mid].top < u.top - reach) lo = mid + 1;
      else hi = mid;
    }
    const out: Unit[] = [];
    for (let k = lo; k < units.length && units[k].top <= u.top + reach; k++) if (near(units[k], u)) out.push(units[k]);
    return out;
  };
  const aligned = (a: Unit, b: Unit) => {
    const slack = 0.02 * (sizes.get(a.page)?.width ?? 612);
    return Math.abs(a.left - b.left) <= slack || Math.abs(a.right - b.right) <= slack || Math.abs(a.left + a.right - b.left - b.right) / 2 <= slack;
  };
  // The same numbers, or numbers that move with the page.
  const counts = (a: Unit, b: Unit) => a.numbers.length === b.numbers.length && a.numbers.every((n, k) => n === b.numbers[k] || b.numbers[k] - n === b.page - a.page);
  // OCR's two readings of one line: letters within a fifth first (cheap), then ocrSame.
  const ocr = (a: Unit, b: Unit) => {
    const n = Math.min(a.letters.length, b.letters.length);
    return n >= 10 && Math.abs(a.letters.length - b.letters.length) <= n * 0.2 && ocrSame(a.text, b.text);
  };
  const same = (a: Unit, b: Unit) => (a.key === b.key && counts(a, b)) || ocr(a, b);
  // The most pages in a row, each within two pages of the next.
  const run = (pages: Set<number>) => {
    const sorted = [...pages].sort((a, b) => a - b);
    let best = 0;
    sorted.forEach((p, k) => {
      let n = 1;
      while (k + n < sorted.length && sorted[k + n] - sorted[k + n - 1] <= 2) n++;
      best = Math.max(best, n);
    });
    return best;
  };
  const repeats = new Set<Unit>();
  for (const u of units) {
    const around = nearby(u).filter((o) => aligned(o, u));
    const pages = new Set(around.filter((o) => o.key === u.key && counts(u, o)).map((o) => o.page));
    if (run(pages) < needed) for (const o of around) if (!pages.has(o.page) && ocr(u, o)) pages.add(o.page);
    if (run(pages) >= needed) repeats.add(u);
  }
  const sized = (a: Unit, b: Unit) => Math.abs(a.height - b.height) <= 0.3 * Math.max(a.height, b.height);
  for (const u of units) if (repeats.has(u) || nearby(u).some((r) => repeats.has(r) && sized(r, u) && same(r, u))) for (const l of u.lines) furniture.add(l);
  for (const l of lastRows.flat()) if (CONTINUED_RE.test(l.text.trim())) furniture.add(l);
  // A row half furniture is furniture: a table's row at a page's top holds
  // one cell that repeats ("closed") among cells that do not.
  for (const row of edgeRows) {
    if (row.filter((l) => furniture.has(l)).length * 2 >= row.length) for (const l of row) if (l.text.trim().split(/\s+/).length <= 8) furniture.add(l);
  }
  return lines.filter((l) => furniture.has(l));
}

/** Two lines with the same words as OCR reads them on two pages: letters
    within a fifth, and every word of four letters or more close to one of
    the other's, so two captions that differ in one word stay apart. */
export function ocrSame(a: string, b: string): boolean {
  const [ra, rb] = [readingOf(a), readingOf(b)];
  const n = Math.min(ra.letters.length, rb.letters.length);
  if (n < 10 || editDistance(ra.letters, rb.letters, Math.floor(n * 0.2)) > Math.floor(n * 0.2)) return false;
  const close = (w: string, list: string[]) => list.some((v) => editDistance(w, v, Math.floor(w.length / 3)) <= Math.floor(w.length / 3));
  return ra.words.every((w) => close(w, rb.words)) && rb.words.every((w) => close(w, ra.words));
}

/** Levenshtein distance, stopping once it passes max. */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, cur[j]);
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

const layouts = new Map<string, Layout>();

/** Let a PDF's layout go once no document still to score reads it. */
export function forgetText(pdf: string) {
  layouts.delete(pdf);
}

export function pdfText(pdf: string, pages?: [number, number]): PdfText {
  const range = pages ? ["-f", String(pages[0]), "-l", String(pages[1])] : [];
  const raw = run(["-raw", "-nodiag", "-enc", "UTF-8", ...range, pdf, "-"])
    .split("\f")
    .map((page) => page.split("\n"));
  if (raw.length > 1 && raw.at(-1)?.join("").trim() === "") raw.pop();
  let layout = layouts.get(pdf);
  if (!layout) layouts.set(pdf, (layout = layoutOf(pdf)));
  const inRange = (l: Line) => !pages || (l.page >= pages[0] && l.page <= pages[1]);
  const lines = layout.lines.filter(inRange);
  return {
    first: pages?.[0] ?? 1,
    pages: new Set(lines.map((l) => l.page)).size,
    raw,
    lines,
    furniture: layout.furniture.filter(inRange),
    sizes: layout.sizes,
    symbols: layout.symbols.filter((s) => !pages || (s.page >= pages[0] && s.page <= pages[1])),
  };
}

/** The text pdftotext cannot read: pdf.js's text items (paint.ts) that stand
    where no line of pdftotext's is, and whose words no line of the page
    holds (a CID font whose map this sandbox's poppler lacks: a report's
    headings in a Japanese font read as nothing). Vertical writing in the
    margin and an item that stands at one place on several pages are the
    page's furniture, as pdftotext's own are. */
export function blindText(pdf: PdfText, paint: PagePaint[]): { page: number; text: string }[] {
  const found: { page: number; text: string; key: string }[] = [];
  const furniture = new Set(pdf.furniture);
  const last = pdf.first + pdf.raw.length - 1;
  for (let page = pdf.first; page <= last; page++) {
    const painted = paint[page - 1];
    if (!painted) continue;
    const lines = pdf.lines.filter((l) => l.page === page);
    // Words the page's furniture holds are no words to cover: a title the margin's tab repeats is the page's own.
    const held = heldBy(lines.filter((l) => !furniture.has(l)).map((l) => wordsOf(l.text).map((w) => w.w)));
    for (const item of painted.items) {
      if (item.vertical || wordsOf(item.text).length === 0) continue;
      const [x, y] = [(item.x1 + item.x2) / 2, (item.y1 + item.y2) / 2];
      if (lines.some((l) => x >= l.left - 2 && x <= l.right + 2 && y >= l.top - 2 && y <= l.bottom + 2) || held(item.text)) continue;
      const place = `${Math.round(item.y1 / (0.03 * painted.height))} ${Math.round(item.x1 / (0.02 * painted.width))}`;
      found.push({ page, text: item.text, key: `${normText(item.text)}|${place}` });
    }
  }
  const pages = new Map<string, Set<number>>();
  for (const f of found) pages.set(f.key, (pages.get(f.key) ?? new Set<number>()).add(f.page));
  const needed = pdf.sizes.size <= 8 ? 2 : 3;
  return found.filter((f) => (pages.get(f.key)?.size ?? 0) < needed).map(({ page, text }) => ({ page, text }));
}

type Leaks = {
  strings: number;
  leaked: number;
  leaks: number;
  clean: number | null;
  /** Each leaked string: where the candidate's words hold it, and how many of its lines a figure's picture shows. */
  found: { text: string; at: { unit: number; tok: number }[]; pictured?: number }[];
};

/** The lines alone on their row: a page number stands alone, a table's
    cell or a list's marker the text layer reads apart shares its row. */
function aloneOnRow(lines: Line[]): Set<Line> {
  return new Set(rowsOf(lines).flatMap((row) => (row.length === 1 ? row : [])));
}

/** Does a word list hold a run of words, in order, one after another? */
function holds(words: string[], run: string[]): boolean {
  for (let i = 0; i + run.length <= words.length; i++) if (run.every((w, k) => words[i + k] === w)) return true;
  return false;
}

/** The candidate's figures that show a line of the PDF: its middle inside
    the figure's region (a crop draws its region as the page does). */
function picturedBy(pdf: PdfText, cand: Flat): (line: Line) => Extract<DocBlock, { kind: "figure" }>[] {
  const figures = cand.blocks.flatMap((b) => (b.kind === "figure" && b.at ? [b] : []));
  return (line) => {
    const size = pdf.sizes.get(line.page);
    if (!size) return [];
    const [x, y] = [((line.left + line.right) / 2 / size.width) * 100, ((line.top + line.bottom) / 2 / size.height) * 100];
    return figures.filter((f) => {
      if (!f.at || f.at.page !== line.page) return false;
      const b = regionBounds(f.at.region);
      return x >= b.x1 && x <= b.x2 && y >= b.y1 && y <= b.y2;
    });
  };
}

/** Furniture lines' words at the candidate's edges (table cells aside: a
    cell may hold a number), past the times the same line stands alone on
    its row among the PDF's other lines (a chapter title that is also the
    running head; a list's marker or a table's cell the text layer reads
    apart shares its row and forgives nothing). A string is the page's own
    words where the candidate's word next to it stands next to it in one of
    the PDF's other lines: a heading's number ("2 VHE OBSERVATIONS"), a
    caption's ("Table 3"), a paragraph that opens with a company's name.
    The candidate's title is the page's own line where the running head
    repeats it, and a footnote's label or mark is no page number. Text set
    sideways (a newsletter's tab) leaks nothing: the parse never reads it,
    so its words in the candidate are the page's own (the contents entry
    for the section the tab names). A furniture line at the page's edge
    inside a figure's region leaks too: the crop draws it (a figure's
    region that reaches up to the running head). */
function leaksOf(pdf: PdfText, furniture: Line[], cand: Flat): Leaks {
  const furnitureSet = new Set(furniture);
  const alone = aloneOnRow(pdf.lines);
  const others = new Map<string, number>();
  for (const l of pdf.lines) if (!furnitureSet.has(l) && alone.has(l)) others.set(normText(l.text), (others.get(normText(l.text)) ?? 0) + 1);
  // The PDF's other lines and rows (a heading the text layer reads as two
  // lines on one row, "第 1 節" and its title), as words.
  const kept = pdf.lines.filter((l) => !furnitureSet.has(l));
  const rows = rowsOf(kept).filter((row) => row.length > 1);
  const own = [...kept.map((l) => l.text), ...rows.map((row) => row.map((l) => l.text).join(" "))].map((t) => wordsOf(t).map((w) => w.w));
  const strings = [...new Set(furniture.map((f) => f.text.trim()))].filter((f) => wordsOf(f).length > 0);
  const words = strings.map((f) => wordsOf(f).map((w) => w.w));
  const inLine = (run: string[]) => own.some((line) => holds(line, run));
  const beside = (m: { unit: number; tok: number }, x: number) => {
    const unit = cand.units[m.unit];
    const k = words[x].length;
    const before = m.tok > unit.first ? cand.toks[m.tok - 1].w : null;
    const after = m.tok + k < unit.end ? cand.toks[m.tok + k].w : null;
    return (before !== null && inLine([before, ...words[x]])) || (after !== null && inLine([...words[x], after]));
  };
  const atEdges = furnitureMatches(cand, words, false, false);
  // A heading made of running heads alone is the section's own title, which
  // the running head repeats over the section's pages (a report's "第 1 節
  // …" on every page, its heading once): its first such heading is the
  // page's own words, where the text layer cannot read the title (a
  // heading drawn as outlines).
  const covered = new Map<number, Set<number>>();
  atEdges.forEach((list, x) => {
    for (const m of list) for (let t = m.tok; t < m.tok + words[x].length; t++) covered.set(m.unit, (covered.get(m.unit) ?? new Set<number>()).add(t));
  });
  const titled = (unit: number) => {
    const u = cand.units[unit];
    return cand.blocks[u.block].kind === "heading" && u.end > u.first && (covered.get(unit)?.size ?? 0) === u.end - u.first;
  };
  const matches = atEdges.map((list, x) => {
    const own = list.find((m) => titled(m.unit));
    return list.filter((m) => m !== own && cand.blocks[cand.units[m.unit].block].kind !== "title" && !beside(m, x));
  });
  // A crop shows a running head, a running foot, or a page number: a
  // furniture line at its page's edge (no other line above a head, none
  // below a foot) inside a figure's region. A chart's label a run of pages
  // repeats inside the body is none.
  const shown = picturedBy(pdf, cand);
  const body = new Map<number, { top: number; bottom: number }>();
  for (const l of kept) {
    const b = body.get(l.page);
    body.set(l.page, { top: Math.min(b?.top ?? l.top, l.top), bottom: Math.max(b?.bottom ?? l.bottom, l.bottom) });
  }
  const atEdge = (f: Line) => {
    const b = body.get(f.page);
    return !b || f.bottom <= b.top || f.top >= b.bottom;
  };
  const pictured = new Map<string, number>();
  for (const f of furniture) if (atEdge(f) && shown(f).length > 0) pictured.set(f.text.trim(), (pictured.get(f.text.trim()) ?? 0) + 1);
  let leaked = 0;
  let leaks = 0;
  const found: Leaks["found"] = [];
  const flat = new Set(furniture.filter((f) => !sideways(f)).map((f) => f.text.trim()));
  strings.forEach((text, x) => {
    if (!flat.has(text)) return;
    const inPictures = pictured.get(text) ?? 0;
    const excess = Math.max(0, matches[x].length - (others.get(normText(text)) ?? 0)) + inPictures;
    if (excess <= 0) return;
    leaked++;
    leaks += excess;
    found.push({ text, at: matches[x], ...(inPictures > 0 ? { pictured: inPictures } : {}) });
  });
  return { strings: strings.length, leaked, leaks, clean: strings.length > 0 ? 1 - leaked / strings.length : null, found };
}

// ── The import's look ───────────────────────────────────────────────────────
//
// What the page editor draws that a page sets and no reference records: an
// inline formula at its words' size, a PDF figure at its printed width, a
// Word paragraph's borders. The page sets each; the checks read the page
// editor's own rules and the import.

let formulaScaleMemo: number | null = null;

/** The size the page editor draws a formula at over its paragraph's words:
    KaTeX's stylesheet sets `.katex { font: … 1.21em … }` (a web font's
    x-height: a formula drew 21% larger than its words), unless the page
    editor's CSS (components/docs) sets the formula's size again. */
export function formulaScale(): number {
  if (formulaScaleMemo !== null) return formulaScaleMemo;
  const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : f.endsWith(".css") ? [join(dir, f)] : []));
  const own = files(join(ROOT, "src", "components", "docs")).map((f) => readFileSync(f, "utf8"));
  formulaScaleMemo = formulaScaleOf(readFileSync(join(ROOT, "node_modules", "katex", "dist", "katex.min.css"), "utf8"), own);
  return formulaScaleMemo;
}

/** The formula's size from the stylesheets: the page editor's rule for a
    formula's `.katex` (under `.docs-math`) when one sets a size, else
    KaTeX's own. */
export function formulaScaleOf(katexCss: string, ownCss: string[]): number {
  const rule = (css: string, selector: RegExp) => {
    for (const m of css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!m[1].split(",").some((sel) => selector.test(sel.trim()))) continue;
      const size = /font(?:-size)?\s*:[^;]*?([\d.]+)(em|%)/.exec(m[2]);
      if (size) return size[2] === "%" ? Number(size[1]) / 100 : Number(size[1]);
    }
    return null;
  };
  return ownCss.map((css) => rule(css, /\.docs-math\b.*\.katex$/)).find((x) => x !== null) ?? rule(katexCss, /^\.katex$/) ?? 1;
}

type Box = { width: number; height: number };
/** The import's page: its size and margins in points (the converter's page setup). */
export type PageSetup = Box & { margins: { top: number; right: number; bottom: number; left: number } };

/** Each PDF figure's crop as the page editor draws it (figureCropSize, at
    most the text's width) against the size the page prints it at, scaled
    down only where the page editor's text box is smaller: right within a
    tenth. A crop drawn at the column's width drew a two-column paper's
    figure twice its printed size. */
export function figureWidths(cand: Flat, page: Box, setup: PageSetup): { right: number; total: number; misses: string[] } {
  const px = 96 / 72;
  const room = { width: (setup.width - setup.margins.left - setup.margins.right) * px, height: (setup.height - setup.margins.top - setup.margins.bottom) * px };
  let right = 0;
  let total = 0;
  const misses: string[] = [];
  for (const block of cand.blocks) {
    if (block.kind !== "figure" || !block.at) continue;
    const b = regionBounds(block.at.region);
    const printed = { width: ((b.x2 - b.x1) / 100) * page.width * px, height: ((b.y2 - b.y1) / 100) * page.height * px };
    if (!(printed.width > 0 && printed.height > 0)) continue;
    const want = printed.width * Math.min(1, room.width / printed.width, room.height / printed.height);
    const drawn = Math.min(figureCropSize(block.at.region, { ...page, margins: setup.margins }).width, room.width);
    total++;
    if (Math.abs(drawn - want) <= 0.1 * want) right++;
    else misses.push(`p${block.at.page}: drawn ${Math.round(drawn)} px, printed ${Math.round(want)} px`);
  }
  return { right, total, misses };
}

/** A Word file's paragraphs with borders (w:pBdr, the paragraph's own, else
    its style's or a style it is based on): the words each opens with and
    its sides. */
export function wordBorders(path: string): { words: string; sides: Side[] }[] {
  const zip = unzipOffice(new Uint8Array(readFileSync(path)));
  const styles = parseXmlPart(zip, "word/styles.xml");
  const doc = parseXmlPart(zip, "word/document.xml");
  const byId = new Map(descendants(styles, "style").map((st) => [attr(st, "styleId") ?? "", st]));
  const fallback = descendants(styles, "style").find((st) => attr(st, "type") === "paragraph" && attr(st, "default") === "1");
  const sidesOf = (pBdr: Element | null): Side[] | null => {
    if (!pBdr) return null;
    const names: [Side, string[]][] = [["top", ["top"]], ["right", ["right", "end"]], ["bottom", ["bottom"]], ["left", ["left", "start"]]];
    return names.filter(([, tags]) => tags.some((tag) => !["none", "nil", null].includes(attr(child(pBdr, tag), "val")))).map(([side]) => side);
  };
  const styleSides = (id: string | null, seen = new Set<string>()): Side[] | null => {
    const st = id ? byId.get(id) : fallback;
    if (!st || seen.has(id ?? "")) return null;
    seen.add(id ?? "");
    return sidesOf(child(st, "pPr", "pBdr")) ?? styleSides(attr(child(st, "basedOn"), "val"), seen);
  };
  const out: { words: string; sides: Side[] }[] = [];
  for (const p of descendants(doc, "p")) {
    const sides = sidesOf(child(p, "pPr", "pBdr")) ?? styleSides(attr(child(p, "pPr", "pStyle"), "val"));
    const words = wordsOf(descendants(p, "t").map((t) => t.textContent ?? "").join("")).slice(0, 8).map((w) => w.w).join(" ");
    if (words) out.push({ words, sides: sides ?? [] });
  }
  return out;
}

/** The candidate's paragraphs, headings, titles, and quote blocks drawn
    with a border, and the Word file's, paired by the words they open with:
    F1 of those with the same sides. A Word style may draw a rule under a
    heading and a bar beside a quote block. */
export function borderScore(word: { words: string; sides: Side[] }[], cand: Flat): number | null {
  const key = (sides: Side[] | undefined) => [...(sides ?? [])].sort().join(" ");
  const opening = (b: number) => wordsOf(cand.unitsOf[b].map((u) => cand.units[u].text).join(" ")).slice(0, 8).map((w) => w.w).join(" ");
  const theirs = new Map<string, string>();
  cand.blocks.forEach((block, b) => {
    if (block.kind === "paragraph" || block.kind === "heading" || block.kind === "title" || block.kind === "quote") theirs.set(opening(b), key(block.borders));
  });
  const mine = new Map(word.map((p) => [p.words, key(p.sides)]));
  const want = word.filter((p) => p.sides.length > 0);
  const got = [...theirs].filter(([, sides]) => sides !== "");
  if (want.length === 0 && got.length === 0) return null;
  const recall = want.length > 0 ? want.filter((p) => theirs.get(p.words) === key(p.sides)).length / want.length : 1;
  const precision = got.length > 0 ? got.filter(([words, sides]) => mine.get(words) === sides).length / got.length : 0;
  return recall + precision > 0 ? (2 * recall * precision) / (recall + precision) : 0;
}

/** The import's look, where each check applies: its inline formulas drawn
    at their words' size (within 5%), its crops at their printed width, a
    Word file's borders, and against the page (a PDF's, a Word file's
    rendering; drawn.ts) the space around its displays, its tables' row
    heights, and its list markers' places. */
export type LookScores = {
  formulas: number | null;
  figures: number | null;
  borders: number | null;
  displays: number | null;
  rows: number | null;
  markers: number | null;
  /** Numbers drawn whole in their table cells (drawn.ts brokenNumbers), and the count broken. */
  numbers: number | null;
  broken: number;
  /** Checklist items whose wraps stand at the page's indent (drawn.ts checklistWraps), and the count that do not. */
  checklists: number | null;
  checklistsWrong: number;
  score: number | null;
  misses: string[];
};

export function lookScores(
  cand: Flat,
  input: { page?: Box; setup?: PageSetup; word?: { words: string; sides: Side[] }[]; rich?: RichNode; parse?: Doc; pdf?: PdfText; placed?: number[][]; path?: string },
): LookScores {
  const inline = cand.math.some((m) => !m.display);
  const formulas = inline ? (Math.abs(formulaScale() - 1) <= 0.05 ? 1 : 0) : null;
  const widths = input.page && input.setup ? figureWidths(cand, input.page, input.setup) : null;
  const figures = widths && widths.total > 0 ? widths.right / widths.total : null;
  const borders = input.word ? borderScore(input.word, cand) : null;
  // Against the page (a PDF's, a Word file's rendering): the page editor's own drawing of what the page sets.
  const path = input.path;
  const gaps = input.rich && input.parse && input.pdf && path ? displayGaps(input.rich, input.parse, input.pdf, (page, box) => inkBands(path, page, box)) : null;
  const rows = input.placed && input.pdf ? rowHeights(cand, input.placed, input.pdf) : null;
  const markers = input.rich ? markerPlaces(input.rich) : null;
  const numbers = input.rich ? brokenNumbers(input.rich) : null;
  const checklists = input.placed && input.pdf ? checklistWraps(cand, input.placed, input.pdf) : null;
  const all = {
    formulas,
    figures,
    borders,
    displays: gaps?.score ?? null,
    rows: rows?.score ?? null,
    markers: markers?.score ?? null,
    numbers: numbers?.score ?? null,
    checklists: checklists?.score ?? null,
  };
  const parts = Object.values(all).filter((x): x is number => x !== null);
  const misses = [
    ...(formulas === 0 ? [`inline formulas drawn at ${formulaScale()} times their words' size`] : []),
    ...(widths?.misses ?? []),
    ...(gaps?.misses ?? []),
    ...(rows?.misses ?? []),
    ...(markers?.misses ?? []),
    ...(numbers?.misses ?? []),
    ...(checklists?.misses ?? []),
  ];
  return { ...all, broken: numbers?.broken ?? 0, checklistsWrong: checklists?.wrong ?? 0, score: parts.length > 0 ? parts.reduce((a, b) => a + b, 0) / parts.length : null, misses };
}

export type FreeScores = {
  composite: number;
  coverage: {
    recall: number | null;
    precision: number | null;
    f1: number | null;
    expected: number;
    words: number;
    /** The text layer reads fewer words than BLIND of the candidate's: coverage is not scored. */
    blind: boolean;
    /** The words the candidate lacks most, and holds past the PDF's most, with their counts. */
    missing: [string, number][];
    extra: [string, number][];
  };
  furniture: Leaks;
  numberLines: { count: number; score: number; found: { unit: number; text: string }[] };
  garbles: { count: number; score: number; found: { kind: string; match: string; unit: number; text: string }[] };
  /** Display equations as LaTeX the glyph check passes, a crop at half, over the displays checked and cropped (mathPart). */
  math: number | null;
  /** The checks against the page's lines and fonts (layout.ts). */
  layout: LayoutScores | null;
  /** The import's look (lookScores); none for a parse. */
  look: LookScores | null;
};

/** A table's header row as a Word file's rendering repeats it: a row of the
    page, among a page's first three rows under its furniture, whose words
    are the words of one of the candidate's tables' first row, after that
    row's first place on an earlier page. */
function repeatedHeads(pdf: PdfText, cand: Flat): Line[] {
  const key = (words: string[]) => [...words].sort().join(" ");
  const heads = new Set<string>();
  cand.blocks.forEach((block, b) => {
    if (block.kind !== "table") return;
    const words = cand.unitsOf[b].filter((u) => cand.units[u].row === 0).flatMap((u) => cand.toks.slice(cand.units[u].first, cand.units[u].end).map((t) => t.w));
    if (words.length >= 2) heads.add(key(words));
  });
  if (heads.size === 0) return [];
  const furniture = new Set(pdf.furniture);
  const seen = new Set<string>();
  const out: Line[] = [];
  const rows = rowsOf(pdf.lines.filter((l) => !furniture.has(l)));
  let page = -1;
  let rank = 0;
  for (const row of rows) {
    rank = row[0].page === page ? rank + 1 : 0;
    page = row[0].page;
    const k = key(row.flatMap((l) => wordsOf(l.text).map((w) => w.w)));
    if (!heads.has(k)) continue;
    if (seen.has(k) && rank < 3) out.push(...row);
    seen.add(k);
  }
  return out;
}

/** Whether some of these runs of words hold a text's words in their order:
    half of its runs of three words (of two, for a shorter text) stand in
    one of them. */
function heldBy(sequences: string[][]): (text: string) => boolean {
  const runs = new Set<string>();
  for (const words of sequences) {
    for (let i = 0; i < words.length; i++) {
      runs.add(words.slice(i, i + 2).join(" "));
      runs.add(words.slice(i, i + 3).join(" "));
    }
  }
  return (text) => {
    const words = wordsOf(text).map((w) => w.w);
    const k = words.length >= 3 ? 3 : Math.min(2, words.length);
    if (k === 0) return true;
    const keys = words.length <= k ? [words.join(" ")] : Array.from({ length: words.length - k + 1 }, (_, i) => words.slice(i, i + k).join(" "));
    return keys.filter((key) => runs.has(key)).length * 2 >= keys.length;
  };
}

/** Whether the candidate's words hold a line's words in their order (heldBy its units). */
function heldLines(cand: Flat): (text: string) => boolean {
  return heldBy(cand.units.map((unit) => cand.toks.slice(unit.first, unit.end).map((t) => t.w)));
}

/** Whether a text's words stand on the pages the text layer reads, running
    heads and feet aside (heldBy its lines). */
function onThePages(pdf: PdfText): (text: string) => boolean {
  const furniture = new Set(pdf.furniture);
  return heldBy(pdf.lines.filter((l) => !furniture.has(l)).map((l) => wordsOf(l.text).map((w) => w.w)));
}

/** A title the parse takes from a later page than the first (past an
    archive's notice on the first): its words stand on the scored pages
    (`scored`) and not on the first page (`first`), so it is theirs. */
export function laterTitle(scored: PdfText, first: PdfText): (title: string) => boolean {
  const [here, there] = [onThePages(scored), onThePages(first)];
  return (title) => here(title) && !there(title);
}

function countWords(texts: string[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const text of texts) for (const w of wordsOf(text)) out.set(w.w, (out.get(w.w) ?? 0) + 1);
  return out;
}

/** The words the candidate prints, as the PDF's text layer holds them: its
    words and its list markers ("1.1", "(a)"). Its formulas apart, as the
    glyphs they draw (a parse's readable characters, else the glyphs KaTeX
    draws): the text layer splits a formula into words by its glyphs'
    spacing ("2", "k1", "t" where the formula reads "2k1t"), so the formulas'
    glyphs cover the PDF's short words, as the reference metrics let a
    reference's math do, and are never extra words. */
function printedWords(
  cand: Flat,
  contents: boolean,
): { words: string[]; glyphs: Map<string, number>; raised: { joined: string; parts: string[] }[]; tight: { joined: string; parts: string[]; formula: string }[] } {
  const kept = (b: number) => contents || cand.blocks[b].role !== "contents";
  const toks = cand.toks.filter((t) => kept(cand.units[t.unit].block));
  const words = toks.map((t) => t.w);
  // A word a raised mark ends ("Storage" and its note's "2"): the text layer
  // may read the mark into the word or apart from it.
  const raised: { joined: string; parts: string[] }[] = [];
  for (const t of toks) {
    const unit = cand.units[t.unit];
    const at = unit.raised.find(([a]) => a > t.start && a < t.end)?.[0];
    if (at === undefined) continue;
    const parts = wordsOf(unit.text.slice(t.start, at)).concat(wordsOf(unit.text.slice(at, t.end))).map((w) => w.w);
    if (parts.length > 1) raised.push({ joined: t.w, parts });
  }
  cand.blocks.forEach((block, b) => {
    if (block.kind === "list" && kept(b)) for (const item of block.items) words.push(...wordsOf(item.marker).map((w) => w.w));
  });
  const glyphs = new Map<string, number>();
  const readings = new Map<MathItem, string>();
  for (const m of cand.math) {
    const reading = m.text?.trim() ? m.text : m.latex !== undefined || m.mathml !== undefined ? mathLeaves(m, m.display).join(" ") : "";
    readings.set(m, reading);
    for (const w of wordsOf(`${reading} ${m.label ?? ""}`)) for (const ch of w.w) glyphs.set(ch, (glyphs.get(ch) ?? 0) + 1);
  }
  // A word set tight after a formula ("$n$th", "$k$th"): the text layer reads
  // the formula's glyphs and the word as one word ("nth"). parse loop
  // finding: thinkdsp's "the nth row" scored "nth" missing and "th" extra.
  const tight: { joined: string; parts: string[]; formula: string }[] = [];
  for (const m of cand.math) {
    if (m.display || m.to === undefined || !kept(m.block)) continue;
    const t = toks.find((x) => x.unit === m.unit && x.start === m.to);
    const formula = wordsOf(readings.get(m) ?? "").map((w) => w.w).join("");
    const joined = t && formula ? wordsOf(formula + t.w)[0]?.w : undefined;
    if (t && joined && [...formula].length <= 4) tight.push({ joined, parts: [t.w], formula });
  }
  return { words, glyphs, raised, tight };
}

/** The reference-free checks: text coverage against pdftotext (every word of
    the PDF once, less its furniture lines; a line-end hyphen joins its word
    when the candidate holds the joined word), furniture lines at the
    candidate's edges, lines that are only a page number, garbled glyphs (by
    string, and for a PDF in TeX's math fonts by the glyphs' codes), and
    display math as checked LaTeX (glyphs.ts). */
/** A text layer that reads fewer words than this share of the candidate's
    reads blind (Japanese in Adobe-Japan1 fonts without a ToUnicode map, which
    pdftotext reads only with poppler-data, which this sandbox lacks): its
    coverage is not scored. */
const BLIND = 0.5;

/** `word`: the candidate is a Word file's, checked against LibreOffice's PDF
    of it, which leaves an empty contents field empty where the parse builds
    the contents list from the headings: a contents list's words are left
    out (they repeat the headings). */
/** The math part: each display checked as LaTeX scores 1 when it passes and 0
    when it fails, and each crop of a display half (a right formula over its
    crop over wrong words). It stands only where a display is checked: a crop
    alone (a page whose formulas no check reads, set in Times) brings in no
    part at 0. A page whose displays are all crops has no math part, as one
    whose displays are words has none, and loses no garbles or coverage as
    the words do. */
export function mathPart(glyphs: Pick<GlyphScores, "checked" | "passed" | "mathImages">): number | null {
  return glyphs.checked > 0 ? (glyphs.passed + glyphs.mathImages / 2) / (glyphs.checked + glyphs.mathImages) : null;
}

export function freeScores(pdf: PdfText, cand: Flat, glyphs?: GlyphScores, word = false, look: LookScores | null = null, layout: LayoutScores | null = null): FreeScores {
  const { words: printed, glyphs: formulaGlyphs, raised, tight } = printedWords(cand, !word);
  const candBag = countWords([]);
  for (const w of printed) candBag.set(w, (candBag.get(w) ?? 0) + 1);
  const expected = new Map<string, number>();
  // Word draws a hollow bullet in Courier New, which the text layer reads as
  // the letter "o": a line that opens with one before a list item of the
  // candidate (whatever bullet it draws) is no word.
  const opening = (text: string) => wordsOf(text).slice(0, 3).map((w) => w.w).join(" ");
  const items = new Map<string, number>();
  for (const b of cand.blocks) {
    if (b.kind !== "list") continue;
    for (const item of b.items) {
      const key = opening(item.spans.map((x) => x.text).join(""));
      items.set(key, (items.get(key) ?? 0) + 1);
    }
  }
  // A figure's words are its picture's, not words to cover: the lines inside
  // a region the candidate shows as a figure (a chart's labels, a diagram's
  // boxes, a slide's picture), unless the candidate's words hold the line
  // (a caption inside its figure's region, a paragraph the region takes in);
  // a short line (three words at most, a CJK character a quarter word) or a
  // display's crop's line whatever it holds (a label that leaks into the
  // text is extra). Prose a display's crop shows is its own check (layout.ts).
  const shown = picturedBy(pdf, cand);
  const held = heldLines(cand);
  const labels = pdf.lines.filter((l) => shown(l).some((f) => f.mathImage !== undefined || labelWords(l.text) <= 3 || !held(l.text)));
  // Word repeats a table's header row at the top of each page the table runs onto (LibreOffice's rendering does
  // too); the page editor draws the header row once and repeats it itself: a repeat is no words to cover.
  if (word) labels.push(...repeatedHeads(pdf, cand));
  pdf.raw.forEach((rawLines, p) => {
    const lines = rawLines.map((line) => {
      // A raised footnote label runs into its note's first word ("1All amounts…"),
      // and Word's math letters read twice ("𝑝𝑝00", "εε") are one letter each.
      const own = line.replace(/^(\s*\d{1,3})(?=\p{Lu}\p{Ll})/u, "$1 ").replace(DOUBLED_RE, "$1");
      const hollow = /^\s*o\s+(\S.*)$/.exec(own);
      const left = hollow ? (items.get(opening(hollow[1])) ?? 0) : 0;
      if (!hollow || left <= 0) return own;
      items.set(opening(hollow[1]), left - 1);
      return hollow[1];
    });
    const dropped = [...pdf.furniture, ...labels].filter((f) => f.page === pdf.first + p);
    const drop = countWords(dropped.map((f) => f.text));
    // A word read out of a symbol font counts as the page draws it (◆ read "u" is no word; Symbol's "a" is α),
    // on a line that is a word to cover.
    const symbols = pdf.symbols.filter((s) => s.page === pdf.first + p && !dropped.includes(s.line));
    for (const s of symbols) for (const w of wordsOf(s.word)) drop.set(w.w, (drop.get(w.w) ?? 0) + 1);
    for (const s of symbols) for (const w of wordsOf(s.reads)) expected.set(w.w, (expected.get(w.w) ?? 0) + 1);
    // The words pdftotext cannot read are the page's words all the same.
    for (const b of pdf.blind ?? []) if (b.page === pdf.first + p) for (const w of wordsOf(b.text)) expected.set(w.w, (expected.get(w.w) ?? 0) + 1);
    for (let i = 0; i + 1 < lines.length; i++) {
      const m = /(\p{L}+)-\s*$/u.exec(lines[i]);
      // A title in capitals breaks its words in capitals: "COM-", "PARED".
      const next = m && /^\p{Lu}+$/u.test(m[1]) ? /^\s*(\p{Lu}+)/u.exec(lines[i + 1]) : /^\s*(\p{Ll}+)/u.exec(lines[i + 1]);
      const joined = m && next ? wordsOf(m[1] + next[1])[0]?.w : undefined;
      if (!m || !next || !joined || !candBag.has(joined)) continue;
      lines[i] = lines[i].slice(0, m.index) + m[1] + next[1];
      lines[i + 1] = lines[i + 1].slice(next[0].length);
    }
    for (const w of wordsOf(lines.join("\n"))) {
      const left = drop.get(w.w) ?? 0;
      if (left > 0) drop.set(w.w, left - 1);
      else expected.set(w.w, (expected.get(w.w) ?? 0) + 1);
    }
  });
  // A word with its raised mark counts as the text layer reads it: whole, or
  // as the word and the mark apart.
  for (const { joined, parts } of raised) {
    const short = (candBag.get(joined) ?? 0) > (expected.get(joined) ?? 0);
    if (!short || !parts.every((w) => (expected.get(w) ?? 0) > (candBag.get(w) ?? 0))) continue;
    candBag.set(joined, (candBag.get(joined) ?? 0) - 1);
    for (const w of parts) candBag.set(w, (candBag.get(w) ?? 0) + 1);
  }
  // A word set tight after a formula counts as the text layer reads it: the
  // formula's glyphs and the word as one word.
  for (const { joined, parts, formula } of tight) {
    const short = (expected.get(joined) ?? 0) > (candBag.get(joined) ?? 0);
    const extra = parts.every((w) => (candBag.get(w) ?? 0) > (expected.get(w) ?? 0));
    const chars = countWords([]);
    for (const ch of formula) chars.set(ch, (chars.get(ch) ?? 0) + 1);
    if (!short || !extra || ![...chars].every(([ch, c]) => (formulaGlyphs.get(ch) ?? 0) >= c)) continue;
    for (const [ch, c] of chars) formulaGlyphs.set(ch, (formulaGlyphs.get(ch) ?? 0) - c);
    for (const w of parts) candBag.set(w, (candBag.get(w) ?? 0) - 1);
    candBag.set(joined, (candBag.get(joined) ?? 0) + 1);
  }
  // The candidate's word count, a split mark counted apart.
  const printedCount = [...candBag.values()].reduce((a, n) => a + n, 0);
  let hits = 0;
  let total = 0;
  const covered = new Map<string, number>();
  for (const [w, n] of expected) {
    total += n;
    hits += Math.min(n, candBag.get(w) ?? 0);
  }
  // The words no printed word matches: a short one the formulas' glyphs hold is covered.
  let formulaHits = 0;
  for (const [w, n] of expected) {
    let rest = n - Math.min(n, candBag.get(w) ?? 0);
    const chars = countWords([]);
    for (const ch of w) chars.set(ch, (chars.get(ch) ?? 0) + 1);
    while (rest > 0 && [...w].length <= 4 && [...chars].every(([ch, c]) => (formulaGlyphs.get(ch) ?? 0) >= c)) {
      for (const [ch, c] of chars) formulaGlyphs.set(ch, (formulaGlyphs.get(ch) ?? 0) - c);
      covered.set(w, (covered.get(w) ?? 0) + 1);
      formulaHits++;
      rest--;
    }
  }
  const most = (a: Map<string, number>, b: Map<string, number>) =>
    [...a]
      .map(([w, n]): [string, number] => [w, n - (b.get(w) ?? 0)])
      .filter(([, n]) => n > 0)
      .sort((x, y) => y[1] - x[1])
      .slice(0, 20);
  // A footnote's label and marks as the page editor draws them (1, 2, …
  // where the page prints ∗ or ¶¶) are no extra words.
  const noted = new Map<string, number>();
  for (const t of cand.toks) if (t.note) noted.set(t.w, (noted.get(t.w) ?? 0) + 1);
  let forgiven = 0;
  for (const [w, n] of noted) forgiven += Math.min(n, Math.max(0, (candBag.get(w) ?? 0) - (expected.get(w) ?? 0)));
  const blind = total < BLIND * printedCount;
  const recall = total > 0 && !blind ? (hits + formulaHits) / total : null;
  const precision = printedCount - forgiven > 0 && !blind ? hits / (printedCount - forgiven) : null;
  const f1 = recall === null || precision === null ? null : recall + precision > 0 ? (2 * recall * precision) / (recall + precision) : 0;
  const furniture = leaksOf(pdf, pdf.furniture, cand);
  const furnitureSet = new Set(pdf.furniture);
  // A block that is only a page number; a line inside a block ("12" of a
  // display read as words) is no page number's leak.
  const numbers = cand.units.flatMap((unit, u) => (!["table", "list", "code"].includes(cand.blocks[unit.block].kind) && PAGE_NUMBER_RE.test(unit.text.trim()) ? [{ unit: u, text: unit.text.trim() }] : []));
  // The PDF's own lone numbers that are no furniture (a figure's axis): a
  // table's cell shares its row and forgives nothing.
  const alone = aloneOnRow(pdf.lines);
  const ownNumbers = pdf.lines.filter((l) => !furnitureSet.has(l) && alone.has(l) && PAGE_NUMBER_RE.test(l.text.trim())).length;
  const numberCount = Math.max(0, numbers.length - ownNumbers);
  const garbled: FreeScores["garbles"]["found"] = [];
  cand.units.forEach((unit, u) => {
    for (const g of garblesOf(unit.text)) garbled.push({ kind: g.kind, match: g.match, unit: u, text: unit.text });
  });
  for (const m of cand.math) if (m.image) for (const g of garblesOf(m.image)) garbled.push({ kind: g.kind, match: g.match, unit: -1, text: m.image });
  // The PDF's own text layer holds the same garbles (they come from it), so
  // none is forgiven here. The glyphs' codes see what no string shows (a lost
  // ϵ, ℱ read as F); the larger count stands.
  const garbleExcess = Math.max(garbled.length, glyphs?.garbles ?? 0);
  const parts: Record<keyof typeof FREE_WEIGHTS, number | null> = {
    coverage: f1,
    furniture: furniture.clean,
    numbers: Math.max(0, 1 - numberCount / Math.max(1, pdf.pages)),
    garbles: Math.max(0, 1 - garbleExcess / (5 + cand.toks.length / 100)),
    math: glyphs ? mathPart(glyphs) : null,
    order: layout?.order ?? null,
    structure: layout?.structure ?? null,
    layout: layout?.layout ?? null,
    look: look?.score ?? null,
  };
  let sum = 0;
  let weight = 0;
  for (const part of Object.keys(FREE_WEIGHTS) as (keyof typeof FREE_WEIGHTS)[]) {
    const s = parts[part];
    if (s === null) continue;
    sum += FREE_WEIGHTS[part] * s;
    weight += FREE_WEIGHTS[part];
  }
  return {
    composite: weight > 0 ? (100 * sum) / weight : 0,
    coverage: {
      recall,
      precision,
      f1,
      expected: total,
      words: printedCount,
      blind,
      missing: most(expected, new Map([...new Set([...candBag.keys(), ...covered.keys()])].map((w) => [w, (candBag.get(w) ?? 0) + (covered.get(w) ?? 0)]))),
      extra: most(candBag, expected),
    },
    furniture,
    numberLines: { count: numberCount, score: parts.numbers ?? 0, found: numbers },
    garbles: { count: garbleExcess, score: parts.garbles ?? 0, found: garbled },
    math: parts.math,
    layout,
    look,
  };
}
