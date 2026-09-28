/**
 * The check of a rendering against its reference, with pdftotext as the reader.
 * Furniture is what prints in the page's head and foot bands. The words of the page's body are compared
 * with the reference's prose words; math, a vector figure's labels, and a long table's repeated header rows
 * are left out of the count, since their text-layer order or repetition is not prose.
 */
import { execFileSync } from "node:child_process";
import { pictureWords, plainReading, type Leaf, type SpecSpan } from "./spec";

type Word = { text: string; x0: number; x1: number; y0: number; y1: number };
/** A page's lines: the body's as text in reading order, the bands' as words with positions, the body's in the
    PDF's own drawing order (`raw`, which keeps a line's prose together around inline math), and `stray`, a body
    line at the very top or bottom of the page that reads like a page number (a band set too thin). */
export type PdfPage = { width: number; height: number; body: string[]; bands: Word[][]; raw: string[]; stray: string[] };

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decode = (text: string) =>
  text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (all, name: string) =>
    name[0] === "#" ? String.fromCodePoint(Number.parseInt(name.slice(name[1] === "x" ? 2 : 1), name[1] === "x" ? 16 : 10)) : (ENTITIES[name] ?? all),
  );

/** The PDF's pages as pdftotext reads them, split into body and bands (`bands`, points from the top and bottom edges). */
export function readPdf(path: string, bands: { top: number; bottom: number }): PdfPage[] {
  const html = execFileSync("pdftotext", ["-bbox-layout", "-enc", "UTF-8", path, "-"], { encoding: "utf8", maxBuffer: 1 << 28 });
  const pages: PdfPage[] = [];
  for (const page of html.matchAll(/<page width="([\d.]+)" height="([\d.]+)">([\s\S]*?)<\/page>/g)) {
    const width = Number(page[1]);
    const height = Number(page[2]);
    const out: PdfPage = { width, height, body: [], bands: [], raw: [], stray: [] };
    const edges: { text: string; y0: number; y1: number }[] = [];
    for (const line of page[3].matchAll(/<line [^>]*>([\s\S]*?)<\/line>/g)) {
      const words: Word[] = [...line[1].matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([\s\S]*?)<\/word>/g)].map((w) => ({
        text: decode(w[5]),
        x0: Number(w[1]),
        y0: Number(w[2]),
        x1: Number(w[3]),
        y1: Number(w[4]),
      }));
      if (!words.length) continue;
      const inBand = words.every((w) => w.y1 <= bands.top) || words.every((w) => w.y0 >= height - bands.bottom);
      if (inBand) out.bands.push(words);
      else {
        out.body.push(words.map((w) => w.text).join(" "));
        edges.push({ text: out.body[out.body.length - 1], y0: Math.min(...words.map((w) => w.y0)), y1: Math.max(...words.map((w) => w.y1)) });
      }
    }
    // A page number stands apart from the text; a fraction's numerator sits a few points above its line.
    edges.sort((a, c) => a.y0 - c.y0);
    const [first, second] = edges;
    const [last, beforeLast] = [edges[edges.length - 1], edges[edges.length - 2]];
    const number = (text: string) => /^(page\s+)?\d+(\s*(of|\/)\s*\d+)?$/i.test(text.trim());
    if (first && second && number(first.text) && second.y0 - first.y1 > 12) out.stray.push(first.text);
    if (last && beforeLast && last !== first && number(last.text) && last.y0 - beforeLast.y1 > 12) out.stray.push(last.text);
    pages.push(out);
  }
  // The same pages in drawing order, less the lines that print only what the bands hold.
  const raw = execFileSync("pdftotext", ["-raw", "-enc", "UTF-8", path, "-"], { encoding: "utf8", maxBuffer: 1 << 28 }).split("\f");
  pages.forEach((page, k) => {
    const band = count(page.bands.flatMap((words) => words.flatMap((w) => tokens(w.text))));
    const onlyBand = (line: string) => [...count(tokens(line))].every(([t, n]) => (band.get(t) ?? 0) >= n);
    page.raw = (raw[k] ?? "").split("\n").filter((line) => line.trim() && !onlyBand(line));
  });
  return pages;
}

