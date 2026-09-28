import { isMathText, type Doc, type DocBlock } from "./adapt";
import { mathLeaves, mathTokens, normLabel, sequenceSimilarity, textMathTokens } from "./math";
import type { RefBlock, Span } from "./model";
import { garblesOf, wordsOf, type Garble } from "./text";

// The metrics: a reference and a candidate (a parse or an import, through
// the adapters) scored word by word and block by block. Every metric is a
// pure function of the two flat views and their word matching. One line each:
//   text        word recall, precision, F1 over the two multisets of words (math out)
//   order       share of matched words that stand in the reference's order (footnotes apart)
//   furniture   share of furniture strings never at the candidate's edges more often than at the reference's
//   blocks      F1 of reference blocks found with their kind and candidate blocks of the right kind
//   paragraphs  1 − (units split + units merged) / reference units (a paragraph, a heading, a list item)
//   headings    share of reference headings found as headings at their level, after the best level shift
//   lists       mean of list item recall, depth accuracy, and marker accuracy (the marker as drawn)
//   tables      F1 of table words in their cell, rows and columns mapped one to one (leaks both ways reported)
//   math        mean of display and inline similarity of canonical forms (images and words read as math reported)
//   garbles     1 − garbled glyphs past the reference's own over (5 + words / 100)
//   styles      mean F1 of the styles the reference marks (bold, italic, underline, small caps, sub, sup)
//   footnotes   mean of notes found, notes linked from their mark, and the notes' words F1
//   roles       mean of alignment, indentation, and captions F1, checkbox states, separators and
//               quotations found, and printed equation labels right

/** The composite's weights: what each part of a perfect parse is worth. A
    part that does not apply (no table on either side) drops out and the
    rest share its weight; the composite is out of 100. */
export const WEIGHTS = {
  text: 25, // word F1
  order: 10, // reading order
  furniture: 10, // furniture strings that never leak
  blocks: 10, // block kinds found, F1
  paragraphs: 5, // no unit split, no units merged
  headings: 5, // headings found at their level
  lists: 5, // list items found, at their depth, with their marker
  tables: 10, // table words in their cell, F1
  math: 10, // display and inline math similarity
  garbles: 5, // no garbled glyph
  styles: 5, // style F1
  footnotes: 5, // footnotes found, linked, and their words right
  roles: 5, // alignment, indentation, captions, checkboxes, separators, quotations, equation labels
} as const;
export type Part = keyof typeof WEIGHTS;

/** The reference-free composite's weights (free.ts); out of 100 over the parts that apply. */
export const FREE_WEIGHTS = {
  coverage: 60, // word F1 against pdftotext
  furniture: 20, // furniture lines that never leak
  numbers: 10, // no line that is only a page number
  garbles: 10, // no garbled glyph, by string and by the math font's code
  math: 10, // display equations as LaTeX that draws the page's symbols (glyphs.ts)
} as const;

// ── The flat view ───────────────────────────────────────────────────────────

/** A run of a block's words that belongs to one place: a paragraph, a list
    item, a table cell (-1: the table's caption). */
export type Unit = {
  block: number;
  index: number;
  row: number;
  col: number;
  text: string;
  breaks: number[];
  /** Its words count for the style metrics (not a title, heading, or code). */
  styled: boolean;
  /** Its words: [first, end) in the document's words. */
  first: number;
  end: number;
  /** A candidate's footnote marks: where each stands in `text`, and the id of its note. */
  marks: { at: number; end: number; id: string }[];
  /** Its raised runs [start, end) in `text`: a reference's footnote marks are among them. */
  raised: [number, number][];
};
/** The styles scored on the characters of matched words. */
export const STYLES = ["bold", "italic", "underline", "smallCaps", "sub", "sup"] as const;
export type Style = (typeof STYLES)[number];
/** A word; `note`: a candidate's footnote mark or label (the page editor draws its own numbers there). */
export type Tok = { w: string; unit: number; start: number; end: number; note?: true } & Record<Style, boolean>;
/** A formula: display (a block of its own) or inline (in a unit, before word `at`). */
export type MathItem = {
  block: number;
  unit: number;
  at: number;
  display: boolean;
  latex?: string;
  mathml?: string;
  label?: string;
  /** An inline formula's plain reading, when its source gives one. */
  text?: string;
  /** An equation shown as an image: the glyph text read from it. */
  image?: string;
};
export type Flat = { blocks: DocBlock[]; units: Unit[]; toks: Tok[]; math: MathItem[]; unitsOf: number[][] };

type Row = Extract<RefBlock, { kind: "table" }>["rows"][number];

/** Each cell's place in the table's grid: the first free slot of its row,
    past the slots merged cells above hold. */
export function gridPlaces(rows: Row[]): { row: number; col: number }[][] {
  const taken: boolean[][] = [];
  return rows.map((row, r) => {
    let col = 0;
    return row.cells.map((cell) => {
      while (taken[r]?.[col]) col++;
      const place = { row: r, col };
      for (let dr = 0; dr < (cell.rowspan ?? 1); dr++) {
        for (let dc = 0; dc < (cell.colspan ?? 1); dc++) (taken[r + dr] ??= [])[col + dc] = true;
      }
      col += cell.colspan ?? 1;
      return place;
    });
  });
}

function addUnit(flat: Flat, block: number, index: number, spans: Span[], opts: { row?: number; col?: number; styled: boolean; breaks?: number[]; shift?: number }) {
  let text = "";
  const u = flat.units.length;
  const first = flat.toks.length;
  const length = spans.reduce((n, s) => n + s.text.length, 0);
  const flags = Object.fromEntries(STYLES.map((style) => [style, new Uint8Array(length)])) as Record<Style, Uint8Array>;
  const raised: [number, number][] = [];
  let stretch = 0;
  const flush = (to: number) => {
    for (const w of wordsOf(text.slice(stretch, to))) {
      const [start, end] = [w.start + stretch, w.end + stretch];
      const share = (style: Style) => flags[style].subarray(start, end).reduce((n, f) => n + f, 0) * 2 > end - start;
      flat.toks.push({ w: w.w, unit: u, start, end, ...(Object.fromEntries(STYLES.map((style) => [style, share(style)])) as Record<Style, boolean>) });
    }
  };
  for (const span of spans) {
    const start = text.length;
    text += span.text;
    if (span.latex !== undefined || span.mathml !== undefined) {
      flush(start);
      flat.math.push({ block, unit: u, at: flat.toks.length, display: false, latex: span.latex, mathml: span.mathml, text: span.text });
      stretch = text.length;
      continue;
    }
    for (const style of STYLES) if (span[style]) flags[style].fill(1, start, text.length);
    if (span.sup && text.length > start) raised.push([start, text.length]);
  }
  flush(text.length);
  const shift = opts.shift ?? 0;
  const marks = (flat.blocks[block].marks ?? []).filter((m) => m.unit === index).map(({ at, end, id }) => ({ at: at + shift, end: end + shift, id }));
  // A footnote's own label (its first characters) and the marks linking to one.
  for (let t = first; t < flat.toks.length; t++) {
    const tok = flat.toks[t];
    if (tok.start < shift || marks.some((m) => tok.start >= m.at && tok.end <= m.end)) tok.note = true;
  }
  flat.units.push({ block, index, row: opts.row ?? -1, col: opts.col ?? -1, text, breaks: opts.breaks ?? [], styled: opts.styled, first, end: flat.toks.length, marks, raised });
  flat.unitsOf[block].push(u);
}

