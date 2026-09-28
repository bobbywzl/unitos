import { execFileSync } from "node:child_process";
import { FREE_WEIGHTS, furnitureMatches, type Flat } from "./metrics";
import { garblesOf, normText, PAGE_NUMBER_RE, wordsOf } from "./text";

// Checks that need no reference: the PDF's own text (pdftotext) against the
// candidate's words, and detectors for what should never be in a parse.

type Line = { page: number; top: number; bottom: number; text: string };

/** The PDF's text by pdftotext: each page's lines in content order (-raw:
    the words to cover) and each line with its place (-tsv). Furniture lines
    stand in a page's top or bottom two rows, within 15% of its edge, and are
    a page number or repeat (digits aside) on several pages of the whole
    document, a range's pages or not. */
export type PdfText = { first: number; pages: number; raw: string[][]; lines: Line[]; furniture: Line[] };

function run(args: string[]): string {
  return execFileSync("pdftotext", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
}

const keyOf = (text: string) => normText(text).replace(/\d+/g, "#");

/** Every page's lines with their place, and the furniture lines among them. */
function layoutOf(pdf: string): { lines: Line[]; furniture: Line[] } {
  const heights = new Map<number, number>();
  const byKey = new Map<string, Line>();
  for (const row of run(["-tsv", pdf, "-"]).split("\n").slice(1)) {
    const f = row.split("\t");
    if (f.length < 12) continue;
    const [level, page, par, block, line] = f.slice(0, 5).map(Number);
    const [top, height] = [Number(f[7]), Number(f[9])];
    if (level === 1) heights.set(page, height);
    const key = `${page}|${par}|${block}|${line}`;
    if (level === 4) byKey.set(key, { page, top, bottom: top + height, text: "" });
    const entry = byKey.get(key);
    if (level === 5 && entry) entry.text = entry.text ? `${entry.text} ${f[11]}` : f[11];
  }
  const lines = [...byKey.values()].filter((l) => l.text.trim());
  const edge: Line[] = [];
  for (const [page, height] of heights) {
    const rows: Line[][] = [];
    for (const l of lines.filter((x) => x.page === page).sort((a, b) => a.top - b.top)) {
      const row = rows.at(-1);
      if (row && Math.abs(row[0].top - l.top) < 3) row.push(l);
      else rows.push([l]);
    }
    for (const row of new Set([...rows.slice(0, 2), ...rows.slice(-2)])) {
      for (const l of row) if (l.top < height * 0.15 || l.bottom > height * 0.85) edge.push(l);
    }
  }
  const onPages = new Map<string, Set<number>>();
  for (const l of edge) onPages.set(keyOf(l.text), (onPages.get(keyOf(l.text)) ?? new Set<number>()).add(l.page));
  const needed = heights.size <= 8 ? 2 : 3;
  const furniture = edge.filter((l) => PAGE_NUMBER_RE.test(l.text.trim()) || (onPages.get(keyOf(l.text))?.size ?? 0) >= needed);
  return { lines, furniture };
}

const layouts = new Map<string, { lines: Line[]; furniture: Line[] }>();

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
  return { first: pages?.[0] ?? 1, pages: new Set(lines.map((l) => l.page)).size, raw, lines, furniture: layout.furniture.filter(inRange) };
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
  furniture: { strings: number; leaked: number; leaks: number; clean: number | null; found: { text: string; at: { unit: number; tok: number }[] }[] };
  numberLines: { count: number; score: number; found: { unit: number; text: string }[] };
  garbles: { count: number; score: number; found: { kind: string; match: string; unit: number; text: string }[] };
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

/** The reference-free checks: text coverage against pdftotext (every word of
    the PDF once, less its furniture lines; a line-end hyphen joins its word
    when the candidate holds the joined word), furniture lines at the
    candidate's edges, lines that are only a page number, garbled glyphs. */
export function freeScores(pdf: PdfText, cand: Flat): FreeScores {
  const candBag = countWords([]);
  for (const t of cand.toks) candBag.set(t.w, (candBag.get(t.w) ?? 0) + 1);
  const expected = new Map<string, number>();
  pdf.raw.forEach((rawLines, p) => {
    const lines = [...rawLines];
    const drop = countWords(pdf.furniture.filter((f) => f.page === pdf.first + p).map((f) => f.text));
    for (let i = 0; i + 1 < lines.length; i++) {
      const m = /(\p{L}+)-\s*$/u.exec(lines[i]);
      const next = /^\s*(\p{Ll}+)/u.exec(lines[i + 1]);
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
  for (const [w, n] of expected) {
    total += n;
    hits += Math.min(n, candBag.get(w) ?? 0);
  }
  const most = (a: Map<string, number>, b: Map<string, number>) =>
    [...a]
      .map(([w, n]): [string, number] => [w, n - (b.get(w) ?? 0)])
      .filter(([, n]) => n > 0)
      .sort((x, y) => y[1] - x[1])
      .slice(0, 20);
  const recall = total > 0 ? hits / total : null;
  const precision = cand.toks.length > 0 ? hits / cand.toks.length : null;
  const f1 = recall === null || precision === null ? null : recall + precision > 0 ? (2 * recall * precision) / (recall + precision) : 0;
  // Furniture: a furniture line's words at the candidate's edges (table
  // cells aside: a cell may hold a number), past the times the same line
  // stands among the PDF's other lines (a chapter title that is also the
  // running head).
  const furnitureSet = new Set(pdf.furniture);
  const others = countWords([]);
  for (const l of pdf.lines) if (!furnitureSet.has(l)) others.set(normText(l.text), (others.get(normText(l.text)) ?? 0) + 1);
  const strings = [...new Set(pdf.furniture.map((f) => f.text.trim()))].filter((f) => wordsOf(f).length > 0);
  const matches = furnitureMatches(
    cand,
    strings.map((f) => wordsOf(f).map((w) => w.w)),
    false,
  );
  let leaked = 0;
  let leaks = 0;
  const found: FreeScores["furniture"]["found"] = [];
  strings.forEach((text, x) => {
    const excess = matches[x].length - (others.get(normText(text)) ?? 0);
    if (excess <= 0) return;
    leaked++;
    leaks += excess;
    found.push({ text, at: matches[x] });
  });
  const numbers = candidateLines(cand).filter((l) => PAGE_NUMBER_RE.test(l.text));
  const ownNumbers = pdf.lines.filter((l) => !furnitureSet.has(l) && PAGE_NUMBER_RE.test(l.text.trim())).length;
  const numberCount = Math.max(0, numbers.length - ownNumbers);
  const garbled: FreeScores["garbles"]["found"] = [];
  cand.units.forEach((unit, u) => {
    for (const g of garblesOf(unit.text)) garbled.push({ kind: g.kind, match: g.match, unit: u, text: unit.text });
  });
  for (const m of cand.math) if (m.image) for (const g of garblesOf(m.image)) garbled.push({ kind: g.kind, match: g.match, unit: -1, text: m.image });
  // The PDF's own text layer holds the same garbles (they come from it), so
  // none is forgiven here.
  const garbleExcess = garbled.length;
  const parts: Record<keyof typeof FREE_WEIGHTS, number | null> = {
    coverage: f1,
    furniture: strings.length > 0 ? 1 - leaked / strings.length : null,
    numbers: Math.max(0, 1 - numberCount / Math.max(1, pdf.pages)),
    garbles: Math.max(0, 1 - garbleExcess / (5 + cand.toks.length / 100)),
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
    coverage: { recall, precision, f1, expected: total, words: cand.toks.length, missing: most(expected, candBag), extra: most(candBag, expected) },
    furniture: { strings: strings.length, leaked, leaks, clean: parts.furniture, found },
    numberLines: { count: numberCount, score: parts.numbers ?? 0, found: numbers },
    garbles: { count: garbleExcess, score: parts.garbles ?? 0, found: garbled },
  };
}
