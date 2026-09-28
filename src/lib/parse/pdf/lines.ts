// Items to lines: the items near one baseline make a line. Superscripts,
// subscripts, accents, and big operators join the right line; letter-spaced
// caps collapse; a wide gap starts a new cell.

import { median } from "@/lib/parse/pdf/geometry";
import { OPERATOR_GLYPH_RE, SPACING_ACCENTS, sameFlags } from "@/lib/parse/pdf/glyphs";
import type { Cell, Item, Line, Run } from "@/lib/parse/pdf/types";

export const ATTACH_PUNCT_RE = /^[.,;:!?)\]…%]/;
const CJK_START_RE = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const NUMERIC_TOKEN_RE = /^[\d.,%$€£+−–-]+$/;

// ── Letter-spaced caps ("A L P H A B E T") ──────────────────────────────────

// Inside one item: "A L P H A B E T" → "ALPHABET". Kickers and small-caps
// labels carry their letter spacing as literal spaces in the string.
function collapseSpacedStr(str: string): string {
  const tokens = str.split(" ").filter((t) => t.length > 0);
  if (tokens.length < 3 || !tokens.every((t) => t.length === 1)) return str;
  return tokens.join("");
}

// Across items: one glyph per item with small uniform gaps → merge into words.
function mergeSpacedItems(items: Item[]): Item[] {
  const singles = items.filter((i) => i.str.trim().length === 1).length;
  if (singles < 6 || singles < items.length * 0.6) return items;
  const out: Item[] = [];
  for (const item of items) {
    const last = out[out.length - 1];
    const gap = last ? item.x - (last.x + last.w) : Infinity;
    if (
      last &&
      last.str.length <= 2 &&
      item.str.trim().length === 1 &&
      gap >= 0 &&
      gap < item.size * 0.45 &&
      sameFlags(last, item)
    ) {
      last.str += item.str;
      last.w = item.x + item.w - last.x;
    } else {
      out.push({ ...item });
    }
  }
  return out;
}

// ── Line building ───────────────────────────────────────────────────────────