/** A document as units, words, and formulas in reading order. */
export function flatten(doc: Doc): Flat {
  const flat: Flat = { blocks: doc.blocks, units: [], toks: [], math: [], unitsOf: [] };
  doc.blocks.forEach((block, b) => {
    flat.unitsOf.push([]);
    const breaks = (unit: number, shift = 0) => (block.breaks ?? []).filter((x) => x.unit === unit).map((x) => x.at + shift);
    switch (block.kind) {
      case "title":
      case "heading":
        return addUnit(flat, b, 0, block.spans, { styled: false, breaks: breaks(0) });
      case "paragraph":
      case "quote":
        return addUnit(flat, b, 0, block.spans, { styled: true, breaks: breaks(0) });
      case "footnote":
        return addUnit(flat, b, 0, [{ text: block.label ? `${block.label} ` : "" }, ...block.spans], {
          styled: true,
          breaks: breaks(0, block.label ? block.label.length + 1 : 0),
          shift: block.label ? block.label.length + 1 : 0,
        });
      case "list":
        return block.items.forEach((item, i) => addUnit(flat, b, i, item.spans, { styled: true, breaks: breaks(i) }));
      case "table": {
        if (block.caption) addUnit(flat, b, -1, block.caption, { styled: true });
        const places = gridPlaces(block.rows);
        let index = 0;
        // A header cell's words are bold as the table sets them: the table metric scores the header.
        block.rows.forEach((row, r) =>
          row.cells.forEach((cell, c) => addUnit(flat, b, index++, cell.spans, { row: places[r][c].row, col: places[r][c].col, styled: !cell.header })),
        );
        return;
      }
      case "figure":
        if (block.mathImage !== undefined) flat.math.push({ block: b, unit: -1, at: flat.toks.length, display: true, image: block.mathImage });
        else if (block.caption) addUnit(flat, b, 0, block.caption, { styled: true });
        return;
      case "equation":
        flat.math.push({ block: b, unit: -1, at: flat.toks.length, display: true, latex: block.latex, mathml: block.mathml, label: block.label });
        return;
      case "code":
        return addUnit(flat, b, 0, [{ text: block.text }], { styled: false });
      case "separator":
        return;
    }
  });
  return flat;
}

// ── Word matching ───────────────────────────────────────────────────────────

/** Pairs the words of two sequences, order not required: runs of words that
    occur once on each side seed a match (12, 6, 3, then 1 words long), each
    seed grows while the words agree, and the words left between matches
    pair with the nearest equal word ahead. Moved text still matches, so
    reading order can be measured on the pairs. */
export function matchWords(a: readonly string[], b: readonly string[]): { aTo: Int32Array; bTo: Int32Array } {
  const ids = new Map<string, number>();
  const id = (w: string) => {
    let v = ids.get(w);
    if (v === undefined) ids.set(w, (v = ids.size));
    return v;
  };
  const A = Int32Array.from(a, id);
  const B = Int32Array.from(b, id);
  const aTo = new Int32Array(A.length).fill(-1);
  const bTo = new Int32Array(B.length).fill(-1);
  const pair = (i: number, j: number) => {
    aTo[i] = j;
    bTo[j] = i;
  };
  const grow = (i: number, j: number) => {
    for (let x = i, y = j; x >= 0 && y >= 0 && aTo[x] < 0 && bTo[y] < 0 && A[x] === B[y]; x--, y--) pair(x, y);
    for (let x = i + 1, y = j + 1; x < A.length && y < B.length && aTo[x] < 0 && bTo[y] < 0 && A[x] === B[y]; x++, y++) pair(x, y);
  };
  for (const k of [12, 6, 3, 1]) {
    const grams = (arr: Int32Array, to: Int32Array) => {
      const at = new Map<string, number>(); // a run's key → its start, -1 when it occurs twice
      let free = 0; // unmatched words in a row, ending at i
      for (let i = 0; i < arr.length; i++) {
        free = to[i] < 0 ? free + 1 : 0;
        if (free < k) continue;
        const key = k === 1 ? String(arr[i]) : arr.subarray(i - k + 1, i + 1).join(",");
        at.set(key, at.has(key) ? -1 : i - k + 1);
      }
      return at;
    };
    const ga = grams(A, aTo);
    const gb = grams(B, bTo);
    const seeds: [number, number][] = [];
    for (const [key, i] of ga) {
      const j = gb.get(key);
      if (i >= 0 && j !== undefined && j >= 0) seeds.push([i, j]);
    }
    seeds.sort((x, y) => x[0] - y[0]);
    for (const [i, j] of seeds) if (aTo[i] < 0 && bTo[j] < 0) grow(i, j);
  }
  let last = -1;
  for (let i = 0; i < A.length; i++) {
    if (aTo[i] >= 0) {
      last = aTo[i];
      continue;
    }
    for (let j = last + 1; j < B.length && j <= last + 40 && bTo[j] < 0; j++) {
      if (B[j] === A[i]) {
        pair(i, j);
        last = j;
        break;
      }
    }
  }
  return { aTo, bTo };
}

// ── Block alignment ─────────────────────────────────────────────────────────

/** The two documents' words matched, and each block's counterpart: a
    reference block's owner is the candidate block holding most of its
    matched words; a candidate block's main is the reference block most of
    its matched words come from. A block with no words (an equation, a rule,
    an uncaptioned figure) pairs by its place between its neighbors. */
export type Alignment = {
  aTo: Int32Array;
  bTo: Int32Array;
  /** Reference block → candidate block → matched words (table captions out). */
  overlap: Map<number, Map<number, number>>;
  refMatched: Int32Array;
  candMatched: Int32Array;
  owner: Int32Array;
  main: Int32Array;
  /** Candidate blocks that are mostly a reference table's caption: neither
      right nor wrong as blocks. */
  caption: Uint8Array;
};

const hasWords = (flat: Flat, block: number) => flat.unitsOf[block].some((u) => flat.units[u].end > flat.units[u].first);

/** How well a candidate block stands in for a word-less reference block. */
function fit(ref: DocBlock, cand: DocBlock, candFlat: Flat, candBlock: number): number {
  if (ref.kind === "equation") {
    if (cand.kind === "equation") return 1 + sequenceSimilarity(mathTokens(ref, true), mathTokens(cand, true));
    if (cand.kind === "figure") return cand.mathImage !== undefined ? 0.5 : 0.4;
    const text = candFlat.unitsOf[candBlock].map((u) => candFlat.units[u].text).join(" ");
    return cand.kind === "paragraph" && isMathText(text) ? 0.3 : 0;
  }
  if (ref.kind === "figure") return cand.kind === "figure" ? (cand.mathImage === undefined ? 1 : 0.5) : 0;
  return ref.kind === cand.kind ? 1 : 0;
}

export function align(ref: Flat, cand: Flat): Alignment {
  const { aTo, bTo } = matchWords(
    ref.toks.map((t) => t.w),
    cand.toks.map((t) => t.w),
  );
  const overlap = new Map<number, Map<number, number>>();
  const refMatched = new Int32Array(ref.blocks.length);
  const candMatched = new Int32Array(cand.blocks.length);
  const captionWords = new Int32Array(cand.blocks.length);
  aTo.forEach((j, i) => {
    if (j < 0) return;
    const ru = ref.units[ref.toks[i].unit];
    const cb = cand.units[cand.toks[j].unit].block;
    if (ru.index === -1 && ref.blocks[ru.block].kind === "table") {
      captionWords[cb]++;
      return;
    }
    const row = overlap.get(ru.block) ?? new Map<number, number>();
    row.set(cb, (row.get(cb) ?? 0) + 1);
    overlap.set(ru.block, row);
    refMatched[ru.block]++;
    candMatched[cb]++;
  });
  const owner = new Int32Array(ref.blocks.length).fill(-1);
  const main = new Int32Array(cand.blocks.length).fill(-1);
  const mainCount = new Int32Array(cand.blocks.length);
  for (const [rb, row] of overlap) {
    let best = -1;
    let bestN = 0;
    for (const [cb, n] of row) {
      if (n > bestN || (n === bestN && cb < best)) [best, bestN] = [cb, n];
      if (n > mainCount[cb] || (n === mainCount[cb] && rb < main[cb])) {
        main[cb] = rb;
        mainCount[cb] = n;
      }
    }
    owner[rb] = best;
  }
  // A table that carries its caption is a table, however few of its cells' words match.
  const caption = new Uint8Array(cand.blocks.length);
  captionWords.forEach((n, cb) => {
    if (n > candMatched[cb] && cand.blocks[cb].kind !== "table") caption[cb] = 1;
  });
  // Word-less reference blocks pair with a free candidate block between the
  // owners of their neighbors.
  const used = new Set<number>();
  for (let rb = 0; rb < ref.blocks.length; rb++) {
    const kind = ref.blocks[rb].kind;
    if (owner[rb] >= 0 || hasWords(ref, rb) || !(kind === "equation" || kind === "figure" || kind === "separator")) continue;
    let lo = -1;
    let hi = cand.blocks.length;
    for (let p = rb - 1; p >= 0; p--) if (owner[p] >= 0) { lo = owner[p]; break; }
    for (let n = rb + 1; n < ref.blocks.length; n++) if (owner[n] >= 0 && hasWords(ref, n)) { hi = owner[n]; break; }
    if (hi <= lo) hi = Math.min(cand.blocks.length, lo + 8);
    let best = -1;
    let bestFit = 0;
    for (let cb = lo + 1; cb < hi; cb++) {
      if (used.has(cb) || candMatched[cb] >= 3) continue;
      const f = fit(ref.blocks[rb], cand.blocks[cb], cand, cb);
      if (f > bestFit) [best, bestFit] = [cb, f];
    }
    if (best >= 0) {
      owner[rb] = best;
      main[best] = rb;
      used.add(best);
    }
  }
  return { aTo, bTo, overlap, refMatched, candMatched, owner, main, caption };
}

