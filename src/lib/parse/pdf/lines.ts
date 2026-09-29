// Items to lines: the items near one baseline make a line. Superscripts,
// subscripts, accents, and big operators join the right line; letter-spaced
// caps collapse; a wide gap starts a new cell.

import { median } from "@/lib/parse/pdf/geometry";
import { OPERATOR_GLYPH_RE, SPACING_ACCENTS, charCount, isUnicodeMathFont, sameFlags } from "@/lib/parse/pdf/glyphs";
import { hangingBox } from "@/lib/parse/pdf/math/layout";
import { mathGlyph } from "@/lib/parse/pdf/math-fonts";
import { splitZones } from "@/lib/parse/pdf/math/zones";
import type { Cell, Item, Line, Run } from "@/lib/parse/pdf/types";

export const ATTACH_PUNCT_RE = /^[.,;:!?)\]…%]/;
const CJK_START_RE = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const NUMERIC_TOKEN_RE = /^[\d.,%$€£+−–-]+$/;

// ── Letter-spaced caps ("A L P H A B E T") ──────────────────────────────────

// Inside one item: "A L P H A B E T" → "ALPHABET". Kickers and small-caps
// labels carry their letter spacing as literal spaces in the string.
function collapseSpacedStr(str: string): string {
  // Three letters need two spaces: most strings have fewer.
  const space = str.indexOf(" ");
  if (space < 0 || str.indexOf(" ", space + 1) < 0) return str;
  const tokens = str.split(" ").filter((t) => t.length > 0);
  if (tokens.length < 3 || !tokens.every((t) => t.length === 1)) return str;
  return tokens.join("");
}

// Across items: one glyph per item with small uniform gaps → merge into words.
// A gap a quarter of the size past the letters' own spacing is a word space:
// small capitals set one glyph per item, their letters touching, ran their
// words together ("FRACTIONSANDROOTS", synth-math-html).
function mergeSpacedItems(items: Item[]): Item[] {
  const singles = items.filter((i) => charCount(i.str) === 1).length;
  if (singles < 6 || singles < items.length * 0.6) return items;
  const letterGap = median(items.slice(1).map((item, k) => item.x - (items[k].x + items[k].w)).filter((g) => g >= 0));
  const out: Item[] = [];
  for (const item of items) {
    const last = out[out.length - 1];
    const gap = last ? item.x - (last.x + last.w) : Infinity;
    if (
      last &&
      [...last.str].length <= 2 &&
      charCount(item.str) === 1 &&
      gap >= 0 &&
      gap < item.size * 0.45 &&
      (gap < letterGap + item.size * 0.25 || item.math || last.math) &&
      sameFlags(last, item)
    ) {
      last.str += item.str;
      last.w = item.x + item.w - last.x;
      if (last.glyphs && item.glyphs) last.glyphs = [...last.glyphs, ...item.glyphs];
    } else {
      out.push({ ...item });
    }
  }
  return out;
}

// ── Drop caps ───────────────────────────────────────────────────────────────

// A drop cap: a paragraph's first letter (or two) set two lines tall or
// more, its top level with the first line's, the lines beside it set in by
// its width (IEEEtran's \IEEEPARstart, a CSS float). Grouped on its own
// baseline it took the lines beside it for its scripts: their words ran
// together out of order with no spaces, a heading at its size ("…on page
// nine.Stheir key results…theyanswer…", synth-paper-html). It opens the
// first word: it joins that word with no space, in the word's style
// ("S" + "CIENTIFIC"), and the lines beside it start where the
// paragraph's lines under it do.
const DROP_CAP_RE = /^(?=\p{Lu})\p{Script=Latin}{1,2}$/u;