/** The strings printed in the bands, each run of words split where a wide gap separates them; in page order. */
export function furnitureOf(pages: PdfPage[]): string[] {
  const seen = new Set<string>();
  for (const page of pages) {
    const lines = [...page.bands].sort((a, c) => a[0].y0 - c[0].y0 || a[0].x0 - c[0].x0);
    for (const words of lines) {
      const sorted = [...words].sort((a, c) => a.x0 - c.x0);
      let run: string[] = [];
      for (let k = 0; k < sorted.length; k++) {
        if (k > 0 && sorted[k].x0 - sorted[k - 1].x1 > 15) {
          seen.add(run.join(" "));
          run = [];
        }
        run.push(sorted[k].text);
      }
      if (run.length) seen.add(run.join(" "));
    }
  }
  return [...seen];
}

// ---------------------------------------------------------------- words

/** Text as the check compares it: NFKC (ligatures unfold), no soft hyphens or zero-width characters, one space. */
export const normalize = (text: string) =>
  text.normalize("NFKC").replace(/[\u00ad\u200b-\u200d\u2060\ufeff]/g, "").replace(/\s+/g, " ").trim();
/** Words: runs of letters or runs of digits, so a footnote mark glued to a word ("theory1") splits off. */
export const tokens = (text: string): string[] => normalize(text).match(/[\p{L}\p{M}]+|\p{N}+/gu) ?? [];

const count = (list: string[]) => {
  const out = new Map<string, number>();
  for (const t of list) out.set(t, (out.get(t) ?? 0) + 1);
  return out;
};

/** The reference's text, sorted by what the check does with it. */
function referenceText(leaves: Leaf[]) {
  const prose: string[] = [];
  const segments: string[] = [];
  const math: string[] = [];
  const excused: string[] = [];
  const repeated: string[] = [];
  // `prefix` (a list marker, a footnote's label) counts as words; `inSegment` says whether the lookup includes it.
  const addSpans = (spans: SpecSpan[], prefix = "", inSegment = true) => {
    let segment = inSegment ? prefix : "";
    if (!inSegment && prefix) prose.push(prefix);
    const flush = () => {
      prose.push(segment);
      segments.push(segment);
      segment = "";
    };
    for (const s of spans) {
      if (s.latex) {
        flush();
        math.push(s.text);
      } else if (s.footnote || s.qed) {
        // A footnote mark and a proof's box print apart from the words (a raised digit, a symbol glyph).
        prose.push(segment, s.text);
        segments.push(segment);
        segment = "";
      } else segment += s.text;
    }
    flush();
  };
  for (const { block } of leaves) {
    switch (block.kind) {
      case "title":
      case "heading":
      case "paragraph":
      case "quote":
        addSpans(block.spans);
        break;
      case "footnote":
        // The foot of the page prints the label before the note, glued to it in LaTeX, apart in Word.
        addSpans(block.spans, block.label, false);
        break;
      case "list":
        // A marker is printed by construction (LaTeX's \item, Word's numbering, a text span); pdftotext often sets it apart.
        for (const it of block.items) addSpans(it.spans, it.marker, false);
        break;
      case "equation":
        math.push(plainReading(block.latex));
        if (block.label) prose.push(block.label);
        break;
      case "table": {
        if (block.caption) addSpans(block.caption);
        const headers = block.rows.findIndex((r) => !r.cells.some((c) => c.header));
        block.rows.forEach((r, index) => {
          for (const c of r.cells) {
            addSpans(c.spans);
            if (block.layout?.long && index < (headers === -1 ? block.rows.length : headers)) repeated.push(c.spans.map((s) => s.text).join(""));
          }
        });
        if (block.layout?.continued) excused.push(block.layout.continued);
        break;
      }
      case "figure":
        if (block.caption) addSpans(block.caption);
        excused.push(...pictureWords(block.picture));
        break;
      case "code":
        prose.push(block.text);
        segments.push(...block.text.split("\n"));
        break;
      case "separator":
      case "pagebreak":
      // A contents field no one updated prints no entries.
      case "contents":
        break;
    }
  }
  return { prose, segments, math, excused, repeated };
}

