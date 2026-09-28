import { execFileSync } from "node:child_process";
import { regionBounds } from "@/lib/video/types";
import type { GlyphScores } from "./glyphs";
import { mathLeaves } from "./math";
import { FREE_WEIGHTS, furnitureMatches, type Flat } from "./metrics";
import { garblesOf, normText, PAGE_NUMBER_RE, wordsOf } from "./text";

// Checks that need no reference: the PDF's own text (pdftotext) against the
// candidate's words, and detectors for what should never be in a parse.

type Line = { page: number; top: number; bottom: number; left: number; right: number; text: string };

/** The PDF's text by pdftotext: each page's lines in content order (-raw:
    the words to cover), and each line with its place (-tsv) with the
    furniture lines among them (layoutOf). */
export type PdfText = { first: number; pages: number; raw: string[][]; lines: Line[]; furniture: Line[]; sizes: Map<number, { width: number; height: number }> };

function run(args: string[]): string {
  return execFileSync("pdftotext", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
}

const keyOf = (text: string) => normText(text).replace(/\d+/g, "#");
const lettersOf = (text: string) => normText(text).replace(/[^\p{L}]/gu, "");
/** A long table's foot on each page it breaks at (LaTeX's longtable, Word). */
const CONTINUED_RE = /^\(?continued (?:on (?:the )?next page|overleaf)\)?\.?$/i;
/** A line that is a page number, and the number: "12", "- 12 -", "Page 3 of 12". */
const NUMBER_LINE_RE = /^[-–— ]*(?:(?:page|p\.)\s*)?(\d{1,4})(?:\s*(?:of|\/)\s*\d{1,4})?[-–— ]*$/i;

type Layout = { lines: Line[]; furniture: Line[]; sizes: Map<number, { width: number; height: number }> };

/** Every page's lines with their place, and the furniture lines among them.
    Furniture stands in a page's first or last two rows, wherever those rows
    are (heads sit 12–19% down a page, a scan's foot at 81–83%, census class
    4), and shows it on other pages of the whole document, a range's pages or
    not:
    - a page number: a lone number that keeps its distance from the page's
      index at one height on several pages (2302.12627 prints them 85% down
      the page), or a lone number in the page's outer 8%;
    - a repeat: the same words, digits aside and OCR's misreadings forgiven
      ("CHALLENGE TO APOLLO", "CHALLENGE TO _POLLO"), at the same height on
      several pages;
    - "Continued on next page" in the last rows;
    - a short line on a row half made of those: the head that names each
      page's section beside its page number, the Supreme Court's "(Slip
      Opinion)" beside its first page's head;
    - text set sideways in the page's margin (arXiv's identifier).
    The parse's finder (lib/parse/pdf/furniture.ts) reads the same kinds of
    evidence from pdf.js's lines; this one reads pdftotext's boxes. */
function layoutOf(pdf: string): Layout {
  const sizes = new Map<number, { width: number; height: number }>();
  const byKey = new Map<string, Line>();
  for (const row of run(["-tsv", pdf, "-"]).split("\n").slice(1)) {
    const f = row.split("\t");
    if (f.length < 12) continue;
    const [level, page, par, block, line] = f.slice(0, 5).map(Number);
    const [left, top, width, height] = [6, 7, 8, 9].map((i) => Number(f[i]));
    if (level === 1) sizes.set(page, { width, height });
    const key = `${page}|${par}|${block}|${line}`;
    if (level === 4) byKey.set(key, { page, top, bottom: top + height, left, right: left + width, text: "" });
    const entry = byKey.get(key);
    if (level === 5 && entry) entry.text = entry.text ? `${entry.text} ${f[11]}` : f[11];
  }
  const lines = [...byKey.values()].filter((l) => l.text.trim());
  const furniture = new Set<Line>();
  const size = (l: Line) => sizes.get(l.page) ?? { width: 612, height: 792 };
  for (const l of lines) {
    const tall = l.bottom - l.top;
    if (tall > 30 && tall > 3 * (l.right - l.left) && (l.right < 0.1 * size(l).width || l.left > 0.9 * size(l).width)) furniture.add(l);
  }
  // Each page's rows (lines whose tops lie within 3 pt, left to right), its
  // first and last two, and its first and last.
  const edgeRows: Line[][] = [];
  const lastRows: Line[][] = [];
  const outermost = new Set<Line>();
  for (const page of sizes.keys()) {
    const rows: Line[][] = [];
    for (const l of lines.filter((x) => x.page === page && !furniture.has(x)).sort((a, b) => a.top - b.top)) {
      const row = rows.at(-1);
      if (row && Math.abs(row[0].top - l.top) < 3) row.push(l);
      else rows.push([l]);
    }
    for (const row of rows) row.sort((a, b) => a.left - b.left);
    edgeRows.push(...new Set([...rows.slice(0, 2), ...rows.slice(-2)]));
    lastRows.push(...rows.slice(-2));
    for (const l of [...(rows[0] ?? []), ...(rows.at(-1) ?? [])]) outermost.add(l);
  }
  const candidates = edgeRows.flat();
  const needed = sizes.size <= 8 ? 2 : 3;
  const near = (a: { page: number; top: number }, b: { top: number }) => Math.abs(a.top - b.top) <= 0.03 * (sizes.get(a.page)?.height ?? 792);
  const outer = (l: Line) => l.bottom < 0.08 * size(l).height || l.top > 0.92 * size(l).height;

  // Page numbers: a lone number whose distance from the page's index repeats
  // at its height on `needed` pages (a figure's axis label "1" on page 1
  // stands apart from the page numbers' height); a lone number at that
  // distance in a page's first or last row (a paper sets its first page's
  // number at the foot, the others' in the head); a lone number in the
  // page's outer 8%.
  const numbered = candidates.flatMap((l) => {
    const m = NUMBER_LINE_RE.exec(l.text.trim());
    return m ? [{ line: l, offset: Number(m[1]) - l.page }] : [];
  });
  for (const { line, offset } of numbered) {
    const pages = new Set(numbered.filter((o) => o.offset === offset && near(o.line, line)).map((o) => o.line.page));
    if (pages.size >= needed) furniture.add(line);
  }
  const offsets = new Set(numbered.filter((n) => furniture.has(n.line)).map((n) => n.offset));
  for (const { line, offset } of numbered) if (offsets.has(offset) && outermost.has(line)) furniture.add(line);
  for (const l of candidates) if (outer(l) && PAGE_NUMBER_RE.test(l.text.trim())) furniture.add(l);

  // Repeats: a line or a whole row of three letters or more (a diagram's
  // label "o3" tops pages too) that reads the same at the same height (3% of
  // the page) on `needed` pages. A row, since pdftotext cuts a head at its
  // gaps where OCR reads it whole on other pages ("CHALLENGE", "TO",
  // "P, POLLO").
  type Unit = { lines: Line[]; text: string; page: number; top: number };
  const units: Unit[] = [
    ...candidates.map((l) => ({ lines: [l], text: l.text, page: l.page, top: l.top })),
    ...edgeRows.filter((r) => r.length > 1).map((r) => ({ lines: r, text: r.map((l) => l.text.trim()).join(" "), page: r[0].page, top: r[0].top })),
  ].filter((u) => lettersOf(u.text).length >= 3);
  const byText = new Map<string, Unit[]>();
  for (const u of units) byText.set(keyOf(u.text), [...(byText.get(keyOf(u.text)) ?? []), u]);
  for (const u of units) {
    const pages = new Set((byText.get(keyOf(u.text)) ?? []).filter((o) => near(o, u)).map((o) => o.page));
    if (pages.size < needed) for (const o of units) if (!pages.has(o.page) && near(o, u) && ocrSame(u.text, o.text)) pages.add(o.page);
    if (pages.size >= needed) for (const l of u.lines) furniture.add(l);
  }
  for (const l of lastRows.flat()) if (CONTINUED_RE.test(l.text.trim())) furniture.add(l);
  // A row half furniture is furniture: a table's row at a page's top holds
  // one cell that repeats ("closed") among cells that do not.
  for (const row of edgeRows) {
    if (row.filter((l) => furniture.has(l)).length * 2 >= row.length) for (const l of row) if (l.text.trim().split(/\s+/).length <= 8) furniture.add(l);
  }
  return { lines, furniture: lines.filter((l) => furniture.has(l)), sizes };
}

/** Two lines with the same words as OCR reads them on two pages: letters
    within a fifth, and every word of four letters or more close to one of
    the other's, so two captions that differ in one word stay apart. */
export function ocrSame(a: string, b: string): boolean {
  const [la, lb] = [lettersOf(a), lettersOf(b)];
  const n = Math.min(la.length, lb.length);
  if (n < 10 || editDistance(la, lb, Math.floor(n * 0.2)) > Math.floor(n * 0.2)) return false;
  const words = (t: string) => normText(t).split(/[^\p{L}]+/u).filter((w) => w.length >= 4);
  const close = (w: string, list: string[]) => list.some((v) => editDistance(w, v, Math.floor(w.length / 3)) <= Math.floor(w.length / 3));
  const [wa, wb] = [words(a), words(b)];
  return wa.every((w) => close(w, wb)) && wb.every((w) => close(w, wa));
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
  const raw = run(["-raw", "-enc", "UTF-8", ...range, pdf, "-"])
    .split("\f")
    .map((page) => page.split("\n"));
  if (raw.length > 1 && raw.at(-1)?.join("").trim() === "") raw.pop();
  let layout = layouts.get(pdf);
  if (!layout) layouts.set(pdf, (layout = layoutOf(pdf)));
  const inRange = (l: Line) => !pages || (l.page >= pages[0] && l.page <= pages[1]);
  const lines = layout.lines.filter(inRange);
  return { first: pages?.[0] ?? 1, pages: new Set(lines.map((l) => l.page)).size, raw, lines, furniture: layout.furniture.filter(inRange), sizes: layout.sizes };
}

type Leaks = { strings: number; leaked: number; leaks: number; clean: number | null; found: { text: string; at: { unit: number; tok: number }[] }[] };

/** Furniture lines' words at the candidate's edges (table cells aside: a
    cell may hold a number), past the times the same line stands among the
    PDF's other lines (a chapter title that is also the running head). The
    candidate's title is the page's own line where the running head repeats
    it, and a footnote's label or mark is no page number. */
function leaksOf(pdf: PdfText, furniture: Line[], cand: Flat): Leaks {
  const furnitureSet = new Set(furniture);
  const others = new Map<string, number>();
  for (const l of pdf.lines) if (!furnitureSet.has(l)) others.set(normText(l.text), (others.get(normText(l.text)) ?? 0) + 1);
  const strings = [...new Set(furniture.map((f) => f.text.trim()))].filter((f) => wordsOf(f).length > 0);
  const matches = furnitureMatches(
    cand,
    strings.map((f) => wordsOf(f).map((w) => w.w)),
    false,
    false,
  ).map((list) => list.filter((m) => cand.blocks[cand.units[m.unit].block].kind !== "title"));
  let leaked = 0;
  let leaks = 0;
  const found: Leaks["found"] = [];
  strings.forEach((text, x) => {
    const excess = matches[x].length - (others.get(normText(text)) ?? 0);
    if (excess <= 0) return;
    leaked++;
    leaks += excess;
    found.push({ text, at: matches[x] });
  });
  return { strings: strings.length, leaked, leaks, clean: strings.length > 0 ? 1 - leaked / strings.length : null, found };
}

export type FreeScores = {
  composite: number;
  coverage: {
    recall: number | null;
    precision: number | null;
    f1: number | null;
    expected: number;
    words: number;
    /** The words the candidate lacks most, and holds past the PDF's most, with their counts. */
    missing: [string, number][];
    extra: [string, number][];
  };
  furniture: Leaks;
  numberLines: { count: number; score: number; found: { unit: number; text: string }[] };
  garbles: { count: number; score: number; found: { kind: string; match: string; unit: number; text: string }[] };
  /** Display equations as LaTeX the glyph check passes, over every display the page sets in TeX's math fonts. */
  math: number | null;
};

/** The candidate's lines: its units cut at line breaks and where pages
    begin (tables, lists, and code aside). */
function candidateLines(cand: Flat): { unit: number; text: string }[] {
  const out: { unit: number; text: string }[] = [];
  cand.units.forEach((unit, u) => {
    const kind = cand.blocks[unit.block].kind;
    if (kind === "table" || kind === "list" || kind === "code") return;
    const cuts = [...new Set([0, unit.text.length, ...unit.breaks])].sort((a, b) => a - b);
    for (let k = 0; k + 1 < cuts.length; k++) {
      for (const line of unit.text.slice(cuts[k], cuts[k + 1]).split("\n")) if (line.trim()) out.push({ unit: u, text: line.trim() });
    }
  });
  return out;
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
function printedWords(cand: Flat): { words: string[]; glyphs: Map<string, number> } {
  const words = cand.toks.map((t) => t.w);
  for (const block of cand.blocks) if (block.kind === "list") for (const item of block.items) words.push(...wordsOf(item.marker).map((w) => w.w));
  const glyphs = new Map<string, number>();
  for (const m of cand.math) {
    const reading = m.text?.trim() ? m.text : m.latex !== undefined || m.mathml !== undefined ? mathLeaves(m, m.display).join(" ") : "";
    for (const w of wordsOf(`${reading} ${m.label ?? ""}`)) for (const ch of w.w) glyphs.set(ch, (glyphs.get(ch) ?? 0) + 1);
  }
  return { words, glyphs };
}

/** The reference-free checks: text coverage against pdftotext (every word of
    the PDF once, less its furniture lines; a line-end hyphen joins its word
    when the candidate holds the joined word), furniture lines at the
    candidate's edges, lines that are only a page number, garbled glyphs (by
    string, and for a PDF in TeX's math fonts by the glyphs' codes), and
    display math as checked LaTeX (glyphs.ts). */
export function freeScores(pdf: PdfText, cand: Flat, glyphs?: GlyphScores): FreeScores {
  const { words: printed, glyphs: formulaGlyphs } = printedWords(cand);
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
  // A diagram's labels are the figure's, not words to cover: short lines
  // (three words at most) inside a region the candidate shows as a figure.
  // A paragraph shown as a picture still is (its lines are long).
  const figures = cand.blocks.flatMap((b) => (b.kind === "figure" && b.at ? [b.at] : []));
  const labels = pdf.lines.filter((l) => {
    const size = pdf.sizes.get(l.page);
    if (!size || wordsOf(l.text).length > 3) return false;
    const [x, y] = [((l.left + l.right) / 2 / size.width) * 100, ((l.top + l.bottom) / 2 / size.height) * 100];
    return figures.some((f) => {
      const b = regionBounds(f.region);
      return f.page === l.page && x >= b.x1 && x <= b.x2 && y >= b.y1 && y <= b.y2;
    });
  });
  pdf.raw.forEach((rawLines, p) => {
    const lines = rawLines.map((line) => {
      // A raised footnote label runs into its note's first word ("1All amounts…").
      const own = line.replace(/^(\s*\d{1,3})(?=\p{Lu}\p{Ll})/u, "$1 ");
      const hollow = /^\s*o\s+(\S.*)$/.exec(own);
      const left = hollow ? (items.get(opening(hollow[1])) ?? 0) : 0;
      if (!hollow || left <= 0) return own;
      items.set(opening(hollow[1]), left - 1);
      return hollow[1];
    });
    const drop = countWords([...pdf.furniture, ...labels].filter((f) => f.page === pdf.first + p).map((f) => f.text));
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
  const recall = total > 0 ? (hits + formulaHits) / total : null;
  const precision = printed.length - forgiven > 0 ? hits / (printed.length - forgiven) : null;
  const f1 = recall === null || precision === null ? null : recall + precision > 0 ? (2 * recall * precision) / (recall + precision) : 0;
  const furniture = leaksOf(pdf, pdf.furniture, cand);
  const furnitureSet = new Set(pdf.furniture);
  const numbers = candidateLines(cand).filter((l) => PAGE_NUMBER_RE.test(l.text));
  const ownNumbers = pdf.lines.filter((l) => !furnitureSet.has(l) && PAGE_NUMBER_RE.test(l.text.trim())).length;
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
  const displays = glyphs ? glyphs.checked + glyphs.mathImages : 0;
  const parts: Record<keyof typeof FREE_WEIGHTS, number | null> = {
    coverage: f1,
    furniture: furniture.clean,
    numbers: Math.max(0, 1 - numberCount / Math.max(1, pdf.pages)),
    garbles: Math.max(0, 1 - garbleExcess / (5 + cand.toks.length / 100)),
    math: glyphs && displays > 0 ? glyphs.passed / displays : null,
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
      words: printed.length,
      missing: most(expected, new Map([...new Set([...candBag.keys(), ...covered.keys()])].map((w) => [w, (candBag.get(w) ?? 0) + (covered.get(w) ?? 0)]))),
      extra: most(candBag, expected),
    },
    furniture,
    numberLines: { count: numberCount, score: parts.numbers ?? 0, found: numbers },
    garbles: { count: garbleExcess, score: parts.garbles ?? 0, found: garbled },
    math: parts.math,
  };
}