// The items with each drop cap moved onto its paragraph's first line, and
// the first item of each other line beside it with the x that line takes.
function dropCaps(items: Item[]): { items: Item[]; starts: { item: Item; x: number }[] } {
  let out = items;
  const starts: { item: Item; x: number }[] = [];
  for (const cap of items) {
    if (cap.math || !DROP_CAP_RE.test(cap.str.trim())) continue;
    const right = cap.x + cap.w;
    const top = cap.y + cap.size * 0.7;
    // Text at most half its size starting just right of it, from its top
    // down to half its size under its baseline, by baseline: each line's
    // first item.
    const beside = items
      .filter((i) => !i.math && i.size * 2 <= cap.size && i.y <= top && i.y >= cap.y - cap.size * 0.5 && i.x >= right - i.size * 0.5 && i.x <= right + i.size * 2.5)
      .sort((a, b) => b.y - a.y);
    const rows: Item[][] = [];
    for (const i of beside) {
      const row = rows[rows.length - 1];
      if (row && Math.abs(row[0].y - i.y) < i.size * 0.3) row.push(i);
      else rows.push([i]);
    }
    const firsts = rows.map((row) => row.reduce((a, b) => (b.x < a.x ? b : a)));
    // The lines beside it follow one another at the text's leading.
    let n = 1;
    while (n < firsts.length && firsts[n - 1].y - firsts[n].y <= firsts[n].size * 1.6) n++;
    const lines = firsts.slice(0, n);
    const first = lines[0];
    if (!first || Math.abs(first.y + first.size * 0.7 - top) > first.size * 0.5) continue;
    if (lines.filter((l) => l.y >= cap.y - l.size * 0.5).length < 2) continue;
    // Stretched to the first word, it takes no space before it, unless the
    // page sets one: a letter that is a word of its own ("A", "I") stands a
    // word space from the next word, a drop cap's first letter none
    // (lettrine: "A" 3.6 pt from "long", "T" 0 pt from "he"). Its str then
    // ends in the space. A float's lines all start at one x, the first line
    // too, and say nothing: the letter joins.
    const spaced = first.x - (cap.x + cap.w) >= first.size * 0.3 && lines.some((l) => Math.abs(l.x - first.x) > first.size * 0.1);
    const lead: Item = { ...cap, str: cap.str.trim() + (spaced ? " " : ""), y: first.y, size: first.size, w: first.x - cap.x, bold: first.bold, italic: first.italic, mono: first.mono, smallCaps: first.smallCaps, href: first.href, font: first.font, look: first.look };
    out = out.map((i) => (i === cap ? lead : i));
    // The other lines beside it start where the paragraph's next line does,
    // or where the cap does when none follows: set in by its width, they
    // broke the paragraph where the lines came back to the column's edge
    // (synth-paper-tex). A CSS float sits in the first line's indent, and
    // the first line keeps it.
    const last = lines[lines.length - 1];
    const under = items.filter((i) => i.y < last.y - last.size * 0.5 && i.y >= last.y - last.size * 1.6 && i.x < last.x - last.size && i.x >= cap.x - cap.size);
    const x = Math.min(cap.x, ...under.map((i) => i.x));
    for (const item of lines.slice(1)) starts.push({ item, x });
  }
  return { items: out, starts };
}

// ── OCR layers ──────────────────────────────────────────────────────────────

/** An OCR layer's words as the scan shows them. A letter or two read out
    of a picture, over four times the page's text size, is no word (a
    rocket's drawing read as a 73 pt "i" took a chapter's title as its
    scripts). From one word's start to the next on its line is the word's
    width and a space (a quarter em): when the median ratio of that advance
    to the text layer's width and a space is off by a tenth or more, each
    word with a next one on its line takes that scale, a space short of the
    next word (a justified line's spaces stretch, so the median runs high).
    A line's last word keeps its width: the page's notes, set smaller than
    its body at the same size, run past the column at the body's scale.
    Two words are two words: a word whose box runs into the next word's
    ends a space short of it (NASA SP-4408's scan boxes overlap, "Igor"
    ending at 170.7 and "Lissov" starting at 167.0: 228 blocks on 161 pages
    read runs of words with no space, 49 on 47 now, where the text layer
    itself sets none). */
export function fitOcrItems(items: Item[]) {
  const text = median(items.map((i) => i.size));
  for (let k = items.length - 1; k >= 0; k--) if (charCount(items[k].str) <= 2 && items[k].size > text * 4) items.splice(k, 1);
  const words = items.filter((i) => i.str.trim()).sort((a, b) => b.y - a.y || a.x - b.x);
  const next = (k: number) => {
    const [a, b] = [words[k], words[k + 1]];
    return b && Math.abs(a.y - b.y) <= a.size * 0.2 && a.w > 0 ? b : undefined;
  };
  const ratios: number[] = [];
  words.forEach((a, k) => {
    const b = next(k);
    // A column's gutter or a table's cell gap is no word space.
    const ratio = b ? (b.x - a.x) / (a.w + a.size * 0.25) : 0;
    if (ratio > 0.5 && ratio < 2.5) ratios.push(ratio);
  });
  const scale = ratios.length >= 20 ? median(ratios) : 1;
  words.forEach((a, k) => {
    const b = next(k);
    if (!b) return;
    if (Math.abs(scale - 1) >= 0.1 && b.x - a.x < (a.w + a.size * 0.25) * 2.5) a.w = Math.max(a.w, Math.min(a.w * scale, b.x - a.x - a.size * 0.2));
    if (a.x + a.w > b.x - a.size * 0.15 && b.x - a.x > a.size * 0.5 && /[\p{L}\p{N}]$/u.test(a.str) && /^[\p{L}\p{N}]/u.test(b.str)) a.w = b.x - a.x - a.size * 0.2;
  });
}