/** Joins a word the text layer split with a gap ("S cripts" from synthesized small caps) when the joined
    word is the reference's and the second part alone is not, and puts closing punctuation standing alone
    ("arrays ,") back on the word before it. */
function joinSplitWords(line: string, vocabulary: Set<string>): string {
  const words = line.split(" ");
  const out: string[] = [];
  for (let k = 0; k < words.length; k++) {
    const last = out[out.length - 1];
    const word = words[k];
    if (last !== undefined && /^[,.;:!?)\]}”’]+$/.test(word) && /\p{L}$/u.test(last)) {
      out[out.length - 1] = last + word;
      continue;
    }
    // Up to four pieces ("ar X iv"): join them when together they are one reference word, and a piece after
    // the first is no reference word by itself.
    let joined = 0;
    for (let n = Math.min(4, words.length - k); n >= 2 && !joined; n--) {
      const pieces = words.slice(k, k + n);
      const whole = tokens(pieces.join(""));
      if (whole.length === 1 && vocabulary.has(whole[0]) && pieces.slice(1).some((piece) => !tokens(piece).every((t) => vocabulary.has(t)))) joined = n;
    }
    if (joined) {
      out.push(words.slice(k, k + joined).join(""));
      k += joined - 1;
    } else out.push(word);
  }
  return out.join(" ");
}

/** Joins a word split across lines: a line-end hyphen that TeX added goes when the joined word is the
    reference's; a compound broken at its own hyphen ("stop-" / "word") keeps the hyphen. */
function joinLines(lines: string[], vocabulary: Set<string>): string[] {
  const out = [...lines];
  for (let k = 0; k < out.length - 1; k++) {
    const end = out[k].match(/(\p{L}*)[-\u2010]$/u);
    if (!end) continue;
    // The word's other half starts the next line, or the one after a short line of math ("P n") set between.
    let next = k + 1;
    let start = out[next].match(/^(\p{Ll}\p{L}*)(\S*)/u);
    if (!start && out[next].length <= 6 && k + 2 < out.length) {
      const after = out[k + 2].match(/^(\p{Ll}\p{L}*)(\S*)/u);
      if (after && end[1] && vocabulary.has(normalize(end[1] + after[1]))) [next, start] = [k + 2, after];
    }
    if (!start) continue;
    out[k] = (end[1] && vocabulary.has(normalize(end[1] + start[1])) ? out[k].slice(0, -1) : out[k]) + start[0];
    out[next] = out[next].slice(start[0].length).replace(/^ /, "");
  }
  return out;
}

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

/** Joins a line that ends inside CJK text to the next one without a space: a line break there is not a space. */
function joinCjkLines(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    const last = out[out.length - 1];
    if (last !== undefined && CJK.test(last.slice(-1)) && CJK.test(line.charAt(0))) out[out.length - 1] = last + line;
    else out.push(line);
  }
  return out;
}

/** Joins a drop cap, a capital on a line of its own that the text layer may place anywhere, with the
    line-start word it begins ("S" and "CIENTIFIC"). */
function joinDropCaps(lines: string[], vocabulary: Set<string>): string[] {
  const out = [...lines];
  out.forEach((letter, k) => {
    if (!/^\p{Lu}$/u.test(letter)) return;
    const at = out.findIndex((line) => {
      const first = line.match(/^\p{L}+/u)?.[0];
      return first !== undefined && !vocabulary.has(first) && vocabulary.has(letter + first);
    });
    if (at === -1) return;
    out[at] = letter + out[at];
    out[k] = "";
  });
  return out;
}

export type Agreement = {
  pages: number;
  refWords: number;
  pdfWords: number;
  matched: number;
  recall: number;
  precision: number;
  /** F1 of recall and precision: the share of words the reference and the PDF agree on. */
  agreement: number;
  missing: [string, number][];
  extra: [string, number][];
  segments: { total: number; found: number; misses: string[] };
};