const ov = (a: Alignment, rb: number, cb: number) => a.overlap.get(rb)?.get(cb) ?? 0;

// ── Metrics ─────────────────────────────────────────────────────────────────

function countOf(words: Iterable<string>): Map<string, number> {
  const out = new Map<string, number>();
  for (const w of words) out.set(w, (out.get(w) ?? 0) + 1);
  return out;
}

const f1Of = (p: number | null, r: number | null) => (p === null || r === null ? null : p + r === 0 ? 0 : (2 * p * r) / (p + r));
const share = (n: number, d: number) => (d > 0 ? n / d : null);

export type WordScores = { recall: number | null; precision: number | null; f1: number | null; refWords: number; candWords: number };

/** Word recall, precision, F1 over the two multisets of words (math out);
    a candidate word also counts as right when it is a glyph of the
    reference's math, which a parse that reads math as words prints. */
export function wordScores(ref: Flat, cand: Flat): WordScores {
  const refBag = countOf(ref.toks.map((t) => t.w));
  const candBag = countOf(cand.toks.map((t) => t.w));
  const mathBag = new Map<string, number>();
  const mathChars = new Map<string, number>();
  for (const m of ref.math) {
    const leaves = m.latex !== undefined || m.mathml !== undefined ? mathLeaves(m, m.display) : [];
    for (const w of wordsOf([...leaves, m.label ?? ""].join(" "))) {
      mathBag.set(w.w, (mathBag.get(w.w) ?? 0) + 1);
      for (const ch of w.w) mathChars.set(ch, (mathChars.get(ch) ?? 0) + 1);
    }
  }
  const noteBag = countOf(cand.toks.filter((t) => t.note).map((t) => t.w));
  let recallHits = 0;
  for (const [w, n] of refBag) recallHits += Math.min(n, candBag.get(w) ?? 0);
  let precisionHits = 0;
  for (const [w, n] of candBag) {
    const prose = Math.min(n, refBag.get(w) ?? 0);
    const whole = Math.min(n - prose, mathBag.get(w) ?? 0);
    if (whole > 0) mathBag.set(w, (mathBag.get(w) ?? 0) - whole);
    // A footnote number the page editor draws where the page prints a sign (¶¶, †) is no error of the words.
    const noted = Math.min(n - prose - whole, noteBag.get(w) ?? 0);
    let rest = n - prose - whole - noted;
    precisionHits += prose + whole + noted;
    const chars = countOf(w);
    while (rest > 0 && [...w].length <= 4 && [...chars].every(([ch, c]) => (mathChars.get(ch) ?? 0) >= c)) {
      for (const [ch, c] of chars) mathChars.set(ch, (mathChars.get(ch) ?? 0) - c);
      rest--;
      precisionHits++;
    }
  }
  const recall = share(recallHits, ref.toks.length);
  const precision = share(precisionHits, cand.toks.length);
  return { recall, precision, f1: f1Of(precision, recall), refWords: ref.toks.length, candWords: cand.toks.length };
}

const inNote = (flat: Flat, tok: number) => flat.blocks[flat.units[flat.toks[tok].unit].block].kind === "footnote";

/** Reading order: the share of matched words that stand in the reference's
    order (the longest run of matched words in order over all matched).
    With `notesApart`, a footnote's words on either side are left out: where
    a note stands (the page's foot, after the paragraph that cites it, the
    document's end) is the footnote metric's to judge. */
export function orderScore(al: Alignment, notesApart?: { ref: Flat; cand: Flat }): number | null {
  const tails: number[] = [];
  let n = 0;
  for (let i = 0; i < al.aTo.length; i++) {
    const j = al.aTo[i];
    if (j < 0) continue;
    if (notesApart && (inNote(notesApart.ref, i) || inNote(notesApart.cand, j))) continue;
    n++;
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (tails[mid] < j) lo = mid + 1;
      else hi = mid;
    }
    tails[lo] = j;
  }
  return n >= 2 ? tails.length / n : null;
}

/** Where each furniture string (as words) stands at an edge of a unit: its
    start or end, a line's, or where a later page begins. Only spaces and
    dashes may stand between the edge and the string, and the string stands
    apart from the words beside it ("A-2):" does not end with a page number
    "2"). A string next to another at an edge is at an edge too, so "12
    CHAPTER 1. RIVERS The words" holds both. Each place once, by its first
    word. `cells: false` leaves table cells out; `marks: false` leaves out a
    footnote's label, a raised mark, and a contents entry, whose page number
    is its own (a candidate's: the reference's count as they stand, so a
    parse that reads a note as a paragraph opening with its number leaks
    nothing). */
export function furnitureMatches(flat: Flat, strings: string[][], cells = true, marks = true): { unit: number; tok: number }[][] {
  const out = strings.map(() => new Map<string, { unit: number; tok: number }>());
  const gap = (text: string) => /^[\s\-–—]*$/.test(text);
  flat.units.forEach((unit, u) => {
    if (!cells && flat.blocks[unit.block].kind === "table") return;
    if (!marks && flat.blocks[unit.block].role === "contents") return;
    const { first, end, text } = unit;
    if (end <= first) return;
    const toks = flat.toks;
    const cuts = new Set<number>([0, text.length, ...unit.breaks]);
    for (let i = text.indexOf("\n"); i >= 0; i = text.indexOf("\n", i + 1)) cuts.add(i).add(i + 1);
    const apart = (at: number) => at <= 0 || at >= text.length || cuts.has(at) || /[\s\-–—]/.test(text[at - 1]) || /[\s\-–—]/.test(text[at]);
    // The words a string may begin at, and the words it may end at.
    const opens = new Set<number>();
    const closes = new Set<number>();
    for (const c of cuts) {
      let t = first;
      while (t < end && toks[t].start < c) t++;
      if (t < end && gap(text.slice(c, toks[t].start))) opens.add(t);
      t = end - 1;
      while (t >= first && toks[t].end > c) t--;
      if (t >= first && gap(text.slice(toks[t].end, c))) closes.add(t);
    }
    // A footnote's label and a raised mark are no page number.
    const block = flat.blocks[unit.block];
    const label = !marks && block.kind === "footnote" && block.label ? block.label.length + 1 : 0;
    const marked = (t: number) =>
      !marks && (toks[t].start < label || unit.raised.some(([a, b]) => toks[t].start >= a && toks[t].end <= b) || unit.marks.some((m) => toks[t].start >= m.at && toks[t].end <= m.end));
    const at = (t: number, words: string[]) => t >= first && t + words.length <= end && !marked(t) && words.every((w, x) => toks[t + x].w === w);
    for (let round = 0, grew = true; grew && round < 4; round++) {
      grew = false;
      strings.forEach((words, x) => {
        const k = words.length;
        if (k === 0) return;
        for (const t of [...opens]) {
          if (!at(t, words) || !apart(toks[t + k - 1].end)) continue;
          out[x].set(`${u}:${t}`, { unit: u, tok: t });
          if (t + k < end && !opens.has(t + k)) grew = Boolean(opens.add(t + k));
        }
        for (const t of [...closes]) {
          const t0 = t - k + 1;
          if (!at(t0, words) || !apart(toks[t0].start)) continue;
          out[x].set(`${u}:${t0}`, { unit: u, tok: t0 });
          if (t0 - 1 >= first && !closes.has(t0 - 1)) grew = Boolean(closes.add(t0 - 1));
        }
      });
    }
  });
  return out.map((m) => [...m.values()]);
}