function composeAccents(items: Item[]): Item[] {
  const out: Item[] = [];
  for (let k = 0; k < items.length; k++) {
    const item = items[k];
    // An accent closing one item over the letter opening the next ("…, Kamil˙"
    // then "e"): composed across the split (import compare loop finding).
    const trailing = item.str.length > 1 ? SPACING_ACCENTS[item.str[item.str.length - 1]] : undefined;
    const after = items[k + 1];
    if (trailing && after && /^\p{L}/u.test(after.str) && after.x <= item.x + item.w + item.size * 0.3) {
      out.push({ ...item, str: item.str.slice(0, -1) });
      items[k + 1] = { ...after, str: (after.str[0] + trailing).normalize("NFC") + after.str.slice(1) };
      continue;
    }
    const mark = item.str.length === 1 ? SPACING_ACCENTS[item.str] : undefined;
    if (mark) {
      // The letter under the accent: the glyph of a neighbor item that the
      // accent's center sits over — its first glyph, or with a wider item the
      // glyph at that offset (an accent over the last letter of "Kamilė" read
      // as a stray dot: import compare loop finding).
      const cx = item.x + item.w / 2;
      const glyphAt = (it: Item | undefined): number => {
        if (it === undefined || it.str.length === 0 || it.w <= 0) return -1;
        const advance = it.w / it.str.length;
        const idx = Math.floor((cx - it.x + advance * 0.15) / advance);
        return idx >= 0 && idx < it.str.length && /\p{L}/u.test(it.str[idx]) ? idx : -1;
      };
      const composedAt = (base: Item, idx: number): Item => ({
        ...base,
        str: base.str.slice(0, idx) + (base.str[idx] + mark).normalize("NFC") + base.str.slice(idx + 1),
      });
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

function buildLine(rawItems: Item[], page: number): Line {
  const items = mergeSpacedItems(
    composeAccents(
      rawItems
        .map((i) => ({ ...i, str: i.mono ? i.str : collapseSpacedStr(i.str) }))
        .sort((a, b) => a.x - b.x),
    ),
  );
  const size = Math.max(...items.map((i) => i.size));
  const cells: Cell[] = [];
  let prevEnd: number | null = null;
  let prevItem: Item | null = null;
  for (const item of items) {
    const gap = prevEnd === null ? 0 : item.x - prevEnd;
    // A cell boundary: a wide gap, or an em between two numbers — number
    // columns sit closer than the word gap rule allows (a table of Brier
    // scores read as one cell per row: import compare loop finding).
    const numeric =
      prevItem !== null &&
      NUMERIC_TOKEN_RE.test(prevItem.str.trim()) &&
      NUMERIC_TOKEN_RE.test(item.str.trim());
    const wide =
      prevEnd !== null && (gap > Math.max(8, size * 1.6) || (numeric && gap > size * 1.0));
    prevItem = item;
    let cell = cells[cells.length - 1];
    if (!cell || wide) {
      cell = { x: item.x, text: "", runs: [] };
      cells.push(cell);
    } else if (gap > size * 0.12 && !cell.text.endsWith(" ")) {
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
        href: item.href,
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
  // The baseline is where the line's text sits: the median baseline of its
  // full-size glyphs. The highest glyph was the baseline before, so a line
  // with a superscript sat too high — its gap to the line above shrank and
  // its gap to the line below grew, splitting paragraphs and fusing others
  // (import compare loop finding).
  const large = items.filter((i) => i.size >= size * 0.75);
  const ys = items.map((i) => i.y);
  return {
    cells,
    text,
    runs,
    items,
    x: first.x,
    xEnd: Math.max(...items.map((i) => i.x + i.w), last.x + last.w),
    y: median(large.map((i) => i.y)),
    size,
    page,
    firstWordWidth,
    mathChars: items.reduce((n, i) => n + (i.math ? i.str.replace(/\s/g, "").length : 0), 0),
    yMin: Math.min(...ys),
    yMax: Math.max(...ys),
  };
}

export function buildLines(items: Item[], page: number): Line[] {
  const sorted = items.filter((i) => i.str.trim().length > 0);
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
  const operators = sorted.filter((i) => OPERATOR_GLYPH_RE.test(i.str.trim()));
  const grouped: Item[][] = [];
  const anchors: Item[] = [];
  for (const item of sorted) {
    if (OPERATOR_GLYPH_RE.test(item.str.trim())) continue;
    const last = grouped[grouped.length - 1];
    const anchor = anchors[anchors.length - 1];
    const tolerance = anchor ? Math.max(2, Math.max(anchor.size, item.size) * 0.5) : 0;
    if (last && Math.abs(anchor.y - item.y) < tolerance) {
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
    const chars = g.reduce((n, i) => n + i.str.replace(/\s/g, "").length, 0);
    const mathChars = g.reduce((n, i) => n + (i.math ? i.str.replace(/\s/g, "").length : 0), 0);
    return {
      size,
      y: median(large.map((i) => i.y)),
      x1: Math.min(...g.map((i) => i.x)),
      x2: Math.max(...g.map((i) => i.x + i.w)),
      mathy: chars > 0 && mathChars >= chars * 0.3,
      prose: chars >= 20 && mathChars < chars * 0.5,
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
  for (let k = 0; k < grouped.length; k++) {
    for (const item of grouped[k]) {
      const glyph = item.str.trim();
      const accent = glyph.length === 1 && SPACING_ACCENTS[glyph] !== undefined;
      // An accent belongs over a letter of about its own size: a line of
      // subscripts beside it is no candidate (import compare loop finding).
      const candidates = neighbors(k).filter(
        (n) =>
          (item.size <= stats[n].size * 0.75 || (accent && stats[n].size >= item.size * 0.75)) &&
          gapTo(item, n) <= stats[n].size * 1.05 &&
          overlaps(item, n),
      );
      const mathy = candidates.filter((n) => stats[n].mathy);
      const pool = stats[k].mathy && mathy.length > 0 ? mathy : candidates.filter((n) => stats[n].prose || stats[n].mathy);
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
    const center = op.y - op.size * 0.6;
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
    const target = mathy[0] ?? prose[0];
    if (target !== undefined) moved[target].push(op);
    else standalone.push([op]);
  }
  const regrouped = [...kept.map((g, k) => [...g, ...moved[k]]), ...standalone].filter((g) => g.length > 0);
  const baseline = (g: Item[]) => {
    const size = Math.max(...g.map((i) => i.size));
    return median(g.filter((i) => i.size >= size * 0.75).map((i) => i.y));
  };
  regrouped.sort((a, b) => baseline(b) - baseline(a));
  return regrouped.map((g) => buildLine(g, page)).filter((l) => l.text.length > 0);
}
