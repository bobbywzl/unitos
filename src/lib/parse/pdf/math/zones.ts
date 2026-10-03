// Inline math zones (research memo §1.7): which glyphs of a text line are a
// formula. TeX says it by font: math italic letters come from the math
// italic font (text italic from CMTI), math commas and periods from it too,
// a math minus from the symbol font. Digits, + = ( ) and small glyphs join
// the math beside them; a word in a text font ends the formula. A zone is
// cut out of the line's items (an item may hold the end of a formula and
// the start of the next words: "+ 1 = 0 has a superscript"), so its words
// ride through line joins and merges as runs, and its LaTeX comes once the
// page's rules are known (resolveZones).

import type { Glyph, PageDrawing, Rule } from "@/lib/parse/pdf/drawing";
import { isBoldFont, isItalicFont, isTextMath, isUnicodeMathFont, isUnreadMath, longArrowEnd } from "@/lib/parse/pdf/glyphs";
import { layoutLatex } from "@/lib/parse/pdf/math/check";
import { braceLabelBoxes, hangingGlyph, type Atom } from "@/lib/parse/pdf/math/layout";
import { mathGlyph } from "@/lib/parse/pdf/math-fonts";
import { wholeChars } from "@/lib/parse/pdf/text";
import type { Box, Item, Line, MathZone, Run } from "@/lib/parse/pdf/types";
import type { MathSpan } from "@/lib/parse/types";

type Kind = "math" | "attach" | "text";

const MATH_FAMILIES = new Set(["oml", "oms", "omx", "msa", "msb", "euf", "rsfs", "lasy", "esint"]);
const ATTACH_RE = /^[0-9+=()[\]!/:;]$/;
// Operator names set upright next to math: \lim, \sup, \log, … (a word
// in prose is set apart by spaces and followed by words, never by math).
const OPNAMES = new Set([
  "lim", "sup", "inf", "max", "min", "sin", "cos", "tan", "log", "ln", "exp", "det", "dim", "ker", "deg", "gcd",
  "arg", "Pr", "limsup", "liminf", "mod",
]);

// A glyph only math sets: a math family's, the text font's upright capital
// Greek (Γ … Ω, codes 0–10: "ω ∈ Ω" ended the formula at the Ω, read as a
// word), or any glyph of a math font set in Unicode — KaTeX's fonts and
// OpenType math fonts set nothing but formulas, their digits and roman
// letters too (synth-math-html's \dfrac{1}{2} had no glyph to start a
// formula, and \text{if } cut its formula in two).
const isMathGlyph = (g: Glyph) =>
  (g.family !== null && MATH_FAMILIES.has(g.family)) ||
  (g.family === "ot1" && (g.code <= 0x0a || isUnicodeMathFont(g.base))) ||
  (g.family === null && isUnreadMath(g));

function kind(g: Glyph, size: number): Kind {
  if (isMathGlyph(g)) return "math";
  // A text font's digit joins the math beside it as CMR's does where the
  // page's formulas take their digits from the text's font (glyphs.ts
  // isTextMath: MathDesign's Utopia, LibreOffice's Liberation Serif).
  if (g.family === null) return isTextMath(g) && /^[0-9/]$/.test(g.unicode) ? "attach" : "text";
  if (g.family !== "ot1") return "text";
  if (g.size < size * 0.85 || ATTACH_RE.test(g.unicode)) return "attach";
  // An accent over a math letter (\hat, \bar, \dot) is the text font's.
  return mathGlyph("ot1", g.code)?.cls === "accent" ? "attach" : "text";
}

const LETTER_RE = /^\p{L}$/u;
const isLetter = (g: Glyph) => LETTER_RE.test(g.unicode);
// A letter of TeX's bold or sans text fonts.
const boldOrSans = (g: Glyph) => g.family === "ot1" && isLetter(g) && (/^CM(BX|SS)/.test(g.base) || g.variant === "bf" || g.variant === "sf");
// A list marker: "(a)", "(iv)", "(3)", "a.", "3.", "iv)".
const MARKER_RE = /^(\((?:[a-zA-Z]|[ivxlc]{1,5}|\d{1,3})\)|(?:[a-zA-Z]|[ivxlc]{1,5}|\d{1,3})[.)])$/;
const gapOf = (a: Glyph, b: Glyph) => b.x - (a.x + a.w);

/** Whether a cell's text is set in a font of its own, not TeX's: its Latin
    letters in such a font (code's aside) outnumber the letters of TeX's
    text fonts three to one (Times text with Computer Modern math). */
function ownTextFont(items: Item[]): boolean {
  let own = 0;
  let tex = 0;
  for (const it of items) {
    for (const g of it.glyphs ?? []) {
      if (!/^[A-Za-z]$/.test(g.unicode)) continue;
      if (g.family === null && !it.mono && !isTextMath(g)) own++;
      else if (g.family === "ot1") tex++;
    }
  }
  return own > 3 * tex;
}

/** The small glyphs set over a long arrow drawn in pieces (glyphs.ts
    longArrowEnd): its label (\xRightarrow{\text{Def. 12.a}}). The label
    joins the arrow's formula whatever its font, where a word in a text
    font would end it, and the arrow is math though its first piece is the
    text font's "=" (parse loop finding: GeoTopo's "==⇒" under "Def. 12.a"
    and under "Kompakt", set in the text's sans, read as words, and the
    arrow as a "⟹" of no formula; a label with a math letter, "f stetig",
    read). */
function arrowLabels(glyphs: Glyph[], size: number): { arrows: Set<Glyph>; labels: Set<Glyph> } {
  const arrows = new Set<Glyph>();
  const labels = new Set<Glyph>();
  for (const arrow of glyphs) {
    const end = longArrowEnd(arrow);
    if (end === undefined) continue;
    let label = false;
    for (const g of glyphs) {
      const rise = (g.y - arrow.y) / arrow.size;
      const center = g.x + g.w / 2;
      if (g.size < size * 0.85 && rise > 0.3 && rise < 1.1 && center > arrow.x && center < end) {
        labels.add(g);
        label = true;
      }
    }
    if (label) arrows.add(arrow);
  }
  return { arrows, labels };
}