// ── Line building ───────────────────────────────────────────────────────────

// A letter and its accent as one character. TeX sets an accented i on a
// dotless ı (\'{\i}), which Unicode composes with no accent: "Domı́nguez"
// read apart from "Domínguez" (arxiv-2503-22874).
function withAccent(letter: string, mark: string): string {
  const base = letter === "ı" ? "i" : letter === "ȷ" ? "j" : letter;
  return (base + mark).normalize("NFC");
}

function composeAccents(items: Item[]): Item[] {
  const out: Item[] = [];
  for (let k = 0; k < items.length; k++) {
    const item = items[k];
    // An accent closing one item over the letter opening the next ("…, Kamil˙"
    // then "e"): composed across the split (import compare loop finding).
    const trailing = item.str.length > 1 ? SPACING_ACCENTS[item.str[item.str.length - 1]] : undefined;
    const after = items[k + 1];
    if (trailing && after && /^\p{L}/u.test(after.str) && after.x <= item.x + item.w + item.size * 0.3) {
      // The accent's glyph, the item's last, goes with it.
      const accent = item.glyphs?.at(-1);
      const [letter, ...rest] = Array.from(after.str);
      out.push({ ...item, str: item.str.slice(0, -1), glyphs: accent ? item.glyphs!.slice(0, -1) : item.glyphs });
      items[k + 1] = {
        ...after,
        str: withAccent(letter, trailing) + rest.join(""),
        glyphs: accent && after.glyphs ? [...after.glyphs, accent] : after.glyphs,
      };
      continue;
    }
    const mark = item.str.length === 1 ? SPACING_ACCENTS[item.str] : undefined;
    if (mark) {
      // The letter under the accent: the glyph of a neighbor item that the
      // accent's center sits over — its first glyph, or with a wider item the
      // glyph at that offset (an accent over the last letter of "Kamilė" read
      // as a stray dot: import compare loop finding). Counted in characters,
      // not UTF-16 units: a hat over 𝒮 went unplaced.
      const cx = item.x + item.w / 2;
      const glyphAt = (it: Item | undefined): number => {
        const chars = it ? Array.from(it.str) : [];
        if (it === undefined || chars.length === 0 || it.w <= 0) return -1;
        const advance = it.w / chars.length;
        const idx = Math.floor((cx - it.x + advance * 0.15) / advance);
        return idx >= 0 && idx < chars.length && /\p{L}/u.test(chars[idx]) ? idx : -1;
      };
      const composedAt = (base: Item, idx: number): Item => {
        const chars = Array.from(base.str);
        return {
          ...base,
          str: chars.slice(0, idx).join("") + withAccent(chars[idx], mark) + chars.slice(idx + 1).join(""),
          glyphs: base.glyphs && item.glyphs ? [...base.glyphs, ...item.glyphs] : base.glyphs,
        };
      };
      const next = items[k + 1];
      const prev = out[out.length - 1];
      const nextIdx = glyphAt(next);
      if (nextIdx >= 0) {
        out.push(composedAt(next!, nextIdx));
        k++;
        continue;
      }
      const prevIdx = glyphAt(prev);
      if (prevIdx >= 0) {
        out[out.length - 1] = composedAt(prev!, prevIdx);
        continue;
      }
    }
    out.push(item);
  }
  return out;
}

const QED_RE = /^[□■∎]$/;

/** The least gap between two items of a line, in points, that reads as a
    space: 0.12 of the line's size, or 0.2 after a script (an item set at
    0.85 of the size or less, a tenth of the size or more off the next
    item's baseline). TeX leaves \scriptspace (0.5 pt) after a script, and
    a word space is 0.22 em or more, justified too: "hk(z)" read "hk (z)".
    size: the line's text size. */
export function spaceGap(prev: Item, next: Item, size: number): number {
  return prev.size <= size * 0.85 && Math.abs(prev.y - next.y) >= size * 0.1 ? size * 0.2 : size * 0.12;
}

// Two runs of words a line apart that one line took, the later starting
// left of the earlier's end: no gap tells their space. A form's title lines
// beside its 24 pt number read "CertificationRequest"
// (real-irs-fw9-2024-p1). A script stacked over another sits less than its
// size apart, and a formula's letters make no word of four.
function crossesBack(prev: Item, next: Item): boolean {
  const size = Math.min(prev.size, next.size);
  const words = (i: Item) => !i.math && /[A-Za-z]{4}/.test(i.str);
  return next.x < prev.x + prev.w - size * 0.3 && Math.abs(prev.y - next.y) >= size * 0.95 && words(prev) && words(next);
}

