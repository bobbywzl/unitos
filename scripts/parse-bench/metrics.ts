import { dropChars, isMathText, type Doc, type DocBlock } from "./adapt";
import { mathLeaves, mathTokens, normLabel, sequenceSimilarity, textMathTokens } from "./math";
import type { Font, FontRole, Fonts, RefBlock, Span } from "./model";
import { garblesOf, wordsOf, type Garble } from "./text";

// The metrics: a reference and a candidate (a parse or an import, through
// the adapters) scored word by word and block by block. Every metric is a
// pure function of the two flat views and their word matching. One line each:
//   text        word recall, precision, F1 over the two multisets of words (math out)
//   order       share of matched words that stand in the reference's order (footnotes apart)
//   furniture   share of furniture strings never at the candidate's edges more often than at the reference's
//   blocks      F1 of reference blocks found with their kind and candidate blocks of the right kind
//   paragraphs  1 − (units split + units merged) / reference units (a paragraph, a heading, a list item)
//   headings    F1 of reference headings found as headings at their level (after the best level shift)
//               and candidate headings that are such a heading (an invented heading counts)
//   lists       mean of list item recall, depth accuracy, and marker accuracy (the marker as drawn)
//   tables      F1 of table words in their cell, rows and columns mapped one to one (leaks both ways reported)
//   math        mean of display and inline similarity of canonical forms (images and words read as math reported)
//   garbles     1 − garbled glyphs past the reference's own over (5 + words / 100)
//   styles      mean F1 of the styles the reference marks (bold, italic, underline, strikethrough,
//               small caps, sub, sup, text color, highlight)
//   footnotes   mean of notes found, notes linked from their mark, and the notes' words F1
//   roles       mean of alignment (titles, headings, paragraphs, list items; justified where a wrap
//               shows it), indentation, and captions F1, indent sizes and spacing as the page
//               measures them, checkbox states, separators and quotations found, and printed
//               equation labels right and on the page's side
//   fonts       per role (body, title, each heading level, caption, footnote): the face's shape,
//               its size (the body's in points, the others' as a ratio to the body), bold, color

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
  fonts: 5, // each role's face: shape, size, bold, color
} as const;
export type Part = keyof typeof WEIGHTS;

/** The reference-free composite's weights (free.ts); out of 100 over the parts that apply. */
export const FREE_WEIGHTS = {
  coverage: 60, // word F1 against pdftotext
  furniture: 20, // furniture lines that never leak
  numbers: 10, // no line that is only a page number
  garbles: 10, // no garbled glyph, by string and by the math font's code
  math: 10, // display equations as LaTeX that draws the page's symbols (glyphs.ts)
  order: 10, // no line read across a column's gutter (layout.ts)
  structure: 10, // no prose in a table's cells or a display's crop, no figure in two pieces (layout.ts)
  layout: 10, // indents the page sets, the body's face, page labels in order (layout.ts)
  look: 10, // the import's formulas at their words' size, crops at their printed width, Word borders, a display's space, a row's height, a marker's place
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
  /** Its sub- and superscript runs [start, end) in `text`. */
  scripts: [number, number][];
};
/** The styles scored on the characters of matched words: these on or off,
    and a text color and a highlight by their color. */
export const STYLES = ["bold", "italic", "underline", "strike", "smallCaps", "sub", "sup"] as const;
export type Style = (typeof STYLES)[number];
export type Scored = Style | "color" | "highlight";
export const SCORED: Scored[] = [...STYLES, "color", "highlight"];
/** A word; `note`: a candidate's footnote mark or label (the page editor
    draws its own numbers there); `link`: most of it in a link, whose
    underline and color are the link's; its color and highlight, where most
    of its characters take one. */
export type Tok = { w: string; unit: number; start: number; end: number; note?: true; link: boolean; color?: string; highlight?: string } & Record<Style, boolean>;
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
  /** An inline formula's place in its unit's text: [from, to). */
  from?: number;
  to?: number;
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

/** `color`: the color the block sets its words in (textColor); a span in it
    is no colored run. */
function addUnit(flat: Flat, block: number, index: number, spans: Span[], opts: { row?: number; col?: number; styled: boolean; breaks?: number[]; shift?: number; color?: string }) {
  let text = "";
  const u = flat.units.length;
  const first = flat.toks.length;
  const length = spans.reduce((n, s) => n + s.text.length, 0);
  const flags = Object.fromEntries(STYLES.map((style) => [style, new Uint8Array(length)])) as Record<Style, Uint8Array>;
  const links = new Uint8Array(length);
  const colors: (string | undefined)[] = new Array(length);
  const fills: (string | undefined)[] = new Array(length);
  const raised: [number, number][] = [];
  const scripts: [number, number][] = [];
  let stretch = 0;
  // The value most of a word's characters take, or none.
  const most = (values: (string | undefined)[], start: number, end: number) => {
    const count = new Map<string, number>();
    for (let k = start; k < end; k++) if (values[k]) count.set(values[k] as string, (count.get(values[k] as string) ?? 0) + 1);
    const [value, n] = [...count].sort((a, b) => b[1] - a[1])[0] ?? ["", 0];
    return n * 2 > end - start ? value : undefined;
  };
  const flush = (to: number) => {
    for (const w of wordsOf(text.slice(stretch, to))) {
      const [start, end] = [w.start + stretch, w.end + stretch];
      const share = (arr: Uint8Array) => arr.subarray(start, end).reduce((n, f) => n + f, 0) * 2 > end - start;
      const color = most(colors, start, end);
      const highlight = most(fills, start, end);
      flat.toks.push({
        w: w.w,
        unit: u,
        start,
        end,
        link: share(links),
        ...(color ? { color } : {}),
        ...(highlight ? { highlight } : {}),
        ...(Object.fromEntries(STYLES.map((style) => [style, share(flags[style])])) as Record<Style, boolean>),
      });
    }
  };
  for (const span of spans) {
    const start = text.length;
    text += span.text;
    if (span.latex !== undefined || span.mathml !== undefined) {
      flush(start);
      flat.math.push({ block, unit: u, at: flat.toks.length, display: false, latex: span.latex, mathml: span.mathml, text: span.text, from: start, to: text.length });
      stretch = text.length;
      continue;
    }
    for (const style of STYLES) if (span[style]) flags[style].fill(1, start, text.length);
    if (span.href) links.fill(1, start, text.length);
    if (span.color && !sameColor(span.color, opts.color)) colors.fill(span.color, start, text.length);
    if (span.highlight) fills.fill(span.highlight, start, text.length);
    if (span.sup && text.length > start) raised.push([start, text.length]);
    if ((span.sup || span.sub) && text.length > start) scripts.push([start, text.length]);
  }
  flush(text.length);
  const shift = opts.shift ?? 0;
  const marks = (flat.blocks[block].marks ?? []).filter((m) => m.unit === index).map(({ at, end, id }) => ({ at: at + shift, end: end + shift, id }));
  // A footnote's own label (its first characters) and the marks linking to one.
  for (let t = first; t < flat.toks.length; t++) {
    const tok = flat.toks[t];
    if (tok.start < shift || marks.some((m) => tok.start >= m.at && tok.end <= m.end)) tok.note = true;
  }
  flat.units.push({ block, index, row: opts.row ?? -1, col: opts.col ?? -1, text, breaks: opts.breaks ?? [], styled: opts.styled, first, end: flat.toks.length, marks, raised, scripts });
  flat.unitsOf[block].push(u);
}