/** The formulas among a cell's glyphs (in x order), as glyph runs. */
function zonesOf(glyphs: Glyph[], size: number, textFont: boolean): Glyph[][] {
  const zones: Glyph[][] = [];
  let cur: Glyph[] = [];
  const tight = (a: Glyph | undefined, b: Glyph | undefined) => a !== undefined && b !== undefined && boldOrSans(a) && boldOrSans(b) && gapOf(a, b) < 0.12 * size;
  const { arrows, labels } = arrowLabels(glyphs, size);
  const kinds = glyphs.map((g, k): Kind => {
    if (arrows.has(g)) return "math";
    if (labels.has(g)) return "attach";
    // Where the text is set in a font of its own (Times), a letter of TeX's
    // bold or sans is a formula's: \mathbf{g}, \mathsf{G}_1 (arXiv 2504.02736
    // read "g4" and "G1" as words). A word of them is a word (\textsf{Adam}
    // where the text is Times and its sans TeX's).
    if (textFont && boldOrSans(g) && !tight(glyphs[k - 1], g) && !tight(g, glyphs[k + 1])) return "math";
    return kind(g, size);
  });
  const kindMap = new Map(glyphs.map((g, k) => [g, kinds[k]]));
  const kindOf = (g: Glyph) => kindMap.get(g) ?? kind(g, size);
  const flush = (): void => {
    let z = cur;
    cur = [];
    // What follows an aside's bracket is read again as a formula of its own
    // ("S = {0, 1} (x = 1 when": the x = 1 after the bracket).
    let after: Glyph[] = [];
    // A citation a word space after a formula's operand ("γ > 1 [57]",
    // arXiv 2502.02648) is the sentence's, and so is what follows it; an
    // interval stands after a relation ("x ∈ [0, 1]"). A zero-width glyph
    // before the bracket is a piece of a relation drawn in parts, no
    // operand (↦'s bar, whose text reads "7": "F: ℝ ↦ [0, 1]").
    const citation = z.findIndex(
      (g, n) =>
        n > 0 &&
        (g.family === "ot1" || g.family === null) &&
        g.unicode === "[" &&
        z[n - 1].w > 0 &&
        gapOf(z[n - 1], g) > 0.2 * size &&
        /[\p{L}\p{N})\]}′']/u.test(z[n - 1].unicode) &&
        /^\[\d+(?:\s*[,–-]\s*\d+)*\]/.test(z.slice(n, n + 24).map((h) => h.unicode).join("")),
    );
    if (citation > 0) z = z.slice(0, citation);
    const count = (ch: string) => z.filter((g) => g.unicode === ch).length;
    // A sentence's colon or semicolon after a formula, and a bracket it
    // does not close, are the sentence's; a half-open interval's ")" closes
    // its "[" ("[a, b)" lost its bracket and read as words).
    for (;;) {
      const last = z[z.length - 1];
      if (!last || (last.family !== "ot1" && last.family !== null)) break;
      if (/^[;:]$/.test(last.unicode) || (last.unicode === ")" && count(")") + count("]") > count("(") + count("["))) z = z.slice(0, -1);
      else break;
    }
    // A text font's bracket the formula never closes, a word space after
    // the formula's last glyph, opens the sentence's aside: "values in ℝ (a
    // real number" read "ℝ(a", which no check passes. An extension font's
    // delimiter is the formula's, whatever its text layer says (a tall "{"
    // reads "(": "|x| = {" before cases lost its brace).
    const text = (h: Glyph) => h.family === "ot1" || h.family === null;
    const brackets = (from: number, re: RegExp) => z.slice(from).filter((h) => text(h) && re.test(h.unicode)).length;
    const aside = z.findIndex((g, n) => n > 0 && text(g) && /^[([]$/.test(g.unicode) && gapOf(z[n - 1], g) > 0.2 * size && brackets(n + 1, /^[)\]]$/) <= brackets(n + 1, /^[([]$/));
    if (aside > 0) {
      after = z.slice(aside + 1);
      z = z.slice(0, aside);
    }
    // A footnote mark set apart before the formula, the sentence's colon,
    // or a bracket the formula does not close, is the sentence's. A mark
    // follows its word tight; a small glyph a space after the words is a
    // radical's index (∛ drawn as a picture, synth-math-html).
    for (;;) {
      const first = z[0];
      if (!first || (first.family !== "ot1" && first.family !== null)) break;
      const before = glyphs[glyphs.indexOf(first) - 1];
      const mark = first.size < size * 0.85 && z[1] !== undefined && gapOf(first, z[1]) > 0.15 * size && (before === undefined || gapOf(before, first) < 0.15 * size);
      const punct = /^[:;!]$/.test(first.unicode);
      const bracket = /^[([]$/.test(first.unicode) && !z.slice(1).some((g) => g.unicode === ")" || g.unicode === "]");
      if (mark || punct || bracket) z = z.slice(1);
      else break;
    }
    // A list item's marker at the cell's start ("(a)", "(ii)", "3.", a
    // bullet a math font draws: acmart's itemize, "• scan(Pred)" read
    // \bullet\text{ scan}, two bullets in the import) is the item's, not
    // its first formula's ("(a) x ≥ 0" read as one formula).
    if (z[0] === glyphs[0] && /^[•∙◦⋆∗·]$/.test(z[0].unicode) && z[1] !== undefined && gapOf(z[0], z[1]) > 0.15 * size) z = z.slice(1);
    // (A marker is set in the text's fonts: "1" and the math periods of
    // "2...,n" open no item.)
    if (z[0] === glyphs[0]) {
      for (let n = 2; n < Math.min(7, z.length); n++) {
        const head = z.slice(0, n).map((g) => g.unicode).join("");
        if (MARKER_RE.test(head) && gapOf(z[n - 1], z[n]) > 0.15 * size && z.slice(0, n).every((g) => g.family === "ot1" || g.family === null)) {
          z = z.slice(n);
          break;
        }
      }
    }
    // A number set in bold before a word space is an exercise's number
    // ("*33 2n balls", Grinstead–Snell p. 125, read \mathbf{33}2n): the
    // item's, not its formula's.
    let bold = 0;
    while (bold < z.length && /^[0-9]$/.test(z[bold].unicode) && isBoldFont(z[bold].base)) bold++;
    if (bold > 0 && bold < z.length && gapOf(z[bold - 1], z[bold]) > 0.15 * size) z = z.slice(bold);
    // Math by font, or small glyphs stacked one over the other (a fraction
    // of digits: \frac{1}{2} sets no math-font glyph).
    // A URL's slashes are the math italic's (url.sty sets them in math): a
    // run whose only math is slashes is no formula (arXiv 2506.06352's
    // "arbital.com/p/…" read "\operatorname{com}/\mathrm{p}/", and its
    // link was lost), unless it is a number over a number ("1/2").
    const stacked = z.some((a) => z.some((b) => a !== b && a.size < size * 0.85 && b.size < size * 0.85 && Math.abs(a.y - b.y) > size * 0.4 && a.x < b.x + b.w && b.x < a.x + a.w));
    const math = z.filter((g) => kindOf(g) === "math");
    const url = math.every((g) => g.unicode === "/") && !/^[0-9]+\/[0-9]+$/.test(z.map((g) => g.unicode).join(""));
    // A lone text italic letter a page's math takes is a formula (lone,
    // below), and so is one with its scripts (t_i, t_1).
    const single = isTextMath(z[0]) && isLetter(z[0]) && z.slice(1).every((g) => g.size < size * 0.85 && (isTextMath(g) || kindOf(g) === "attach"));
    // So is a run of such letters with a glyph of TeX's text font: on such
    // a page TeX's roman sets only formulas' brackets, digits, and signs
    // (mathpazo's thesis: "P(E_i) =" read as words before a fraction, its
    // display lost, its numerator and denominator dropped).
    const roman = z.some((g) => g.family === "ot1") && z.some((g) => isTextMath(g) && isLetter(g));
    const again = () => {
      cur = after;
      if (cur.length > 0) flush();
    };
    if (!stacked && !single && !roman && (math.length === 0 || url)) return again();
    // A lone raised symbol after a word (a footnote's dagger) is a mark,
    // not a formula: every glyph small, none on the line.
    if (!stacked && z.every((g) => g.size < size * 0.85)) return again();
    zones.push(z);
    again();
  };
  for (let k = 0; k < glyphs.length; k++) {
    const g = glyphs[k];
    const prev = glyphs[k - 1];
    const gap = prev ? gapOf(prev, g) : 0;
    if (kinds[k] === "text") {
      // A word in a text font (roman, bold, italic) ends the formula,
      // unless it is an operator name next to math, one letter set against
      // math (\mathbf{x}, \mathrm{d}x), or a short name set tight before it
      // (\mathrm{Var}(X)).
      let j = k;
      // A word's letters are one size: a script set on it ends it ("max"
      // and its limit's l, arXiv 2506.06352's \max_{l\in\mathcal{L}(t)}).
      while (
        j < glyphs.length &&
        kinds[j] === "text" &&
        isLetter(glyphs[j]) &&
        (j === k || (gapOf(glyphs[j - 1], glyphs[j]) < 0.12 * size && (glyphs[j].size >= g.size * 0.85 || !isTextMath(glyphs[j]))))
      )
        j++;
      if (j === k) {
        flush();
        continue;
      }
      const word = glyphs.slice(k, j).map((x) => x.unicode).join("");
      const after = glyphs[j];
      const afterGap = after ? gapOf(glyphs[j - 1], after) : Infinity;
      // A text italic's letter a page's math takes, set small and tight
      // after the word, is its script: math.
      const nextMath = after !== undefined && (kinds[j] !== "text" || (isTextMath(after) && after.size < g.size * 0.85 && gapOf(glyphs[j - 1], after) < 0.12 * size));
      // \liminf and \limsup set "inf" and "sup" a thin space after "lim".
      const limit = word === "lim" && afterGap < 0.3 * size && /^(inf|sup)/.test(glyphs.slice(j, j + 3).map((x) => x.unicode).join(""));
      const opname = (OPNAMES.has(word) && (cur.length > 0 || nextMath)) || limit;
      // "Var(" or "sgn x" set tight: a name; "sets:" is a word and its colon.
      const opens = after !== undefined && (kinds[j] === "math" || after.unicode === "(");
      // A bold letter stands a relation's space from its neighbors
      // (\mathbf{x} = y), and so does a text italic's letter a page's math
      // takes (glyphs.ts isTextMath: the Math Guide's A∖B); a roman one
      // touches them (\mathrm{d}x), where a word space, however tight, is a
      // fifth of an em.
      const near = (/^CMBX/i.test(g.base) || isTextMath(g) ? 0.3 : 0.12) * size;
      // Such a letter stands up to 0.6 em from a relation or an operator
      // beside it (MathDesign sets "t ∈" 0.44 em apart), and so does an
      // upright letter after a relation (the grade in "y = A").
      const op = (h: Glyph | undefined) => h !== undefined && h.family !== null && /^(rel|bin)$/.test(mathGlyph(h.family, h.code)?.cls ?? "");
      const rel = (h: Glyph | undefined) => h !== undefined && h.family !== null && mathGlyph(h.family, h.code)?.cls === "rel";
      const reach = (h: Glyph | undefined) => ((isTextMath(g) && op(h)) || (g.family === "ot1" && h === prev && rel(h)) ? 0.6 * size : near);
      const letter = word.length === 1 && ((cur.length > 0 && gap < reach(prev)) || (nextMath && afterGap < reach(after)));
      const name = word.length <= 4 && opens && afterGap < 0.12 * size;
      // A short upright name with a script set on it, inside a formula
      // (\mathrm{sw}^{1}_{p,p'} after ¬, arXiv 2506.06752 (15)): set tight
      // on both sides, where a word stands a word space from the math. A
      // word that opens no formula: an author's name with its marks
      // ("Sahu¹⋆") is no formula.
      const scripted = word.length <= 4 && cur.length > 0 && gap < 0.12 * size && after !== undefined && after.size < size * 0.85 && afterGap < 0.12 * size;
      // A text italic's letters a page's math takes, set small and tight
      // after the formula, are its last glyph's script (PLOS's k_{sp}:
      // "k = k" left its "sp" out).
      const script = cur.length > 0 && gap < 0.12 * size && glyphs.slice(k, j).every((h) => isTextMath(h) && h.size < size * 0.85);
      // On such a page a lone italic letter between upright words is a
      // formula of its own ("in any decision tree t, she"); in an italic
      // phrase ("E. coli") it is a word.
      const italicWord = (from: number, step: 1 | -1) => {
        let n = from;
        while (glyphs[n] !== undefined && !isLetter(glyphs[n])) n += step;
        return glyphs[n] !== undefined && isItalicFont(glyphs[n].base);
      };
      const lone = word.length === 1 && isTextMath(g) && cur.length === 0 && !italicWord(k - 1, -1) && !italicWord(j, 1);
      if (opname || letter || name || scripted || script) cur.push(...glyphs.slice(k, j));
      else if (lone) {
        flush();
        cur.push(g);
        flush();
      } else flush();
      k = j - 1;
      continue;
    }
    if (cur.length && gap > 0.6 * size && kinds[k] !== "math" && kinds[k - 1] !== "math") flush();
    // TeX sets no space between a number and a letter of one formula: a
    // number a word space before a math letter is the words' (a contents
    // entry's "2.3 L² estimate" read "3\quad L^{2}", arXiv 2411.09614). An
    // operator after a space still joins ("2 × 2").
    if (kinds[k] === "math" && cur.length && gap > 0.2 * size && g.family !== null && mathGlyph(g.family, g.code)?.cls === "ord" && !cur.some((c) => kindOf(c) === "math")) flush();
    cur.push(g);
  }
  flush();
  return zones;
}

// ── Items cut at a formula's edges ─────────────────────────────────────────

// Where each of an item's glyphs sits in its string. An item whose text
// was built from its glyphs (glyphs.ts itemText) says what each adds (""
// for an accent set on its letter or a composite's second half); for the
// others pdf.js adds spaces between glyphs, and a ligature is one glyph and
// two letters.
function charSpans(item: Item): [number, number][] {
  const spans: [number, number][] = [];
  let i = 0;
  for (const g of item.glyphs ?? []) {
    const read = g.text ?? g.unicode.normalize("NFKC");
    // A space glyph takes the string's space, or nothing: KaTeX sets a
    // zero-width strut at a formula's first glyph, and it took the "(" of
    // "(ω)" (synth-notes-html: the formula's text began a character late).
    if (read !== "" && read.trim() === "") {
      const end = /\s/.test(item.str[i] ?? "") ? i + 1 : i;
      spans.push([i, end]);
      i = end;
      continue;
    }
    if (read !== "") while (i < item.str.length && /\s/.test(item.str[i])) i++;
    let end: number;
    if (read !== "" && item.str.startsWith(read, i)) end = i + read.length;
    else if (read === "" || g.w <= g.size * 0.01) end = i;
    // One glyph, one character, and a character past the Basic Multilingual
    // Plane is two UTF-16 units: Cambria Math's 𝑝 reads "𝑝𝑝" in the text
    // layer, and a cut one unit in began the NPS thesis's formulas with half
    // a letter (the import's save failed).
    else end = Math.min(item.str.length, i + ((item.str.codePointAt(i) ?? 0) > 0xffff ? 2 : 1));
    spans.push([i, end]);
    i = end;
  }
  return spans;
}

// A part of an item: its glyphs [from, to) and their string. The spaces
// after a part stay with it, so the line puts exactly one space between it
// and the next part. A part of a formula is raised or lowered as its glyphs
// stand against the formula's baseline (base): a formula that fails the
// check keeps its scripts as the words' sub and sup (x_n read "xn"); one
// that passes drops them (resolveZones), its LaTeX holds them.
function part(item: Item, spans: [number, number][], from: number, to: number, zone: MathZone | undefined, base: number | undefined): Item {
  const glyphs = item.glyphs!.slice(from, to);
  const start = from === 0 ? 0 : spans[from][0];
  const end = to === spans.length ? item.str.length : spans[to][0];
  const x = from === 0 ? item.x : glyphs[0].x;
  const last = glyphs[glyphs.length - 1];
  const xEnd = to === spans.length ? item.x + item.w : last.x + last.w;
  const out: Item = { ...item, str: item.str.slice(start, end), x, w: Math.max(0, xEnd - x), glyphs, zone };
  if (zone) {
    // The thresholds lines.ts markShifts reads a text's scripts by.
    const rise = base === undefined || glyphs.some((g) => g.size > zone.size * 0.9) ? 0 : glyphs[0].y - base;
    out.sup = rise >= zone.size * 0.15;
    out.sub = rise <= -zone.size * 0.1;
  }
  return out;
}

/** The line's items with its formulas cut out: an item inside a formula
    carries its zone (and its raise: part), an item a formula starts or
    ends in splits there. cells: where each cell of the line starts in
    items. */
export function splitZones(items: Item[], cells: number[]): Item[] {
  const out: Item[] = [];
  const bounds = [...cells, items.length];
  for (let c = 0; c + 1 < bounds.length; c++) {
    const cellItems = items.slice(bounds[c], bounds[c + 1]);
    const size = textSize(cellItems);
    // A letter of TeX's bold or sans is a formula's where the text has a
    // font of its own, and in a cell of that letter and its scripts alone
    // (a table's "G₁₃").
    const all = cellItems.flatMap((it) => it.glyphs ?? []).filter((g) => g.unicode.trim() !== "");
    const letter = all.length >= 2 && boldOrSans(all[0]) && all.slice(1).every((g) => g.size < all[0].size * 0.85 && g.x >= all[0].x);
    const textFont = letter || ownTextFont(cellItems);
    // zonesOf keeps a run only with a math glyph in it, a text italic's
    // letter a page's math takes, or two small glyphs stacked: a cell with
    // none of them, as most are, has no formula and keeps its items as they
    // are.
    let math = false;
    let small = 0;
    for (const it of cellItems) {
      for (const g of it.glyphs ?? []) {
        if (isMathGlyph(g) || (isTextMath(g) && isLetter(g)) || (textFont && boldOrSans(g))) math = true;
        if (g.size < size * 0.85) small++;
      }
    }
    if (!math && small < 2) {
      out.push(...cellItems);
      continue;
    }
    // A space glyph is no word: it neither ends nor joins a formula.
    const glyphs = cellItems
      .flatMap((it) => it.glyphs ?? [])
      .filter((g) => g.family !== null || g.unicode.trim() !== "")
      .sort((a, b) => a.x - b.x || b.y - a.y);
    const zoneOf = new Map<Glyph, MathZone>();
    // Each formula's baseline: where most of its full-size glyphs stand (a
    // big operator or a tall delimiter hangs from its origin, apart).
    const baseOf = new Map<MathZone, number>();
    // An item with no glyphs is text a formula cannot run through.
    const breaks = cellItems.filter((it) => !it.glyphs?.length).map((it) => it.x);
    for (const z of zonesOf(glyphs, size, textFont)) {
      const x1 = z[0].x;
      const x2 = z[z.length - 1].x;
      if (breaks.some((x) => x > x1 && x < x2)) continue;
      const zone: MathZone = { glyphs: z, size, latex: "", ok: false, open: false };
      for (const g of z) zoneOf.set(g, zone);
      const ys = z.filter((g) => g.size > size * 0.9 && !hangingGlyph(g)).map((g) => Math.round(g.y * 10) / 10);
      const counts = new Map<number, number>();
      for (const y of ys) counts.set(y, (counts.get(y) ?? 0) + 1);
      const base = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
      if (base !== undefined) baseOf.set(zone, base);
    }
    for (const item of cellItems) {
      const glyphs = item.glyphs ?? [];
      if (glyphs.length === 0 || !glyphs.some((g) => zoneOf.has(g))) {
        out.push(item);
        continue;
      }
      const spans = charSpans(item);
      // A cut falls where the formula changes between two glyphs with text
      // between them; a glyph that reads as nothing (an accent composed on
      // its letter, a composite's second half, a strut) stays with the one
      // before it, or at the item's start with the first that reads.
      const zones = glyphs.map((g) => zoneOf.get(g));
      const reads = spans.map(([a, b]) => b > a);
      const first = reads.indexOf(true);
      for (let k = 0; k < glyphs.length; k++) if (!reads[k]) zones[k] = k < first ? zones[first] : zones[k - 1] ?? zones[k];
      let from = 0;
      for (let k = 1; k <= glyphs.length; k++) {
        if (k < glyphs.length && (zones[k] === zones[from] || spans[k][0] === spans[from][0])) continue;
        const zone = zones[from];
        out.push(part(item, spans, from, k, zone, zone && baseOf.get(zone)));
        from = k;
      }
    }
  }
  return out;
}

// The size most of a cell's characters are set in.
// A cell's text size: the size most of its characters take, among those
// at a script's size or more under its largest letter. A cell of a
// letter and its long subscript (a fraction's denominator, ξ_{eff,uniform})
// holds more of the script's characters than of the letter's (a math
// font's letter: a heading beside a column's text is no such letter): read at the
// script's size, its subscript's letters were words, and the fraction's
// line went into the text line over it (parse loop finding: ICML's (34)
// was a crop).
function textSize(items: Item[]): number {
  const big = Math.max(0, ...items.filter((i) => (i.glyphs ?? []).some((g) => isMathGlyph(g) && LETTER_RE.test(g.unicode))).map((i) => i.size));
  const chars = new Map<number, number>();
  for (const i of items) {
    if (i.size < big * 0.85) continue;
    const key = Math.round(i.size * 10) / 10;
    chars.set(key, (chars.get(key) ?? 0) + i.str.length);
  }
  if (chars.size === 0) for (const i of items) chars.set(Math.round(i.size * 10) / 10, (chars.get(Math.round(i.size * 10) / 10) ?? 0) + i.str.length);
  return [...chars].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 10;
}

/** The glyphs no text item reads: an accent placed on its letter, the
    second half of a composite (↦'s arrow), a code the text layer drops. A
    formula's layout needs them. */
export function orphanGlyphs(lines: Line[], drawing: PageDrawing): Glyph[] {
  const read = new Set<Glyph>();
  for (const line of lines) for (const item of line.items) for (const g of item.glyphs ?? []) read.add(g);
  return drawing.glyphs.filter((g) => !read.has(g) && g.family !== null);
}

/** Each zone on the page's lines gets its LaTeX, checked against its
    glyphs (and the page's glyphs no item reads that sit on it); a zone
    that fails stays plain text, its scripts raised and lowered (part), and
    one that passes drops its scripts' sub and sup: its LaTeX holds them. */
export function resolveZones(lines: Line[], drawing: PageDrawing) {
  // Read at the first zone: most pages of prose have none.
  let orphans: Glyph[] | null = null;
  const seen = new Set<MathZone>();
  // A path one formula read is no other's: a determinant's closing bar,
  // drawn as a picture, opened the formula after it ("\bigg|= ad − bc",
  // synth-math-html).
  const taken = new Set<Box>();
  for (const line of lines) {
    for (const item of line.items) {
      const zone = item.zone;
      if (!zone || seen.has(zone)) continue;
      seen.add(zone);
      orphans ??= orphanGlyphs(lines, drawing);
      // An orphan on another line's baseline, within that line, is that
      // line's (parse loop finding: GeoTopo's arrow under "Vor.", its
      // "=" and "⇒" read by the composite ⟹ of their line, stood a line
      // over "⇒ 𝔅δ(x) ⊆ f⁻¹(…)", whose formula took them as a row
      // "=\Rightarrow" and failed).
      resolveZone(zone, drawing, orphans, taken, (g) => onOtherLine(g, line, lines));
    }
  }
  if (seen.size === 0) return;
  for (const line of lines) {
    for (const r of [...line.runs, ...line.cells.flatMap((c) => c.runs)]) {
      if (!r.zone?.ok) continue;
      r.sup = false;
      r.sub = false;
    }
  }
}

/** Whether a glyph stands on the baseline of another line of text (no
    display's), within that line, and off this line's: it is that line's. */
export function onOtherLine(g: Glyph, line: Line, lines: Line[]): boolean {
  return (
    Math.abs(line.y - g.y) >= g.size * 0.1 &&
    lines.some((l) => l !== line && !l.display && Math.abs(l.y - g.y) < g.size * 0.1 && g.x >= l.x - g.size * 0.5 && g.x <= l.xEnd + g.size * 0.5)
  );
}

/** One zone's LaTeX and check (resolveZones). orphans: the page's glyphs
    no item reads; the zone takes those that sit on it. taken: the paths
    other formulas read; the zone reads none of them, and adds its own. */
export function resolveZone(zone: MathZone, drawing: PageDrawing, orphans: Glyph[], taken = new Set<Box>(), elsewhere: (g: Glyph) => boolean = () => false) {
  const x1 = Math.min(...zone.glyphs.map((g) => g.x));
  // A symbol drawn in two glyphs from one origin (↦: the bar has no width,
  // and the text layer holds the bar alone) reaches as far as its second
  // glyph: a formula that ends in ↦ lost its arrow ("g: ℝⁿ ↦" at a line's
  // end read as words).
  const second = orphans.filter((o) => zone.glyphs.some((z) => z.w < z.size * 0.05 && Math.abs(o.x - z.x) < z.size * 0.12 && Math.abs(o.y - z.y) < z.size * 0.05));
  const x2 = Math.max(...zone.glyphs.map((g) => g.x + g.w), ...second.map((g) => g.x + g.w));
  const low = Math.min(...zone.glyphs.map((g) => g.y));
  const high = Math.max(...zone.glyphs.map((g) => g.y));
  // The size the formula is set at: its line's text size, or its own
  // largest glyph's where that is larger — KaTeX sets math a fifth
  // larger than its prose (a radical's bar over a 13 pt digit in 11 pt
  // prose), and a display's cell holds more scripts than base glyphs
  // (a_{ij} read its scripts at the base's level).
  const em = Math.max(zone.size, ...zone.glyphs.map((g) => g.size));
  const on = (g: Glyph) => g.x + g.w / 2 > x1 && g.x + g.w / 2 < x2 && g.y > low - em * 0.6 && g.y < high + em * 1.2;
  const extra = orphans.filter((g) => on(g) && !elsewhere(g));
  for (const g of extra) orphans.splice(orphans.indexOf(g), 1);
  const glyphs = [...zone.glyphs, ...extra];
  // The rules inside it: a fraction bar, a radical's or an overline's
  // bar over its glyphs. A bar with the formula's glyphs over it only
  // is a display's fraction bar under its numerator's line (arXiv
  // 2506.08494 p. 2 read it as \underline).
  // A vertical rule inside it is an array's column line: the layout
  // reads it with the array's rows, and an \hline that runs past the
  // cells by their padding. Without one, a rule past the glyphs is none
  // of theirs (a fraction bar over the next formula read as an overline,
  // arXiv 2502.02648 p. 11), unless the formula's glyphs stand over it
  // and under it and it runs past them by under a sixth of an em:
  // LibreOffice draws a fraction's bar a tenth of an em past its parts
  // (the Math Guide's x over −x + 1 read without its bar), and KaTeX a
  // fifth past a fraction it ends with (1/(1 + 1/x), synth-math-html).
  const columns = drawing.rules.filter((r) => r.dir === "v" && r.x1 > x1 && r.x1 < x2 && r.y1 > low - em && r.y2 < high + em * 1.2);
  const pad = columns.length > 0 ? em * 0.6 : 1;
  // A radical's vinculum starts at its sign and may run past the last
  // glyph under it (synth-math-tex's √ over a fraction, by a third of a point).
  const vinculum = (r: Rule) =>
    zone.glyphs.some((g) => g.family !== null && mathGlyph(g.family, g.code)?.cls === "radical" && Math.abs(g.x + g.w - r.x1) < em * 0.2);
  const holds = (r: Rule, over: boolean) => glyphs.some((g) => (over ? g.y > r.y1 : g.y < r.y1) && g.x + g.w / 2 > r.x1 && g.x + g.w / 2 < r.x2);
  const inside = (r: Rule, pad: number) => r.x1 >= x1 - pad && r.x2 <= x2 + (vinculum(r) ? em : pad);
  // A rule with none of the formula's glyphs over it is a bar over them (an
  // overline, a radical's): it stands close over their tops. One farther up
  // is the line over's (its underline took the formula under it, whose
  // superscript reached up to it).
  const topOf = (g: Glyph) => g.y + ((g.box ?? (g.family ? mathGlyph(g.family, g.code)?.box : undefined))?.[0] ?? 0.7) * g.size;
  const capped = (r: Rule) => glyphs.some((g) => g.x + g.w / 2 > r.x1 && g.x + g.w / 2 < r.x2 && g.y < r.y1 && r.y1 - topOf(g) < em * 0.35);
  const own = new Set(glyphs);
  const near = [
    ...drawing.rules.filter(
      (r) =>
        r.dir === "h" &&
        (inside(r, pad) || (columns.length === 0 && inside(r, em * 0.25) && holds(r, true))) &&
        r.y1 > low - em &&
        r.y1 < high + em &&
        // Under the formula's own glyphs, close: their underline (an
        // underlined vector, \underline{\alpha}).
        ((holds(r, false) && (holds(r, true) || capped(r))) || underlines(r, glyphs, new Set())) &&
        !underlines(r, drawing.glyphs, own),
    ),
    ...columns,
  ];
  // The paths drawn on it: a radical's sign, a picture of an accent or
  // a tall delimiter (KaTeX draws them so), which may start an em left
  // of the glyphs, or just right of them (a closing delimiter), and run
  // past them (the rows it holds that the formula lacks).
  // A box that reaches an em and a half past them is none of theirs: a
  // table cell's frame around the formula (the Math Guide's cells failed).
  const paths = drawing.paths.filter(
    (b) =>
      !b.clip &&
      !taken.has(b) &&
      b.x1 >= x1 - em * 1.5 &&
      b.x1 < x2 + em * 0.6 &&
      b.x2 <= x2 + em * 1.5 &&
      ((b.y1 > low - em * 2 && b.y2 < high + em * 2) || (b.x2 - b.x1 < em * 0.6 && b.y2 > low && b.y1 < high + em)) &&
      !paintsRule(b, drawing.rules),
  );
  try {
    const { latex, check, atoms, used } = layoutLatex(glyphs, near, { display: false, size: em }, paths);
    for (const p of used) taken.add(p);
    zone.latex = latex;
    // Every glyph drawn inside the formula is the formula's: a script
    // another line took is missing from the LaTeX, which still passes
    // the check (synth-math-html: a numerator's x^k read as x).
    zone.ok = check.ok && !strayInside(atoms, new Set(glyphs), drawing.glyphs);
      const last = atoms.filter((a) => a.size >= zone.size * 0.85).sort((a, b) => b.x2 - a.x2)[0];
    zone.open = last !== undefined && (last.cls === "rel" || last.cls === "bin" || last.cls === "punct");
  } catch {
    zone.ok = false;
  }
}

/** A rule close under glyphs (none of own) that it spans end to end, as
    TeX's \underline spans its box: their underline (an underlined vector,
    of the formula or of the line over it). */
export function underlines(r: Rule, page: Glyph[], own: Set<Glyph>): boolean {
  const over = page.filter((g) => {
    if (own.has(g) || g.hidden || g.unicode.trim() === "") return false;
    const bottom = g.y - ((g.box ?? (g.family ? mathGlyph(g.family, g.code)?.box : undefined))?.[1] ?? 0.2) * g.size;
    return g.x + g.w / 2 > r.x1 && g.x + g.w / 2 < r.x2 && g.y > r.y1 && bottom - r.y1 < g.size * 0.3;
  });
  if (over.length === 0) return false;
  const size = Math.max(...over.map((g) => g.size));
  return Math.abs(Math.min(...over.map((g) => g.x)) - r.x1) < size * 0.05 && Math.abs(Math.max(...over.map((g) => g.x + g.w)) - r.x2) < size * 0.1;
}

/** A path that paints one of the page's rules (a fraction bar filled as a
    thin box, an array's column line stroked) is that rule, read with it or
    not at all. */
export function paintsRule(b: Box, rules: Rule[]): boolean {
  return rules.some((r) =>
    r.dir === "v"
      ? Math.abs((b.x1 + b.x2) / 2 - r.x1) < r.thickness + 1 && b.x2 - b.x1 < r.thickness + 2 && Math.abs(b.y1 - r.y1) < 1 && Math.abs(b.y2 - r.y2) < 1
      : Math.abs(b.x1 - r.x1) < 1 && Math.abs((b.y1 + b.y2) / 2 - r.y1) < r.thickness + 1 && b.y2 - b.y1 < r.thickness + 2,
  );
}

/** A glyph of the page drawn inside the formula's atoms' box — its origin
    inside — that is not the formula's own (spaces aside); one where a
    brace's label stands (layout.ts braceLabelBoxes); or a small one that
    starts just past its right end, over its baseline: the end of a script
    the formula lost (a closing bracket of an exponent, synth-notes-tex; an
    exponent, arXiv 2411.09614 p. 15). It counts from its start: a script
    stacked on the formula's last one starts inside the formula and stays
    text beside it. Counted from its center, a wide one (the + over the i
    of 𝒪ᵢ⁺) failed the 𝒪ᵢ± formulas of springer-bmb-01377. */
function strayInside(atoms: Atom[], own: Set<Glyph>, page: Glyph[]): boolean {
  if (atoms.length === 0) return false;
  const em = Math.max(...atoms.map((a) => a.size));
  const x1 = Math.min(...atoms.map((a) => a.x1)) + em * 0.05;
  const x2 = Math.max(...atoms.map((a) => a.x2)) - em * 0.05;
  const y1 = Math.min(...atoms.map((a) => a.bottom));
  const y2 = Math.max(...atoms.map((a) => a.top));
  const base = Math.min(...atoms.filter((a) => a.size >= em * 0.9).map((a) => a.yb));
  const labels = braceLabelBoxes(atoms);
  return page.some((g) => {
    if (own.has(g) || g.hidden || g.unicode.trim() === "") return false;
    const cx = g.x + g.w / 2;
    // A glyph on the lowest limit's baseline is inside too: a lower limit's
    // "=1" that another line took left \sum_{k}^{r}, which passed.
    if (cx > x1 && cx < x2 && g.y >= y1 - em * 0.05 && g.y < y2) return true;
    if (labels.some((b) => cx > b.x1 && cx < b.x2 && g.y > b.y1 && g.y < b.y2)) return true;
    return g.size < em * 0.8 && g.x >= x2 && g.x < x2 + em * 0.3 && g.y > base + em * 0.2 && g.y < y2;
  });
}

/** A block's inline formulas: the runs of one formula that passed the
    check. A formula TeX broke across lines (after a relation or an
    operator) is two zones with only a line break between: they join. */
export function mathSpans(text: string, runs: Run[] | undefined): MathSpan[] {
  const spans: { start: number; end: number; zones: MathZone[] }[] = [];
  for (const r of runs ?? []) {
    const zone = r.zone;
    if (!zone) continue;
    const last = spans[spans.length - 1];
    const between = last ? text.slice(last.end, r.start) : "x";
    const tail = last?.zones[last.zones.length - 1];
    if (last && tail && between.trim() === "" && (tail === zone || tail.open)) {
      last.end = r.end;
      if (tail !== zone) last.zones.push(zone);
      continue;
    }
    spans.push({ start: r.start, end: r.end, zones: [zone] });
  }
  // A formula the line break cut keeps its closing bracket on the next
  // line, where it read as the sentence's ("g(h(t," and "s))"):
  // the bracket right after it that closes one it left open is its own.
  for (const s of spans) {
    const latex = s.zones.map((z) => z.latex).join(" ");
    if (s.zones.length < 2 || balanced(latex) || !balanced(latex, true)) continue;
    let depth = 0;
    for (const [t] of latex.matchAll(BRACKET_RE)) depth += OPENS.has(t) ? 1 : CLOSES.has(t) ? -1 : 0;
    const tail = /^\)+/.exec(text.slice(s.end));
    if (tail && tail[0].length <= depth) {
      s.end += tail[0].length;
      s.zones.push({ ...s.zones[s.zones.length - 1], latex: tail[0], ok: true });
    }
  }
  // A zone whose runs lie apart (its items out of order in the line) and a
  // zone that failed the check stay text.
  const seen = new Map<MathZone, number>();
  for (const s of spans) for (const z of s.zones) seen.set(z, (seen.get(z) ?? 0) + 1);
  const parts: MathSpan[] = [];
  for (const s of spans) {
    if (!s.zones.every((z) => z.ok && seen.get(z) === 1)) continue;
    let { start, end } = s;
    while (start < end && /\s/.test(text[start])) start++;
    while (end > start && /\s/.test(text[end - 1])) end--;
    ({ start, end } = wholeChars(text, start, end));
    if (end > start) parts.push({ start, end, latex: s.zones.map((z) => z.latex).join(" ") });
  }
  // A formula a text word cut in two ("m(" and ") = m(" around HH) reads
  // as two formulas with a bracket each: both stay text. A set whose
  // braces hold words ("{t ∈ ℝ such that g(t) ≥ 1}", broken across lines
  // too: TeX's source sets it as three formulas and two words) keeps its
  // parts, the brace open in the first and closed in the last, when the
  // few words between them are all that stands between.
  const out: MathSpan[] = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    // A set of names set in the text's font ("E = {HHH,HHT,HTT}"): one
    // formula, the names its \text (the last name, set against the brace,
    // went to the closing part).
    const next = parts[i + 1];
    const names = next ? text.slice(p.end, next.start).trim() : "";
    if (next && /\\lbrace/.test(p.latex) && /^[\p{L}\d]+(?:,\s*[\p{L}\d]+)*,$|^[\p{L}\d]+(?:,\s*[\p{L}\d]+)+$/u.test(names)) {
      const last = names.endsWith(",") ? /^\\operatorname\{([\p{L}\d]+)\}/u.exec(next.latex) : null;
      const latex = `${p.latex}\\text{${names}${last ? last[1] : ""}}${last ? next.latex.slice(last[0].length) : next.latex}`;
      if (!balanced(p.latex) && balanced(latex) && (last || !names.endsWith(","))) {
        out.push({ start: p.start, end: next.end, latex });
        i++;
        continue;
      }
    }
    if (!balanced(p.latex) && /\\lbrace/.test(p.latex)) {
      let latex = p.latex;
      let j = i;
      while (j + 1 < parts.length && j - i < 3 && !balanced(latex)) {
        const between = text.slice(parts[j].end, parts[j + 1].start);
        if (!/^[\s\p{L}]*$/u.test(between) || (between.match(/\p{L}+/gu) ?? []).length > 4) break;
        latex += ` ${parts[j + 1].latex}`;
        j++;
      }
      if (j > i && balanced(latex)) {
        out.push(...parts.slice(i, j + 1));
        i = j;
        continue;
      }
    }
    if (balanced(p.latex)) out.push(p);
  }
  return out;
}

// Brackets in a formula's LaTeX; any other command is skipped whole.
const BRACKET_RE = /\\(?:lbrace|rbrace|langle|rangle|lfloor|rfloor|lceil|rceil|[{}])|\\[A-Za-z]+|[()[\]]/g;
const OPENS = new Set(["(", "[", "\\lbrace", "\\{", "\\langle", "\\lfloor", "\\lceil"]);
const CLOSES = new Set([")", "]", "\\rbrace", "\\}", "\\rangle", "\\rfloor", "\\rceil"]);

/** Every bracket closes one opened before it, of any kind: a half-open
    interval [0, 1) counts. open: a bracket may stay open at the end. */
export function balanced(latex: string, open = false): boolean {
  let depth = 0;
  for (const [t] of latex.matchAll(BRACKET_RE)) {
    if (OPENS.has(t)) depth++;
    else if (CLOSES.has(t)) depth--;
    if (depth < 0) return false;
  }
  return depth === 0 || open;
}