// A cell boundary: a wide gap, or an em between two numbers — number
// columns sit closer than the word gap rule allows (a table of Brier
// scores read as one cell per row: import compare loop finding).
function opensCell(prev: Item, item: Item, size: number): boolean {
  const gap = item.x - (prev.x + prev.w);
  const numeric = NUMERIC_TOKEN_RE.test(prev.str.trim()) && NUMERIC_TOKEN_RE.test(item.str.trim());
  return gap > Math.max(8, size * 1.6) || (numeric && gap > size * 1.0);
}

// A glyph set smaller than its cell's text and raised or lowered off the
// text's baseline is a superscript or a subscript. Footnote references sit
// 0.27–0.49 em up at 0.58–0.82 of the text's size (SCOTUS, MMWR, Word,
// arXiv), and LaTeX sets a footnote's own label at 0.875 of its words; TeX
// subscripts sit 0.15–0.34 em down. The text size is the size
// most characters are set in, so a drop cap leaves the words beside it
// alone. A math font's glyphs belong to their formula.
function markShifts(items: Item[]) {
  const chars = new Map<number, number>();
  for (const i of items) {
    const key = Math.round(i.size * 10) / 10;
    chars.set(key, (chars.get(key) ?? 0) + i.str.length);
  }
  const textSize = [...chars].sort((a, b) => b[1] - a[1])[0][0];
  const baseline = median(items.filter((i) => Math.abs(i.size - textSize) <= textSize * 0.05).map((i) => i.y));
  for (const item of items) {
    const small = !item.math && item.size <= textSize * 0.9;
    item.sup = small && item.y - baseline >= textSize * 0.15;
    item.sub = small && baseline - item.y >= textSize * 0.1;
  }
}

function buildLine(rawItems: Item[], page: number): Line {
  const merged = mergeSpacedItems(
    composeAccents(
      rawItems
        .map((i) => ({ ...i, str: i.mono ? i.str : collapseSpacedStr(i.str) }))
        .sort((a, b) => a.x - b.x),
    ),
  );
  // A line's size is its text's: KaTeX sets a formula 1.21 times its prose,
  // so a sentence with inline math took the math's size and read as a
  // heading (synth-paper-html: seven invented headings). A glyph of a math
  // font set in Unicode counts only on a line with no other text.
  const textSizes = merged.flatMap((i) => {
    const text = i.glyphs?.filter((g) => !isUnicodeMathFont(g.base));
    return !i.glyphs?.length || text?.length === i.glyphs.length ? [i.size] : (text ?? []).map((g) => g.size);
  });
  const size = Math.max(...(textSizes.length > 0 ? textSizes : merged.map((i) => i.size)));
  // Raises are read per cell: a table cell set smaller on its own baseline
  // is no superscript of the cell beside it (a slide's table of primers read
  // as runs of superscripts).
  let from = 0;
  const cellStarts: number[] = [];
  for (let k = 1; k <= merged.length; k++) {
    if (k < merged.length && !opensCell(merged[k - 1], merged[k], size)) continue;
    markShifts(merged.slice(from, k));
    cellStarts.push(from);
    from = k;
  }
  // Inline formulas cut out of the items, cell by cell (math/zones.ts).
  const items = splitZones(merged, cellStarts);
  const cells: Cell[] = [];
  let prevEnd: number | null = null;
  let prevItem: Item | null = null;
  for (const item of items) {
    const gap = prevEnd === null ? 0 : item.x - prevEnd;
    // An end-of-proof mark set flush right closes the line's text, not a cell
    // of its own (read by its code, □ turned "as claimed." and a running
    // head into a table).
    const proofEnd = item === items[items.length - 1] && QED_RE.test(item.str.trim());
    const wide = prevItem !== null && !proofEnd && opensCell(prevItem, item, size);
    const least = prevItem !== null ? spaceGap(prevItem, item, size) : size * 0.12;
    const crossed = prevItem !== null && crossesBack(prevItem, item);
    prevItem = item;
    let cell = cells[cells.length - 1];
    if (!cell || wide) {
      cell = { x: item.x, text: "", runs: [] };
      cells.push(cell);
    } else if ((gap > least || crossed) && !cell.text.endsWith(" ")) {
      // Punctuation that attaches left ("PRESS" chip then ".") takes no space.
      const attach = ATTACH_PUNCT_RE.test(item.str) && gap < size * 0.7;
      if (!attach) cell.text += " ";
    }
    const start = cell.text.length;
    cell.text += item.str;
    const last = cell.runs[cell.runs.length - 1];
    if (last && sameFlags(last, item) && start - last.end <= 1) {
      last.end = cell.text.length;
    } else {
      cell.runs.push({
        start,
        end: cell.text.length,
        bold: item.bold,
        italic: item.italic,
        mono: item.mono,
        smallCaps: item.smallCaps,
        href: item.href,
        sup: item.sup,
        sub: item.sub,
        zone: item.zone,
        look: item.look,
      });
    }
    prevEnd = item.x + item.w;
  }
  for (const cell of cells) {
    const trimmed = cell.text.trimEnd();
    const cut = trimmed.length;
    cell.text = trimmed;
    cell.runs = cell.runs
      .map((r) => ({ ...r, end: Math.min(r.end, cut) }))
      .filter((r) => r.end > r.start);
  }
  let text = "";
  const runs: Run[] = [];
  cells.forEach((cell, i) => {
    if (i > 0) text += "\t";
    const offset = text.length;
    text += cell.text;
    for (const r of cell.runs) runs.push({ ...r, start: r.start + offset, end: r.end + offset });
  });
  const first = items[0];
  // The unit a wrap moves to the next line: a word, or one glyph in a script
  // that wraps anywhere (CJK carries no spaces, so the "first word" of a CJK
  // line was the whole line and every line read as wrapped).
  const firstWord = CJK_START_RE.test(first.str) ? first.str[0] : first.str.split(" ")[0] || first.str;
  const firstWordWidth =
    first.str.length > 0 ? first.w * Math.min(1, firstWord.length / first.str.length) : size;
  const last = items[items.length - 1];
  const ys = items.map((i) => i.y);
  return {
    cells,
    text,
    runs,
    items,
    x: first.x,
    xEnd: Math.max(...items.map((i) => i.x + i.w), last.x + last.w),
    y: baselineOf(items, (i) => hangingBox(i) !== null),
    size,
    page,
    firstWordWidth,
    mathChars: items.reduce((n, i) => n + (i.math ? charCount(i.str) : 0), 0),
    yMin: Math.min(...ys),
    yMax: Math.max(...ys),
  };
}