/** The color a block sets its words in: its own font's, else its role's
    (a table's and a figure's are their caption's). A gray paragraph, a navy
    title: the fonts metric scores that color, and a span in it is no
    colored run, whether a style or the words' own marks set it. */
function textColor(doc: Doc, block: DocBlock): string | undefined {
  const role = fontRole(block);
  const own = "font" in block ? block.font : undefined;
  return own ? own.color : role ? doc.fonts?.[role]?.color : undefined;
}

/** A document as units, words, and formulas in reading order. */
export function flatten(doc: Doc): Flat {
  const flat: Flat = { blocks: doc.blocks, units: [], toks: [], math: [], unitsOf: [] };
  doc.blocks.forEach((block, b) => {
    flat.unitsOf.push([]);
    const breaks = (unit: number, shift = 0) => (block.breaks ?? []).filter((x) => x.unit === unit).map((x) => x.at + shift);
    const color = textColor(doc, block);
    switch (block.kind) {
      case "title":
      case "heading":
        return addUnit(flat, b, 0, block.spans, { styled: false, breaks: breaks(0), color });
      case "paragraph":
      case "quote":
        return addUnit(flat, b, 0, block.spans, { styled: true, breaks: breaks(0), color });
      case "footnote":
        return addUnit(flat, b, 0, [{ text: block.label ? `${block.label} ` : "" }, ...block.spans], {
          styled: true,
          breaks: breaks(0, block.label ? block.label.length + 1 : 0),
          shift: block.label ? block.label.length + 1 : 0,
          color,
        });
      case "list":
        return block.items.forEach((item, i) => addUnit(flat, b, i, item.spans, { styled: true, breaks: breaks(i), color }));
      case "table": {
        if (block.caption) addUnit(flat, b, -1, block.caption, { styled: true, color });
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
        else if (block.caption) addUnit(flat, b, 0, block.caption, { styled: true, color });
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

/** A candidate's inline formulas by the page each stands on (its block's
    first page, a page more for each page that begins before it in its
    block), as their LaTeX. */
export function formulasByPage(flat: Flat): Record<number, string[]> {
  const out: Record<number, string[]> = {};
  const byUnit = new Map<number, MathItem[]>();
  for (const m of flat.math) if (!m.display && (m.latex ?? m.mathml)) byUnit.set(m.unit, [...(byUnit.get(m.unit) ?? []), m]);
  flat.blocks.forEach((block, b) => {
    let page = block.page ?? 1;
    for (const u of flat.unitsOf[b]) {
      const unit = flat.units[u];
      for (const m of byUnit.get(u) ?? []) (out[page + unit.breaks.filter((at) => at <= (m.from ?? 0)).length] ??= []).push(m.latex ?? m.mathml ?? "");
      page += unit.breaks.length;
    }
  });
  return out;
}

/** The inline formulas a saved run held on each page that the candidate no
    longer holds there (nor on a page beside it): each saved formula takes
    the candidate's same LaTeX first, else one whose canonical form is 0.8
    like it or more. A regression that turns right formulas back into words
    moves no score when the words are all there (round 4's "F: ℝ ↦ [0, 1]"):
    the saved run's formulas show it. */
export function lostFormulas(saved: Record<number, string[]>, now: Record<number, string[]>): { page: number; latex: string }[] {
  const left = new Map(Object.entries(now).map(([page, list]) => [Number(page), [...list]]));
  const lost: { page: number; latex: string }[] = [];
  const pending: { page: number; latex: string }[] = [];
  for (const [page, list] of Object.entries(saved)) {
    for (const latex of list) {
      const here = left.get(Number(page)) ?? [];
      const k = here.indexOf(latex);
      if (k >= 0) here.splice(k, 1);
      else pending.push({ page: Number(page), latex });
    }
  }
  for (const f of pending) {
    const want = mathTokens({ latex: f.latex }, false);
    let best: { list: string[]; k: number; sim: number } | null = null;
    for (const page of [f.page, f.page - 1, f.page + 1]) {
      (left.get(page) ?? []).forEach((latex, k, list) => {
        const sim = sequenceSimilarity(want, mathTokens({ latex }, false));
        if (sim >= 0.8 && (!best || sim > best.sim)) best = { list, k, sim };
      });
    }
    const hit = best as { list: string[]; k: number; sim: number } | null;
    if (hit) hit.list.splice(hit.k, 1);
    else lost.push(f);
  }
  return lost;
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
  // owners of their neighbors: an equation, a figure, a separator, and a
  // table whose cells hold no words (a table of formulas).
  const used = new Set<number>();
  const cellWords = (rb: number) => ref.unitsOf[rb].some((u) => ref.units[u].index >= 0 && ref.units[u].end > ref.units[u].first);
  for (let rb = 0; rb < ref.blocks.length; rb++) {
    const kind = ref.blocks[rb].kind;
    const wordless = kind === "table" ? !cellWords(rb) : !hasWords(ref, rb) && (kind === "equation" || kind === "figure" || kind === "separator");
    if (owner[rb] >= 0 || !wordless) continue;
    let lo = -1;
    let hi = cand.blocks.length;
    for (let p = rb - 1; p >= 0; p--) if (owner[p] >= 0) { lo = owner[p]; break; }
    for (let n = rb + 1; n < ref.blocks.length; n++) if (owner[n] >= 0 && hasWords(ref, n)) { hi = owner[n]; break; }
    if (hi <= lo) hi = Math.min(cand.blocks.length, lo + 8);
    let best = -1;
    let bestFit = 0;
    // A candidate table's words may pair with the same numbers in the prose; it is free unless it holds
    // another reference table.
    const tableOwners = new Set(ref.blocks.flatMap((b, r) => (b.kind === "table" && owner[r] >= 0 ? [owner[r]] : [])));
    for (let cb = lo + 1; cb < hi; cb++) {
      const free = kind === "table" ? cand.blocks[cb].kind === "table" && !tableOwners.has(cb) : candMatched[cb] < 3;
      if (used.has(cb) || !free) continue;
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
  // A heading's own number ("3 Well-posedness of …") is no page number, in the heading or in a line that
  // repeats it (a contents entry): a number that opens the words a heading opens with, a word after it.
  const HEAD = 3;
  const openings = new Set<string>();
  flat.units.forEach((unit) => {
    const kind = flat.blocks[unit.block].kind;
    if ((kind === "heading" || kind === "title") && unit.end - unit.first >= 2 && /^\d+$/.test(flat.toks[unit.first].w) && !/^\d+$/.test(flat.toks[unit.first + 1].w)) {
      openings.add(flat.toks.slice(unit.first, Math.min(unit.end, unit.first + HEAD)).map((t) => t.w).join(" "));
    }
  });
  const headingNumber = (t: number, end: number, words: string[]) =>
    words.length === 1 && /^\d+$/.test(words[0]) && [2, HEAD].some((k) => t + k <= end && openings.has(flat.toks.slice(t, t + k).map((x) => x.w).join(" ")));
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
    const at = (t: number, words: string[]) => t >= first && t + words.length <= end && !marked(t) && words.every((w, x) => toks[t + x].w === w) && !headingNumber(t, end, words);
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

export type HeadingScores = {
  ref: number;
  found: number;
  atLevel: number;
  shift: number;
  /** Candidate headings (a table's caption aside), and those that are a reference heading at its level. */
  cand: number;
  right: number;
  recall: number | null;
  precision: number | null;
  score: number | null;
  misses: { ref: number; cand: number }[];
  /** Candidate headings no reference heading stands for, or at another level. */
  invented: number[];
};

/** Headings: reference headings found as headings at their level, after the
    one level shift that fits best (a parse that sets every section one level
    deeper keeps the hierarchy), and candidate headings that are one of them:
    a heading the page does not set (a bold line of the body, a figure's
    label) is wrong. The score is their F1. */
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
  const rightAt = new Set(pairs.filter((p) => p.cl === p.rl + shift).map((p) => p.cand));
  const candidates = cand.blocks.flatMap((block, cb) => (block.kind === "heading" && !al.caption[cb] ? [cb] : []));
  const invented = candidates.filter((cb) => !rightAt.has(cb));
  const recall = share(Math.max(0, atLevel), total);
  const precision = share(candidates.length - invented.length, candidates.length) ?? (total > 0 ? 0 : null);
  return {
    ref: total,
    found: pairs.length,
    atLevel: Math.max(0, atLevel),
    shift,
    cand: candidates.length,
    right: candidates.length - invented.length,
    recall,
    precision,
    score: f1Of(precision, recall),
    misses,
    invented,
  };
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
    list format (a marker left in the words is no marker), or, for an
    unmarked item, the reference's marker its words open with (a label no
    list level draws, "[Bil95]"). */
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
    // A label no list level draws ("[Bil95]") stays as the words an unmarked item opens with: that is its marker,
    // drawn as the page draws it.
    const words = cand.units[cu].text.trimStart();
    const worded = theirs.marker === "" && mine.marker !== "" && words.startsWith(mine.marker) && (words.length === mine.marker.length || /\s/.test(words[mine.marker.length]));
    if (sameMarker(mine.marker, theirs.marker) || worded) {
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

/** A formula in a table cell and a candidate formula read alike: the same
    canonical form, near enough. */
const SAME_FORMULA = 0.9;

/** The inline formulas of a flat's table cells, by unit. */
function cellFormulas(flat: Flat): Map<number, number[]> {
  const out = new Map<number, number[]>();
  flat.math.forEach((m, k) => {
    if (m.display || m.unit < 0) return;
    const unit = flat.units[m.unit];
    if (flat.blocks[unit.block].kind !== "table" || unit.index < 0) return;
    out.set(m.unit, [...(out.get(m.unit) ?? []), k]);
  });
  return out;
}

/** A formula's canonical tokens, and a cell's words as the table metric compares them. */
const tokensOf = (flat: Flat, k: number) => mathTokens(flat.math[k], false);
const plain = (text: string) => text.normalize("NFKC").replace(/\s+/g, "");

/** A reference table's cells in the candidate table that owns it: rows and
    columns map one to one, by the most words and formulas shared, and those
    no word or formula maps keep their place when that place is free. */
function cellMap(ref: Flat, cand: Flat, al: Alignment, rb: number, refFormulas: Map<number, number[]>, candFormulas: Map<number, number[]>) {
  const cb = al.owner[rb];
  const body = ref.unitsOf[rb].filter((u) => ref.units[u].index >= 0);
  const rowVotes = new Map<string, number>();
  const colVotes = new Map<string, number>();
  const key = (a: number, b: number) => `${a},${b}`;
  const vote = (ru: Unit, cu: Unit) => {
    rowVotes.set(key(ru.row, cu.row), (rowVotes.get(key(ru.row, cu.row)) ?? 0) + 1);
    colVotes.set(key(ru.col, cu.col), (colVotes.get(key(ru.col, cu.col)) ?? 0) + 1);
  };
  for (const u of body) {
    for (let i = ref.units[u].first; i < ref.units[u].end; i++) {
      const j = al.aTo[i];
      if (j < 0) continue;
      const cu = cand.units[cand.toks[j].unit];
      if (cu.block !== cb || cu.index < 0) continue;
      vote(ref.units[u], cu);
    }
  }
  // A formula the owning table's cells hold once, read alike or as the same characters, votes too.
  const ownerCells = cb >= 0 ? cand.unitsOf[cb].filter((u) => cand.units[u].index >= 0) : [];
  for (const u of body) {
    for (const k of refFormulas.get(u) ?? []) {
      const want = tokensOf(ref, k);
      const reading = plain(ref.math[k].text ?? "");
      const alike = ownerCells.filter(
        (cu) => (candFormulas.get(cu) ?? []).some((c) => sequenceSimilarity(want, tokensOf(cand, c)) >= SAME_FORMULA) || (reading !== "" && plain(cand.units[cu].text) === reading),
      );
      if (alike.length === 1) vote(ref.units[u], cand.units[alike[0]]);
    }
  }
  const rows = assign(rowVotes);
  const cols = assign(colVotes);
  // Rows and columns no word or formula maps keep their place when that place is free (a table of formulas
  // read as words).
  const byPlace = (map: Map<number, number>, from: number[], to: number[]) => {
    const taken = new Set(map.values());
    for (const r of new Set(from)) {
      if (map.has(r) || !to.includes(r) || taken.has(r)) continue;
      map.set(r, r);
      taken.add(r);
    }
  };
  byPlace(rows, body.map((u) => ref.units[u].row), ownerCells.map((u) => cand.units[u].row));
  byPlace(cols, body.map((u) => ref.units[u].col), ownerCells.map((u) => cand.units[u].col));
  const cellAt = (unit: Unit) => ownerCells.find((c) => cand.units[c].row === rows.get(unit.row) && cand.units[c].col === cols.get(unit.col)) ?? -1;
  return { cb, body, rows, cols, cellAt };
}

/** Tables: a table word is in place when it lands in the candidate table
    that owns its table, in the row and column its row and column map to
    (rows and columns map one to one, by the most words and formulas shared).
    A formula in a cell is placed as a word is: in place when the mapped
    cell holds a formula read alike, or the same characters as words. F1 of
    words and formulas in place, and the leaks both ways. */
export function tableScores(ref: Flat, cand: Flat, al: Alignment): TableScores {
  const inPlace = new Uint8Array(cand.toks.length);
  const refFormulas = cellFormulas(ref);
  const candFormulas = cellFormulas(cand);
  const formulaPlaced = new Set<number>();
  let refWords = 0;
  let hits = 0;
  let outside = 0;
  const misses: TableScores["misses"] = [];
  ref.blocks.forEach((block, rb) => {
    if (block.kind !== "table") return;
    const { cb, body, rows, cols, cellAt } = cellMap(ref, cand, al, rb, refFormulas, candFormulas);
    for (const u of body) {
      const unit = ref.units[u];
      for (const k of refFormulas.get(u) ?? []) {
        refWords++;
        const at = cellAt(unit);
        const want = tokensOf(ref, k);
        const formula = at < 0 ? undefined : (candFormulas.get(at) ?? []).find((c) => !formulaPlaced.has(c) && sequenceSimilarity(want, tokensOf(cand, c)) >= SAME_FORMULA);
        const reading = ref.math[k].text;
        const asWords = at >= 0 && formula === undefined && reading !== undefined && plain(reading) !== "" && plain(cand.units[at].text) === plain(reading);
        if (formula !== undefined) formulaPlaced.add(formula);
        if (asWords) for (let j = cand.units[at].first; j < cand.units[at].end; j++) inPlace[j] = 1;
        if (formula !== undefined || asWords) hits++;
        else misses.push({ ref: u, row: unit.row, col: unit.col, want: latexOf(ref.math[k]), got: at >= 0 ? cand.units[at].text : "" });
      }
    }
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
  for (const list of candFormulas.values()) {
    candWords += list.length;
    candHits += list.filter((k) => formulaPlaced.has(k)).length;
  }
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
  labels: {
    ref: number;
    right: number;
    extra: number;
    score: number | null;
    misses: { want: string; got: string }[];
    /** Of the labels right, those on the page's side (the right, or the left where the reference says so). */
    side: { ref: number; right: number; score: number | null };
  };
  /** Reference equations the candidate shows as images. */
  images: number;
  /** Reference equations and inline formulas the candidate reads as plain words. */
  plainDisplay: number;
  plainInline: number;
  score: number | null;
  misses: { display: boolean; want: string; got: string; similarity: number }[];
};

const latexOf = (m: { latex?: string; mathml?: string }) => m.latex ?? (m.mathml ? "(MathML)" : "");

/** Inline formulas one right after another in a unit, no word between them
    ("z = x−μ/σ = 1−5/6" set as two formulas with an "=" between, or as one):
    each such formula's run, by its index in flat.math. Where one formula
    ends and the next begins is a writer's choice the page does not show. */
function formulaRuns(flat: Flat): Map<number, number[]> {
  const runs = new Map<number, number[]>();
  let run: number[] = [];
  const close = () => {
    if (run.length > 1) for (const k of run) runs.set(k, run);
    run = [];
  };
  flat.math.forEach((m, k) => {
    const last = run.length > 0 ? flat.math[run[run.length - 1]] : null;
    const next = last && !m.display && last.unit === m.unit && last.to !== undefined && m.from !== undefined && wordsOf(flat.units[m.unit].text.slice(last.to, m.from)).length === 0;
    if (!next) close();
    if (!m.display) run.push(k);
  });
  close();
  return runs;
}

/** A run's formulas read as one: each formula's tokens, and the signs between them. */
function runTokens(flat: Flat, run: number[]): string[] {
  const out: string[] = [];
  run.forEach((k, i) => {
    const m = flat.math[k];
    const prev = i > 0 ? flat.math[run[i - 1]] : null;
    if (prev) out.push(...textMathTokens(flat.units[m.unit].text.slice(prev.to, m.from)));
    out.push(...mathTokens(m, false));
  });
  return out;
}

/** Math: each reference formula against its counterpart, by the similarity
    of canonical forms. A display equation's counterpart is its owner; an
    inline formula's is a candidate formula between the matched words around
    it, or else the candidate's words there read as math; a formula alone in
    a table cell, the candidate cell's (cellMap). A run of formulas with no
    word between them reads as one on either side (formulaRuns): a candidate
    formula that holds two of the reference's and the "=" between them scores
    both. An image scores 0. */
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
  const labels: MathScores["labels"] = { ref: 0, right: 0, extra: 0, score: null, misses: [], side: { ref: 0, right: 0, score: null } };
  // A table's cells in the candidate's table, as the table metric maps them, made once a table.
  const refCells = cellFormulas(ref);
  const candCells = cellFormulas(cand);
  const maps = new Map<number, ReturnType<typeof cellMap>>();
  const mapOf = (rb: number) => maps.get(rb) ?? maps.set(rb, cellMap(ref, cand, al, rb, refCells, candCells)).get(rb);
  const [refRuns, candRuns] = [formulaRuns(ref), formulaRuns(cand)];
  const candIndex = new Map(cand.math.map((m, k) => [m, k]));
  for (const [k, m] of ref.math.entries()) {
    const want = mathTokens(m, m.display);
    if (m.display) {
      const cb = al.owner[m.block];
      const other = cb >= 0 ? cand.blocks[cb] : null;
      if (m.label) {
        labels.ref++;
        const theirs = other?.kind === "equation" ? (other.label ?? "") : "";
        if (theirs && normLabel(theirs) === normLabel(m.label)) {
          labels.right++;
          const block = ref.blocks[m.block];
          const want = block.kind === "equation" ? (block.labelSide ?? "right") : "right";
          labels.side.ref++;
          if (other?.kind === "equation" && (other.labelSide ?? "right") === want) labels.side.right++;
        } else labels.misses.push({ want: m.label, got: other?.kind === "equation" ? theirs || "(no label)" : `(${other?.kind ?? "missing"})` });
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
      // The formula, or its run, against the candidate's formula, or the candidate's run.
      const mine = refRuns.get(k);
      const wants = mine ? [want, runTokens(ref, mine)] : [want];
      for (const hit of hits) {
        const theirs = candRuns.get(candIndex.get(hit) ?? -1);
        if (!mine && !theirs) continue;
        const gots: [string[], string][] = [[mathTokens(hit, false), latexOf(hit)]];
        if (theirs) gots.push([runTokens(cand, theirs), theirs.map((j) => latexOf(cand.math[j])).join(" ")]);
        for (const w of wants) {
          for (const [tokens, latex] of gots) {
            const s = sequenceSimilarity(w, tokens);
            if (s > sim) [sim, got] = [s, latex];
          }
        }
      }
    } else {
      const gap = gapText(cand, al, prev, next, want.length);
      // A formula alone in a table cell has no words beside it: the candidate's cell the table's rows and
      // columns map it to holds it, as a formula or as words.
      const at = !gap.trim() && ref.blocks[unit.block].kind === "table" && unit.index >= 0 ? (mapOf(unit.block)?.cellAt(unit) ?? -1) : -1;
      if (gap.trim()) {
        plainInline++;
        sim = sequenceSimilarity(want, textMathTokens(gap));
        got = `(words) ${gap.trim()}`;
      } else if (at >= 0 && (candCells.get(at) ?? []).length > 0) {
        for (const k of candCells.get(at) ?? []) {
          const s = sequenceSimilarity(want, mathTokens(cand.math[k], false));
          if (s >= sim) [sim, got] = [s, latexOf(cand.math[k])];
        }
      } else if (at >= 0 && cand.units[at].text.trim()) {
        plainInline++;
        sim = sequenceSimilarity(want, textMathTokens(cand.units[at].text));
        got = `(words) ${cand.units[at].text.trim()}`;
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
  labels.side.score = labels.side.ref > 0 ? labels.side.right / labels.side.ref : null;
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
  f1: Record<Scored, number | null>;
  /** Characters of matched words: styled on both sides, only in the candidate, only in the reference. */
  counts: Record<Scored, { both: number; candOnly: number; refOnly: number }>;
};

const meanOf = (list: (number | null)[]) => {
  const known = list.filter((x): x is number => x !== null);
  return known.length > 0 ? known.reduce((a, b) => a + b, 0) / known.length : null;
};

/** Two colors a reader takes for one: no channel apart by more than 0x30. */
export function sameColor(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return a === b;
  const channels = (hex: string) => [1, 3, 5].map((k) => Number.parseInt(hex.slice(k, k + 2), 16));
  const [x, y] = [channels(a), channels(b)];
  return x.every((c, k) => Math.abs(c - y[k]) <= 0x30);
}

/** Bold, italic, underline, strikethrough, small caps, sub, sup, text
    color, and highlight: F1 over the characters of matched words, where both
    words count for styles (not in a title, a heading, or code). A color or
    a highlight is right in the same color; in another, it is wrong on both
    sides. A link's underline and color are the link's, not scored. A style
    the reference never marks is not scored: its author did not mark it. */
export function styleScores(ref: Flat, cand: Flat, al: Alignment): StyleScores {
  const counts = Object.fromEntries(SCORED.map((style) => [style, { both: 0, candOnly: 0, refOnly: 0 }])) as StyleScores["counts"];
  const tally = (style: Scored, r: boolean, c: boolean, right: boolean, weight: number) => {
    if (r && c && right) counts[style].both += weight;
    else {
      if (c) counts[style].candOnly += weight;
      if (r) counts[style].refOnly += weight;
    }
  };
  al.aTo.forEach((j, i) => {
    if (j < 0) return;
    const r = ref.toks[i];
    const c = cand.toks[j];
    if (!ref.units[r.unit].styled || !cand.units[c.unit].styled) return;
    const weight = r.end - r.start;
    const link = r.link || c.link;
    for (const style of STYLES) if (style !== "underline" || !link) tally(style, r[style], c[style], true, weight);
    if (!link) tally("color", Boolean(r.color), Boolean(c.color), sameColor(r.color, c.color), weight);
    tally("highlight", Boolean(r.highlight), Boolean(c.highlight), sameColor(r.highlight, c.highlight), weight);
  });
  const f = ({ both, candOnly, refOnly }: { both: number; candOnly: number; refOnly: number }) =>
    both + candOnly + refOnly > 0 ? (2 * both) / (2 * both + candOnly + refOnly) : null;
  const marks = (style: Scored) =>
    ref.toks.some((t) => ref.units[t.unit].styled && (style === "color" ? Boolean(t.color) && !t.link : style === "highlight" ? Boolean(t.highlight) : t[style] && (style !== "underline" || !t.link)));
  const f1 = Object.fromEntries(SCORED.map((style) => [style, marks(style) ? f(counts[style]) : null])) as Record<Scored, number | null>;
  return { bold: f1.bold, italic: f1.italic, score: meanOf(SCORED.map((style) => f1[style])), f1, counts };
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
  /** Centered, right-aligned, and justified titles, headings, and paragraphs: F1 of those aligned alike, where the reference aligns any. */
  align: number | null;
  /** First-line, hanging, and block indents of paragraphs: F1 of those indented alike, where the reference marks any. */
  indent: number | null;
  /** Paragraphs whose indent the reference measures: the share indented alike at the page's size. */
  indentSize: number | null;
  /** The space under paragraphs and lists and between a list's items, where the reference measures it: the share alike. */
  spacing: number | null;
  /** Caption words (a figure's, a table's) in a caption of the candidate: F1, where the reference has captions. */
  captions: number | null;
  /** Checklist items: the share of the reference's whose counterpart item has its box and state. */
  checks: number | null;
  /** Separators and quotations: the share of the reference's found with their kind. */
  separators: number | null;
  quotes: number | null;
  /** The mean of the roles the reference has, printed equation labels among them (the composite's part). */
  score: number | null;
  /** The blocks alignment, indentation, indent sizes, and spacing count wrong, for the detail report. */
  misses: { align: PropertyMiss[]; indent: PropertyMiss[]; indentSize: PropertyMiss[]; spacing: PropertyMiss[] };
};

/** A block a property counts wrong: the reference's value and the
    candidate's ("left" or "none" where a side sets none, "not found" where
    the block has no counterpart), and the block's first words. */
export type PropertyMiss = { ref: string; cand: string; text: string };

/** F1 of a block property both sides may set: a reference block with it
    is right when its counterpart has the same; a candidate block with it is
    right when its main reference block has the same. */
function propertyF1(ref: Flat, cand: Flat, al: Alignment, of: (flat: Flat, b: number) => string | undefined): number | null {
  const refSet = ref.blocks.flatMap((_, rb) => (of(ref, rb) ? [rb] : []));
  if (refSet.length === 0) return null;
  const candSet = cand.blocks.flatMap((_, cb) => (of(cand, cb) && !al.caption[cb] ? [cb] : []));
  const recall = refSet.filter((rb) => al.owner[rb] >= 0 && of(cand, al.owner[rb]) === of(ref, rb)).length / refSet.length;
  const precision = candSet.length > 0 ? candSet.filter((cb) => al.main[cb] >= 0 && of(ref, al.main[cb]) === of(cand, cb)).length / candSet.length : 0;
  return f1Of(precision, recall);
}

/** The blocks propertyF1 counts wrong, each pair once: a reference block
    whose counterpart differs, then a candidate block whose main reference
    block differs. `none` names a side that sets none. */
function propertyMisses(ref: Flat, cand: Flat, al: Alignment, of: (flat: Flat, b: number) => string | undefined, none: string): PropertyMiss[] {
  const out: PropertyMiss[] = [];
  const seen = new Set<string>();
  ref.blocks.forEach((_, rb) => {
    const want = of(ref, rb);
    if (!want) return;
    const cb = al.owner[rb];
    const got = cb >= 0 ? (of(cand, cb) ?? none) : "not found";
    if (got === want) return;
    seen.add(`${rb}:${cb}`);
    out.push({ ref: want, cand: got, text: blockText(ref, rb) });
  });
  cand.blocks.forEach((_, cb) => {
    const got = of(cand, cb);
    if (!got || al.caption[cb]) return;
    const rb = al.main[cb];
    const want = rb >= 0 ? (of(ref, rb) ?? none) : "not found";
    if (want === got || seen.has(`${rb}:${cb}`)) return;
    out.push({ ref: want, cand: got, text: blockText(cand, cb) });
  });
  return out;
}

/** A paragraph shorter than this may fit on one line, where justified and
    flush left draw alike. */
const JUSTIFY_CHARS = 100;

/** Each unit's inline formulas, by unit. */
const formulasOf = new WeakMap<Flat, Map<number, MathItem[]>>();

/** A unit's length as drawn: its characters, each inline formula counted by
    the glyphs it draws (its MathML's leaves). A reference's formula holds
    the glyphs as its text, a parse's the page's characters, an import's
    none: its glyphs count alike on every side. */
function drawnLength(flat: Flat, u: number): number {
  let index = formulasOf.get(flat);
  if (!index) {
    index = new Map();
    for (const m of flat.math) if (!m.display && m.unit >= 0) index.set(m.unit, [...(index.get(m.unit) ?? []), m]);
    formulasOf.set(flat, index);
  }
  let n = flat.units[u].text.length;
  for (const m of index.get(u) ?? []) {
    const text = m.text ?? "";
    n += (m.latex !== undefined || m.mathml !== undefined ? mathLeaves(m, false).join("").length : text.length) - text.length;
  }
  return n;
}

/** A title's, a heading's, a paragraph's, or a list's items' alignment as
    the metric compares it. Justified counts only where the reference
    justifies any paragraph (a reference that marks none leaves it
    unscored), and on a paragraph of JUSTIFY_CHARS or more as drawn
    (drawnLength) or a list with an item that long, where a wrap shows it;
    elsewhere it is flush left. A line centered on the page is centered
    whether it reads as a heading or a paragraph. */
function alignKey(justified: boolean) {
  return (flat: Flat, b: number): string | undefined => {
    const block = flat.blocks[b];
    if (block.kind !== "title" && block.kind !== "heading" && block.kind !== "paragraph" && block.kind !== "list") return undefined;
    if (block.align !== "justify") return block.align;
    // A list's items show it where one of them wraps.
    const lengths = flat.unitsOf[b].map((u) => drawnLength(flat, u));
    const whole = block.kind === "list" ? Math.max(0, ...lengths) : lengths.reduce((n, x) => n + x, 0);
    return justified && (block.kind === "paragraph" || block.kind === "list") && whole >= JUSTIFY_CHARS ? "justify" : undefined;
  };
}

/** A measure within 2 pt or a quarter of the page's: an indent, a space. */
const nearPoints = (got: number, want: number) => Math.abs(got - want) <= Math.max(2, 0.25 * Math.abs(want));

/** Indent sizes: each reference paragraph whose indent the page measures
    (indentPt) against its counterpart's: its first line starting alike, and
    its other lines too where the page sets them in, within 2 pt or a
    quarter (a one-line paragraph set in reads as a first-line indent or a
    block indent alike). A page may set its paragraphs 5 pt in where the
    page editor drew every indent at half an inch. */
function indentSizes(ref: Flat, cand: Flat, al: Alignment): { score: number | null; misses: PropertyMiss[] } {
  const show = (x: { left: number; first: number } | undefined) => (x ? `${x.left}/${x.first} pt` : "none");
  let total = 0;
  let right = 0;
  const misses: PropertyMiss[] = [];
  ref.blocks.forEach((block, rb) => {
    if (block.kind !== "paragraph" || !block.indentPt) return;
    total++;
    const cb = al.owner[rb];
    const other = cb >= 0 ? cand.blocks[cb] : null;
    const got = other?.kind === "paragraph" ? other.indentPt : undefined;
    const want = block.indentPt;
    if (got && nearPoints(got.left + got.first, want.left + want.first) && (want.left === 0 || nearPoints(got.left, want.left))) right++;
    else misses.push({ ref: show(block.indentPt), cand: other ? show(got) : "not found", text: blockText(ref, rb) });
  });
  return { score: total > 0 ? right / total : null, misses };
}

/** Spacing: the space the reference measures under a paragraph or a list
    (to the next one below it in its column) and between a list's items,
    against its counterpart's, within 2 pt or a quarter. A block the
    candidate runs into the next one is the paragraphs metric's, and a
    block whose candidate says no space (a parse that measured none there;
    the import always draws one) is not counted here. A page may space a
    checklist's items or a list's paragraphs 4 to 6 pt apart where the page
    editor drew them tight. */
function spacingScores(ref: Flat, cand: Flat, al: Alignment): { score: number | null; misses: PropertyMiss[] } {
  let total = 0;
  let right = 0;
  const misses: PropertyMiss[] = [];
  const judge = (rb: number, want: number, got: number | undefined, what: string) => {
    total++;
    if (got !== undefined && nearPoints(got, want)) right++;
    else misses.push({ ref: `${what} ${want} pt`, cand: got === undefined ? "none" : `${got} pt`, text: blockText(ref, rb) });
  };
  ref.blocks.forEach((block, rb) => {
    if (block.kind !== "paragraph" && block.kind !== "list") return;
    const cb = al.owner[rb];
    const other = cb >= 0 ? cand.blocks[cb] : null;
    const said = other?.kind === "paragraph" || other?.kind === "list" ? other.spaceAfter : undefined;
    if (block.spaceAfter !== undefined && said !== undefined && al.owner[rb + 1] !== cb) judge(rb, block.spaceAfter, said, "after");
    if (block.kind === "list" && block.itemSpace !== undefined) judge(rb, block.itemSpace, other?.kind === "list" ? (other.itemSpace ?? 0) : undefined, "between items");
  });
  return { score: total > 0 ? right / total : null, misses };
}

/** A block's first words, for the detail report. */
function blockText(flat: Flat, b: number): string {
  return flat.unitsOf[b].map((u) => flat.units[u].text).join(" ").replace(/\s+/g, " ").trim().slice(0, 60);
}

/** The roles and marks the page's layout carries: alignment, indentation,
    captions, checkbox states, separators, quotations. */
export function roleScores(ref: Flat, cand: Flat, al: Alignment, blocks: BlockScores, lists: ListScores, math: MathScores): RoleScores {
  const indent = (flat: Flat, b: number) => {
    const block = flat.blocks[b];
    return block.kind === "paragraph" ? block.indent : undefined;
  };
  // A list's items count only where the reference justifies its paragraphs too (a reference that marks
  // no paragraph justified leaves the look unscored).
  const justified = ref.blocks.some((block) => block.kind === "paragraph" && block.align === "justify");
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
  const align = alignKey(justified);
  const sizes = indentSizes(ref, cand, al);
  const spacing = spacingScores(ref, cand, al);
  const roles = {
    align: propertyF1(ref, cand, al, align),
    indent: propertyF1(ref, cand, al, indent),
    indentSize: sizes.score,
    spacing: spacing.score,
    captions: refCaption > 0 ? f1Of(candCaption > 0 ? candHits / candCaption : 0, hits / refCaption) : null,
    checks: lists.checks.ref > 0 ? lists.checks.right / lists.checks.ref : null,
    separators: kind("separator"),
    quotes: kind("quote"),
  };
  const misses = {
    align: roles.align === null ? [] : propertyMisses(ref, cand, al, align, "left"),
    indent: roles.indent === null ? [] : propertyMisses(ref, cand, al, indent, "none"),
    indentSize: sizes.misses,
    spacing: spacing.misses,
  };
  return { ...roles, score: meanOf([...Object.values(roles), math.labels.score, math.labels.side.score]), misses };
}

export type FontScores = {
  /** Each role's reference blocks, those whose counterpart says its font, and of those the ones right in each property. */
  roles: Partial<Record<FontRole, { blocks: number; known: number; shape: number; size: number; bold: number; color: number }>>;
  /** Each property's mean over the roles (a role none of whose counterparts says its font scores 0). */
  shape: number | null;
  size: number | null;
  bold: number | null;
  color: number | null;
  /** The mean of the four (the composite's part). */
  score: number | null;
  misses: { ref: number; cand: number; role: FontRole; want: Font; got: Font | null; why: string }[];
};

/** A size within a tenth of another. */
const nearSize = (a: number, b: number) => b > 0 && Math.abs(a / b - 1) <= 0.1;

/** The role a reference block's font is scored by, when it has one. */
function fontRole(block: DocBlock): FontRole | null {
  switch (block.kind) {
    case "title":
      return "title";
    case "heading":
      return `h${block.level}`;
    case "paragraph":
    case "list":
      return "body";
    case "footnote":
      return "footnote";
    case "figure":
    case "table":
      return block.caption ? "caption" : null;
    default:
      return null;
  }
}

/** Fonts: each reference block of a role (the body's paragraphs and list
    items, the title, each heading level, a figure's or a table's caption, a
    footnote) against the candidate block that holds most of its words (of a
    table, its caption's words): the same shape; the size, the body's in
    points and every other role's as a ratio to the body, within a tenth; the
    same weight; the same color (a reference block without a font of its own
    takes its role's, bold and colored as most of its words are). The
    candidate's body size is the size most
    of its body's characters take. A block whose counterpart says nothing of
    its font is not counted, and a role none of whose counterparts says
    anything scores 0. */
export function fontScores(fonts: Fonts | undefined, ref: Flat, cand: Flat, al: Alignment): FontScores | null {
  if (!fonts) return null;
  const tally = new Map<number, number>();
  cand.blocks.forEach((block, cb) => {
    const body = (block.kind === "paragraph" && !block.role) || block.kind === "list";
    if (!body || !block.font) return;
    const chars = cand.unitsOf[cb].reduce((n, u) => n + cand.units[u].text.length, 0);
    tally.set(block.font.size, (tally.get(block.font.size) ?? 0) + chars);
  });
  const candBody = [...tally].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  // The candidate block holding most of a reference block's matched words (of a table, its caption's).
  const holder = (rb: number): number => {
    const block = ref.blocks[rb];
    if (block.kind !== "table") return al.owner[rb];
    const votes = new Map<number, number>();
    for (const u of ref.unitsOf[rb]) {
      if (ref.units[u].index !== -1) continue;
      for (let i = ref.units[u].first; i < ref.units[u].end; i++) {
        const j = al.aTo[i];
        if (j >= 0) votes.set(cand.units[cand.toks[j].unit].block, (votes.get(cand.units[cand.toks[j].unit].block) ?? 0) + 1);
      }
    }
    return [...votes].sort((a, b) => b[1] - a[1])[0]?.[0] ?? -1;
  };
  // A reference block's font: its own, else its role's, bold where most of its words' characters are bold and
  // in the color most of them take (a hand reference marks weight and color on the words, not on the block).
  const wantOf = (rb: number, role: FontRole): Font | undefined => {
    const block = ref.blocks[rb];
    const own = "font" in block ? block.font : undefined;
    const base = own ?? fonts[role];
    if (own || !base) return base;
    let total = 0;
    let bold = 0;
    const colors = new Map<string, number>();
    for (const u of ref.unitsOf[rb]) {
      if (block.kind === "table" && ref.units[u].index !== -1) continue;
      for (let t = ref.units[u].first; t < ref.units[u].end; t++) {
        const tok = ref.toks[t];
        const n = tok.end - tok.start;
        total += n;
        if (tok.bold) bold += n;
        if (tok.color && !tok.link) colors.set(tok.color, (colors.get(tok.color) ?? 0) + n);
      }
    }
    const [top, most] = [...colors].sort((a, b) => b[1] - a[1])[0] ?? ["", 0];
    const color = total > 0 && most * 2 > total ? top : base.color;
    return { shape: base.shape, size: base.size, ...(base.bold || (total > 0 && bold * 2 > total) ? { bold: true as const } : {}), ...(color ? { color } : {}) };
  };
  const roles: FontScores["roles"] = {};
  const misses: FontScores["misses"] = [];
  ref.blocks.forEach((block, rb) => {
    const role = fontRole(block);
    const want = role ? wantOf(rb, role) : undefined;
    if (!role || !want) return;
    const cb = holder(rb);
    if (cb < 0) return;
    const r = (roles[role] ??= { blocks: 0, known: 0, shape: 0, size: 0, bold: 0, color: 0 });
    r.blocks++;
    const other = cand.blocks[cb];
    const got = "font" in other && other.font ? other.font : null;
    if (!got) return;
    r.known++;
    const size =
      role === "body" ? nearSize(got.size, want.size) : candBody !== null && nearSize(got.size / candBody, want.size / fonts.body.size);
    const checks = { shape: got.shape === want.shape, size, bold: Boolean(got.bold) === Boolean(want.bold), color: sameColor(got.color, want.color) };
    for (const key of ["shape", "size", "bold", "color"] as const) if (checks[key]) r[key]++;
    const wrong = (Object.keys(checks) as (keyof typeof checks)[]).filter((key) => !checks[key]);
    if (wrong.length > 0) misses.push({ ref: rb, cand: cb, role, want, got, why: wrong.join(", ") });
  });
  const list = Object.values(roles);
  if (list.length === 0) return null;
  const share = (key: "shape" | "size" | "bold" | "color") => list.reduce((n, r) => n + (r.known > 0 ? r[key] / r.known : 0), 0) / list.length;
  const [shape, size, bold, color] = [share("shape"), share("size"), share("bold"), share("color")];
  return { roles, shape, size, bold, color, score: (shape + size + bold + color) / 4, misses };
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

// ── Readings a page allows ──────────────────────────────────────────────────

type ListBlock = Extract<DocBlock, { kind: "list" }>;

/** A clause list's numbered titles ("1. Definitions" in bold over "1.1 …",
    "1.2 …") read either as the list's items or as headings over lists of
    their clauses: a candidate that reads a reference's title item as a
    heading, with the lists after it holding the item's clauses one depth
    up, reads as the reference's list (the heading its item, the lists
    their items at the reference's depths, a footnote between them after
    the list), unless the reference sets those words as a heading too (a
    contents list's entry). Either reading scores alike. */
export function readAsReference(reference: Doc, candidate: Doc): Doc {
  const key = (text: string) => wordsOf(text).map((w) => w.w).join(" ");
  // A title the reference also sets as a heading (a contents list's entry for a section) reads as that heading.
  const headings = new Set(reference.blocks.flatMap((block) => (block.kind === "heading" ? [key(block.spans.map((span) => span.text).join("")).replace(/^[\d\s]+(?=\p{L})/u, "")] : [])));
  const titles = new Map<string, { marker: string; depth: number }>();
  for (const block of reference.blocks) {
    if (block.kind !== "list") continue;
    block.items.forEach((item, i) => {
      const words = item.spans.filter((span) => span.text.trim());
      const next = block.items[i + 1];
      const text = item.spans.map((span) => span.text).join("");
      if (item.marker && words.length > 0 && words.every((span) => span.bold) && next && next.depth > item.depth && !headings.has(key(text))) {
        titles.set(key(`${item.marker} ${text}`), { marker: item.marker, depth: item.depth });
      }
    });
  }
  if (titles.size === 0) return candidate;
  const out: DocBlock[] = [];
  let changed = false;
  for (let i = 0; i < candidate.blocks.length; ) {
    const block = candidate.blocks[i];
    const title = block.kind === "heading" ? titles.get(key(block.spans.map((span) => span.text).join(""))) : undefined;
    if (block.kind !== "heading" || !title) {
      out.push(candidate.blocks[i++]);
      continue;
    }
    // The titles and their clause lists that follow one another, a footnote between them set aside.
    const list: ListBlock = { kind: "list", items: [] };
    const notes: DocBlock[] = [];
    const add = (from: ListBlock, shift: number) => {
      const at = list.items.length;
      list.items.push(...from.items.map((item) => ({ ...item, depth: item.depth + shift })));
      for (const b of from.breaks ?? []) (list.breaks ??= []).push({ ...b, unit: b.unit + at });
      for (const m of from.marks ?? []) (list.marks ??= []).push({ ...m, unit: m.unit + at });
      list.font ??= from.font;
    };
    for (let open: { depth: number } | null = null; i < candidate.blocks.length; i++) {
      const b = candidate.blocks[i];
      const text = b.kind === "heading" ? b.spans.map((span) => span.text).join("") : "";
      const next = b.kind === "heading" ? titles.get(key(text)) : undefined;
      if (b.kind === "heading" && next) {
        const cut = text.indexOf(next.marker) + next.marker.length;
        const lead = cut + (/^\s*/.exec(text.slice(cut))?.[0].length ?? 0);
        add({ kind: "list", items: [{ depth: next.depth, marker: next.marker, spans: dropChars(b.spans, lead) }], breaks: (b.breaks ?? []).filter((x) => x.at >= lead).map((x) => ({ ...x, at: x.at - lead })), marks: (b.marks ?? []).filter((x) => x.at >= lead).map((x) => ({ ...x, at: x.at - lead, end: x.end - lead })) }, 0);
        open = next;
      } else if (b.kind === "list" && open && b.items.length > 0) {
        add(b, open.depth + 1 - Math.min(...b.items.map((item) => item.depth)));
      } else if (b.kind === "footnote" && open) {
        notes.push(b);
      } else break;
    }
    out.push(list, ...notes);
    changed = true;
  }
  return changed ? { ...candidate, blocks: out } : candidate;
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
  fonts: FontScores | null;
};

/** A candidate scored against a reference: every metric and the composite. */
export function score(reference: Doc, furniture: string[], candidate: Doc): { scores: Scores; ref: Flat; cand: Flat; al: Alignment } {
  const ref = flatten(reference);
  const cand = flatten(readAsReference(reference, candidate));
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
  const fonts = fontScores(reference.fonts, ref, cand, al);
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
    fonts: fonts?.score ?? null,
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
    fonts,
  };
  return { scores, ref, cand, al };
}
