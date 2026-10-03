// One formula's glyphs and rules to LaTeX (research memo §1.8). The order:
// each glyph's entry in the TeX font tables, extensible pieces joined,
// composite symbols fused, braces and arrows over content, rules (radicals,
// fractions, overlines), accents, fenced groups (matrices, binomials,
// cases), aligned rows, big operators' limits, scripts, tokens. Geometry in
// PDF points, y up; an em is a glyph's size.

import type { Glyph, Rule } from "@/lib/parse/pdf/drawing";
import { isBoldFont, isItalicFont, isTextMath, isUnnamedFont, isUnreadMath, type MathFamily } from "@/lib/parse/pdf/glyphs";
import { mathGlyph, type MathGlyph } from "@/lib/parse/pdf/math-fonts";
import type { Box, Item } from "@/lib/parse/pdf/types";

type Variant = "bold" | "bf" | "sf" | "tt" | null;

export type Atom = {
  fam: MathFamily | null; // null: a node several glyphs make
  code: number;
  entry: MathGlyph | null;
  tex: string;
  cls: string;
  size: number;
  x1: number;
  x2: number;
  yb: number; // baseline
  top: number;
  bottom: number;
  upright: boolean;
  // A text italic's letter where the page's math sets its own letters: a
  // word of them is text, one alone a math letter.
  italic?: boolean;
  // Set while the formula is read.
  limits?: boolean;
  upper?: string;
  lower?: string;
  claimed?: boolean;
  // A big operator's own left edge, where its limits widen x1: the line's
  // order goes by it.
  ownX1?: number;
  fracPart?: number; // a fraction outside any other structure: its parts' size
  rows?: number[]; // an array's or a matrix's row baselines, top first
};

const OPNAMES = new Set([
  "lim", "limsup", "liminf", "sup", "inf", "max", "min", "sin", "cos", "tan", "cot", "sec", "csc", "sinh", "cosh",
  "tanh", "coth", "log", "ln", "lg", "exp", "det", "dim", "ker", "deg", "gcd", "hom", "arg", "Pr", "arcsin",
  "arccos", "arctan", "argmin", "argmax",
]);
export const LIMIT_OPS = new Set(["lim", "limsup", "liminf", "sup", "inf", "max", "min", "argmin", "argmax", "det", "gcd", "Pr"]);
// \not over a relation: the command KaTeX knows for the pair.
const NOT: Record<string, string> = {
  "=": "\\neq", "\\in": "\\notin", "\\subset": "\\not\\subset", "\\supset": "\\not\\supset",
  "\\subseteq": "\\nsubseteq", "\\supseteq": "\\nsupseteq", "\\leq": "\\nleq", "\\geq": "\\ngeq", "<": "\\nless",
  ">": "\\ngtr", "\\sim": "\\nsim", "\\mid": "\\nmid", "\\parallel": "\\nparallel", "\\cong": "\\ncong",
};
const JOIN: [string, string, string][] = [
  ["-", "\\rightarrow", "\\longrightarrow"],
  ["\\leftarrow", "-", "\\longleftarrow"],
  ["\\leftarrow", "\\rightarrow", "\\longleftrightarrow"],
  ["=", "\\Rightarrow", "\\Longrightarrow"],
  ["\\Leftarrow", "=", "\\Longleftarrow"],
  ["\\Leftarrow", "\\Rightarrow", "\\Longleftrightarrow"],
  ["piece:lhook", "\\rightarrow", "\\hookrightarrow"],
  ["\\leftarrow", "piece:rhook", "\\hookleftarrow"],
  ["|", "=", "\\models"],
  ["\\triangleright", "\\triangleleft", "\\bowtie"],
];
const BIG = ["", "\\big", "\\Big", "\\bigg", "\\Bigg"];
const INTEGRAL_RE = /^\\(i+nt|oint|oiint|oiiint)$/;
const SIZED_RE = /^\\(left|right|[bB]igg?)/;
const FENCE_ENV: Record<string, string> = { "(": "pmatrix", "[": "bmatrix", "\\{": "Bmatrix", "|": "vmatrix", "\\|": "Vmatrix" };

// The formula being read: display or inline, and the size of the text it
// sits in (a fraction's parts that much smaller are a text-style fraction).
let style = { display: true, size: 10 };

const cx = (a: { x1: number; x2: number }) => (a.x1 + a.x2) / 2;
const overlapX = (a: { x1: number; x2: number }, b: { x1: number; x2: number }) => Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1);
const byX = (a: Atom, b: Atom) => a.x1 - b.x1;
const maxSize = (atoms: Atom[]) => Math.max(...atoms.map((a) => a.size), 1);
// The symbols that give a formula its size: its delimiters aside, which a
// limit may set larger than itself (IEEE Access's text-size parentheses
// under an integral).
const ownSize = (atoms: Atom[]) => {
  const inner = atoms.filter((a) => a.cls !== "open" && a.cls !== "close");
  return inner.length > 0 ? inner : atoms;
};
const isPiece = (a: Atom, name: string) => a.entry?.piece === name;
const isTall = (a: Atom, em: number) => a.fam === "omx" && (a.cls === "open" || a.cls === "close") && a.top - a.bottom > 1.1 * em;
/** A family whose glyphs hang from their origin, a box the metrics give:
    TeX's extension font and esint's integrals. */
export const hangingFamily = (fam: MathFamily | null) => fam === "omx" || fam === "esint";

function node(atoms: Atom[], tex: string, yb: number, size: number, extra: Partial<Atom> = {}): Atom {
  return {
    fam: null,
    code: -1,
    entry: null,
    tex,
    cls: "ord",
    size,
    x1: Math.min(...atoms.map((a) => a.x1)),
    x2: Math.max(...atoms.map((a) => a.x2)),
    yb,
    top: Math.max(...atoms.map((a) => a.top)),
    bottom: Math.min(...atoms.map((a) => a.bottom)),
    upright: false,
    ...extra,
  };
}

// A letter's italic correction in em (tftopl cmmi10 and cmsy10, those of
// 0.02 em and more): TeX sets it after the letter, so two letters of one
// formula stand up to that far apart. A text italic's letter (MathTime's
// Times) takes a tenth of an em.
const ITALIC: Partial<Record<MathFamily, Record<number, number>>> = {
  oml: {
    0x00: 0.139, 0x02: 0.028, 0x04: 0.076, 0x05: 0.081, 0x06: 0.058, 0x07: 0.139, 0x09: 0.11, 0x0a: 0.05, 0x0c: 0.053,
    0x0d: 0.056, 0x0e: 0.038, 0x10: 0.074, 0x11: 0.036, 0x12: 0.028, 0x17: 0.064, 0x18: 0.046, 0x19: 0.036, 0x1b: 0.036,
    0x1c: 0.113, 0x1d: 0.036, 0x20: 0.036, 0x21: 0.036, 0x24: 0.028, 0x26: 0.08, 0x40: 0.056, 0x42: 0.05, 0x43: 0.072,
    0x44: 0.028, 0x45: 0.058, 0x46: 0.139, 0x48: 0.081, 0x49: 0.078, 0x4a: 0.096, 0x4b: 0.072, 0x4d: 0.109, 0x4e: 0.109,
    0x4f: 0.028, 0x50: 0.139, 0x53: 0.058, 0x54: 0.139, 0x55: 0.109, 0x56: 0.222, 0x57: 0.139, 0x58: 0.078, 0x59: 0.222,
    0x5a: 0.072, 0x66: 0.108, 0x67: 0.036, 0x6a: 0.057, 0x6b: 0.031, 0x71: 0.036, 0x72: 0.028, 0x76: 0.036, 0x77: 0.027,
    0x79: 0.036, 0x7a: 0.044,
  },
  oms: {
    0x42: 0.03, 0x43: 0.058, 0x44: 0.028, 0x45: 0.089, 0x46: 0.099, 0x47: 0.059, 0x49: 0.074, 0x4a: 0.185, 0x4e: 0.147,
    0x4f: 0.028, 0x50: 0.082, 0x53: 0.075, 0x54: 0.254, 0x55: 0.099, 0x56: 0.082, 0x57: 0.082, 0x58: 0.146, 0x59: 0.082,
    0x5a: 0.079,
  },
};
const italicOf = (a: Atom): number => ((a.fam ? ITALIC[a.fam]?.[a.code] : undefined) ?? (a.fam === null && a.italic ? 0.1 : 0)) * a.size;

function variantOf(base: string): Variant {
  if (/^(CMMIB|CMBSY|EUFB)/i.test(base)) return "bold";
  if (/^CMBX/i.test(base)) return "bf";
  if (/^CMSS/i.test(base)) return "sf";
  if (/^CMTT/i.test(base)) return "tt";
  return null;
}

// ── Atoms ───────────────────────────────────────────────────────────────────

/** One atom per glyph the tables know, its box from the TFM height and
    depth: a big operator or delimiter hangs below its origin; a text font's
    letter, digit, or bracket too. Other glyphs come back apart (the check
    fails on them). */
const LIGATURES: Record<string, string> = { "ﬀ": "ff", "ﬁ": "fi", "ﬂ": "fl", "ﬃ": "ffi", "ﬄ": "ffl" };

function atomsOf(glyphs: Glyph[]): { atoms: Atom[]; unknown: Glyph[] } {
  const atoms: Atom[] = [];
  const unknown: Glyph[] = [];
  for (const g of glyphs) {
    // A text font's ligature is its letters, each a share of its advance:
    // T1's ﬀ (cm-super, at 0x1b) has no glyph in OT1's table, and GeoTopo's
    // "𝔘 = {U_i} mit U_i offen in X" was a crop (parse loop finding).
    const letters = LIGATURES[g.unicode];
    if (letters && (g.family === null || g.family === "ot1")) {
      const w = Math.max(g.w, 0) / letters.length;
      const parts = [...letters].map((ch, k) => textAtom({ ...g, unicode: ch, family: null, x: g.x + k * w, w }));
      if (parts.every((a) => a !== null)) atoms.push(...(parts as Atom[]));
      else unknown.push(g);
      continue;
    }
    const entry = g.family ? mathGlyph(g.family, g.code) : null;
    if (!entry || (!entry.latex && entry.cls !== "piece" && entry.cls !== "radical")) {
      const text = g.family === null ? textAtom(g) : null;
      if (text) atoms.push(text);
      else unknown.push(g);
      continue;
    }
    const variant = g.variant ?? variantOf(g.base);
    let tex = entry.latex;
    if (tex && variant === "bold" && entry.cls !== "piece") tex = `\\boldsymbol{${tex}}`;
    else if (variant === "bf" && /^[A-Za-z0-9]$/.test(tex)) tex = `\\mathbf{${tex}}`;
    else if (variant === "sf" && /^[A-Za-z]$/.test(tex)) tex = `\\mathsf{${tex}}`;
    else if (variant === "tt" && /^[A-Za-z]$/.test(tex)) tex = `\\mathtt{${tex}}`;
    const [height, depth] = g.box ?? entry.box;
    atoms.push({
      fam: g.family,
      code: g.code,
      entry,
      tex,
      cls: entry.cls,
      size: g.size,
      x1: g.x,
      x2: g.x + Math.max(g.w, 0),
      yb: g.y,
      top: g.y + height * g.size,
      bottom: g.y - depth * g.size,
      // A text italic's letter in a formula is a math letter (\mathit, or
      // the letters of a math set whose italic is its text's).
      upright: Boolean(entry.upright) && variant === null && !isItalicFont(g.base),
      italic: Boolean(entry.upright) && variant === null && isItalicFont(g.base),
    });
  }
  return { atoms, unknown };
}

// A text font's letter, digit, sign, or bracket inside a formula
// (\text{otherwise} in a paper set in Times; a math set that takes its
// digits, "=", and letters from the text's fonts: Utopia's under
// MathDesign, Liberation Serif's in LibreOffice and OpenStax), its box
// estimated from its shape, as the font's metrics are not known. An upright
// letter is \mathrm, an italic one a math letter. An en dash is the minus,
// a middle dot the product (PLOS sets both in Minion: "1 – Δe^{–λt}"). A
// Computer Modern font under another name (arXiv 2502.02648's "mwa_cmmi10")
// is no text font: its letters are math italic, and the formula stays a
// picture.
// A Latin letter with a mark (ü, ß, é) is a word's letter: it reads in
// \text, as math has no such letter (parse loop finding: GeoTopo's "für"
// and "überdecken" in its displays failed the check on their ü and ß, and
// each display was a crop).
// A CJK character (kana, kanji, hangul) is a word's letter too, and text
// only (parse loop finding: the Japanese "L = E⁻¹ として, A = LU" lost its
// kana, failed the check, and was a crop).
const TEXT_CHAR_RE = /^[A-Za-z0-9,.;:()[\]=+−–·!/<>#%&\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u017F\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}ー]$/u;
/** A letter a word in a formula holds: ASCII, Latin with a mark, or CJK.
    A ligature of TeX's text font (ff, fi, fl, ffi, ffl) is the letters it
    joins: \mathrm{eff} read \mathrm{e}ff. */
const LETTER_RE = /^(?:[A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u017F\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}ー]|ff|fi|fl|ffi|ffl)$/u;
/** A Latin letter with a mark, or a CJK character: no math letter, so text only. */
const MARKED_RE = /[\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u017F\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}ー]/u;
const CM_NAME_RE = /cm(r|mi|mib|sy|bsy|ex|bx|ti|ss|tt|sl)\d/i;