export type FurnitureScores = {
  strings: number;
  leaked: number;
  leaks: number;
  clean: number | null;
  /** Each leaked string: where it stands at the candidate's edges, and how often at the reference's. */
  found: { text: string; ref: number; at: { unit: number; tok: number }[] }[];
};

/** Furniture leaks: a furniture string at an edge of the candidate (a
    block's, a line's, a page start's) more often than at an edge of the
    reference. Clean: the share of furniture strings that never leak. */
export function furnitureScores(furniture: string[], ref: Flat, cand: Flat): FurnitureScores {
  const strings = [...new Set(furniture.map((f) => f.trim()).filter((f) => wordsOf(f).length > 0))];
  const words = strings.map((f) => wordsOf(f).map((w) => w.w));
  // A table cell may hold a number ("2 36", a fraction's parts): cells are the table metric's.
  const inCand = furnitureMatches(cand, words, false, false);
  const inRef = furnitureMatches(ref, words, false);
  let leaked = 0;
  let leaks = 0;
  const found: FurnitureScores["found"] = [];
  strings.forEach((text, x) => {
    if (inCand[x].length <= inRef[x].length) return;
    leaked++;
    leaks += inCand[x].length - inRef[x].length;
    found.push({ text, ref: inRef[x].length, at: inCand[x] });
  });
  return { strings: strings.length, leaked, leaks, clean: strings.length > 0 ? 1 - leaked / strings.length : null, found };
}

export type BlockScores = {
  recall: number | null;
  precision: number | null;
  f1: number | null;
  byKind: Record<string, { ref: number; found: number; cand: number; right: number }>;
  /** A reference unit (a paragraph, a heading, a list item) cut into several candidate units. */
  splits: { ref: number; pieces: number[] }[];
  /** A candidate unit that holds most of several reference units. */
  merges: { cand: number; parts: number[] }[];
  paragraphs: number | null;
};

/** Blocks by kind: a reference block is found when its owner has its kind
    and holds half its matched words or more; a candidate block is right when
    its main has its kind and it is its main's owner (the other pieces of a
    split paragraph are not right blocks). Splits and merges are counted on units (a
    paragraph, a heading, a list item; table cells are the table metric's):
    a split is a reference unit cut into several candidate units that are
    mostly its words; a merge is a candidate unit that holds most of several
    reference units. */
export function blockScores(ref: Flat, cand: Flat, al: Alignment): BlockScores {
  const byKind: BlockScores["byKind"] = {};
  const kind = (k: string) => (byKind[k] ??= { ref: 0, found: 0, cand: 0, right: 0 });
  let found = 0;
  ref.blocks.forEach((block, rb) => {
    kind(block.kind).ref++;
    const cb = al.owner[rb];
    if (cb < 0 || cand.blocks[cb].kind !== block.kind) return;
    if (hasWords(ref, rb) && ov(al, rb, cb) * 2 < al.refMatched[rb]) return;
    kind(block.kind).found++;
    found++;
  });
  let right = 0;
  let counted = 0;
  cand.blocks.forEach((block, cb) => {
    if (al.caption[cb]) return;
    counted++;
    kind(block.kind).cand++;
    const rb = al.main[cb];
    if (rb < 0 || ref.blocks[rb].kind !== block.kind || al.owner[rb] !== cb) return;
    if (hasWords(cand, cb) && ov(al, rb, cb) * 2 < al.candMatched[cb]) return;
    kind(block.kind).right++;
    right++;
  });
  // Units: words shared between each reference unit and each candidate unit.
  const textUnit = (flat: Flat, u: number) => flat.blocks[flat.units[u].block].kind !== "table";
  const shared = new Map<number, Map<number, number>>();
  const back = new Map<number, Map<number, number>>();
  al.aTo.forEach((j, i) => {
    if (j < 0 || !textUnit(ref, ref.toks[i].unit)) return;
    const [ru, cu] = [ref.toks[i].unit, cand.toks[j].unit];
    shared.set(ru, (shared.get(ru) ?? new Map<number, number>()).set(cu, (shared.get(ru)?.get(cu) ?? 0) + 1));
    back.set(cu, (back.get(cu) ?? new Map<number, number>()).set(ru, (back.get(cu)?.get(ru) ?? 0) + 1));
  });
  const top = (m: Map<number, number> | undefined) => {
    let best = -1;
    let n = 0;
    for (const [k, v] of m ?? []) if (v > n || (v === n && k < best)) [best, n] = [k, v];
    return { best, n };
  };
  const sum = (m: Map<number, number> | undefined) => [...(m ?? new Map<number, number>()).values()].reduce((a, b) => a + b, 0);
  const pieces = new Map<number, number[]>();
  for (const [cu, row] of back) {
    const { best: ru, n } = top(row);
    const words = ref.units[ru].end - ref.units[ru].first;
    if (n * 2 >= sum(row) && n >= (words <= 3 ? 1 : 2)) pieces.set(ru, [...(pieces.get(ru) ?? []), cu]);
  }
  const parts = new Map<number, number[]>();
  for (const [ru, row] of shared) {
    const { best: cu, n } = top(row);
    if (n * 2 >= sum(row)) parts.set(cu, [...(parts.get(cu) ?? []), ru]);
  }
  const splits: BlockScores["splits"] = [];
  const merges: BlockScores["merges"] = [];
  for (const [ru, list] of pieces) if (list.length > 1) splits.push({ ref: ru, pieces: list.sort((a, b) => a - b) });
  for (const [cu, list] of parts) if (list.length > 1) merges.push({ cand: cu, parts: list.sort((a, b) => a - b) });
  splits.sort((a, b) => a.ref - b.ref);
  merges.sort((a, b) => a.cand - b.cand);
  const units = ref.units.filter((unit, u) => textUnit(ref, u) && unit.end > unit.first).length;
  const faults = splits.reduce((n, x) => n + x.pieces.length - 1, 0) + merges.reduce((n, x) => n + x.parts.length - 1, 0);
  const recall = share(found, ref.blocks.length);
  const precision = share(right, counted);
  return {
    recall,
    precision,
    f1: f1Of(precision, recall),
    byKind,
    splits,
    merges,
    paragraphs: units > 0 ? Math.max(0, 1 - faults / units) : null,
  };
}

export type HeadingScores = { ref: number; found: number; atLevel: number; shift: number; score: number | null; misses: { ref: number; cand: number }[] };

/** Headings: the share of reference headings found as headings at their
    level, after the one level shift that fits best (a parse that sets every
    section one level deeper keeps the hierarchy). */
export function headingScores(ref: Flat, cand: Flat, al: Alignment): HeadingScores {
  const pairs: { ref: number; cand: number; rl: number; cl: number }[] = [];
  const misses: HeadingScores["misses"] = [];
  let total = 0;
  ref.blocks.forEach((block, rb) => {
    if (block.kind !== "heading") return;
    total++;
    const cb = al.owner[rb];
    const other = cb >= 0 ? cand.blocks[cb] : null;
    if (other?.kind === "heading" && ov(al, rb, cb) * 2 >= al.refMatched[rb]) pairs.push({ ref: rb, cand: cb, rl: block.level, cl: other.level });
    else misses.push({ ref: rb, cand: cb });
  });
  let shift = 0;
  let atLevel = -1;
  for (let s = -5; s <= 5; s++) {
    const n = pairs.filter((p) => p.cl === p.rl + s).length;
    if (n > atLevel || (n === atLevel && Math.abs(s) < Math.abs(shift))) [shift, atLevel] = [s, n];
  }
  for (const p of pairs) if (p.cl !== p.rl + shift) misses.push({ ref: p.ref, cand: p.cand });
  return { ref: total, found: pairs.length, atLevel: Math.max(0, atLevel), shift, score: share(Math.max(0, atLevel), total), misses };
}