const letterCount = (word: string) => count([...word]);
const within = (small: Map<string, number>, large: Map<string, number>) => [...small].every(([ch, n]) => (large.get(ch) ?? 0) >= n);

/** The letters TeX's math fonts print for glyphs a reader cannot name and reads by their code: CMSY's ⟨ ⟩ ‖
    ("h", "i", "k", without ToUnicode maps), CMEX's big operators (∑ "P" "X", ∏ "Q" "Y", ∫ "R" "Z", ⋃ "S", ⋂ "T")
    and radicals ("p" to "t"). */
export const TEX_FALLBACK_LETTERS = "hikPQRSTXYZpqrst";

/** The PDF's body words against the reference's prose words. `fallback`: letters a symbol font's glyphs read as. */
export function checkRendering(leaves: Leaf[], pages: PdfPage[], fallback = ""): Agreement {
  const ref = referenceText(leaves);
  const refTokens = ref.prose.flatMap(tokens);
  const refBag = count(refTokens);
  const vocabulary = new Set([...refTokens, ...ref.math.flatMap(tokens)]);
  const joinAll = (list: string[]) => joinCjkLines(joinDropCaps(joinLines(list.map((line) => joinSplitWords(line, vocabulary)), vocabulary), vocabulary).filter(Boolean));
  // Two reading orders of the same text layer: the layout's lines, and the PDF's drawing order (which keeps a
  // line-end hyphen next to its word when a math glyph comes between them in the layout's order).
  const orders = [joinAll(pages.flatMap((page) => page.body)), joinAll(pages.flatMap((page) => page.raw))];

  // Extra words: what the body prints beyond the reference, except math, a figure's labels, and repeated header rows.
  // A word is math when its letters, less the fallback letters, all come from one formula.
  const formulas = ref.math.map((f) => letterCount(tokens(f).join("")));
  const isMath = (word: string) => {
    const rest = [...word].filter((ch) => !fallback.includes(ch));
    if (rest.length === 0) return word.length <= 6;
    const letters = letterCount(rest.join(""));
    return formulas.some((f) => within(letters, f));
  };
  const excused = new Set([...ref.excused, ...ref.repeated].flatMap(tokens));
  const measure = (lines: string[]) => {
    const pdfTokens = lines.flatMap(tokens);
    const pdfBag = count(pdfTokens);
    let matched = 0;
    const missing = new Map<string, number>();
    for (const [t, n] of refBag) {
      const hit = Math.min(n, pdfBag.get(t) ?? 0);
      matched += hit;
      if (hit < n) missing.set(t, n - hit);
    }
    const extra = new Map<string, number>();
    let extraCount = 0;
    for (const [t, n] of pdfBag) {
      const over = n - (refBag.get(t) ?? 0);
      if (over <= 0 || [...t].length === 1 || excused.has(t) || isMath(t)) continue;
      extra.set(t, over);
      extraCount += over;
    }
    const recall = refTokens.length ? matched / refTokens.length : 1;
    const precision = matched + extraCount ? matched / (matched + extraCount) : 1;
    const agreement = recall + precision ? (2 * recall * precision) / (recall + precision) : 0;
    return { pdfWords: pdfTokens.length, matched, recall, precision, agreement, missing, extra };
  };
  const [best] = orders.map(measure).sort((a, c) => c.agreement - a.agreement);

  // A segment is found when either reading order holds it.
  const texts = orders.map((list) => ` ${normalize(list.join(" "))} `);
  const checked = ref.segments.map(normalize).filter((s) => tokens(s).length >= 3);
  const misses = checked.filter((s) => !texts.some((text) => text.includes(s)));
  const top = (map: Map<string, number>) => [...map].sort((a, c) => c[1] - a[1] || a[0].localeCompare(c[0])).slice(0, 12);
  return {
    pages: pages.length,
    refWords: refTokens.length,
    pdfWords: best.pdfWords,
    matched: best.matched,
    recall: best.recall,
    precision: best.precision,
    agreement: best.agreement,
    missing: top(best.missing),
    extra: top(best.extra),
    segments: { total: checked.length, found: checked.length - misses.length, misses: misses.slice(0, 12) },
  };
}