function textAtom(g: Glyph): Atom | null {
  const ch = g.unicode;
  // A math font's glyph no table reads (MathTime's big parenthesis) is no
  // text: read as a small one, it made a row of its own over its formula.
  // Nor is a glyph of a font with no name: bbm's 𝕜 reads "k" (glyphs.ts).
  if (!TEXT_CHAR_RE.test(ch) || CM_NAME_RE.test(g.base) || isUnreadMath(g) || isUnnamedFont(g.base)) return null;
  const [height, depth] = /[gjpqy]/.test(ch)
    ? [0.45, 0.22]
    : /[acemnorsuvwxz]/.test(ch)
      ? [0.45, 0]
      : /[,;]/.test(ch)
        ? [0.1, 0.2]
        : /[.:]/.test(ch)
          ? [0.1, 0]
          : /[()[\]/]/.test(ch)
            ? [0.75, 0.25]
            : /[=+−–·<>]/.test(ch)
              ? [0.58, 0.08]
              : [0.69, 0];
  const cls = /[,;]/.test(ch)
    ? "punct"
    : /[([]/.test(ch)
      ? "open"
      : /[)\]!]/.test(ch)
        ? "close"
        : /[=<>]/.test(ch)
          ? "rel"
          : /[+−–·]/.test(ch)
            ? "bin"
            : "ord";
  const italic = isItalicFont(g.base);
  // A bold letter or digit is \mathbf (Springer's vectors n, m in Times
  // Bold read as \mathrm), a bold italic one \boldsymbol.
  const bold = /[A-Za-z0-9]/.test(ch) && isBoldFont(g.base);
  // A bold letter with a mark reads as an upright one: \mathbf has no ü.
  return {
    fam: null,
    code: g.code,
    entry: null,
    // KaTeX draws "-" in a formula as the minus sign.
    tex: bold ? `\\${italic ? "boldsymbol" : "mathbf"}{${ch}}` : ch === "−" || ch === "–" ? "-" : ch === "·" ? "\\cdot" : /[#%&]/.test(ch) ? `\\${ch}` : ch,
    cls,
    size: g.size,
    x1: g.x,
    x2: g.x + Math.max(g.w, 0),
    yb: g.y,
    top: g.y + height * g.size,
    bottom: g.y - depth * g.size,
    upright: LETTER_RE.test(ch) && !italic && !bold,
    // PLOS sets every formula's letters in Minion's italic ("dP_k/dt"):
    // those are math letters (isTextMath), not words.
    italic: LETTER_RE.test(ch) && italic && !bold && !isTextMath(g),
  };
}

// ── Pieces: extensible delimiters, multiple integrals ──────────────────────

const PIECE_DELIM: Record<string, string> = { lparen: "(", rparen: ")", lbrack: "[", rbrack: "]", lbrace: "\\{", rbrace: "\\}" };

function assemblePieces(atoms: Atom[], rules: Rule[]): Atom[] {
  const pieces = atoms.filter((a) => a.fam === "omx" && (/^(l|r)(paren|brack|brace)-|^brace-rep$/.test(a.entry?.piece ?? "") || isPiece(a, "vrep")));
  const rest = atoms.filter((a) => !pieces.includes(a));
  const stacks: Atom[][] = [];
  for (const p of pieces.sort(byX)) {
    const col = stacks.find((c) => Math.abs(c[0].x1 - p.x1) < 0.15 * p.size && isPiece(c[0], "vrep") === isPiece(p, "vrep"));
    if (col) col.push(p);
    else stacks.push([p]);
  }
  // Delimiters stacked at one x are each their own: a top piece under a
  // bottom piece starts the next (parse loop finding: the MML book's three
  // augmented matrices one under another, joined by ⇝, read their brackets
  // as one bracket around all three).
  const columns: Atom[][] = [];
  for (const stack of stacks) {
    let cur: Atom[] = [];
    // (Each delimiter keeps its pieces in the stack's order: its first
    // piece gives its baseline.)
    const keep = (list: Atom[]) => columns.push(stack.filter((p) => list.includes(p)));
    for (const p of [...stack].sort((a, b) => b.top - a.top)) {
      const prev = cur[cur.length - 1];
      const ends = prev && /-bot$/.test(prev.entry?.piece ?? "") && /-top$/.test(p.entry?.piece ?? "");
      if (ends) {
        keep(cur);
        cur = [];
      }
      cur.push(p);
    }
    if (cur.length) keep(cur);
  }
  const fences: Atom[] = [];
  for (const col of columns) {
    // A column's pieces may be joined by rules drawn between them (KaTeX
    // draws a tall brace's extenders so): they are the delimiter's, no
    // array's column line (a cases brace read as an array's first column,
    // synth-notes-html (2.3)).
    const x1 = Math.min(...col.map((p) => p.x1));
    const x2 = Math.max(...col.map((p) => p.x2));
    const low = Math.min(...col.map((p) => p.bottom));
    const high = Math.max(...col.map((p) => p.top));
    for (const r of rules) if (r.dir === "v" && r.x1 > x1 && r.x1 < x2 && r.y1 >= low - 1 && r.y2 <= high + 1) read.add(r);
    const named = col.find((p) => /^(l|r)(paren|brack|brace)-/.test(p.entry?.piece ?? ""));
    const kind = named ? (named.entry?.piece ?? "").split("-")[0] : col[0].tex === "\\|" ? "dbar" : "bar";
    const tex = named ? PIECE_DELIM[kind] : kind === "dbar" ? "\\|" : "|";
    const cls = named ? (kind[0] === "l" ? "open" : "close") : "bar";
    // A column of one bar piece is a plain bar, not a fence (\arrowvert).
    fences.push(node(col, tex, col[0].yb, col[0].size, { fam: "omx", cls, entry: { latex: tex, unicode: tex, cls: "open", box: [0, 0], size: 5 } }));
  }
  // Bar columns pair up as open and close, each kind with its own: |x|
  // drawn tall, and a norm around it (‖∏|f|^p‖ paired ‖ with the first |,
  // arXiv 2506.08494 (2.12)).
  // Only bars of one row pair: two rows' evaluation bars ("|_{t=0}" in each
  // row of an aligned display) are no absolute value.
  const bars = fences.filter((a) => a.cls === "bar").sort(byX);
  for (const tex of ["|", "\\|"]) {
    const kind = bars.filter((b) => b.tex === tex);
    for (let i = 0; i + 1 < kind.length; ) {
      if (Math.min(kind[i].top, kind[i + 1].top) > Math.max(kind[i].bottom, kind[i + 1].bottom)) {
        kind[i].cls = "open";
        kind[i + 1].cls = "close";
        i += 2;
      } else i++;
    }
  }
  for (const b of bars) if (b.cls === "bar") b.cls = "ord";
  // Integral signs set against each other: \iint, \iiint (amsmath kerns
  // them to a tenth of an em apart; two integrals side by side stand a thin
  // space, a sixth, apart).
  const ints = rest.filter((a) => a.tex === "\\int").sort(byX);
  for (let i = 0; i < ints.length; i++) {
    const run = [ints[i]];
    for (let j = i + 1; j < ints.length; j++) {
      const last = run[run.length - 1];
      if (ints[j].x1 - last.x2 >= 0.14 * last.size || Math.abs(ints[j].yb - last.yb) > 0.1 * last.size) break;
      run.push(ints[j]);
    }
    if (run.length < 2) continue;
    run[0].tex = run.length === 2 ? "\\iint" : "\\iiint";
    run[0].x2 = run[run.length - 1].x2;
    for (const r of run.slice(1)) rest.splice(rest.indexOf(r), 1);
    i += run.length - 1;
  }
  return [...rest, ...fences];
}

// ── Composites: symbols TeX builds from two or more glyphs ─────────────────

function matches(a: Atom, want: string): boolean {
  return want.startsWith("piece:") ? isPiece(a, want.slice(6)) : a.tex === want;
}

function fuseComposites(input: Atom[]): Atom[] {
  const out = [...input].sort((a, b) => a.x1 - b.x1 || b.yb - a.yb);
  const drop = (...list: Atom[]) => {
    for (const a of list) out.splice(out.indexOf(a), 1);
  };
  let changed = true;
  while (changed) {
    changed = false;
    for (const a of out) {
      const em = a.size;
      const beside = (pred: (b: Atom) => boolean) => out.find((b) => b !== a && Math.abs(b.yb - a.yb) < 0.05 * em && pred(b));
      // \not: the slash has no advance and sits on the relation it negates.
      if (isPiece(a, "not")) {
        const b = beside((b) => Math.abs(b.x1 - a.x1) < 0.12 * em && b.cls === "rel");
        if (b) {
          b.tex = NOT[b.tex] ?? `\\not${b.tex}`;
          drop(a);
          changed = true;
          break;
        }
      }
      // \mapsto: the bar without advance at the arrow's start; with a minus
      // between, \longmapsto.
      if (isPiece(a, "mapstochar")) {
        const b = beside((b) => Math.abs(b.x1 - a.x1) < 0.12 * em && (b.tex === "\\rightarrow" || b.tex === "-"));
        if (b) {
          const c = b.tex === "-" ? beside((c) => c.tex === "\\rightarrow" && overlapX(b, c) > 0.05 * em) : undefined;
          const target = c ?? b;
          target.tex = c ? "\\longmapsto" : "\\mapsto";
          target.cls = "rel";
          target.x1 = a.x1;
          drop(...(c ? [a, b] : [a]));
          changed = true;
          break;
        }
      }
      // Arrows joined with a 3mu overlap (\joinrel): long arrows, hooks,
      // \models, \bowtie.
      for (const [l, r, tex] of JOIN) {
        if (!matches(a, l)) continue;
        const b = beside((b) => matches(b, r) && b.x1 > a.x1 && overlapX(a, b) > 0.08 * em && overlapX(a, b) < 0.3 * em);
        if (!b) continue;
        b.tex = tex;
        b.cls = "rel";
        b.x1 = a.x1;
        drop(a);
        changed = true;
        break;
      }
      if (changed) break;
      // \notin: the math slash drawn over an element sign.
      if (a.tex === "\\in") {
        const b = out.find((b) => b.fam === "oml" && b.code === 0x3d && Math.abs(b.yb - a.yb) < 0.05 * em && cx(b) > a.x1 && cx(b) < a.x2);
        if (b) {
          a.tex = "\\notin";
          drop(b);
          changed = true;
          break;
        }
      }
      // Stacked over "=": \cong (a tilde), \doteq (a dot).
      // (The dot is set at the text's size: a label's period over "=" is a
      // script's, "a.s." over "=" read as \doteq.)
      if (a.tex === "=") {
        const b = out.find(
          (b) =>
            b !== a &&
            b.size >= a.size * 0.85 &&
            Math.abs(cx(b) - cx(a)) < 0.15 * em &&
            b.yb > a.yb + 0.1 * em &&
            b.yb < a.yb + 0.7 * em &&
            (b.tex === "\\sim" || b.tex === "."),
        );
        if (b) {
          a.tex = b.tex === "\\sim" ? "\\cong" : "\\doteq";
          drop(b);
          changed = true;
          break;
        }
      }
      // Dots: three periods or three centered dots in a row; three periods
      // stacked (\vdots) or on a diagonal (\ddots). LaTeX sets \vdots and
      // \ddots in the text's roman font: a page whose text font is no
      // Computer Modern stacks the text font's periods (parse loop finding:
      // mml-book's Charter periods left (2.70) and (2.71) crops).
      if (a.tex === "." || a.tex === "\\cdot") {
        const next = (p: Atom, dx: [number, number], dy: [number, number]) =>
          out.find((b) => b !== p && b.tex === a.tex && b.x1 - p.x1 >= dx[0] * em && b.x1 - p.x1 <= dx[1] * em && p.yb - b.yb >= dy[0] * em && p.yb - b.yb <= dy[1] * em);
        const shapes: [string, [number, number], [number, number]][] = [
          [a.tex === "." ? "\\ldots" : "\\cdots", [0.2, 0.6], [-0.03, 0.03]],
          ["\\vdots", [-0.05, 0.05], [0.3, 0.5]],
          ["\\ddots", [0.3, 0.5], [0.2, 0.4]],
        ];
        for (const [tex, dx, dy] of shapes) {
          if (tex !== "\\ldots" && tex !== "\\cdots" && a.fam !== "ot1" && a.fam !== null) continue;
          if ((tex === "\\ldots" || tex === "\\cdots") && a.tex === "." && a.fam !== "oml") continue;
          const b = next(a, dx, dy);
          const c = b ? next(b, dx, dy) : undefined;
          if (!b || !c) continue;
          const dots = node([a, b, c], tex, tex === "\\ldots" || tex === "\\cdots" ? a.yb : c.yb, a.size, { cls: "ord" });
          drop(a, b, c);
          out.push(dots);
          out.sort((p, q) => p.x1 - q.x1 || q.yb - p.yb);
          changed = true;
          break;
        }
        if (changed) break;
      }
    }
  }
  return out;
}

// ── Arrows and braces over content ─────────────────────────────────────────

// A long arrow drawn from pieces (\xrightarrow, \overrightarrow): minus
// signs overlapping each other and an arrowhead, on one baseline. A label
// set small over it makes \xrightarrow{label}; content under it,
// \overrightarrow{content}. Two glyphs overlapping by \joinrel's 3mu and
// nothing over them are \longrightarrow, a composite.
// A double arrow (\xRightarrow) is drawn the same way from equals signs
// and a double arrowhead (parse loop finding: GeoTopo's "==⇒" under
// "o. B. d. A." read as \overset{…}{=}====\Rightarrow).
function arrowRuns(atoms: Atom[]): Atom[] {
  const out = [...atoms];
  const shafts = out.filter((a) => a.tex === "-" && a.fam === "oms");
  const bars = out.filter((a) => a.tex === "=");
  for (const head of out.filter((a) => /^\\(right|left|Right|Left)arrow$/.test(a.tex))) {
    const em = head.size;
    const right = /^\\(right|Right)/.test(head.tex);
    const double = /^\\[RL]/.test(head.tex);
    const name = `${double ? (right ? "Right" : "Left") : right ? "right" : "left"}arrow`;
    const pieces = double ? bars : shafts;
    const run: Atom[] = [head];
    for (;;) {
      const edge = run[run.length - 1];
      const next = pieces.find(
        (s) =>
          !run.includes(s) &&
          Math.abs(s.yb - head.yb) < 0.05 * em &&
          (right ? s.x1 < edge.x1 && s.x2 > edge.x1 - 0.02 * em : s.x2 > edge.x2 && s.x1 < edge.x2 + 0.02 * em),
      );
      if (!next) break;
      run.push(next);
    }
    if (run.length < 2) continue;
    const x1 = Math.min(...run.map((a) => a.x1));
    const x2 = Math.max(...run.map((a) => a.x2));
    const inside = (b: Atom) => !run.includes(b) && cx(b) > x1 - 0.1 * em && cx(b) < x2 + 0.1 * em;
    const bottom = Math.min(...run.map((a) => a.bottom));
    const under = out.filter((b) => inside(b) && b.top <= bottom + 0.2 * em && b.top >= bottom - 0.5 * em && b.size >= em * 0.9);
    // A label stands within an em of the arrow: the row over it in an
    // aligned display is no label (GeoTopo's rows of labeled arrows).
    const label = out.filter((b) => inside(b) && b.bottom >= head.yb && b.yb > head.yb + 0.1 * em && b.yb < head.yb + em && b.size < em * 0.9);
    const labelBelow = out.filter((b) => inside(b) && b.top <= head.yb && b.yb < head.yb - 0.1 * em && b.yb > head.yb - em && b.size < em * 0.9);
    let made: Atom;
    if (under.length > 0 && label.length === 0 && !double) {
      const body = linear(under.map((b) => ({ ...b })));
      made = node([...run, ...under], `\\over${right ? "right" : "left"}arrow{${body}}`, under[0].yb, under[0].size);
      for (const b of under) out.splice(out.indexOf(b), 1);
    } else if (label.length > 0 || labelBelow.length > 0 || run.length > 2) {
      // A label's own composites are read first: "A ∩ B ≠ ∅" over an arrow
      // holds \not over "=".
      const above = label.length ? textLabel(label) ?? linear(fuseComposites(label.map((b) => ({ ...b })))) : "";
      const below = labelBelow.length ? `[${linear(fuseComposites(labelBelow.map((b) => ({ ...b }))))}]` : "";
      made = node([...run, ...label, ...labelBelow], `\\x${name}${below}{${above}}`, head.yb, em, { cls: "rel" });
      for (const b of [...label, ...labelBelow]) out.splice(out.indexOf(b), 1);
    } else continue;
    for (const r of run) out.splice(out.indexOf(r), 1);
    out.push(made);
  }
  return out;
}

// A label set in the text font alone is a phrase: \text{Def. 12.a}, its
// word spaces kept (read as math, "Def" was \operatorname{Def} and the
// spaces were lost). A label with a math glyph ("f stetig") is a formula.
const LABEL_CHAR_RE = /^[\p{L}\p{N}.,:;!?()'-]$/u;
function textLabel(label: Atom[]): string | null {
  if (!label.every((b) => b.fam === "ot1" && !b.italic && LABEL_CHAR_RE.test(b.tex)) || !label.some((b) => LETTER_RE.test(b.tex))) return null;
  const sorted = [...label].sort(byX);
  let text = "";
  sorted.forEach((b, k) => {
    if (k > 0 && b.x1 - sorted[k - 1].x2 > 0.2 * b.size) text += " ";
    text += b.tex;
  });
  return `\\text{${text}}`;
}

// \overbrace and \underbrace: the brace tips and cusp are four pieces on
// one height, joined by rules; the content lies on the far side from the
// tips, the label on the near side.
function braces(atoms: Atom[], rules: Rule[], used: Set<Rule>): Atom[] {
  let out = [...atoms];
  const tips = out.filter((a) => /^hbrace-/.test(a.entry?.piece ?? "")).sort(byX);
  // One brace: on one height, from its left end to its right end (an
  // \overbrace's ends point down, its middle up; an \underbrace's the other
  // way). A piece no brace takes stays, and the formula is not read.
  const groups: Atom[][] = [];
  const heights: Atom[][] = [];
  for (const t of tips) {
    const h = heights.find((h) => Math.abs(h[0].yb - t.yb) < 0.1 * t.size);
    if (h) h.push(t);
    else heights.push([t]);
  }
  for (const h of heights) {
    let cur: Atom[] | null = null;
    for (const t of h) {
      if (!cur) {
        if (isPiece(t, "hbrace-down-left") || isPiece(t, "hbrace-up-left")) cur = [t];
        continue;
      }
      cur.push(t);
      if (isPiece(t, isPiece(cur[0], "hbrace-down-left") ? "hbrace-down-right" : "hbrace-up-right")) {
        groups.push(cur);
        cur = null;
      }
    }
  }
  // Nested braces from the inside out: each takes the ones inside it with
  // its content, and its label is its own row (arXiv 2411.19946 (6) sets
  // three under one another).
  groups.sort((a, b) => (isPiece(a[0], "hbrace-down-left") ? a[0].yb - b[0].yb : b[0].yb - a[0].yb));
  for (const g of groups) {
    if (g.length < 2) continue;
    const over = isPiece(g[0], "hbrace-down-left");
    const em = g[0].size;
    const x1 = g[0].x1;
    const x2 = g[g.length - 1].x2;
    const mid = (Math.max(...g.map((a) => a.top)) + Math.min(...g.map((a) => a.bottom))) / 2;
    for (const r of rules) {
      if (r.dir === "h" && r.x1 >= x1 - 0.2 * em && r.x2 <= x2 + 0.2 * em && Math.abs((r.y1 + r.y2) / 2 - mid) < 0.3 * em) {
        used.add(r);
        read.add(r);
      }
    }
    const within = (b: Atom) => !g.includes(b) && cx(b) > x1 - 0.1 * em && cx(b) < x2 + 0.1 * em;
    const top = Math.max(...g.map((a) => a.top));
    const bottom = Math.min(...g.map((a) => a.bottom));
    // The content is the glyphs stacked against the brace, as a fraction's
    // part against its bar: in an aligned display the rows over an
    // underbrace lie within its width too (parse loop finding: GeoTopo's
    // "⇒ ⋃ (U_{i_j} ∩ A) ∪ ((X∖A) ∩ A) = A" took the row over it into
    // its braces, and the display was a crop).
    const far = chain(
      out.filter((b) => within(b) && (over ? b.top <= bottom + 0.1 * em : b.bottom >= top - 0.1 * em)),
      over ? bottom : top,
      over ? -1 : 1,
      em,
      rules.filter((r) => !used.has(r)),
    );
    const near = out.filter(
      (b) =>
        within(b) &&
        !far.includes(b) &&
        !/^hbrace-/.test(b.entry?.piece ?? "") &&
        (over ? b.bottom >= top - 0.2 * em && b.bottom < top + 1.5 * em : b.top <= bottom + 0.2 * em && b.top > bottom - 1.5 * em),
    );
    if (far.length === 0) continue;
    const farRules = rules.filter((r) => !used.has(r) && r.dir === "h" && r.x1 >= x1 - 0.2 * em && r.x2 <= x2 + 0.2 * em && (over ? r.y1 < bottom : r.y1 > top));
    for (const r of farRules) used.add(r);
    const body = linear(structure(far, farRules, 1));
    const label = near.length ? linear(near.map((b) => ({ ...b }))) : "";
    const tex = over ? `\\overbrace{${body}}${label ? `^{${label}}` : ""}` : `\\underbrace{${body}}${label ? `_{${label}}` : ""}`;
    const made = node([...g, ...far, ...near], tex, mainBaseline(far), maxSize(far));
    out = out.filter((b) => !g.includes(b) && !far.includes(b) && !near.includes(b));
    out.push(made);
  }
  return out;
}

/** Where the labels of the formula's braces stand (\underbrace{…}_{n
    \text{ times}}): beyond the brace, an em and a half out, across its
    width. A glyph there the formula lacks is its label, lost (a brace read
    with no label passed the check, synth-math-tex (65), (66)). */
export function braceLabelBoxes(atoms: Atom[]): Box[] {
  const tips = atoms.filter((a) => /^hbrace-/.test(a.entry?.piece ?? "")).sort(byX);
  const out: Box[] = [];
  for (const t of tips) {
    if (!isPiece(t, "hbrace-down-left") && !isPiece(t, "hbrace-up-left")) continue;
    const over = isPiece(t, "hbrace-down-left");
    const end = tips.find((u) => u.x1 > t.x1 && Math.abs(u.yb - t.yb) < 0.1 * t.size && isPiece(u, over ? "hbrace-down-right" : "hbrace-up-right"));
    if (!end) continue;
    const em = t.size;
    out.push(over ? { x1: t.x1, x2: end.x2, y1: t.top, y2: t.top + 1.5 * em } : { x1: t.x1, x2: end.x2, y1: t.bottom - 1.5 * em, y2: t.bottom });
  }
  return out;
}

// ── Rules: radicals, fractions, overlines ──────────────────────────────────

function structure(atoms: Atom[], rules: Rule[], depth = 0): Atom[] {
  const used = new Set<Rule>();
  let pool = braces(atoms, rules, used);
  const nodes: Atom[] = [];
  const hr = rules.filter((r) => r.dir === "h" && !used.has(r)).sort((a, b) => b.x2 - b.x1 - (a.x2 - a.x1));
  const ry = (r: Rule) => (r.y1 + r.y2) / 2;
  for (const r of hr) {
    if (used.has(r) || pool.length === 0) continue;
    const em = Math.max(maxSize(pool), 1);
    const y = ry(r);
    // A radical: its sign's right edge meets the rule's left end at its top.
    const rad = pool.find((a) => a.cls === "radical" && Math.abs(a.x2 - r.x1) < 0.2 * a.size && Math.abs(a.top - y) < 0.25 * a.size);
    if (rad) {
      used.add(r);
      read.add(r);
      const inner = pool.filter((a) => a !== rad && cx(a) > r.x1 && cx(a) < r.x2 + 0.05 * em && a.top <= y + 0.1 * em && a.bottom >= rad.bottom - 0.2 * em);
      // An index is set smaller than the radicand and raised over its
      // baseline; a letter before the sign on the radicand's baseline is
      // the formula's (T_{i\sqrt{p}}, arXiv 2506.08494 (2.10), read as a
      // cube root's i). TeX raises it to 0.6 of the sign's height: a
      // script of the glyph before a tall sign stands under its middle
      // (Springer's "k₁√(k₂/D_A)" read k\sqrt[1]{…}).
      const innerSize = inner.length ? maxSize(inner) : rad.size;
      const innerBase = inner.length ? mainBaseline(inner) : rad.yb;
      const index = pool.filter(
        (a) =>
          a !== rad &&
          !inner.includes(a) &&
          cx(a) < rad.x1 + (rad.x2 - rad.x1) * 0.7 &&
          cx(a) > rad.x1 - 0.3 * em &&
          a.size < rad.size * 0.8 &&
          a.size < innerSize * 0.9 &&
          a.yb > innerBase + 0.2 * innerSize &&
          a.bottom > rad.bottom &&
          a.yb > (rad.top + rad.bottom) / 2 &&
          a.top <= y + 0.3 * em,
      );
      const innerRules = hr.filter((q) => q !== r && !used.has(q) && q.x1 >= r.x1 - 0.1 && q.x2 <= r.x2 + 0.1 && ry(q) < y);
      for (const q of innerRules) used.add(q);
      // The radicand's baseline once its structures are built: a fraction's
      // is its bar's (√(2/π) stood on π's and read as a subscript, IEEE
      // Access (33)).
      const built = structure(inner, innerRules, depth + 1);
      const base = built.length ? mainBaseline(built) : rad.yb;
      const body = linear(built);
      const idx = index.length ? `[${linear(structure(index, [], depth + 1))}]` : "";
      pool = pool.filter((a) => a !== rad && !inner.includes(a) && !index.includes(a));
      const size = inner.length ? maxSize(inner) : rad.size;
      nodes.push(node([rad, ...inner], `\\sqrt${idx}{${body}}`, base, size, { x2: r.x2, top: y + r.thickness }));
      continue;
    }
    // A fraction bar: glyphs above and below within its extent.
    const within = (a: Atom) => cx(a) > r.x1 - 0.05 * em && cx(a) < r.x2 + 0.05 * em;
    const rest = hr.filter((q) => q !== r && !used.has(q));
    // A fraction in a script, its bar short, measures its gaps at its
    // parts' size: the subscript beside an exponent's fraction is no part
    // of it (v_k^{2/p}).
    // So does a fraction whose parts next to its bar are set smaller than
    // the formula (a matrix of ∂u/∂x in a scriptsize Jacobian), its rows'
    // baselines too: a matrix row of them stands 0.9 em of its own under
    // the row over it, and the upper fraction took the lower one as its
    // denominator (parse loop finding: the probability cheatsheet's
    // ∂(u,v)/∂(x,y) matrix).
    const unit0 = r.x2 - r.x1 < 0.6 * em ? Math.min(em, 1.5 * (r.x2 - r.x1)) : em;
    const nearest = (list: Atom[], dir: 1 | -1) => {
      const side = list.filter((a) => !hangingFamily(a.fam) && (dir > 0 ? a.bottom - y : y - a.top) < 0.9 * em);
      return side.length > 0 ? maxSize(side) : em;
    };
    const ups = pool.filter((a) => within(a) && a.bottom >= y - 0.05 * em);
    const downs = pool.filter((a) => within(a) && a.top <= y + 0.05 * em);
    const small = Math.max(nearest(ups, 1), nearest(downs, -1));
    const partEm = small < em * 0.8 ? small : em;
    const unit = Math.min(unit0, partEm);
    const above = chain(ups, y, 1, partEm, rest, unit);
    const below = chain(downs, y, -1, partEm, rest, unit);
    if (above.length && below.length) {
      used.add(r);
      read.add(r);
      // Rules inside a part lie within this bar's extent, on that part's side.
      const inRules = (list: Atom[]) =>
        hr.filter(
          (q) =>
            q !== r &&
            !used.has(q) &&
            q.x1 >= r.x1 - 0.1 * em &&
            q.x2 <= r.x2 + 0.1 * em &&
            (ry(q) - y) * (list[0].yb - y) > 0 &&
            ry(q) <= Math.max(...list.map((a) => a.top)) &&
            ry(q) >= Math.min(...list.map((a) => a.bottom)),
        );
      const nr = inRules(above);
      const dr = inRules(below);
      for (const q of [...nr, ...dr]) used.add(q);
      // A fraction's parts are set in the text style (their operators at
      // the text's size).
      const shown = displayDepth;
      displayDepth = -1;
      const num = linear(structure(above, nr, depth + 1));
      const den = linear(structure(below, dr, depth + 1));
      displayDepth = shown;
      pool = pool.filter((a) => !above.includes(a) && !below.includes(a));
      // A fraction sits on the math axis: its baseline is a quarter em under
      // the bar. Parts set smaller than the formula make a text-style one.
      // Parts set smaller than the text the formula sits in make a
      // text-style fraction (or one in a script): its own size is a step up.
      // Parts at the size of the glyphs beside the bar, on its axis, make a
      // fraction in a script set at the script's size (MathJax's
      // e^{-\frac{1}{2}…} in OpenStax's f(x)): its own size is theirs, and
      // \tfrac keeps its parts at that size.
      // A big operator in a part hangs at its own size, larger than the
      // part's letters: the part's size is theirs (the CS 229 refresher's
      // Bayes rule, a ∑ under its bar, made the fraction larger than the
      // "P(A_k|B) =" before it, which then read as its prescript).
      const partSize = (list: Atom[]) => maxSize(list.some((a) => !hangingFamily(a.fam)) ? list.filter((a) => !hangingFamily(a.fam)) : list);
      const part = Math.max(partSize(above), partSize(below));
      const script = pool.some(
        (a) =>
          !above.includes(a) &&
          !below.includes(a) &&
          a.x2 > r.x1 - part &&
          a.x1 < r.x2 + part &&
          Math.abs(a.size - part) < 0.05 * part &&
          Math.abs(a.yb - (y - 0.25 * part)) < 0.1 * part,
      );
      const size = part >= style.size * 0.95 || script ? part : Math.min(style.size, part / 0.7);
      const frac = script && part < style.size * 0.95 ? "\\tfrac" : "\\frac";
      const extra: Partial<Atom> = { x1: r.x1, x2: r.x2 };
      if (depth === 0) extra.fracPart = part;
      nodes.push(node([...above, ...below], `${frac}{${num}}{${den}}`, y - 0.25 * size, size, extra));
      continue;
    }
    if (above.length && !below.length) {
      used.add(r);
      read.add(r);
      nodes.push(node(above, `\\underline{${linear(structure(above, [], depth + 1))}}`, mainBaseline(above), maxSize(above)));
      pool = pool.filter((a) => !above.includes(a));
    } else if (below.length && !above.length) {
      used.add(r);
      read.add(r);
      nodes.push(node(below, `\\overline{${linear(structure(below, [], depth + 1))}}`, mainBaseline(below), maxSize(below)));
      pool = pool.filter((a) => !below.includes(a));
    }
  }
  return [...pool, ...nodes];
}

// The glyphs stacked against a rule on one side: each within 0.9 em of the
// rule or of one already taken. Past the first, a gap of a quarter em needs
// a rule in it (a fraction inside the part): an aligned display's row over
// a numerator stands that far off, with nothing between (Grinstead–Snell
// p. 20: the row's m and H went into the numerators). So does a glyph at
// the part's size on another baseline than the part's: the rows of cases
// set their fractions close, and one row's denominator stands just over the
// next row's numerator (arXiv 2502.02648 (A2) read one inside the other).
function chain(cands: Atom[], y: number, dir: 1 | -1, em: number, rules: Rule[], unit = em): Atom[] {
  const taken: Atom[] = [];
  let edge = y;
  // The baseline of the part's glyphs at its size, since the last rule.
  let row: number | null = null;
  const sorted = cands.sort((a, b) => (dir > 0 ? a.bottom - b.bottom : b.top - a.top));
  for (const a of sorted) {
    const gap = dir > 0 ? a.bottom - edge : edge - a.top;
    if (gap > 0.9 * em) break;
    const near = dir > 0 ? a.bottom : a.top;
    const barred = rules.some(
      (r) => r.x1 < a.x2 && r.x2 > a.x1 && (r.y1 + r.y2) / 2 > Math.min(edge, near) && (r.y1 + r.y2) / 2 < Math.max(edge, near),
    );
    if (taken.length > 0 && gap > 0.25 * unit && !barred) break;
    // (A radical's sign and a sized delimiter hang from their origins: no baseline.)
    const full = a.size >= em * 0.9 && !hangingFamily(a.fam) && a.cls !== "radical" && a.cls !== "piece";
    if (barred) row = null;
    if (full && row !== null && Math.abs(a.yb - row) > 0.75 * em) break;
    if (full) row ??= a.yb;
    taken.push(a);
    edge = dir > 0 ? Math.max(edge, a.top) : Math.min(edge, a.bottom);
  }
  return taken;
}

/** The formula's baseline: the leftmost of its largest atoms that are no
    big operator or delimiter (those hang from their origin). */
function mainBaseline(atoms: Atom[]): number {
  const cands = ownSize(atoms.filter((a) => !hangingFamily(a.fam)));
  if (cands.length === 0) return atoms[0]?.yb ?? 0;
  const big = maxSize(cands);
  return cands.filter((a) => a.size >= big * 0.9).sort(byX)[0].yb;
}

// ── Accents ─────────────────────────────────────────────────────────────────

function accents(atoms: Atom[]): Atom[] {
  const out = [...atoms];
  for (const acc of atoms.filter((a) => a.cls === "accent")) {
    const em = acc.size;
    const wide = Boolean(acc.entry?.wide);
    const bases = out.filter(
      (b) =>
        b !== acc &&
        b.cls !== "accent" &&
        Math.abs(b.yb - acc.yb) < 0.9 * em &&
        b.yb <= acc.yb + 0.05 * em &&
        (wide ? cx(b) > acc.x1 && cx(b) < acc.x2 : cx(acc) > b.x1 - 0.05 * em && cx(acc) < b.x2 + 0.05 * em),
    );
    if (bases.length === 0) continue;
    const pick = wide ? bases : [bases.sort((p, q) => Math.abs(cx(p) - cx(acc)) - Math.abs(cx(q) - cx(acc)))[0]];
    const body = linear(pick.map((b) => ({ ...b })));
    const made = node(pick, `${acc.tex}{${body}}`, pick[0].yb, pick[0].size);
    for (const b of pick) out.splice(out.indexOf(b), 1);
    out.splice(out.indexOf(acc), 1, made);
  }
  return out;
}

// ── Arrays with rules ──────────────────────────────────────────────────────

/** An array with rules (\begin{array}{c|c} … \hline …): a vertical rule
    inside the formula splits two columns, and a horizontal rule across
    the rows it splits is an \hline, not a fraction bar (read as one, and
    the column rule unread, the array failed to a crop, synth-math-tex
    (60)). The atoms by the vertical rules, and those set on with them,
    become one node; the rules it holds are read. */
function ruledArray(atoms: Atom[], rules: Rule[]): Atom[] {
  const all = rules.filter((r) => r.dir === "v" && !read.has(r));
  if (all.length === 0 || atoms.length === 0) return atoms;
  const em = maxSize(atoms);
  // Arrays stacked in one display are each their own: vertical rules that
  // touch from row to row are one array's (parse loop finding: the MML
  // book's three augmented matrices joined by ⇝ read as one array of
  // twelve rows).
  const groups: Rule[][] = [];
  for (const r of [...all].sort((a, b) => b.y2 - a.y2)) {
    const last = groups[groups.length - 1];
    if (last && r.y2 >= Math.min(...last.map((q) => q.y1)) - 0.3 * em) last.push(r);
    else groups.push([r]);
  }
  let out = atoms;
  for (const vr of groups) out = ruledArrayOf(out, vr, rules, em);
  return out;
}

function ruledArrayOf(atoms: Atom[], vr: Rule[], rules: Rule[], em: number): Atom[] {
  const y1 = Math.min(...vr.map((r) => r.y1));
  const y2 = Math.max(...vr.map((r) => r.y2));
  const rx1 = Math.min(...vr.map((r) => r.x1));
  const rx2 = Math.max(...vr.map((r) => r.x1));
  // Tall delimiters around the rules are the array's fences, not its
  // cells: the array runs between them (parse loop finding: the MML book's
  // augmented matrices [A | I] read "\Biggl[1 & …" with the bracket in the
  // first cell and the comma after the matrix in a row).
  const fences = atoms.filter((a) => isTall(a, em) && a.bottom <= y1 + 0.5 * em && a.top >= y2 - 0.5 * em);
  const open = fences.filter((a) => a.x2 <= rx1).sort((p, q) => q.x2 - p.x2)[0];
  const close = fences.filter((a) => a.x1 >= rx2).sort((p, q) => p.x1 - q.x1)[0];
  const inside = (a: Atom) => !open || !close || (a.x1 >= open.x2 - 0.1 && a.x2 <= close.x1 + 0.1 && a !== open && a !== close);
  const band = atoms.filter((a) => a.yb > y1 - 0.3 * em && a.yb < y2 + 0.3 * em && inside(a)).sort(byX);
  // The array runs from the rules out to the first gap wider than a
  // column's (an em and a half): the formula's other atoms stand apart.
  const left = band.filter((a) => cx(a) < rx1);
  const right = band.filter((a) => cx(a) > rx2);
  if (left.length === 0 && right.length === 0) return atoms;
  let lo = band.indexOf(left[left.length - 1] ?? right[0]);
  let hi = band.indexOf(right[0] ?? left[left.length - 1]);
  while (lo > 0 && band[lo].x1 - band[lo - 1].x2 < 1.5 * em) lo--;
  while (hi < band.length - 1 && band[hi + 1].x1 - band[hi].x2 < 1.5 * em) hi++;
  // Between its fences the array is all there is, however wide its columns
  // stand (the MML book's [A | b] sets them two ems apart).
  const content = open && close ? band : band.slice(lo, hi + 1);
  const mains = content.filter((a) => a.size >= em * 0.95);
  const lines = rowLines(mains.length ? mains : content, em);
  // One row between rules is a table's row, not an array (arXiv
  // 2410.04586's table of marks read as one-row arrays).
  if (lines.length < 2) return atoms;
  const rows = splitRows(content, lines);
  const x1 = Math.min(...content.map((a) => a.x1));
  const x2 = Math.max(...content.map((a) => a.x2));
  // Columns: at each vertical rule, and at each gap of an em or more open
  // in every row.
  const ruleXs = [...new Set(vr.filter((r) => r.x1 > x1 && r.x1 < x2).map((r) => Math.round(r.x1)))].sort((p, q) => p - q);
  if (ruleXs.length === 0) return atoms;
  // A ruled array's columns may stand closer than a matrix's: half an em
  // open in every row is a column gap, more than any space TeX sets inside
  // a cell (the MML book's [A | A⁻¹] sets −1 and 2 6.6 pt apart).
  const cuts = [...ruleXs, ...columnCuts(rows, em, 0.5 * em).filter((c) => ruleXs.every((x) => Math.abs(x - c) > 0.5 * em))].sort((p, q) => p - q);
  const spec = ["c", ...cuts.map((c) => (ruleXs.includes(c) ? "|c" : "c"))].join("");
  // Horizontal rules across the columns: \hline over the row under them.
  const hr = rules.filter((r) => r.dir === "h" && r.x1 <= x1 + 0.5 * em && r.x2 >= x2 - 0.5 * em && r.y1 > y1 - 0.3 * em && r.y1 < y2 + 0.3 * em);
  const cellsOf = (row: Atom[]) => {
    const parts: Atom[][] = cuts.map(() => []).concat([[]]);
    for (const a of row) parts[cuts.filter((c) => cx(a) > c).length].push(a);
    return parts.map((part) => linear(part.map((a) => ({ ...a })))).join(" & ");
  };
  const hline = (above: number, below: number) => hr.filter((r) => r.y1 < above && r.y1 > below).map(() => "\\hline ").join("");
  // Rules over the first row and under the last frame a table set with
  // math in its cells (arXiv 2504.02736 p. 9), not an array: it is left
  // to the tables.
  if (hline(Infinity, lines[0]) && hline(lines[lines.length - 1], -Infinity)) return atoms;
  let body = hline(Infinity, lines[0]);
  rows.forEach((row, k) => {
    body += cellsOf(row);
    const next = lines[k + 1] ?? -Infinity;
    const under = hline(lines[k], next);
    if (k < rows.length - 1) body += ` \\\\ ${under}`;
    else if (under) body += ` \\\\ ${under}`;
  });
  for (const r of [...hr, ...vr]) read.add(r);
  const top = Math.max(...content.map((a) => a.top), y2);
  const bottom = Math.min(...content.map((a) => a.bottom), y1);
  const made = node(content, `\\begin{array}{${spec}} ${body.trim()} \\end{array}`, (top + bottom) / 2 - 0.25 * em, em, { top, bottom, rows: lines });
  return [...atoms.filter((a) => !content.includes(a)), made];
}

// ── Rows: matrices, binomials, cases, aligned lines ────────────────────────

// Baselines of main-size atoms at least 0.9 em apart, top first. A row of
// vertical or diagonal dots alone hangs nothing under its baseline: the
// row under it may stand half an em lower (parse loop finding: the CS 229
// refresher's matrices set rows tight, the ⋮ row's baseline 0.8 em over
// the last row's, and ⋮ read as the last row's superscript).
function rowLines(atoms: Atom[], unit: number): number[] {
  const at = (a: Atom) => Math.round(a.yb * 2) / 2;
  const ys = [...new Set(atoms.map(at))].sort((p, q) => q - p);
  const dotsOnly = (y: number) => atoms.every((a) => at(a) !== y || a.tex === "\\vdots" || a.tex === "\\ddots");
  const lines: number[] = [];
  for (const y of ys) {
    const last = lines[lines.length - 1];
    if (last !== undefined && last - y < (dotsOnly(last) ? 0.5 : 0.9) * unit) continue;
    lines.push(y);
  }
  return lines;
}

// Each atom goes to the row whose baseline is nearest, and a script to its
// base's row: a block entry set between two rows (A₂ in the corner of a
// 3×3 matrix, its baseline midway) stands as near one row as the other,
// and its script nearer the lower (parse loop finding: The Art of Linear
// Algebra's Japanese edition, Figure 13, put A in the second row and its
// "2" in the third, and the display was a crop).
function splitRows(atoms: Atom[], lines: number[]): Atom[][] {
  const rows: Atom[][] = lines.map(() => []);
  const em = maxSize(atoms);
  const nearest = (a: Atom) => {
    let best = 0;
    lines.forEach((ly, i) => {
      if (Math.abs(ly - a.yb) < Math.abs(lines[best] - a.yb)) best = i;
    });
    return best;
  };
  const full = atoms.filter((a) => a.size >= em * 0.85);
  const rowOf = new Map(full.map((a) => [a, nearest(a)]));
  // A limit goes to its operator's row: set over a ⋃ of the row under,
  // it stands nearer the row over (GeoTopo p19's "n" over ⋃ read as a
  // subscript of the row above's last word).
  // An integral sets its limits beside it, as scripts.
  const ops = full.filter((o) => o.cls === "op" && hangingFamily(o.fam) && o.entry?.display && !INTEGRAL_RE.test(o.tex));
  const limitOf = (a: Atom) =>
    ops.find(
      (o) =>
        cx(a) > o.x1 &&
        cx(a) < o.x2 &&
        ((a.bottom >= o.top - 0.2 * em && a.bottom - o.top < 0.8 * em) || (a.top <= o.bottom + 0.2 * em && o.bottom - a.top < 0.8 * em)),
    );
  for (const a of atoms) {
    let row = rowOf.get(a);
    const op = row === undefined ? limitOf(a) : undefined;
    if (op) row = rowOf.get(op);
    if (row === undefined) {
      const base = full
        .filter((b) => a.x1 >= b.x2 - 0.05 * em && a.x1 <= b.x2 + 0.2 * em && a.yb > b.yb - 0.5 * em && a.yb < b.yb + 0.7 * em)
        .sort((p, q) => a.x1 - p.x2 - (a.x1 - q.x2))[0];
      row = base ? rowOf.get(base)! : nearest(a);
    }
    rows[row].push(a);
  }
  return rows;
}

// Columns: gaps of 0.9 em or more open in every row that splits two cells,
// or of 9.5 pt: TeX sets an array's columns 10 pt apart at any text size
// (a 12 pt paper's bmatrix read each row as one cell).
function columnCuts(rows: Atom[][], em: number, least = Math.min(0.9 * em, 9.5)): number[] {
  const all = rows.flat();
  if (all.length === 0) return [];
  const x1 = Math.min(...all.map((a) => a.x1));
  const x2 = Math.max(...all.map((a) => a.x2));
  const cuts: number[] = [];
  let start: number | null = null;
  for (let x = x1; x <= x2; x += 0.5) {
    const open =
      rows.every((r) => !r.some((a) => a.x1 < x && a.x2 > x)) &&
      rows.filter((r) => r.some((a) => a.x2 <= x) && r.some((a) => a.x1 >= x)).length >= 2;
    if (open && start === null) start = x;
    if (!open && start !== null) {
      if (x - start >= least) cuts.push((start + x) / 2);
      start = null;
    }
  }
  return cuts;
}

// A fraction or a binomial set in the other style than its place: \dfrac
// and \dbinom inline, \tfrac and \tbinom in a display (parse loop finding:
// the probability cheatsheet's sampling table sets its binomials' rows at
// the text's size in a table's cell, and read as \binom they failed the
// check on every row glyph's level).
const restyle = (tex: string, prefix: "d" | "t") => tex.replace(/^\\(frac|binom)\b/, `\\${prefix}$1`);

// A cell of cases or a matrix is set in text style: a fraction whose parts
// are the text's size there is \dfrac (arXiv 2502.02648 (14)).
function cells(rows: Atom[][], cuts: number[]): string {
  const cell = (a: Atom): Atom => ({ ...a, tex: a.fracPart !== undefined && a.fracPart >= style.size * 0.9 ? restyle(a.tex, "d") : a.tex });
  return rows
    .map((r) => {
      const parts: Atom[][] = [[]];
      for (const a of [...r].sort(byX)) {
        while (parts.length - 1 < cuts.length && cx(a) > cuts[parts.length - 1]) parts.push([]);
        parts[parts.length - 1].push(a);
      }
      while (parts.length < cuts.length + 1) parts.push([]);
      return parts.map((p) => linear(p.map(cell))).join(" & ");
    })
    .join(" \\\\ ");
}

// A tall delimiter pair around stacked content is its own node, innermost
// first: a matrix, a binomial, or (a left brace with no closer) cases.
function fencedGroups(atoms: Atom[], em: number): Atom[] {
  let out = [...atoms];
  // An opening delimiter whose group stacks nothing (tall parentheses
  // around a fraction) holds no group around it back: the cases of arXiv
  // 2502.02648 (14) waited on the parentheses in their second row, and
  // were a crop.
  const plain = new Set<Atom>();
  for (;;) {
    const fences = out.filter((a) => isTall(a, em) && a.fam === "omx").sort(byX);
    let made: Atom | null = null;
    let marked = false;
    for (let i = 0; i < fences.length && !made; i++) {
      const open = fences[i];
      if (open.cls !== "open" || plain.has(open)) continue;
      // Its closing delimiter: the first no opening one between them takes,
      // on its row (a display's rows each have their binomials: arXiv
      // 2410.04586 p. 7 paired a row's "(" with the next row's ")").
      const mid = (d: Atom) => (d.top + d.bottom) / 2;
      const row = fences.slice(i + 1).filter((d) => Math.abs(mid(d) - mid(open)) < 0.5 * em);
      let depth = 0;
      const close = row.find((d) => (d.cls === "open" ? (depth++, false) : d.cls === "close" && depth-- === 0));
      const inner = row.find((d) => d.cls === "open" && !plain.has(d) && (!close || d.x1 < close.x1));
      if (inner) continue; // innermost first
      const stacks = (yes: boolean) => {
        if (!yes) {
          plain.add(open);
          marked = true;
        }
        return yes;
      };
      const right = close ? close.x1 + 0.1 : Infinity;
      // The rows may stand a third of an em past the delimiters' ends: a
      // binomial set small fills its \Big parentheses to the brim (parse
      // loop finding: the probability cheatsheet's (n−1 over i−1) in CMEX7
      // stood its "1" 0.23 em over their top, and lost it).
      const reach = 0.35 * em;
      let content = out.filter((a) => a !== open && a !== close && a.x1 >= open.x2 - 0.1 && a.x2 <= right && a.top <= open.top + reach && a.bottom >= open.bottom - reach);
      if (!close) {
        // What follows cases on the formula's baseline, past every row's end
        // and on no row's baseline (the sentence's period), is the
        // formula's, not a row's: arXiv 2502.02648 (25) read "γ < 1_{.}",
        // and ICML's (33) "x = ℓ/L." after its cases read as the first
        // row's subscript. The longest such run goes.
        const base = (open.top + open.bottom) / 2 - 0.25 * em;
        const sorted = [...content].sort((p, q) => p.x1 - q.x1);
        for (let k = 1; k < sorted.length; k++) {
          const tail = sorted.slice(k);
          const rest = sorted.slice(0, k);
          if (tail.some((a) => Math.abs(a.yb - base) > 0.2 * em)) continue;
          if (rest.some((a) => a.x2 > tail[0].x1 + 0.1 * em || tail.some((t) => Math.abs(a.yb - t.yb) < 0.1 * em))) continue;
          content = content.filter((a) => rest.includes(a));
          break;
        }
      }
      // Cases take no cases set after them on the line: two side by side
      // ("β = {…} and β' = {…}", arXiv 2410.04586 p. 18) read as one inside
      // the other.
      if (!stacks(content.length > 0 && (Boolean(close) || !content.some((a) => a.tex.startsWith("\\begin{cases}"))))) continue;
      // A tall delimiter or a big operator inside hangs from its origin: its
      // row is the one its middle stands on (linearAt places it so too).
      for (const a of content) {
        if (hangingFamily(a.fam) && (a.cls === "op" || a.entry?.size || a.entry?.piece || a.cls === "open" || a.cls === "close")) a.yb = (a.top + a.bottom) / 2 - 0.25 * Math.min(em, a.size);
      }
      const stackSize = maxSize(content);
      const mains = content.filter((a) => a.size >= stackSize * 0.95 && a.fam !== "omx");
      const lines = rowLines(mains, stackSize);
      if (!stacks(lines.length >= 2)) continue;
      // A matrix whose rows are labeled beside it, a label in a column left
      // of its bracket on each row's baseline (a Markov chain's states):
      // KaTeX has no \bordermatrix, and read with the formula the middle
      // row's label is a factor ("N = 2(…)", Grinstead–Snell p. 419). The
      // formula fails.
      const labels = out.filter(
        (a) => a !== open && !content.includes(a) && !isTall(a, em) && a.x2 <= open.x1 + 0.1 * em && open.x1 - a.x2 < 1.5 * em,
      );
      if (new Set(labels.map((a) => lines.findIndex((y) => Math.abs(a.yb - y) < 0.25 * stackSize)).filter((n) => n >= 0)).size >= 2) lost++;
      const rows = splitRows(content, lines);
      const cuts = columnCuts(rows, stackSize);
      const axis = (open.top + open.bottom) / 2;
      let tex: string;
      // A binomial's rows' size says its style, as a fraction's parts do
      // (fracPart; restyle).
      const extra: Partial<Atom> = { rows: lines };
      if (!close && open.tex === "\\{") tex = `\\begin{cases} ${cells(rows, cuts)} \\end{cases}`;
      else if (!close) {
        stacks(false);
        continue;
      } else if (open.tex === "(" && close.tex === ")" && rows.length === 2 && cuts.length === 0) {
        tex = `\\binom{${linear(rows[0].map((a) => ({ ...a })))}}{${linear(rows[1].map((a) => ({ ...a })))}}`;
        extra.fracPart = stackSize;
      } else {
        const env = FENCE_ENV[open.tex] ?? "matrix";
        tex = `\\begin{${env}} ${cells(rows, cuts)} \\end{${env}}`;
      }
      made = node([open, ...content, ...(close ? [close] : [])], tex, axis - 0.25 * em, em, extra);
      out = out.filter((a) => a !== open && a !== close && !content.includes(a));
      out.push(made);
    }
    if (!made && !marked) return out;
  }
}

// Notes set beside a matrix's rows ("Swap with R₃", "−4R₁", "·(−1)"): the
// atoms right of the matrix, within its height, each on one of its rows'
// baselines, are a column of their own beside it, one row to each of its
// rows (parse loop finding: the MML book's elimination steps read each
// note as a row of a gathered display or a subscript of the matrix, and
// were crops). A mark after the matrix on its axis stays after the notes.
function rowNotes(atoms: Atom[], em: number): Atom[] {
  let out = atoms;
  for (const grid of atoms.filter((a) => a.rows && a.rows.length >= 2)) {
    const lines = grid.rows!;
    // The matrix's closing delimiter, when the array is set between two,
    // comes first.
    const fence = out.find((a) => isTall(a, em) && a.cls === "close" && a.x1 >= grid.x2 - 0.1 * em && a.x1 - grid.x2 < em);
    const edge = fence ? fence.x2 : grid.x2;
    const right = out.filter((a) => a !== grid && a !== fence && a.x1 >= edge - 0.1 * em && a.yb > grid.bottom && a.yb < grid.top);
    const rowOf = (a: Atom) => lines.findIndex((y) => Math.abs(a.yb - y) < 0.3 * em);
    const notes = right.filter((a) => rowOf(a) >= 0);
    if (notes.length === 0) continue;
    // A note starts within a few ems of the matrix and nothing else stands
    // among the notes; a mark on the axis after them all is the sentence's.
    const x2 = Math.max(...notes.map((a) => a.x2));
    if (Math.min(...notes.map((a) => a.x1)) - edge > 3 * em) continue;
    if (right.some((a) => !notes.includes(a) && a.x1 < x2)) continue;
    // One note on the axis alone is the matrix's script or the formula's
    // next symbol, no column.
    if (new Set(notes.map(rowOf)).size === 1 && notes.every((a) => Math.abs(a.yb - grid.yb) < 0.3 * em)) continue;
    const cells = lines.map((_, k) => linear(notes.filter((a) => rowOf(a) === k).map((a) => ({ ...a }))));
    const column = node(notes, `\\quad\\begin{matrix} ${cells.join(" \\\\ ")} \\end{matrix}`, grid.yb, grid.size, { top: grid.top, bottom: grid.bottom });
    out = [...out.filter((a) => !notes.includes(a)), column];
  }
  return out;
}

// Unfenced rows: aligned when every row's first relation sits at one x,
// else gathered.
function alignedRows(atoms: Atom[], em: number): string | null {
  // A row has more than delimiters: a limit's parentheses at the text's
  // size make none (IEEE Access p. 9).
  const mains = atoms.filter((a) => a.size >= em * 0.95 && !hangingFamily(a.fam) && !(a.fam === null && a.limits) && a.cls !== "open" && a.cls !== "close");
  const lines = rowLines(mains, em);
  if (lines.length < 2) return null;
  // A period or a comma after the rows' last glyphs, at the text's size,
  // on no row's baseline, is the sentence's mark after the whole display:
  // TeX sets it on the display's axis, between two rows (parse loop
  // finding: the MML book's systems of equations (2.44), (2.45), (2.73)
  // read it as the middle row's superscript, "0^{.}", and were crops).
  const last = [...atoms].sort((p, q) => q.x2 - p.x2)[0];
  if (/^[.,;]$/.test(last.tex) && last.size >= em * 0.95 && atoms.every((a) => a === last || a.x2 <= last.x1 + 0.1 * em)) {
    const rest = atoms.filter((a) => a !== last);
    const restLines = rowLines(
      rest.filter((a) => mains.includes(a)),
      em,
    );
    if (restLines.length >= 2 && restLines.every((y) => Math.abs(y - last.yb) > 0.25 * em)) {
      const inner = alignedRows(rest, em);
      if (inner) return `${inner}${last.tex}`;
    }
  }
  const rows = splitRows(atoms, lines);
  // Rows that are no more than a big operator's limits are no rows, nor is
  // a limit with a word in the text's size, centered under or over the
  // operator ("k odd" under a ∑).
  if (rows.some((r) => !r.some((a) => a.size >= em * 0.95))) return null;
  const ops = atoms.filter((a) => a.cls === "op" && hangingFamily(a.fam) && a.entry?.display);
  // (Its glyphs in the text's size are a word's letters.)
  const limitRow = (r: Atom[]) => {
    if (!r.every((a) => a.size < em * 0.85 || a.italic || a.upright)) return false;
    const mid = (Math.min(...r.map((a) => a.x1)) + Math.max(...r.map((a) => a.x2))) / 2;
    return ops.some((o) => !r.includes(o) && Math.abs(mid - cx(o)) < 0.5 * em && (Math.max(...r.map((a) => a.top)) <= o.bottom + 0.1 * em || Math.min(...r.map((a) => a.bottom)) >= o.top - 0.1 * em));
  };
  if (rows.some(limitRow)) return null;
  // Nor is a short row just right of a tall delimiter or a fraction of
  // another row that reaches over and under its baseline: it is that
  // one's script, which MathJax sets at its base's size in a script
  // (OpenStax's e^{…(\frac{x-μ}{σ})^2}).
  const hangs = (r: Atom[]) => {
    const s = [...r].sort(byX);
    const first = s[0];
    return (
      s[s.length - 1].x2 - first.x1 < 2 * em &&
      atoms.some((b) => !r.includes(b) && b.top > first.yb && b.bottom < first.yb && first.x1 >= b.x2 - 0.1 * em && first.x1 - b.x2 < 0.3 * em)
    );
  };
  if (rows.some(hangs)) return null;
  // A grid of four columns or more, a gap open down every row between
  // each two, is a matrix with no delimiters (a Betti table's "0: 1 . .").
  const cuts = columnCuts(rows, em);
  if (cuts.length >= 3) return `\\begin{matrix} ${cells(rows, cuts)} \\end{matrix}`;
  // Each row's first relation at its size (a limit's arrow is none).
  const isRel = (a: Atom) => a.cls === "rel" && a.size >= em * 0.95;
  const firstRel = (r: Atom[]) => [...r].sort(byX).find(isRel);
  const rels = rows.map(firstRel).filter((a): a is Atom => a !== undefined);
  // Their left edges, or their centers (eqnarray centers "=" over "⟶").
  const aligned = rels.length === rows.length && rels.every((a) => Math.abs(a.x1 - rels[0].x1) < 0.3 * em || Math.abs(cx(a) - cx(rels[0])) < 0.3 * em);
  const depth = displayDepth;
  if (nesting === displayDepth) displayDepth = nesting + 1;
  try {
    if (aligned) {
      const body = rows.map((r) => {
        const s = [...r].sort(byX);
        const k = s.findIndex(isRel);
        return `${linear(s.slice(0, k).map((a) => ({ ...a })))} &${linear(s.slice(k).map((a) => ({ ...a })))}`;
      });
      return `\\begin{aligned} ${body.join(" \\\\ ")} \\end{aligned}`;
    }
    return `\\begin{gathered} ${rows.map((r) => linear(r.map((a) => ({ ...a })))).join(" \\\\ ")} \\end{gathered}`;
  } finally {
    displayDepth = depth;
  }
}

// ── Limits of big operators ─────────────────────────────────────────────────

// The small glyphs over or under operators or names, each owner's limit.
// A limit is a run along a baseline, its own scripts included (the prime
// of g′ ∈ S(g)), or rows of runs (\substack), and it may hold words a
// space apart ("p prime" is wider than ∏): a gap does not tell one limit
// from two, as TeX sets a thin space at least between two owners. TeX
// centers a limit on its owner, so a run is cut where each part sits
// centered on its own: grown whole, two sums side by side read as one sum
// with both lower limits (\sum_{j=1\ p,q=1}^{k}\sum^{n}, arXiv 2506.08494
// p. 16), and two lim as one (arXiv 2411.09614 p. 18), which the check
// cannot see. A run no part of which sits centered is its one owner's (an
// integral shifts its limits by its slant; a subarray aligns its rows
// left), or no one's.
function limitParts<T extends { x1: number; x2: number }>(glyphs: Atom[], owners: T[], fits: (o: T, b: Atom) => boolean, reach: number, em: number): Map<T, Atom[]> {
  const runs: Atom[][] = [];
  for (const b of [...glyphs].sort(byX)) {
    // On the baseline of a glyph of the run, or a script of one set just
    // after it: a limit's letter takes its sub- and superscript at one x
    // (Θ₁⁽ᵐ⁾ under a sup, arXiv 2302.12627 p. 6: the second Θ's scripts
    // left the limit, and the display failed). A script of a script keeps
    // its size and starts where its base ends (𝒞_{IPC_{0:k−1}} under an
    // arg min, arXiv 2411.19946 (7)).
    const on = (r: Atom[]) =>
      r.some(
        (c) =>
          Math.abs(c.yb - b.yb) < 0.3 * Math.min(b.size, c.size) ||
          (b.size < c.size * 0.95 && Math.abs(b.yb - c.yb) < 0.7 * c.size && b.x1 >= c.x1 && b.x1 - c.x2 < 0.3 * em) ||
          (Math.abs(b.yb - c.yb) < 0.7 * c.size && Math.abs(b.x1 - c.x2) < 0.05 * em),
      );
    const run = runs.find((r) => on(r) && b.x1 - Math.max(...r.map((c) => c.x2)) < 0.6 * em);
    if (run) run.push(b);
    else runs.push([b]);
  }
  const span = (p: Atom[]) => ({ x1: Math.min(...p.map((c) => c.x1)), x2: Math.max(...p.map((c) => c.x2)) });
  const taken = new Map<T, Atom[]>();
  const give = (o: T, p: Atom[]) => taken.set(o, [...(taken.get(o) ?? []), ...p]);
  for (const r of runs) {
    const whole = span(r);
    const fit = owners.filter((o) => r.some((c) => fits(o, c)) && whole.x2 > o.x1 - reach && whole.x1 < o.x2 + reach);
    if (!fit.length) continue;
    // A run is cut only between two glyphs a tenth of an em apart.
    const cuts = [0, ...r.flatMap((c, i) => (i > 0 && c.x1 - span(r.slice(0, i)).x2 >= 0.1 * em ? [i] : [])), r.length];
    const parts: { o: T; i: number; j: number; off: number }[] = [];
    for (const o of fit) {
      let best: { o: T; i: number; j: number; off: number } | null = null;
      for (const i of cuts) {
        for (const j of cuts) {
          const part = r.slice(i, j);
          if (!part.length || !part.every((c) => fits(o, c))) continue;
          const s = span(part);
          if (s.x1 > cx(o) || s.x2 < cx(o)) continue;
          const off = Math.abs(cx(s) - cx(o));
          if (!best || off < best.off - 0.01 * em || (off <= best.off + 0.01 * em && j - i > best.j - best.i)) best = { o, i, j, off };
        }
      }
      if (best && best.off < 0.2 * em) parts.push(best);
    }
    // Two parts that share a glyph: the better centered stands.
    const kept: typeof parts = [];
    for (const p of parts.sort((a, b) => a.off - b.off)) if (kept.every((q) => p.j <= q.i || q.j <= p.i)) kept.push(p);
    for (const p of kept) give(p.o, r.slice(p.i, p.j));
    if (!kept.length && fit.length === 1) give(fit[0], r);
  }
  return taken;
}

function limits(atoms: Atom[], em: number): Atom[] {
  const out = [...atoms];
  // A text-size operator takes limits too (\sum\limits in a list item):
  // a limit sits wholly over its top or under its bottom, a script beside.
  const ops = atoms.filter((a) => a.cls === "op" && (a.entry?.display || hangingFamily(a.fam)) && a.size >= em * 0.75);
  // A limit's delimiters may be set at the operator's size (IEEE Access's
  // "(1 − 2^{−m−1})" under an integral), and so may a word in it, on the
  // baseline of its script-size glyphs (\mbox{odd} under a ∑).
  const word = (op: Atom, b: Atom) =>
    (b.italic || b.upright) && atoms.some((c) => c.size < op.size * 0.85 && Math.abs(c.yb - b.yb) < 0.1 * em && Math.abs(cx(c) - cx(b)) < 5 * em);
  const small = (op: Atom, b: Atom) => b.size < op.size || b.cls === "open" || b.cls === "close" || word(op, b);
  const over = (op: Atom, b: Atom) => b.bottom >= op.top - 0.1 * em && small(op, b);
  const under = (op: Atom, b: Atom) => b.top <= op.bottom + 0.1 * em && small(op, b);
  const fits = (op: Atom, b: Atom) => over(op, b) || under(op, b);
  const taken = limitParts(atoms.filter((c) => !ops.includes(c) && ops.some((o) => fits(o, c))), ops, fits, 0.3 * em, em);
  for (const op of ops) {
    const mine = taken.get(op) ?? [];
    const up = mine.filter((b) => over(op, b));
    const low = mine.filter((b) => under(op, b) && !up.includes(b));
    if (up.length) op.upper = stackedLimit(up);
    if (low.length) op.lower = stackedLimit(low);
    op.limits = true;
    op.ownX1 = op.x1;
    op.x1 = Math.min(op.x1, ...[...up, ...low].map((b) => b.x1));
    op.x2 = Math.max(op.x2, ...[...up, ...low].map((b) => b.x2));
    for (const b of [...up, ...low]) out.splice(out.indexOf(b), 1);
  }
  return out;
}

// A limit of two or more lines is a \substack.
function stackedLimit(atoms: Atom[]): string {
  const size = maxSize(atoms);
  const lines = rowLines(atoms.filter((a) => a.size >= size * 0.95), size);
  if (lines.length < 2) return linear(atoms.map((b) => ({ ...b })));
  const rows = splitRows(atoms, lines);
  return `\\substack{${rows.map((r) => linear(r.map((a) => ({ ...a })))).join(" \\\\ ")}}`;
}

// ── The line: scripts and tokens ────────────────────────────────────────────

// How deep linear() runs: a fraction on the formula's own line (depth 1)
// says its style when its parts differ from the formula's — \tfrac in a
// display, \dfrac inline; anywhere deeper \frac draws the size TeX drew.
let nesting = 0;
// Glyphs the layout could not place in the formula being read.
let lost = 0;
// The depth of linear() at which KaTeX sets the display style: a
// display's own line, and the rows of an aligned or gathered display.
let displayDepth = 1;
// The rules the layout read: a bar, a radical's vinculum, a brace's
// stretch. A rule it left is a structure it missed.
let read = new Set<Rule>();

function linear(input: Atom[]): string {
  nesting++;
  try {
    return linearAt(input);
  } finally {
    nesting--;
  }
}

function linearAt(input: Atom[]): string {
  if (input.length === 0) return "";
  let atoms = accents(input);
  const em = maxSize(ownSize(atoms));
  atoms = fencedGroups(atoms, em);
  const base = mainBaseline(atoms);
  // Big operators and delimiters sit on the math axis, a quarter em over
  // the baseline of their row: in a display of several rows each sum is its
  // own row's (arXiv 2506.08494 p. 12: every sum went to the first row). A
  // sum set in a script's size sits on the script's axis.
  for (const a of atoms) {
    if (hangingFamily(a.fam) && (a.cls === "op" || a.entry?.size || a.entry?.piece || a.cls === "open" || a.cls === "close")) a.yb = (a.top + a.bottom) / 2 - 0.25 * Math.min(em, a.size);
  }
  atoms = rowNotes(atoms, em);
  const rows = alignedRows(atoms, em);
  if (rows) return rows;
  // Tall delimiters pair up as \left … \right (an editor redraws them to
  // fit); one alone keeps its drawn size (\bigl( up to \Biggl(): a lone
  // \left does not parse.
  // A delimiter a level up sized already (a script's tall parentheses are
  // tall for the formula too) keeps its size.
  const tall = atoms.filter((a) => isTall(a, em) && !SIZED_RE.test(a.tex)).sort(byX);
  const stack: Atom[] = [];
  const lone: Atom[] = [];
  for (const d of tall) {
    if (d.cls === "open") stack.push(d);
    else if (d.cls === "close" && stack.length) {
      const o = stack.pop()!;
      o.tex = `\\left${o.tex}`;
      d.tex = `\\right${d.tex}`;
    } else lone.push(d);
  }
  for (const d of [...stack, ...lone]) {
    const side = d.cls === "open" ? "l" : d.cls === "close" ? "r" : "";
    d.tex = `${BIG[Math.min(4, Math.max(1, d.entry?.size ?? 4))]}${side}${d.tex}`;
  }
  atoms = limits(atoms, em);
  const baseSize = atoms.find((a) => a.yb === base)?.size ?? em;
  // An extension font's glyph stands on the baseline, unless it is set in
  // a script's size: the ∑ of an exponent Σd_j/2 read as a big operator
  // after the brace it is the exponent of (arXiv 2506.08494 pp. 5, 7).
  const onBase = (a: Atom) =>
    a.limits ||
    (hangingFamily(a.fam) && a.size >= baseSize * 0.75) ||
    (a.size >= baseSize * 0.85 ? Math.abs(a.yb - base) < 0.12 * baseSize : Math.abs(a.yb - base) < 0.05 * baseSize);
  // A small glyph on the baseline right after a larger script is that
  // script's own script: the exponent in a subscript (I_{k 2^{-n}}) sits
  // as high as the base's baseline.
  const smallSize = (a: Atom) => a.size < baseSize * 0.85;
  const follows = (a: Atom, b: Atom) => b !== a && b.x2 <= a.x1 + 0.1 * baseSize && a.x1 - b.x2 < 0.3 * baseSize;
  const bound = new Set(atoms.filter((a) => smallSize(a) && onBase(a) && atoms.some((b) => smallSize(b) && !onBase(b) && b.size > a.size && follows(a, b))));
  for (let grew = bound.size > 0; grew; ) {
    grew = false;
    for (const a of atoms) {
      if (bound.has(a) || !smallSize(a) || !onBase(a)) continue;
      if ([...bound].some((b) => b.size >= a.size && follows(a, b))) {
        bound.add(a);
        grew = true;
      }
    }
  }
  const onLine = (a: Atom) => onBase(a) && !bound.has(a);
  // A big operator stands in the line where its own glyph stands: a limit
  // set wider than the space before it (\mathclap) reaches past the
  // relation before it (parse loop finding: GeoTopo's "Z(x) := ⋃ A" with
  // "A ⊆ X zhgd." under the ⋃ starting left of the "=" read
  // "Z(x):\bigcup…=\quad A").
  const main = atoms.filter(onLine).sort((a, b) => (a.ownX1 ?? a.x1) - (b.ownX1 ?? b.x1));
  const small = atoms.filter((a) => !main.includes(a));
  // An upright word from main[k]: its last index and its letters ("lim"
  // takes a following "sup" set a thin space apart, "arg" a "min").
  const wordAt = (k: number): { end: number; word: string } => {
    let end = k;
    let word = main[k].tex;
    const named = (w: string) =>
      (w === "lim" || (w === "arg" && /^m(in|ax)$/.test(main.slice(end + 1, end + 4).map((b) => b.tex).join("")))) && main[end + 1].x1 - main[end].x2 < 0.3 * em;
    while (
      (main[k].italic ? main[end + 1]?.italic : main[end + 1]?.upright) &&
      LETTER_RE.test(main[end + 1].tex) &&
      (main[end + 1].x1 - main[end].x2 < 0.12 * em || named(word))
    ) {
      end++;
      word += main[end].tex;
    }
    return { end, word };
  };
  // A label stacked over a relation (\overset{a.s.}{\to}, an L with its
  // exponent over an arrow) is the relation's before any symbol takes its
  // scripts: small glyphs over its width, their baseline half an em over
  // its own or more (a superscript stands a third of an em up, and beside),
  // and the glyphs set on with them. The label's first letter starts left
  // of the arrow, and the symbol before took it for its superscript.
  const labels = new Map<Atom, Atom[]>();
  for (const a of main) {
    if (a.cls !== "rel") continue;
    const label = small.filter(
      (s) => !s.claimed && cx(s) > a.x1 - 0.1 * em && cx(s) < a.x2 + 0.1 * em && s.yb - a.yb > 0.4 * baseSize && s.bottom > a.yb,
    );
    for (let grew = label.length > 0; grew; ) {
      grew = false;
      for (const s of small) {
        if (s.claimed || label.includes(s)) continue;
        if (label.some((l) => Math.abs(l.yb - s.yb) < 0.1 * em && (Math.abs(s.x1 - l.x2) < 0.3 * em || Math.abs(l.x1 - s.x2) < 0.3 * em))) {
          label.push(s);
          grew = true;
        }
      }
    }
    for (const s of label) s.claimed = true;
    if (label.length) labels.set(a, label);
  }
  // So is a label stacked under a relation (\underset{n\to+\infty}{\sim}):
  // small glyphs under its width, wholly under its baseline, and the
  // glyphs set on with them (the CS 229 probability refresher's central
  // limit theorem read "\overline{X}_{n\rightarrow}\sim_{\infty}", and
  // lost its "+").
  const underLabels = new Map<Atom, Atom[]>();
  for (const a of main) {
    if (a.cls !== "rel") continue;
    const label = small.filter((s) => !s.claimed && cx(s) > a.x1 - 0.1 * em && cx(s) < a.x2 + 0.1 * em && a.yb - s.yb > 0.4 * baseSize && s.top < a.yb);
    for (let grew = label.length > 0; grew; ) {
      grew = false;
      for (const s of small) {
        if (s.claimed || label.includes(s)) continue;
        if (label.some((l) => Math.abs(l.yb - s.yb) < 0.1 * em && (Math.abs(s.x1 - l.x2) < 0.3 * em || Math.abs(l.x1 - s.x2) < 0.3 * em))) {
          label.push(s);
          grew = true;
        }
      }
    }
    for (const s of label) s.claimed = true;
    if (label.length) underLabels.set(a, label);
  }
  // The limit under \lim, \sup, \max in display is claimed before any
  // script: wider than the name, it starts left of it ("N → ∞" under "lim"
  // read as a subscript of the "=" before it).
  const nameLimits = new Map<Atom, Atom[]>();
  const names: { a: Atom; x1: number; x2: number }[] = [];
  for (let k = 0; k < main.length; k++) {
    if (!main[k].upright || !LETTER_RE.test(main[k].tex)) continue;
    const { end, word } = wordAt(k);
    if (LIMIT_OPS.has(word)) names.push({ a: main[k], x1: main[k].x1, x2: main[end].x2 });
    k = end;
  }
  // A limit hangs wholly under the name's baseline; an inline subscript
  // reaches above it. Its baseline alone says so where its box is a guess
  // (a text font's "t" under Times' "lim" read as the subscript of the "="
  // before it, Springer).
  const below = (n: { a: Atom }, s: Atom) => s.top < n.a.yb - 0.15 * em || s.yb < n.a.yb - 0.45 * em;
  for (const [n, part] of limitParts(small.filter((c) => !c.claimed && names.some((m) => below(m, c))), names, below, 0.4 * em, em)) {
    for (const c of part) c.claimed = true;
    nameLimits.set(n.a, part);
  }
  const out: string[] = [];
  let prev: Atom | null = null;
  // The previous symbol's rightmost glyph (its last script, if any), and
  // whether it ended a word (a name, \text): the space after it is its own.
  let tail: Atom | null = null;
  let afterWord = false;
  for (let k = 0; k < main.length; k++) {
    const a = main[k];
    // A piece no composite took (a map arrow's bar whose arrow the line
    // cut off, a radical's parts) reads as nothing: the formula would lose
    // the symbol and still pass the check. So does a radical sign no
    // vinculum took (synth-math-tex's inline √ of a fraction read without
    // its root).
    if (a.cls === "piece" || a.cls === "radical") lost++;
    // A name's limits reach past it on both sides: the gaps are theirs.
    const reach = nameLimits.get(a) ?? [];
    const gap = prev ? Math.min(a.x1, ...reach.map((s) => s.x1)) - prev.x2 : 0;
    const spaced = prev !== null && gap > 0.9 * em;
    // Two operands a word space apart keep the space (two formulas set a
    // space apart and read as one, or a control space): read without it,
    // two letters were a product (G ∪ H G, H ∈ ℱ read G ∪ HG, H ∈ ℱ),
    // which the glyph check cannot see. Within a formula TeX sets nothing
    // between two operands but the first one's italic correction and,
    // after a script, a twentieth of an em for each level (e^{-x^2}\,dx
    // sets two after the 2). A bar may be a relation (a ∣ b); a period, a
    // slash, and a prime are no operand.
    const operand = (b: Atom, classes: string[]) => b.code >= 0 && classes.includes(b.cls) && !/^(\||\\\||\\mid|\\vert|\\Vert|\.|\/|'|\\prime)$/.test(b.tex);
    const wordStarts = (a.upright || a.italic) && LETTER_RE.test(a.tex) && wordAt(k).word.length > 1;
    const net = prev && tail ? gap - italicOf(tail) - (tail === prev ? 0 : tail.size < prev.size * 0.6 ? 0.1 * em : 0.05 * em) : 0;
    const apart = prev !== null && !spaced && !afterWord && !wordStarts && operand(prev, ["ord", "close"]) && operand(a, ["ord", "open"]) && net > 0.2 * em;
    let wordEnds = false;
    let tex = a.tex;
    let last = a;
    // A word in a text italic set apart as text is \textit (\text{ for all }
    // in a theorem's italic read as the math letters "forall"); its letter
    // alone, or letters set tight, stay math letters.
    if (a.italic && LETTER_RE.test(a.tex)) {
      const { end, word } = wordAt(k);
      const next = main[end + 1];
      const trail = next ? next.x1 - main[end].x2 : 0;
      // A word space, which math never sets between two symbols of its own
      // (Times' quarter em before an "i": arXiv 2410.04586 p. 7 "fori").
      const apart = (b: Atom | null | undefined, space: number) => !b || space > (b.cls === "ord" ? 0.15 : 0.25) * em;
      if ((word.length > 1 && ((apart(prev, gap) && apart(next, trail)) || /^[a-z]{4,}$/.test(word))) || MARKED_RE.test(word)) {
        k = end;
        last = main[k];
        wordEnds = true;
        const lead = prev && gap > 0.2 * em && !spaced && !/ \}$/.test(out[out.length - 1] ?? "") ? " " : "";
        tex = `\\textit{${lead}${word}${trail > 0.2 * em && trail <= 0.9 * em && next ? " " : ""}}`;
      }
    }
    // Upright letters: an operator name, a word in text, or \mathrm.
    else if (a.upright && LETTER_RE.test(a.tex)) {
      const { end, word } = wordAt(k);
      k = end;
      last = main[k];
      wordEnds = word.length > 1;
      const trail = main[k + 1] ? main[k + 1].x1 - last.x2 : 0;
      // A name set tight against its argument's bracket is an operator
      // ("softmax(", "Var(").
      const applied = main[k + 1]?.cls === "open" && trail < 0.3 * em;
      // A word with a script set on it names a thing (SF_+): no text.
      const scripted = small.some((s) => !s.claimed && s.x1 >= last.x2 - 0.05 * em && s.x1 < last.x2 + 0.15 * em);
      if (OPNAMES.has(word)) tex = `\\${word}`;
      else if ((word.length === 1 || scripted) && !MARKED_RE.test(word)) tex = `\\mathrm{${word}}`;
      else if (MARKED_RE.test(word) || (!applied && (((!prev || gap > 0.2 * em) && (!main[k + 1] || trail > 0.2 * em)) || /^[a-z]{4,}$/.test(word)))) {
        // A word set apart by spaces is text; the spaces stay inside it
        // ("\text{in }\Omega", not "inΩ"), unless a quad already holds them
        // or the word before ends with it.
        const lead = prev && gap > 0.2 * em && !spaced && !/ \}$/.test(out[out.length - 1] ?? "") ? " " : "";
        tex = `\\text{${lead}${word}${trail > 0.2 * em && trail <= 0.9 * em && main[k + 1] ? " " : ""}}`;
      } else tex = `\\operatorname{${word}}`;
      // (mod n): \pmod, its parentheses and quad included.
      if (word === "mod" && out.length && out[out.length - 1] === "(") {
        const close = main.findIndex((b, j) => j > k && b.tex === ")");
        if (close > k) {
          out.pop();
          while (out.length && /^\\(q?quad| )$/.test(out[out.length - 1])) out.pop();
          out.push(`\\pmod{${linear(main.slice(k + 1, close).map((b) => ({ ...b })))}}`);
          prev = main[close];
          tail = prev;
          afterWord = false;
          k = close;
          continue;
        }
      }
      // Limits set under \lim, \sup, \max in display. In a line of text
      // KaTeX sets a name's limit beside it unless told.
      const low = nameLimits.get(a);
      if (low) tex += `${style.display ? "" : "\\limits"}_{${linear(low.map((s) => ({ ...s, claimed: false })))}}`;
    }
    // Scripts set before a symbol with no base of their own: {}^{14}_{6}C.
    const pre = small.filter(
      (s) => !s.claimed && s.x2 <= a.x1 + 0.1 * em && (!prev || s.x1 >= prev.x2 - 0.05 * em) && Math.abs(s.yb - a.yb) < 0.6 * em,
    );
    if (pre.length) {
      for (const s of pre) s.claimed = true;
      out.push(`{}${scripts(pre, a.yb, em)}`);
    }
    if (prev && gap > 1.9 * em) out.push("\\qquad");
    else if (spaced) out.push("\\quad");
    // A word space after a comma between formulas set in one display
    // ("m(0) = 1/5, m(1) = 2/5"): TeX's own space there is a sixth of an em.
    // Two operands apart (above): two digits apart are two numbers too, a
    // matrix row's "−1 1" read as −11 (Springer).
    else if ((prev?.cls === "punct" && gap > 0.4 * em) || apart) out.push("\\ ");
    if (a.fracPart !== undefined && nesting === 1) {
      if (style.display && a.fracPart < style.size * 0.8) tex = restyle(tex, "t");
      else if (!style.display && a.fracPart >= style.size * 0.9) tex = restyle(tex, "d");
    }
    const next = main[k + 1];
    // A bar with a relation's space on both sides is \mid, unless it closes
    // a bar opened before it (|X|^q = 0 read as |X\mid^q).
    const open = main.slice(0, k).filter((b) => b.tex === "|").length % 2 === 1;
    // A tall bar alone keeps its drawn size (\Big|_{a=0}, an evaluation's
    // bar): read at the text's size, its subscript stood off its row.
    const drawn = a.fam === "omx" && a.cls === "ord" && (tex === "|" || tex === "\\|") ? (a.top - a.bottom) / em : 0;
    if (drawn > 1.1) tex = `${BIG[Math.min(4, Math.max(1, Math.round(drawn / 0.6) - 1))]}${tex}`;
    else if (tex === "|" && !open && prev && next && a.x1 - prev.x2 > 0.22 * em && next.x1 - a.x2 > 0.22 * em) tex = "\\mid";
    if (tex === ":" && prev && a.x1 - prev.x2 < 0.25 * em && next && next.x1 - a.x2 > 0.3 * em) tex = "\\colon";
    const label = labels.get(a);
    if (label) tex = `\\overset{${linear(label.map((s) => ({ ...s, claimed: false })))}}{${tex}}`;
    const under = underLabels.get(a);
    if (under) tex = `\\underset{${linear(under.map((s) => ({ ...s, claimed: false })))}}{${tex}}`;
    const right = next ? next.x1 : Infinity;
    let mine = small.filter((s) => !s.claimed && s.x1 >= last.x2 - 0.25 * em && s.x1 < right - 0.05 * em);
    // A script's word runs on under the next symbol's bracket, set tight on
    // it ("2^{2^n−bias}(", IEEE Access p. 9).
    for (let grew = mine.length > 0; grew; ) {
      const end = mine.reduce((t, s) => (s.x2 > t.x2 ? s : t));
      const on = small.find((s) => !s.claimed && !mine.includes(s) && Math.abs(s.yb - end.yb) < 0.05 * em && Math.abs(s.x1 - end.x2) < 0.05 * em && s.x1 < right + 0.2 * em);
      grew = on !== undefined;
      if (on) mine.push(on);
    }
    // A relation, an operator, punctuation, or an opening bracket takes a
    // subscript at most (\leq_{\text{lex}}): a raised glyph after one is the
    // next symbol's prescript ("= {}^{\rho}u", arXiv 2504.02736 p. 7), and
    // small glyphs over and under one are a fraction whose bar the page
    // drew as no rule ("= 1/6" read as =_{6}^{1}). They stay for the next
    // symbol's prescripts, or fail the formula.
    const high = mine.filter((s) => s.yb > last.yb + 0.03 * em);
    if (/^(rel|bin|punct|open)$/.test(a.cls) && high.length > 0) mine = [];
    for (const s of mine) s.claimed = true;
    // Limits over and under: an integral takes them beside it unless told,
    // and so does any operator in a line of text. Scripts beside a big
    // operator in a display: KaTeX would set them over and under. An
    // operator a display sets at the text's size (ℓ(θ) = Σᵢ ℓᵢ, arXiv
    // 2302.12627 p. 5) is drawn so: KaTeX would draw it large.
    // A text-size operator in a display with limits over and under it
    // (\textstyle\sum\limits_{i}) keeps them there: \textstyle alone sets
    // them beside it.
    const big = a.cls === "op" && hangingFamily(a.fam);
    if ((a.lower || a.upper) && (!style.display || INTEGRAL_RE.test(tex) || (big && !a.entry?.display && nesting === displayDepth))) tex += "\\limits";
    else if (style.display && big && a.entry?.display && mine.length > 0 && !a.lower && !a.upper && !INTEGRAL_RE.test(tex)) tex += "\\nolimits";
    if (a.lower) tex += `_{${a.lower}}`;
    if (a.upper) tex += `^{${a.upper}}`;
    if (mine.length) tex += scripts(mine, last.yb, em);
    if (style.display && nesting === displayDepth && big && !a.entry?.display) tex = `{\\textstyle ${tex}}`;
    out.push(tex);
    prev = { ...last, x1: a.x1, x2: Math.max(last.x2, ...mine.map((s) => s.x2), ...reach.map((s) => s.x2)) };
    tail = [last, ...mine, ...reach].reduce((t, s) => (s.x2 > t.x2 ? s : t));
    if (tail === last) tail = prev;
    afterWord = wordEnds;
  }
  // A script with no base is a glyph the layout could not place: the
  // formula is not read (the check fails it).
  if (small.some((s) => !s.claimed)) lost++;
  return join(out);
}

// Sub- and superscripts of one base: above its baseline is ^, below is _.
// A script's own scripts, set smaller, go with the script before them: the
// exponent in a subscript (I_{k 2^{-n}}) can sit over the base's baseline.
function scripts(list: Atom[], yb: number, em: number): string {
  const big = maxSize(list);
  const high = (s: Atom) => s.yb > yb + 0.03 * em;
  const sup = list.filter((s) => s.size >= big * 0.9 && high(s));
  const sub = list.filter((s) => s.size >= big * 0.9 && !high(s));
  const primary = [...sup, ...sub];
  for (const s of list.filter((s) => s.size < big * 0.9)) {
    // Its owner stands right before it; of two (y_{a^2}^{b_c}), the one
    // nearer its baseline.
    const before = primary.filter((p) => Math.abs(p.x2 - s.x1) < 0.35 * em).sort((p, q) => Math.abs(p.yb - s.yb) - Math.abs(q.yb - s.yb));
    const owner = before[0] ?? primary.filter((p) => p.x1 <= s.x1 + 0.1 * em).sort((p, q) => q.x2 - p.x2)[0];
    if (owner ? sup.includes(owner) : high(s)) sup.push(s);
    else sub.push(s);
  }
  let tex = "";
  if (sub.length) tex += `_{${linear(sub.map((s) => ({ ...s, claimed: false })))}}`;
  if (sup.length) {
    const inner = linear(sup.map((s) => ({ ...s, claimed: false })));
    tex += /^(\\prime)+$/.test(inner) ? "'".repeat(inner.split("\\prime").length - 1) : `^{${inner}}`;
  }
  return tex;
}

const ALPHABET_RE = /^\\(mathfrak|mathbf|mathsf|mathtt)\{([A-Za-z0-9]+)\}$/;
const TEXT_RE = /^\\text\{([^{}\\]*)\}$/;

function join(tokens: string[]): string {
  const merged: string[] = [];
  for (const t of tokens) {
    const m = ALPHABET_RE.exec(t);
    const last = merged.length ? ALPHABET_RE.exec(merged[merged.length - 1]) : null;
    // One alphabet per run: \mathfrak{su}, not \mathfrak{s}\mathfrak{u}.
    // One \text per phrase: \text{ ist offene Überdeckung von }, not a
    // \text for each word (GeoTopo's rows of words in aligned displays).
    const words = TEXT_RE.exec(t);
    const before = merged.length ? TEXT_RE.exec(merged[merged.length - 1]) : null;
    if (m && last && m[1] === last[1]) merged[merged.length - 1] = `\\${m[1]}{${last[2]}${m[2]}}`;
    else if (words && before) merged[merged.length - 1] = `\\text{${before[1]}${words[1]}}`;
    else merged.push(t);
  }
  let s = "";
  for (const t of merged) {
    if (!t) continue;
    if (/\\[A-Za-z]+$/.test(s) && /^[A-Za-z]/.test(t)) s += " ";
    s += t;
  }
  return s;
}

// ── Shapes: a radical sign drawn as a path, and what no glyph explains ──────

/** Radical signs drawn as paths (KaTeX draws \sqrt's sign and bar as one
    picture; synth-math-html read its bar alone as \overline): a path that
    ends where a rule starts, the rule on its top edge, reaching down past
    the rule. Each becomes the radical atom the layout pairs with its rule. */
function drawnRadicals(atoms: Atom[], rules: Rule[], paths: Box[], used: Set<Box>): Atom[] {
  const em = maxSize(atoms);
  const out: Atom[] = [];
  const entry = mathGlyph("oms", 0x70);
  for (const r of rules) {
    if (r.dir !== "h") continue;
    const top = r.y1 + r.thickness / 2;
    const sign = paths.find(
      (p) => !used.has(p) && p.x1 < r.x1 - 0.2 * em && p.x1 > r.x1 - 1.5 * em && Math.abs(p.y2 - top) < 0.15 * em && top - p.y1 > 0.5 * em,
    );
    if (!sign || !entry) continue;
    used.add(sign);
    // A sign drawn in strokes (the tick, the stroke down, the stroke up to
    // the rule: OpenStax's √(2·π)): each stroke that ends where the one
    // after it starts is the sign's.
    let x1 = sign.x1;
    let bottom = sign.y1;
    for (let more = true; more; ) {
      more = false;
      for (const p of paths) {
        if (used.has(p) || Math.abs(p.x2 - x1) > 0.05 * em || p.y1 < bottom - 0.05 * em || p.y2 > top) continue;
        used.add(p);
        x1 = p.x1;
        bottom = Math.min(bottom, p.y1);
        more = true;
      }
    }
    out.push({ fam: "oms", code: 0x70, entry, tex: "", cls: "radical", size: em, x1, x2: r.x1, yb: bottom, top, bottom, upright: false });
  }
  return out;
}

/** Horizontal braces KaTeX draws in three pieces: a left, a middle, and a
    right path, abutting, the middle twice as wide and shifted to the side
    its cusp points to (down under what the brace spans). */
export function drawnBraces(paths: Box[], em: number): { left: Box; right: Box; pieces: Box[]; under: boolean }[] {
  const out: { left: Box; right: Box; pieces: Box[]; under: boolean }[] = [];
  const taken = new Set<Box>();
  const flat = paths.filter((p) => p.y2 - p.y1 < 0.6 * em && p.x2 - p.x1 > 0.3 * em).sort((a, b) => a.x1 - b.x1);
  for (const left of flat) {
    if (taken.has(left)) continue;
    // The pieces meet, or overlap by a hair (0.06 em in a line of text).
    const middle = flat.find((m) => !taken.has(m) && m !== left && Math.abs(m.x1 - left.x2) < 0.1 * em);
    const right = middle && flat.find((r) => !taken.has(r) && r !== middle && Math.abs(r.x1 - middle.x2) < 0.1 * em);
    if (!middle || !right || Math.abs(left.y1 - right.y1) > 0.05 * em || Math.abs(left.y2 - right.y2) > 0.05 * em) continue;
    const w = right.x2 - left.x1;
    if (Math.abs(middle.x2 - middle.x1 - w / 2) > 0.1 * w || Math.abs(left.x2 - left.x1 - w / 4) > 0.1 * w) continue;
    const shift = (middle.y1 + middle.y2) / 2 - (left.y1 + left.y2) / 2;
    if (Math.abs(shift) < 0.1 * em) continue;
    for (const q of [left, middle, right]) taken.add(q);
    out.push({ left, right, pieces: [left, middle, right], under: shift < 0 });
  }
  return out;
}

/** KaTeX's pictures, read as the glyphs and rules TeX sets for them (only
    on a page KaTeX set: a figure's strokes are none of these). A radical
    drawn as one path, its sign and its bar (the radicand under the path's
    top edge, the sign's part empty) becomes the radical and the bar the
    layout pairs. A horizontal brace drawn in three pieces (left, middle,
    right, the middle shifted to the side its cusp points to) becomes the
    brace's tips. A tall bar drawn as a thin path becomes a bar piece. */
function katexShapes(atoms: Atom[], paths: Box[], used: Set<Box>): { atoms: Atom[]; rules: Rule[] } {
  const em = maxSize(atoms);
  const out: Atom[] = [];
  const rules: Rule[] = [];
  const free = paths.filter((p) => !used.has(p));
  // Radicals.
  const surd = mathGlyph("oms", 0x70);
  for (const p of free) {
    if (!surd || p.y2 - p.y1 < 0.8 * em || p.x2 - p.x1 < 1.2 * em) continue;
    // An index stands over the sign's part, small and high (\sqrt[3]{…}).
    const index = (a: Atom) => a.size < 0.8 * em && a.yb > (p.y1 + p.y2) / 2 && cx(a) < p.x1 + 0.9 * em;
    const inside = atoms.filter((a) => cx(a) > p.x1 && cx(a) < p.x2 && a.yb > p.y1 && a.top <= p.y2 + 0.05 * em && !index(a));
    if (inside.length === 0) continue;
    const start = Math.min(...inside.map((a) => a.x1));
    const top = Math.max(...inside.map((a) => a.top));
    if (start - p.x1 < 0.5 * em || start - p.x1 > 1.5 * em || p.y2 - top > 0.6 * em || p.y1 > Math.min(...inside.map((a) => a.yb))) continue;
    // The sign's part holds no glyph (an index stands over it, higher up).
    if (atoms.some((a) => !inside.includes(a) && cx(a) > p.x1 && cx(a) < start && a.yb < (p.y1 + p.y2) / 2)) continue;
    used.add(p);
    const thickness = 0.04 * em;
    out.push({ fam: "oms", code: 0x70, entry: surd, tex: "", cls: "radical", size: em, x1: p.x1, x2: start - 0.05 * em, yb: p.y1, top: p.y2, bottom: p.y1, upright: false });
    rules.push({ dir: "h", x1: start - 0.05 * em, x2: p.x2, y1: p.y2 - thickness / 2, y2: p.y2 - thickness / 2, thickness });
  }
  // Braces.
  for (const brace of drawnBraces(free.filter((p) => !used.has(p)), em)) {
    const { left, right, under } = brace;
    const tip = (code: number, x1: number, x2: number): Atom | null => {
      const entry = mathGlyph("omx", code);
      return entry ? { fam: "omx", code, entry, tex: "", cls: "piece", size: em, x1, x2, yb: left.y1, top: left.y2, bottom: left.y1, upright: false } : null;
    };
    const tips = [tip(under ? 0x7c : 0x7a, left.x1, left.x1 + 0.2 * em), tip(under ? 0x7d : 0x7b, right.x2 - 0.2 * em, right.x2)];
    if (tips.some((t) => t === null)) continue;
    for (const q of brace.pieces) used.add(q);
    out.push(...(tips as Atom[]));
  }
  // Tall bars.
  const bar = mathGlyph("omx", 0x0c);
  for (const p of free) {
    if (used.has(p) || !bar || p.x2 - p.x1 > 0.12 * em || p.y2 - p.y1 < 1.1 * em) continue;
    used.add(p);
    out.push({ fam: "omx", code: 0x0c, entry: bar, tex: "|", cls: "ord", size: em, x1: p.x1, x2: p.x2, yb: p.y1, top: p.y2, bottom: p.y1, upright: false });
  }
  return { atoms: out, rules };
}

/** A shape drawn inside the formula that the layout did not read: a
    vertical rule (an array's column line), or a path no rule or radical
    explains (KaTeX draws \vec, \widehat, braces, and tall delimiters as
    pictures; the LaTeX would lack them and still pass the check). */
function unreadShape(atoms: Atom[], rules: Rule[], paths: Box[], used: Set<Box>): boolean {
  if (atoms.length === 0) return false;
  const em = maxSize(atoms);
  const x1 = Math.min(...atoms.map((a) => a.x1));
  const x2 = Math.max(...atoms.map((a) => a.x2));
  const low = Math.min(...atoms.map((a) => a.bottom)) - em;
  const high = Math.max(...atoms.map((a) => a.top)) + em;
  if (rules.some((r) => r.dir === "v" && !read.has(r) && r.x1 > x1 - 0.3 * em && r.x1 < x2 && r.y1 > low && r.y2 < high)) return true;
  // A picture starts at most an em and a half left of the glyphs it covers
  // (a radical's sign), and a clipped one runs past its clip. (The paths
  // that paint rules are left out by the caller.)
  if (paths.some((p) => !used.has(p) && p.x1 > x1 - 1.5 * em && p.x1 < x2 && p.x2 > x1 && p.y1 > low && p.y2 < high)) return true;
  // A delimiter drawn as a picture beside the glyphs: narrow, tall, set
  // close on the left or the right. KaTeX draws a tall bar or bracket so,
  // and a determinant read as its bare matrix (synth-math-html). One on
  // each side holds the formula, whatever their height (a matrix's rows a
  // display lost its top row from); one alone is the formula's when it is
  // about as tall as the formula (the bar of a determinant before "= ad"
  // is none of that formula's).
  const bottom = Math.min(...atoms.map((a) => a.bottom));
  const top = Math.max(...atoms.map((a) => a.top));
  const beside = (p: Box) => !used.has(p) && p.x2 - p.x1 < 0.6 * em && p.y2 - p.y1 > Math.min(1.2 * em, (top - bottom) * 0.8) && p.y1 < top && p.y2 > bottom;
  const left = paths.filter((p) => beside(p) && p.x2 <= x1 + 0.1 * em && p.x2 > x1 - 0.6 * em);
  const right = paths.filter((p) => beside(p) && p.x1 >= x2 - 0.1 * em && p.x1 < x2 + 0.6 * em);
  return (left.length > 0 && right.length > 0) || [...left, ...right].some((p) => p.y2 - p.y1 < top - bottom + em);
}

/** Frames among a formula's rules (\boxed, a framed box): a rule down each
    side and one over and under, meeting at the corners. tol is how far
    apart the ends may stand. */
export function framesOf(rules: Rule[], tol: number): { left: Rule; right: Rule; top: Rule; bottom: Rule }[] {
  const vr = rules.filter((r) => r.dir === "v").sort((a, b) => a.x1 - b.x1);
  const hr = rules.filter((r) => r.dir === "h");
  const out: { left: Rule; right: Rule; top: Rule; bottom: Rule }[] = [];
  const taken = new Set<Rule>();
  for (const left of vr) {
    if (taken.has(left)) continue;
    const right = vr.find((r) => r !== left && !taken.has(r) && r.x1 - left.x1 > 2 * tol && Math.abs(r.y1 - left.y1) < tol && Math.abs(r.y2 - left.y2) < tol);
    if (!right) continue;
    const across = (y: number) =>
      hr.find((r) => !taken.has(r) && Math.abs(r.y1 - y) < tol && r.x1 < left.x1 + tol && r.x2 > right.x1 - tol && r.x2 - r.x1 < right.x1 - left.x1 + 4 * tol);
    const top = across(Math.max(left.y1, left.y2));
    const bottom = across(Math.min(left.y1, left.y2));
    if (!top || !bottom || top === bottom) continue;
    for (const r of [left, right, top, bottom]) taken.add(r);
    out.push({ left, right, top, bottom });
  }
  return out;
}

/** A frame around atoms of the formula (\boxed): the atoms inside are laid
    out alone, with the rules inside, into one \boxed node; its four rules
    are read (parse loop finding: the probability cheatsheet boxes each
    worked answer, "= \boxed{n\sum_{j=1}^{n}\frac{1}{j}}", and the frame's
    rules, unread, failed its displays to crops). */
function framed(atoms: Atom[], rules: Rule[]): Atom[] {
  if (atoms.length === 0) return atoms;
  const em = maxSize(atoms);
  let out = atoms;
  for (const f of framesOf(rules.filter((r) => !read.has(r)), 0.15 * em)) {
    const x1 = f.left.x1;
    const x2 = f.right.x1;
    const y1 = Math.min(f.left.y1, f.left.y2);
    const y2 = Math.max(f.left.y1, f.left.y2);
    const inside = out.filter((a) => cx(a) > x1 && cx(a) < x2 && a.yb > y1 && a.yb < y2);
    if (inside.length === 0) continue;
    const frame = [f.left, f.right, f.top, f.bottom];
    const inner = rules.filter((r) => !frame.includes(r) && !read.has(r) && r.dir === "h" && r.x1 > x1 && r.x2 < x2 && r.y1 > y1 && r.y1 < y2);
    for (const r of frame) read.add(r);
    const built = structure(inside, inner, 1);
    out = [...out.filter((a) => !inside.includes(a)), node(inside, `\\boxed{${linear(built)}}`, mainBaseline(built), maxSize(inside), { x1, x2, top: y2, bottom: y1 })];
  }
  return out;
}

/** A formula's LaTeX from its glyphs and the shapes drawn with them (rules,
    and paths), the atoms the check compares against (pieces joined,
    composites fused), and the paths it read. */
export function formulaToLatex(
  glyphs: Glyph[],
  rules: Rule[],
  opts: { display: boolean; size: number },
  paths: Box[] = [],
): { latex: string; atoms: Atom[]; unknown: Glyph[]; used: Set<Box> } {
  style = opts;
  lost = 0;
  read = new Set();
  displayDepth = opts.display ? 1 : 0;
  const { atoms, unknown } = atomsOf(glyphs);
  const used = new Set<Box>();
  const radicals = drawnRadicals(atoms, rules, paths, used);
  const drawn = glyphs.some((g) => g.base.startsWith("KaTeX_")) ? katexShapes(atoms, paths, used) : { atoms: [], rules: [] };
  const all = [...rules, ...drawn.rules];
  // Arrow runs before composites: a minus and an arrowhead inside a long
  // arrow would otherwise fuse into \longrightarrow.
  const fused = fuseComposites(arrowRuns(assemblePieces([...atoms, ...radicals, ...drawn.atoms], all)));
  const copies = ruledArray(
    framed(
      fused.map((a) => ({ ...a })),
      all,
    ),
    all,
  );
  const bars = all.filter((r) => r.dir === "h");
  const latex = linear(
    structure(
      copies,
      bars.filter((r) => !read.has(r)),
    ),
  );
  if (bars.some((r) => !read.has(r))) lost++;
  if (unreadShape(fused, all, paths, used)) lost++;
  return { latex: lost > 0 ? "" : latex, atoms: fused, unknown, used };
}

/** A glyph set in TeX's extension font (a big operator, a sized
    delimiter), in esint's (an integral), or a radical sign: it hangs from
    its origin by the depth the font's metrics give — its top and bottom,
    and whether it is a display operator (limits over and under it). null
    for any other glyph. */
export function hangingGlyph(g: Glyph): { top: number; bottom: number; display: boolean } | null {
  const entry = g.family !== null && (hangingFamily(g.family) || g.family === "oms") ? mathGlyph(g.family, g.code) : null;
  if (!entry || (g.family === "oms" && entry.cls !== "radical")) return null;
  const [height, depth] = g.box ?? entry.box;
  return { top: g.y + height * g.size, bottom: g.y - depth * g.size, display: Boolean(entry.display) };
}

/** An item of hanging glyphs only (hangingGlyph): a line takes it by its
    box, the top and bottom of its glyphs. null for any other item. */
export function hangingBox(item: Item): { top: number; bottom: number; display: boolean } | null {
  const glyphs = item.glyphs ?? [];
  if (glyphs.length === 0) return null;
  let top = -Infinity;
  let bottom = Infinity;
  let display = false;
  for (const g of glyphs) {
    const box = hangingGlyph(g);
    if (!box) return null;
    top = Math.max(top, box.top);
    bottom = Math.min(bottom, box.bottom);
    display ||= box.display;
  }
  return { top, bottom, display };
}