export type ListScores = {
  items: number;
  found: number;
  atDepth: number;
  marked: number;
  /** Reference checklist items, and those whose counterpart has a box in the same state. */
  checks: { ref: number; right: number };
  /** Found items and those with their marker, by the reference's depth. */
  byDepth: { found: number; marked: number }[];
  recall: number | null;
  depth: number | null;
  markers: number | null;
  score: number | null;
  misses: { unit: number; cand: number; why: string }[];
};

/** A bullet of any glyph: "o" is how a reference writes Word's hollow
    Courier New bullet, which a parse reads as "◦". */
const bulletLike = (m: string) => /^[-*•▪◦‣●○■□·∙–—➢❖◆★➔✓✔❏o]?$/.test(m);
const sameMarker = (a: string, b: string) => (bulletLike(a) && bulletLike(b)) || a.replace(/\s/g, "") === b.replace(/\s/g, "");

/** List items: an item is found when the candidate unit holding most of its
    words is a list item whose words are mostly this item's (an item of
    math alone stands between its found neighbors); then its depth and its
    marker are compared (every bullet glyph is one marker). A candidate's
    marker is the one it draws: the parse's printed marker, the import's
    list format (a marker left in the words is no marker). */
export function listScores(ref: Flat, cand: Flat, al: Alignment): ListScores {
  const votes = new Map<number, Map<number, number>>(); // ref unit → cand unit → words
  const back = new Map<number, Map<number, number>>(); // cand unit → ref unit → words
  const add = (m: Map<number, Map<number, number>>, x: number, y: number) => {
    const row = m.get(x) ?? new Map<number, number>();
    row.set(y, (row.get(y) ?? 0) + 1);
    m.set(x, row);
  };
  al.aTo.forEach((j, i) => {
    if (j < 0) return;
    add(votes, ref.toks[i].unit, cand.toks[j].unit);
    add(back, cand.toks[j].unit, ref.toks[i].unit);
  });
  const top = (m: Map<number, number> | undefined) => {
    let best = -1;
    let n = 0;
    for (const [k, v] of m ?? []) if (v > n) [best, n] = [k, v];
    return { best, n };
  };
  const isItem = (cu: number) => cu >= 0 && cu < cand.units.length && cand.blocks[cand.units[cu].block].kind === "list";
  // Each reference item's candidate item, by words.
  const itemTo = new Map<number, number>();
  const why = new Map<number, { cand: number; why: string }>();
  ref.units.forEach((unit, ru) => {
    if (ref.blocks[unit.block].kind !== "list" || unit.end === unit.first) return;
    const { best: cu, n } = top(votes.get(ru));
    const other = cu >= 0 ? cand.blocks[cand.units[cu].block] : null;
    if (other?.kind === "list" && n * 2 >= unit.end - unit.first && top(back.get(cu)).best === ru) itemTo.set(ru, cu);
    else why.set(ru, { cand: cu, why: !other ? "not found" : other.kind !== "list" ? `in a ${other.kind}` : "merged" });
  });
  // An item of math alone: the candidate item right after its found
  // neighbor before, or right before its found neighbor after.
  const claimed = new Set(itemTo.values());
  ref.units.forEach((unit, ru) => {
    if (ref.blocks[unit.block].kind !== "list" || unit.end > unit.first) return;
    const before = itemTo.get(ru - 1);
    const after = itemTo.get(ru + 1);
    const guess =
      before !== undefined && isItem(before + 1) && cand.units[before + 1].block === cand.units[before].block ? before + 1
      : after !== undefined && isItem(after - 1) && cand.units[after - 1].block === cand.units[after].block ? after - 1
      : -1;
    if (guess >= 0 && !claimed.has(guess)) {
      itemTo.set(ru, guess);
      claimed.add(guess);
    } else {
      why.set(ru, { cand: -1, why: "not found (math alone)" });
    }
  });
  let items = 0;
  let atDepth = 0;
  let marked = 0;
  const checks = { ref: 0, right: 0 };
  const byDepth: ListScores["byDepth"] = [];
  const misses: ListScores["misses"] = [];
  ref.units.forEach((unit, ru) => {
    const block = ref.blocks[unit.block];
    if (block.kind !== "list") return;
    items++;
    const box = block.items[unit.index].checked;
    if (box !== undefined) checks.ref++;
    const cu = itemTo.get(ru);
    if (cu === undefined) {
      const w = why.get(ru);
      misses.push({ unit: ru, cand: w?.cand ?? -1, why: w?.why ?? "not found" });
      return;
    }
    const other = cand.blocks[cand.units[cu].block];
    if (other.kind !== "list") return;
    const mine = block.items[unit.index];
    const theirs = other.items[cand.units[cu].index];
    if (mine.depth === theirs.depth) atDepth++;
    else misses.push({ unit: ru, cand: cu, why: `depth ${theirs.depth}, not ${mine.depth}` });
    const level = (byDepth[mine.depth] ??= { found: 0, marked: 0 });
    level.found++;
    if (sameMarker(mine.marker, theirs.marker)) {
      marked++;
      level.marked++;
    } else misses.push({ unit: ru, cand: cu, why: `marker "${theirs.marker}", not "${mine.marker}"` });
    if (box !== undefined && theirs.checked === box) checks.right++;
  });
  const found = itemTo.size;
  const recall = share(found, items);
  const depth = found > 0 ? atDepth / found : items > 0 ? 0 : null;
  const markers = found > 0 ? marked / found : items > 0 ? 0 : null;
  return {
    items,
    found,
    atDepth,
    marked,
    checks,
    byDepth: Array.from(byDepth, (level) => level ?? { found: 0, marked: 0 }),
    recall,
    depth,
    markers,
    score: recall === null || depth === null || markers === null ? null : (recall + depth + markers) / 3,
    misses,
  };
}

export type TableScores = {
  refWords: number;
  candWords: number;
  recall: number | null;
  precision: number | null;
  f1: number | null;
  /** Reference table words the candidate put outside any table. */
  outside: number;
  /** Candidate table words that are reference prose. */
  inside: number;
  misses: { ref: number; row: number; col: number; want: string; got: string }[];
};

/** Greedy one-to-one assignment by votes, most votes first. */
function assign(votes: Map<string, number>): Map<number, number> {
  const out = new Map<number, number>();
  const taken = new Set<number>();
  for (const [key] of [...votes].sort((x, y) => y[1] - x[1])) {
    const [from, to] = key.split(",").map(Number);
    if (out.has(from) || taken.has(to)) continue;
    out.set(from, to);
    taken.add(to);
  }
  return out;
}

/** Tables: a table word is in place when it lands in the candidate table
    that owns its table, in the row and column its row and column map to
    (rows and columns map one to one, by the most words shared). F1 of words
    in place, and the leaks both ways. */