// The baseline is where a line's text sits: the median baseline of its
// full-size glyphs. The highest glyph was the baseline before, so a line
// with a superscript sat too high — its gap to the line above shrank and
// its gap to the line below grew, splitting paragraphs and fusing others
// (import compare loop finding). A big operator's or delimiter's origin is
// its top (math/layout.ts hangingBox): no baseline. The full size is the
// size of the glyphs on the baseline: a line of tall delimiters and their
// scripts (closing ‖s and their subscripts, arXiv 2506.08494) had none at
// the delimiters' size, and the median of none put it at the page's foot.
function baselineOf(items: Item[], hangs: (i: Item) => boolean): number {
  const onBase = items.filter((i) => !hangs(i));
  const pool = onBase.length > 0 ? onBase : items;
  const size = Math.max(...pool.map((i) => i.size));
  return median(pool.filter((i) => i.size >= size * 0.75).map((i) => i.y));
}

export function buildLines(items: Item[], page: number): Line[] {
  const { items: sorted, starts } = dropCaps(items.filter((i) => i.str.trim().length > 0));
  sorted.sort((a, b) => b.y - a.y || a.x - b.x);
  // A line is the items near one baseline. The anchor is the line's largest
  // item, the tolerance half its size: superscripts, subscripts, and sum
  // limits sit within that of their base line and belong to it (they read as
  // lines of their own before — import compare loop finding).
  // Operator glyphs (∫ ∑ ∏ √) carry their reference point high on the glyph:
  // grouped by it they land in the line above. They are placed once the
  // lines exist, by the glyph's center (import compare loop finding: a
  // display integral appended to the paragraph above it, an inline radical
  // pulled into the equation above its sentence).
  // A TeX extension-font glyph (a sized delimiter too) and a radical hang
  // from their origin by the depth the font's metrics give (math/layout.ts):
  // their box says where they sit.
  const boxes = new Map<Item, NonNullable<ReturnType<typeof hangingBox>>>();
  for (const i of sorted) {
    const box = hangingBox(i);
    if (box) boxes.set(i, box);
  }
  const hangs = (i: Item) => boxes.has(i) || OPERATOR_GLYPH_RE.test(i.str.trim());
  const operators = sorted.filter(hangs);
  // A display operator's limits sit over its top and under its bottom: they
  // stay with it, never with the prose line beside them (census class 1: a
  // sum's upper limit ended the line above, its lower limit the line below).
  // A glyph nearer the baseline of a line of full-size text, within a
  // script's reach of it (an inline formula's subscript over a display), is
  // that line's.
  const limitOf = (item: Item, lines: { y: number; size: number }[]) =>
    [...boxes].some(([op, box]) => {
      if (!box.display || item.size >= op.size * 0.9) return false;
      if (item.x >= op.x + op.w + op.size * 0.5 || item.x + item.w <= op.x - op.size * 0.5) return false;
      const above = item.y >= box.top - item.size * 0.2 && item.y - box.top < op.size * 0.8;
      const below = item.y <= box.bottom && box.bottom - item.y < op.size * 1.1;
      if (!above && !below) return false;
      const reach = above ? item.y - box.top : box.bottom - item.y;
      return !lines.some((l) => l.size >= item.size / 0.8 && Math.abs(l.y - item.y) < Math.min(reach, l.size * 0.45));
    });
  const grouped: Item[][] = [];
  const anchors: Item[] = [];
  // A line whose largest item is half again the size of the text beside it
  // reaches no second baseline of that text: the IRS W-9's 24 pt "W-9" took
  // the two lines of the title beside it, and the side box's, into one line.
  // A formula's scripts stand on baselines of their own around its tall
  // delimiters.
  const ownBaseline = (group: Item[], anchor: Item, item: Item) => {
    if (anchor.size < item.size * 1.5 || anchor.math || item.math) return true;
    const kin = group.filter((i) => Math.abs(i.size - item.size) <= item.size * 0.25);
    return kin.length === 0 || kin.some((i) => Math.abs(i.y - item.y) < item.size * 0.5);
  };
  for (const item of sorted) {
    if (hangs(item)) continue;
    const last = grouped[grouped.length - 1];
    const anchor = anchors[anchors.length - 1];
    const tolerance = anchor ? Math.max(2, Math.max(anchor.size, item.size) * 0.5) : 0;
    if (last && Math.abs(anchor.y - item.y) < tolerance && ownBaseline(last, anchor, item)) {
      last.push(item);
      if (item.size > anchor.size) anchors[anchors.length - 1] = item;
    } else {
      grouped.push([item]);
      anchors.push(item);
    }
  }
  // Superscripts, subscripts, a sum's limits and footnote marks sit on
  // baselines of their own: a glyph set at three quarters of a neighboring
  // line's size or less, within one text height of it, belongs to that line.
  // On their own they read as an equation of their own and their crop pulled
  // the neighboring prose in (import compare loop finding). A lone operator
  // glyph (a radical, an integral sign) inside prose joins the prose line the
  // same way; beside an equation it stays, and the equation's region takes it.
  const stats = grouped.map((g) => {
    const size = Math.max(...g.map((i) => i.size));
    const large = g.filter((i) => i.size >= size * 0.75);
    const chars = g.reduce((n, i) => n + charCount(i.str), 0);
    const mathChars = g.reduce((n, i) => n + (i.math ? charCount(i.str) : 0), 0);
    return {
      size,
      y: median(large.map((i) => i.y)),
      x1: Math.min(...g.map((i) => i.x)),
      x2: Math.max(...g.map((i) => i.x + i.w)),
      mathy: chars > 0 && mathChars >= chars * 0.3,
      prose: chars >= 20 && mathChars < chars * 0.5,
      // A glyph of TeX's math fonts: a line of a formula, however short.
      tex: g.some((i) => i.glyphs?.some((gl) => gl.family !== null && gl.family !== "ot1")),
    };
  });
  const moved: Item[][] = grouped.map(() => []);
  const kept: Item[][] = grouped.map((g) => [...g]);
  const neighbors = (k: number) => [k - 1, k + 1].filter((n) => n >= 0 && n < grouped.length);
  const overlaps = (item: Item, n: number) =>
    item.x < stats[n].x2 + stats[n].size * 2 && item.x + item.w > stats[n].x1 - stats[n].size * 2;
  const gapTo = (item: Item, n: number) => Math.abs(item.y - stats[n].y);
  // A raised glyph (a superscript, a numerator) belongs to the line under it
  // far more often than to the line above: the line above pays a small
  // penalty when the two are about as near.
  const cost = (item: Item, n: number) => gapTo(item, n) + (stats[n].y > item.y ? stats[n].size * 0.15 : 0);
  // Pass 1: small glyphs and spacing accents join the nearest line within a
  // text height — when that line is nearer than the glyph's own line. An
  // equation's limits and exponents join the equation's own line when one is
  // near, never the prose beside it. (A glyph already on the right line
  // stayed put before only by luck: a footnote mark moved to the line above
  // and subscripts to the line below — import compare loop finding.)
  // A script touches the glyph it is set on: it is its line's, never a
  // label or a limit of another line's (arXiv 2502.02648's c_k, over the
  // next line's ">", read "c^α" and "γ >k 1").
  const all = grouped.flat();
  const scripted = (item: Item) =>
    all.some((i) => i !== item && i.size > item.size * 1.1 && Math.abs(i.y - item.y) < i.size * 0.6 && item.x - (i.x + i.w) > -0.05 * i.size && item.x - (i.x + i.w) < 0.15 * i.size);
  // A label stacked over a relation of the line under it (\overset{p}{\to},
  // a word over an arrow) is that line's, however near the line above: it
  // joined the line above as a stray letter.
  const labelOf = (item: Item, n: number) =>
    stats[n].y < item.y &&
    item.size <= stats[n].size * 0.8 &&
    !scripted(item) &&
    grouped[n].some((i) =>
      (i.glyphs ?? []).some((g) => {
        if (g.family === null || g.size < stats[n].size * 0.9 || mathGlyph(g.family, g.code)?.cls !== "rel") return false;
        const rise = (item.y - g.y) / g.size;
        const center = item.x + item.w / 2;
        return rise > 0.45 && rise < 0.95 && center > g.x - g.size * 0.1 && center < g.x + g.w + g.size * 0.1;
      }),
    );
  // The limits of a text-size operator set over and under it (\sum\limits
  // in a sentence) go where the operator goes: the upper one ended the line
  // above as a stray letter, the lower one ran into the end of the line
  // below. An integral's are scripts beside it.
  const inlineOps = [...boxes].filter(([op, box]) => {
    const g = op.glyphs?.length === 1 ? op.glyphs[0] : null;
    return !box.display && g !== null && g.family !== null && mathGlyph(g.family, g.code)?.cls === "op" && !/[∫∮]/.test(op.str);
  });
  // A limit is centered on its operator, with the glyphs on its baseline
  // beside it (a subscript of the line above, "sup_n", over a sentence's
  // sum is that line's).
  const inlineLimitOf = (item: Item) =>
    inlineOps.find(([op, box]) => {
      if (item.size > op.size * 0.8 || item.x + item.w < op.x - op.size || item.x > op.x + op.w + op.size) return false;
      const above = item.y >= box.top - item.size * 0.2 && item.y - box.top < op.size * 0.7;
      const below = item.y <= box.bottom && box.bottom - item.y < op.size;
      if (!above && !below) return false;
      const run = all.filter((i) => i.size <= op.size * 0.8 && Math.abs(i.y - item.y) < item.size * 0.1 && i.x + i.w > op.x - op.size && i.x < op.x + op.w + op.size);
      const center = (Math.min(...run.map((i) => i.x)) + Math.max(...run.map((i) => i.x + i.w))) / 2;
      if (Math.abs(center - (op.x + op.w / 2)) > op.size * 0.25 || scripted(item)) return false;
      const reach = Math.max(0, above ? item.y - box.top : box.bottom - item.y);
      return !stats.some((l) => l.size >= item.size / 0.8 && Math.abs(l.y - item.y) < Math.min(reach, l.size * 0.45));
    })?.[0];
  const inlineLimits = new Map<Item, Item[]>();
  for (let k = 0; k < grouped.length; k++) {
    for (const item of grouped[k]) {
      const glyph = item.str.trim();
      const accent = glyph.length === 1 && SPACING_ACCENTS[glyph] !== undefined;
      if (limitOf(item, stats)) continue;
      if (k + 1 < grouped.length && labelOf(item, k + 1)) {
        moved[k + 1].push(item);
        kept[k] = kept[k].filter((i) => i !== item);
        continue;
      }
      const op = inlineLimitOf(item);
      if (op) {
        inlineLimits.set(op, [...(inlineLimits.get(op) ?? []), item]);
        kept[k] = kept[k].filter((i) => i !== item);
        continue;
      }
      // An accent belongs over a letter of about its own size: a line of
      // subscripts beside it is no candidate (import compare loop finding).
      const candidates = neighbors(k).filter(
        (n) =>
          (item.size <= stats[n].size * 0.75 || (accent && stats[n].size >= item.size * 0.75)) &&
          gapTo(item, n) <= stats[n].size * 1.05 &&
          overlaps(item, n),
      );
      // A glyph of TeX's math fonts prefers a formula's line only when it
      // is about as near as the nearest line: an inline sum's superscript is
      // its own line's, not the formula line over it (synthetic notes p. 5).
      const nearest = Math.min(...candidates.map((n) => gapTo(item, n)));
      const tex = item.glyphs?.some((g) => g.family !== null && g.family !== "ot1") ?? false;
      const mathy = candidates.filter((n) => stats[n].mathy && (!tex || gapTo(item, n) <= nearest * 1.5));
      const pool = stats[k].mathy && mathy.length > 0 ? mathy : candidates.filter((n) => stats[n].prose || stats[n].mathy || stats[n].tex);
      if (pool.length === 0) continue;
      pool.sort((a, b) => cost(item, a) - cost(item, b));
      // The own-line check is for a glyph set small against its own line's
      // base, or an accent grouped with letters of its size. A group of
      // superscripts alone has no base: its baseline is itself, and it always
      // joins the nearest line (a heading absorbed the superscripts of the
      // line below it — import compare loop finding).
      const hasBase = accent
        ? grouped[k].some((i) => i !== item && i.size >= stats[k].size * 0.75)
        : item.size < stats[k].size * 0.75;
      if (hasBase && cost(item, pool[0]) >= gapTo(item, k)) continue;
      // A group of prose is a line of its own, whatever its size against the
      // line beside it: an 11 pt author line under a 24 pt title took the
      // title's line as its scripts ("…DocumentsAda Lovelace",
      // synth-paper-tex).
      if (!hasBase && stats[k].prose) continue;
      moved[pool[0]].push(item);
      kept[k] = kept[k].filter((i) => i !== item);
    }
  }
  // A group whose every glyph left is no line: what moved into it follows
  // its glyphs (a macron over a letter landed in the emptied group of the
  // subscripts beside it — import compare loop finding).
  for (let k = 0; k < grouped.length; k++) {
    if (kept[k].length > 0 || moved[k].length === 0) continue;
    const target = moved.findIndex((m, n) => n !== k && m.some((i) => grouped[k].includes(i)));
    if (target < 0) continue;
    moved[target].push(...moved[k]);
    moved[k] = [];
  }
  // Operators: an equation's own line takes its integral or sum sign; a
  // radical or integral inside prose joins the prose line; anything else
  // stands alone for the equation region to take.
  const standalone: Item[][] = [];
  for (const op of operators) {
    const box = boxes.get(op);
    const center = box ? (box.top + box.bottom) / 2 : op.y - op.size * 0.6;
    const near = (n: number, factor: number) =>
      Math.abs(center - stats[n].y) <= stats[n].size * factor &&
      op.x < stats[n].x2 + stats[n].size * 2 &&
      op.x + op.w > stats[n].x1 - stats[n].size * 2;
    const byDistance = (a: number, b: number) => Math.abs(center - stats[a].y) - Math.abs(center - stats[b].y);
    // A group emptied by pass 1 is no line: an inline integral's limit that
    // moved into its sentence must not draw the integral after it.
    const all = stats.map((_, n) => n).filter((n) => kept[n].length > 0);
    const mathy = all.filter((n) => stats[n].mathy && near(n, 1.5)).sort(byDistance);
    const prose = all.filter((n) => stats[n].prose && near(n, 1.05)).sort(byDistance);
    // A glyph whose box the font's metrics give sits exactly: centered on
    // its line's math axis, a quarter em over the baseline, whatever else
    // the line holds (a list item's "2. ∑ m(ω) = 1" is neither prose nor an
    // equation's line). Else the nearest line of an equation or of prose
    // takes it (a sentence's inline sum is its own, never the display line
    // under it). An estimated one goes to an equation's line first.
    const axis = (n: number) => Math.abs(center - (stats[n].y + stats[n].size * 0.25));
    const onAxis = box
      ? all.filter((n) => stats[n].size >= op.size * 0.8 && axis(n) <= stats[n].size * 0.35 && near(n, 1.5)).sort((a, b) => axis(a) - axis(b))
      : [];
    const target = onAxis[0] ?? (box ? [...mathy, ...prose].sort(byDistance)[0] : (mathy[0] ?? prose[0]));
    if (target !== undefined) moved[target].push(op, ...(inlineLimits.get(op) ?? []));
    else standalone.push([op, ...(inlineLimits.get(op) ?? [])]);
  }
  const regrouped = [...kept.map((g, k) => [...g, ...moved[k]]), ...standalone].filter((g) => g.length > 0);
  regrouped.sort((a, b) => baselineOf(b, (i) => boxes.has(i)) - baselineOf(a, (i) => boxes.has(i)));
  const lines = regrouped.map((g) => buildLine(g, page)).filter((l) => l.text.length > 0);
  // The lines beside a drop cap start where its paragraph's lines do.
  for (const { item, x } of starts) {
    const line = lines.find((l) => l.x === item.x && Math.abs(l.y - item.y) < item.size * 0.3);
    if (line) {
      line.x = x;
      line.cells[0].x = x;
    }
  }
  return lines;
}