export function tableScores(ref: Flat, cand: Flat, al: Alignment): TableScores {
  const inPlace = new Uint8Array(cand.toks.length);
  let refWords = 0;
  let hits = 0;
  let outside = 0;
  const misses: TableScores["misses"] = [];
  ref.blocks.forEach((block, rb) => {
    if (block.kind !== "table") return;
    const cb = al.owner[rb];
    const body = ref.unitsOf[rb].filter((u) => ref.units[u].index >= 0);
    const rowVotes = new Map<string, number>();
    const colVotes = new Map<string, number>();
    for (const u of body) {
      for (let i = ref.units[u].first; i < ref.units[u].end; i++) {
        const j = al.aTo[i];
        if (j < 0) continue;
        const cu = cand.units[cand.toks[j].unit];
        if (cu.block !== cb || cu.index < 0) continue;
        const key = (a: number, b: number) => `${a},${b}`;
        rowVotes.set(key(ref.units[u].row, cu.row), (rowVotes.get(key(ref.units[u].row, cu.row)) ?? 0) + 1);
        colVotes.set(key(ref.units[u].col, cu.col), (colVotes.get(key(ref.units[u].col, cu.col)) ?? 0) + 1);
      }
    }
    const rows = assign(rowVotes);
    const cols = assign(colVotes);
    for (const u of body) {
      const unit = ref.units[u];
      let ok = 0;
      let gotUnit = -1;
      for (let i = unit.first; i < unit.end; i++) {
        refWords++;
        const j = al.aTo[i];
        if (j < 0) continue;
        const cu = cand.units[cand.toks[j].unit];
        if (cu.block === cb && cu.index >= 0 && rows.get(unit.row) === cu.row && cols.get(unit.col) === cu.col) {
          ok++;
          hits++;
          inPlace[j] = 1;
          gotUnit = cand.toks[j].unit;
        } else if (cand.blocks[cu.block].kind !== "table") {
          outside++;
        }
      }
      if (ok < unit.end - unit.first) {
        const want = cand.units.findIndex((c) => c.block === cb && c.index >= 0 && c.row === rows.get(unit.row) && c.col === cols.get(unit.col));
        const got = gotUnit >= 0 ? gotUnit : want;
        misses.push({ ref: u, row: unit.row, col: unit.col, want: unit.text, got: got >= 0 ? cand.units[got].text : "" });
      }
    }
  });
  let candWords = 0;
  let candHits = 0;
  let inside = 0;
  cand.blocks.forEach((block, cb) => {
    if (block.kind !== "table") return;
    for (const u of cand.unitsOf[cb]) {
      if (cand.units[u].index < 0) continue;
      for (let j = cand.units[u].first; j < cand.units[u].end; j++) {
        candWords++;
        if (inPlace[j]) candHits++;
        const i = al.bTo[j];
        if (!inPlace[j] && i >= 0 && ref.blocks[ref.units[ref.toks[i].unit].block].kind !== "table") inside++;
      }
    }
  });
  const recall = share(hits, refWords);
  const precision = share(candHits, candWords);
  // A candidate table where the reference has none costs five times its
  // share of the candidate's words.
  const f1 =
    refWords > 0 ? (f1Of(precision ?? 0, recall ?? 0) ?? 0) : candWords > 0 ? Math.max(0, 1 - (5 * candWords) / Math.max(1, cand.toks.length)) : null;
  return { refWords, candWords, recall, precision, f1, outside, inside, misses };
}

export type MathScores = {
  display: number | null;
  inline: number | null;
  equations: number;
  formulas: number;
  /** Printed equation labels ("(1.2)"), compared apart from the formula:
      reference labels on an equation with the same label, candidate labels
      the reference does not print. */
  labels: { ref: number; right: number; extra: number; score: number | null; misses: { want: string; got: string }[] };
  /** Reference equations the candidate shows as images. */
  images: number;
  /** Reference equations and inline formulas the candidate reads as plain words. */
  plainDisplay: number;
  plainInline: number;
  score: number | null;
  misses: { display: boolean; want: string; got: string; similarity: number }[];
};

const latexOf = (m: { latex?: string; mathml?: string }) => m.latex ?? (m.mathml ? "(MathML)" : "");

/** Math: each reference formula against its counterpart, by the similarity
    of canonical forms. A display equation's counterpart is its owner; an
    inline formula's is a candidate formula between the matched words around
    it, or else the candidate's words there read as math. An image scores 0. */
export function mathScores(ref: Flat, cand: Flat, al: Alignment): MathScores {
  const misses: MathScores["misses"] = [];
  const display: number[] = [];
  const inline: number[] = [];
  let images = 0;
  let plainDisplay = 0;
  let plainInline = 0;
  const miss = (isDisplay: boolean, m: MathItem, got: string, similarity: number) => {
    if (similarity < 0.999) misses.push({ display: isDisplay, want: latexOf(m), got, similarity });
  };
  const labels: MathScores["labels"] = { ref: 0, right: 0, extra: 0, score: null, misses: [] };
  for (const m of ref.math) {
    const want = mathTokens(m, m.display);
    if (m.display) {
      const cb = al.owner[m.block];
      const other = cb >= 0 ? cand.blocks[cb] : null;
      if (m.label) {
        labels.ref++;
        const theirs = other?.kind === "equation" ? (other.label ?? "") : "";
        if (theirs && normLabel(theirs) === normLabel(m.label)) labels.right++;
        else labels.misses.push({ want: m.label, got: other?.kind === "equation" ? theirs || "(no label)" : `(${other?.kind ?? "missing"})` });
      }
      let sim = 0;
      let got = "(missing)";
      if (other?.kind === "equation") {
        sim = sequenceSimilarity(want, mathTokens(other, true));
        got = other.latex;
      } else if (other?.kind === "figure") {
        images++;
        got = `(image) ${other.mathImage ?? cand.unitsOf[cb].map((u) => cand.units[u].text).join(" ")}`;
      } else if (other) {
        const text = cand.unitsOf[cb].map((u) => cand.units[u].text).join(" ");
        plainDisplay++;
        sim = sequenceSimilarity(want, textMathTokens(text));
        got = `(words) ${text}`;
      }
      display.push(sim);
      miss(true, m, got, sim);
      continue;
    }
    // Inline: the matched words just before and after the formula.
    const unit = ref.units[m.unit];
    const prev = m.at - 1 >= unit.first ? al.aTo[m.at - 1] : -1;
    const next = m.at < unit.end ? al.aTo[m.at] : -1;
    // Candidate formulas in the same gap; the one most like it stands for it.
    const hits = cand.math.filter(
      (c) => !c.display && ((prev >= 0 && next >= 0 && c.at > prev && c.at <= next) || (prev >= 0 && next < 0 && c.at === prev + 1) || (next >= 0 && prev < 0 && c.at === next)),
    );
    let sim = 0;
    let got = "(missing)";
    if (hits.length > 0) {
      for (const hit of hits) {
        const s = sequenceSimilarity(want, mathTokens(hit, false));
        if (s >= sim) [sim, got] = [s, latexOf(hit)];
      }
    } else {
      const gap = gapText(cand, al, prev, next, want.length);
      if (gap.trim()) {
        plainInline++;
        sim = sequenceSimilarity(want, textMathTokens(gap));
        got = `(words) ${gap.trim()}`;
      }
    }
    inline.push(sim);
    miss(false, m, got, sim);
  }
  cand.blocks.forEach((block, cb) => {
    if (block.kind !== "equation" || !block.label) return;
    const rb = al.main[cb];
    const mine = rb >= 0 ? ref.blocks[rb] : null;
    if (mine?.kind !== "equation" || !mine.label) labels.extra++;
  });
  labels.score = labels.ref > 0 ? labels.right / labels.ref : null;
  const mean = (list: number[]) => (list.length > 0 ? list.reduce((a, b) => a + b, 0) / list.length : null);
  const d = mean(display);
  const i = mean(inline);
  return {
    display: d,
    inline: i,
    equations: display.length,
    formulas: inline.length,
    labels,
    images,
    plainDisplay,
    plainInline,
    score: d === null ? i : i === null ? d : (d + i) / 2,
    misses,
  };
}

/** The candidate's words between two matched words (or from one of them to
    the next matched word of its unit): where a formula the candidate did not
    mark as math stands. At most a few times the formula's length. */
function gapText(cand: Flat, al: Alignment, prev: number, next: number, size: number): string {
  const toks = cand.toks;
  const room = Math.max(40, size * 3);
  if (prev >= 0 && next >= 0 && toks[prev].unit === toks[next].unit && prev < next) {
    return cand.units[toks[prev].unit].text.slice(toks[prev].end, toks[next].start).slice(0, room);
  }
  if (prev >= 0) {
    const unit = cand.units[toks[prev].unit];
    let j = prev + 1;
    while (j < unit.end && al.bTo[j] < 0) j++;
    const to = j < unit.end ? toks[j].start : unit.text.length;
    return unit.text.slice(toks[prev].end, to).slice(0, room).replace(/[.,;:]\s*$/, "");
  }
  if (next >= 0) {
    const unit = cand.units[toks[next].unit];
    let j = next - 1;
    while (j >= unit.first && al.bTo[j] < 0) j--;
    const from = j >= unit.first ? toks[j].end : 0;
    return unit.text.slice(from, toks[next].start).slice(-room);
  }
  return "";
}

export type GarbleScores = { count: number; excess: number; score: number; found: (Garble & { unit: number; text: string })[] };

/** Garbled glyphs in the candidate's text (and in the glyph text it draws
    under an equation image), past those the reference itself holds. Score:
    1 − garbles over (5 + words / 100), at least 0. */
export function garbleScores(ref: Flat, cand: Flat): GarbleScores {
  const found: GarbleScores["found"] = [];
  cand.units.forEach((unit, u) => {
    for (const g of garblesOf(unit.text)) found.push({ ...g, unit: u, text: unit.text });
  });
  for (const m of cand.math) if (m.image) for (const g of garblesOf(m.image)) found.push({ ...g, unit: -1, text: m.image });
  const own = ref.units.reduce((n, unit) => n + garblesOf(unit.text).length, 0);
  const excess = Math.max(0, found.length - own);
  return { count: found.length, excess, score: Math.max(0, 1 - excess / (5 + cand.toks.length / 100)), found };
}

export type StyleScores = {
  bold: number | null;
  italic: number | null;
  /** The mean of every style's F1 the reference marks (the composite's part). */
  score: number | null;
  /** Each style's F1; null where the reference never marks it. */
  f1: Record<Style, number | null>;
  /** Characters of matched words: styled on both sides, only in the candidate, only in the reference. */
  counts: Record<Style, { both: number; candOnly: number; refOnly: number }>;
};

const meanOf = (list: (number | null)[]) => {
  const known = list.filter((x): x is number => x !== null);
  return known.length > 0 ? known.reduce((a, b) => a + b, 0) / known.length : null;
};

/** Bold, italic, underline, small caps, sub, and sup: F1 over the
    characters of matched words, where both words count for styles (not in a
    title, a heading, or code). A style the reference never marks is not
    scored: its author did not mark it. */
export function styleScores(ref: Flat, cand: Flat, al: Alignment): StyleScores {
  const counts = Object.fromEntries(STYLES.map((style) => [style, { both: 0, candOnly: 0, refOnly: 0 }])) as StyleScores["counts"];
  al.aTo.forEach((j, i) => {
    if (j < 0) return;
    const r = ref.toks[i];
    const c = cand.toks[j];
    if (!ref.units[r.unit].styled || !cand.units[c.unit].styled) return;
    const weight = r.end - r.start;
    for (const style of STYLES) {
      if (r[style] && c[style]) counts[style].both += weight;
      else if (c[style]) counts[style].candOnly += weight;
      else if (r[style]) counts[style].refOnly += weight;
    }
  });
  const f = ({ both, candOnly, refOnly }: { both: number; candOnly: number; refOnly: number }) =>
    both + candOnly + refOnly > 0 ? (2 * both) / (2 * both + candOnly + refOnly) : null;
  const marks = (style: Style) => ref.toks.some((t) => t[style] && ref.units[t.unit].styled);
  const f1 = Object.fromEntries(STYLES.map((style) => [style, marks(style) ? f(counts[style]) : null])) as Record<Style, number | null>;
  return { bold: f1.bold, italic: f1.italic, score: meanOf(STYLES.map((style) => f1[style])), f1, counts };
}

export type NoteScores = {
  /** Reference footnotes; those found as a footnote holding half their words or more. */
  ref: number;
  found: number;
  /** Reference footnotes whose mark the reference prints; those found and linked from a mark where the reference prints it. */
  linkable: number;
  linked: number;
  /** The mean F1 of each reference footnote's words against its counterpart footnote (0 when not found). */
  words: number | null;
  /** Candidate footnotes that are no reference footnote. */
  extra: number;
  /** The mean of the share found, the share linked, and the words' F1. */
  score: number | null;
  misses: { ref: number; cand: number; why: string }[];
};

/** Each reference footnote's printed marks: the raised runs that read as
    its label, before it in reading order and after the last footnote with
    the same label (a note cited twice, "Shen*" and "Sherif*", has two). A
    note whose mark the reference does not raise (an OCR layer that read the
    mark as a quote sign) has none: it is not scored for its link. */
function referenceMarks(ref: Flat): Map<number, { unit: number; at: number; end: number }[]> {
  const out = new Map<number, { unit: number; at: number; end: number }[]>();
  const after = new Map<string, number>();
  ref.blocks.forEach((block, rb) => {
    if (block.kind !== "footnote" || !block.label.trim()) return;
    const label = block.label.trim();
    const units = ref.unitsOf[rb];
    const places: { unit: number; at: number; end: number }[] = [];
    for (let u = after.get(label) ?? 0; u < (units[0] ?? ref.units.length); u++) {
      const unit = ref.units[u];
      if (ref.blocks[unit.block].kind === "footnote") continue;
      // A raised run may hold several marks: "3, 4, ∗" (two affiliations and a note).
      for (const [a, b] of unit.raised) {
        for (const m of unit.text.slice(a, b).matchAll(/[^\s,]+/g)) if (m[0] === label) places.push({ unit: u, at: a + (m.index ?? 0), end: a + (m.index ?? 0) + label.length });
      }
    }
    if (units.length > 0) after.set(label, units[units.length - 1] + 1);
    if (places.length > 0) out.set(rb, places);
  });
  return out;
}

/** The word before a place in a unit's text, and the word after its end. */
function neighbors(flat: Flat, u: number, at: number, end: number): { before: number; after: number } {
  const unit = flat.units[u];
  let before = -1;
  let after = -1;
  for (let t = unit.first; t < unit.end; t++) {
    if (flat.toks[t].end <= at) before = t;
    else if (flat.toks[t].start >= end && after < 0) after = t;
  }
  return { before, after };
}

/** Footnotes: a reference footnote is found when its counterpart is a
    footnote holding half its matched words or more; linked when a mark that
    links to that footnote stands where the reference prints its mark (the
    words beside the two marks are matched words); its words scored as an F1
    against the counterpart. */
export function noteScores(ref: Flat, cand: Flat, al: Alignment): NoteScores | null {
  const notes = ref.blocks.flatMap((block, rb) => (block.kind === "footnote" ? [rb] : []));
  const extra = cand.blocks.filter((block, cb) => block.kind === "footnote" && ref.blocks[al.main[cb]]?.kind !== "footnote").length;
  if (notes.length === 0) return null;
  const printed = referenceMarks(ref);
  const marksOf = new Map<string, { unit: number; at: number; end: number }[]>();
  cand.units.forEach((unit, u) => {
    for (const m of unit.marks) marksOf.set(m.id, [...(marksOf.get(m.id) ?? []), { unit: u, at: m.at, end: m.end }]);
  });
  const words = (flat: Flat, b: number) => flat.unitsOf[b].reduce((n, u) => n + flat.units[u].end - flat.units[u].first, 0);
  let found = 0;
  let linked = 0;
  let linkable = 0;
  let wordSum = 0;
  const misses: NoteScores["misses"] = [];
  for (const rb of notes) {
    const cb = al.owner[rb];
    const other = cb >= 0 ? cand.blocks[cb] : null;
    const mark = printed.get(rb);
    if (mark) linkable++;
    if (other?.kind !== "footnote" || ov(al, rb, cb) * 2 < al.refMatched[rb]) {
      misses.push({ ref: rb, cand: cb, why: other ? `read as ${other.kind}` : "not found" });
      continue;
    }
    found++;
    const shared = ov(al, rb, cb);
    const [r, c] = [words(ref, rb), words(cand, cb)];
    wordSum += r + c > 0 ? (2 * shared) / (r + c) : 1;
    if (!mark) continue;
    // Linked from any of the note's marks: the words beside the two marks
    // match. Where neither word beside the reference's mark aligns (a formula
    // before it, the paragraph's end after), the mark stands in the block's
    // counterpart at the same place in its text.
    const aligned = (t: number) => t >= 0 && al.aTo[t] >= 0;
    const right = (marksOf.get(other.id ?? "") ?? []).some((m) =>
      mark.some((place) => {
        const want = neighbors(ref, place.unit, place.at, place.end);
        const got = neighbors(cand, m.unit, m.at, m.end);
        if ((got.before >= 0 && got.before === al.aTo[want.before]) || (got.after >= 0 && got.after === al.aTo[want.after])) return true;
        if (aligned(want.before) || aligned(want.after)) return false;
        const [ru, cu] = [ref.units[place.unit], cand.units[m.unit]];
        return al.owner[ru.block] === cu.block && Math.abs(place.at / Math.max(1, ru.text.length) - m.at / Math.max(1, cu.text.length)) <= 0.1;
      }),
    );
    if (right) linked++;
    else misses.push({ ref: rb, cand: cb, why: marksOf.has(other.id ?? "") ? "its mark stands elsewhere" : "no mark links to it" });
  }
  const shareFound = found / notes.length;
  const shareLinked = linkable > 0 ? linked / linkable : null;
  const wordScore = wordSum / notes.length;
  return { ref: notes.length, found, linkable, linked, words: wordScore, extra, score: meanOf([shareFound, shareLinked, wordScore]), misses };
}

export type RoleScores = {
  /** Centered and right-aligned paragraphs: F1 of those aligned alike, where the reference aligns any. */
  align: number | null;
  /** First-line, hanging, and block indents of paragraphs: F1 of those indented alike, where the reference marks any. */
  indent: number | null;
  /** Caption words (a figure's, a table's) in a caption of the candidate: F1, where the reference has captions. */
  captions: number | null;
  /** Checklist items: the share of the reference's whose counterpart item has its box and state. */
  checks: number | null;
  /** Separators and quotations: the share of the reference's found with their kind. */
  separators: number | null;
  quotes: number | null;
  /** The mean of the roles the reference has, printed equation labels among them (the composite's part). */
  score: number | null;
};

/** F1 of a paragraph property both sides may set: a reference paragraph
    with it is right when its counterpart paragraph has the same; a
    candidate paragraph with it is right when its main reference paragraph
    has the same. */
function propertyF1(ref: Flat, cand: Flat, al: Alignment, of: (b: DocBlock) => string | undefined): number | null {
  const refSet = ref.blocks.flatMap((block, rb) => (of(block) ? [rb] : []));
  if (refSet.length === 0) return null;
  const candSet = cand.blocks.flatMap((block, cb) => (of(block) && !al.caption[cb] ? [cb] : []));
  const recall = refSet.filter((rb) => al.owner[rb] >= 0 && of(cand.blocks[al.owner[rb]]) === of(ref.blocks[rb])).length / refSet.length;
  const precision = candSet.length > 0 ? candSet.filter((cb) => al.main[cb] >= 0 && of(ref.blocks[al.main[cb]]) === of(cand.blocks[cb])).length / candSet.length : 0;
  return f1Of(precision, recall);
}

/** The roles and marks the page's layout carries: alignment, indentation,
    captions, checkbox states, separators, quotations. */
export function roleScores(ref: Flat, cand: Flat, al: Alignment, blocks: BlockScores, lists: ListScores, math: MathScores): RoleScores {
  const paragraph = (key: "align" | "indent") => (b: DocBlock) => (b.kind === "paragraph" ? b[key] : undefined);
  // Captions: a figure's caption unit, a table's (index -1), a caption paragraph.
  const isCaption = (flat: Flat, u: number) => {
    const unit = flat.units[u];
    const block = flat.blocks[unit.block];
    return block.kind === "figure" || (block.kind === "table" && unit.index === -1) || (block.kind === "paragraph" && block.role === "caption");
  };
  let refCaption = 0;
  let hits = 0;
  let candCaption = 0;
  let candHits = 0;
  ref.toks.forEach((t, i) => {
    if (!isCaption(ref, t.unit)) return;
    refCaption++;
    const j = al.aTo[i];
    if (j >= 0 && isCaption(cand, cand.toks[j].unit)) hits++;
  });
  cand.toks.forEach((t, j) => {
    if (!isCaption(cand, t.unit)) return;
    candCaption++;
    const i = al.bTo[j];
    if (i >= 0 && isCaption(ref, ref.toks[i].unit)) candHits++;
  });
  const kind = (k: string) => {
    const x = blocks.byKind[k];
    return x && x.ref > 0 ? x.found / x.ref : null;
  };
  const roles = {
    align: propertyF1(ref, cand, al, paragraph("align")),
    indent: propertyF1(ref, cand, al, paragraph("indent")),
    captions: refCaption > 0 ? f1Of(candCaption > 0 ? candHits / candCaption : 0, hits / refCaption) : null,
    checks: lists.checks.ref > 0 ? lists.checks.right / lists.checks.ref : null,
    separators: kind("separator"),
    quotes: kind("quote"),
  };
  return { ...roles, score: meanOf([...Object.values(roles), math.labels.score]) };
}

/** The composite: each applicable part's score (0–1) by its weight, out of 100. */
export function composite(parts: Record<Part, number | null>): number {
  let sum = 0;
  let weight = 0;
  for (const part of Object.keys(WEIGHTS) as Part[]) {
    const score = parts[part];
    if (score === null) continue;
    sum += WEIGHTS[part] * score;
    weight += WEIGHTS[part];
  }
  return weight > 0 ? (100 * sum) / weight : 0;
}

// ── One score ───────────────────────────────────────────────────────────────

export type Scores = {
  composite: number;
  parts: Record<Part, number | null>;
  words: WordScores;
  order: number | null;
  furniture: FurnitureScores;
  blocks: BlockScores;
  headings: HeadingScores;
  lists: ListScores;
  tables: TableScores;
  math: MathScores;
  garbles: GarbleScores;
  styles: StyleScores;
  notes: NoteScores | null;
  roles: RoleScores;
};

/** A candidate scored against a reference: every metric and the composite. */
export function score(reference: Doc, furniture: string[], candidate: Doc): { scores: Scores; ref: Flat; cand: Flat; al: Alignment } {
  const ref = flatten(reference);
  const cand = flatten(candidate);
  const al = align(ref, cand);
  const words = wordScores(ref, cand);
  const order = orderScore(al, { ref, cand });
  const furn = furnitureScores(furniture, ref, cand);
  const blocks = blockScores(ref, cand, al);
  const headings = headingScores(ref, cand, al);
  const lists = listScores(ref, cand, al);
  const tables = tableScores(ref, cand, al);
  const math = mathScores(ref, cand, al);
  const garbles = garbleScores(ref, cand);
  const styles = styleScores(ref, cand, al);
  const notes = noteScores(ref, cand, al);
  const roles = roleScores(ref, cand, al, blocks, lists, math);
  const parts: Record<Part, number | null> = {
    text: words.f1,
    order,
    furniture: furn.clean,
    blocks: blocks.f1,
    paragraphs: blocks.paragraphs,
    headings: headings.ref > 0 ? headings.score : null,
    lists: lists.score,
    tables: tables.f1,
    math: math.score,
    garbles: garbles.score,
    styles: styles.score,
    footnotes: notes?.score ?? null,
    roles: roles.score,
  };
  const scores: Scores = {
    composite: composite(parts),
    parts,
    words,
    order,
    furniture: furn,
    blocks,
    headings,
    lists,
    tables,
    math,
    garbles,
    styles,
    notes,
    roles,
  };
  return { scores, ref, cand, al };
}
