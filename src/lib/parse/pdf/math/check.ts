// The glyph check (research memo §1.9): a formula's LaTeX must draw exactly
// the symbols its glyphs are, each at the script level its size says —
// nothing lost, nothing added, nothing raised or lowered by a level. Both
// sides come from KaTeX: the whole formula, and each glyph's own LaTeX
// alone. Measured on formulas with known LaTeX: 94% of the formulas it
// passes are right; it passes 90% of the right ones.

import katex from "katex";
import type { Glyph, Rule } from "@/lib/parse/pdf/drawing";
import { formulaToLatex, hangingFamily, type Atom } from "@/lib/parse/pdf/math/layout";
import type { Box } from "@/lib/parse/pdf/types";
import { KATEX_MACROS } from "@/lib/katex";

export type MathCheck = { ok: boolean; missing: string[]; extra: string[] };

const INVISIBLE_RE = /[\s​⁡-⁤]/g;
const ENTITY: Record<string, string> = { "&lt;": "<", "&gt;": ">", "&amp;": "&", "&#x27;": "'", "&quot;": '"' };
const cache = new Map<string, string[] | null>();

// Each character KaTeX draws, as "char@level": 0 text size, 1 script, 2
// scriptscript (KaTeX's sizing classes: size6 and up, size3–5, size1–2).
// Drawn shapes (a radical sign, a fraction bar, a wide accent) are no
// characters. null: KaTeX cannot read the LaTeX.
function symbolLevels(tex: string, display: boolean): string[] | null {
  const key = `${display ? "D" : "I"}${tex}`;
  if (cache.has(key)) return cache.get(key)!;
  let html: string | null = null;
  try {
    html = katex.renderToString(tex, { output: "html", throwOnError: true, displayMode: display, strict: "ignore", macros: { ...KATEX_MACROS } });
  } catch {
    html = null;
  }
  let out: string[] | null = null;
  if (html !== null) {
    out = [];
    // Each open span: the level inside it, and whether it draws a sized
    // delimiter (skipped: KaTeX draws a tall one as pieces or a picture, and
    // the glyph side skips the extension font's delimiters too).
    const stack: { level: number; delim: boolean }[] = [{ level: 0, delim: false }];
    for (const tok of html.matchAll(/<span([^>]*)>|<\/span>|<svg[\s\S]*?<\/svg>|([^<]+)/g)) {
      if (tok[0].startsWith("<svg")) continue;
      if (tok[0] === "</span>") {
        stack.pop();
        continue;
      }
      const top = stack[stack.length - 1];
      if (tok[1] !== undefined) {
        const m = /sizing reset-size\d+ size(\d+)/.exec(tok[1]);
        stack.push({
          level: m ? (Number(m[1]) >= 5 ? 0 : Number(m[1]) >= 3 ? 1 : 2) : top.level,
          delim: top.delim || /class="[^"]*\b(delimsizing|delimcenter)\b/.test(tok[1]),
        });
        continue;
      }
      if (top.delim) continue;
      const text = (tok[2] ?? "").replace(/&(?:lt|gt|amp|#x27|quot);/g, (e) => ENTITY[e]).normalize("NFKC").replace(INVISIBLE_RE, "");
      // ħ (\hbar) counts as its h and its bar: a page that sets \hbar as a
      // macron over an h (mathpazo) draws those two glyphs (layout.ts
      // accents).
      for (const ch of text) {
        if (ch === "ħ") out.push(`h@${top.level}`, `ˉ@${top.level}`);
        else out.push(`${ch}@${top.level}`);
      }
    }
  }
  if (cache.size > 20000) cache.clear();
  cache.set(key, out);
  return out;
}

function counts(list: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const x of list) m.set(x, (m.get(x) ?? 0) + 1);
  return m;
}

/** The check: the formula's symbols against its atoms'. size is the size
    of the text the formula sits in: an atom that much smaller is a script. */
function checkLatex(latex: string, atoms: Atom[], unknown: Glyph[], display: boolean, size: number): MathCheck {
  const got = symbolLevels(latex, display);
  const missing = unknown.map((g) => `${g.unicode || `#${g.code}`}@?`);
  if (got === null) return { ok: false, missing: [...missing, "(no parse)"], extra: [] };
  const want: string[] = [];
  // Of two script sizes the larger is a script's and the smaller its own
  // script's, whatever their share of the text's: IEEE Access sets 10, 7.6,
  // and 6 points, and its 6 read as a script's.
  const scripts = atoms.filter((a) => a.tex && !hangingFamily(a.fam) && a.size < size * 0.85).map((a) => a.size);
  // A word in a text font keeps its size in a script (\mbox{odd} under a
  // ∑): it stands at the level of the script's glyph on its baseline
  // beside it.
  const besideOf = new Map<Atom, Atom>();
  const letters = atoms.filter((a) => (a.italic || a.upright) && a.size >= size * 0.85).sort((p, q) => p.x1 - q.x1);
  for (let i = 0; i < letters.length; ) {
    let j = i + 1;
    while (j < letters.length && Math.abs(letters[j].yb - letters[i].yb) < 0.05 * size && letters[j].x1 - letters[j - 1].x2 < 0.15 * size) j++;
    const word = letters.slice(i, j);
    const x1 = word[0].x1;
    const x2 = word[word.length - 1].x2;
    // (A letter or a digit in a script's size: a prime in a subscript
    // stands near the baseline too.)
    const small = atoms.find(
      (c) =>
        /^(\\math\w+\{)?[A-Za-z0-9]\}?$/.test(c.tex) &&
        c.size < size * 0.85 &&
        c.size >= size * 0.6 &&
        Math.abs(c.yb - word[0].yb) < 0.05 * size &&
        c.x1 - x2 < 0.6 * size &&
        x1 - c.x2 < 0.6 * size,
    );
    if (small && word.length > 1) for (const w of word) besideOf.set(w, small);
    i = j;
  }
  const script = Math.max(0, ...scripts);
  const two = scripts.some((s) => s < script * 0.9);
  for (const a of atoms) {
    if (!a.tex || a.cls === "piece" || a.cls === "radical") continue;
    // (A tall bar is a sized delimiter too: \Big|.)
    if (a.fam === "omx" && (a.cls === "open" || a.cls === "close" || (/^(\||\\\|)$/.test(a.tex) && a.top - a.bottom > 1.1 * size))) continue;
    const beside = besideOf.get(a);
    const r = (beside ?? a).size / size;
    // An extension font's glyph stands at the text's level whatever its
    // font's size; one set in a script's size is a script's (the ∑ of an
    // exponent Σd_j/2, arXiv 2506.08494 p. 5).
    const level = (hangingFamily(a.fam) && r >= 0.75) || r >= 0.85 ? 0 : two ? ((beside ?? a).size >= script * 0.95 ? 1 : 2) : r >= 0.6 ? 1 : 2;
    const own = symbolLevels(a.cls === "accent" ? `${a.tex}{}` : a.tex, display) ?? [];
    for (const x of own) {
      const at = x.lastIndexOf("@");
      want.push(`${x.slice(0, at)}@${Math.min(2, level + Number(x.slice(at + 1)))}`);
    }
  }
  // MathJax sets no script under its minimum size, 0.8 of the text's
  // (OpenStax's e^{…(…)^2}): where no glyph is under three quarters of the
  // text's size, a script's own script stands at the script's size, and the
  // check takes the two levels as one.
  const counted = atoms.filter((a) => a.tex && a.cls !== "piece" && a.cls !== "radical" && !(a.fam === "omx" && (a.cls === "open" || a.cls === "close")));
  // TeX's fonts stop at 5 points: a formula set at 7 points sets its
  // scripts and their own scripts at 5 (the probability cheatsheet's
  // e^{-x^{2}/2}), so where every script glyph is at that floor the check
  // takes the two levels as one too.
  const smalls = counted.filter((a) => !hangingFamily(a.fam) && a.size < size * 0.85).map((a) => a.size);
  const floor = smalls.length > 0 && smalls.every((s) => s >= 4.5 && s <= 5.3);
  const clamped = counted.length > 0 && (counted.every((a) => a.size / size >= 0.75) || floor);
  // A bracket takes the size of what it holds, not of its level: a limit's
  // terms at a script's size stand in parentheses at the text's (IEEE
  // Access p. 9). Brackets count at any level.
  const merge = (list: string[]) => list.map((x) => (/^[()[\]]@/.test(x) ? `${x[0]}@*` : clamped ? x.replace(/@2$/, "@1") : x));
  const g = counts(merge(got));
  const w = counts(merge(want));
  const extra: string[] = [];
  for (const k of new Set([...g.keys(), ...w.keys()])) {
    const d = (g.get(k) ?? 0) - (w.get(k) ?? 0);
    for (let i = 0; i < Math.abs(d); i++) (d > 0 ? extra : missing).push(k);
  }
  return { ok: missing.length === 0 && extra.length === 0, missing, extra };
}

// ── The structure check ─────────────────────────────────────────────────────
// The glyph check counts symbols; the structure check places them. Every
// symbol of the LaTeX goes where KaTeX draws it (read from the boxes of its
// HTML tree: its fonts' metrics, no browser), and every glyph where the page
// draws it; the two sides are mapped onto each other by the symbols each
// has once, and every symbol must then stand on its glyph's row. A formula
// built wrong with every symbol present fails here: the fractions of two
// case rows that interleave (arXiv 2502.02648 (A2)).

// A symbol at its center, on its baseline (a big operator: at its middle,
// as it hangs on the math axis), and its size against the formula's.
type Placed = { ch: string; x: number; y: number; scale: number };
type TreeNode = {
  classes?: string[];
  children?: TreeNode[];
  style?: Record<string, string | undefined>;
  text?: string;
  width?: number;
  italic?: number;
  height?: number;
  depth?: number;
};

// How far up or down, in ems of the text, a symbol may stand from its
// glyph: TeX's and KaTeX's rows agree to a tenth or two; another row stands
// a line away.
const ROW_OFF = 0.7;
// KaTeX's font sizes (size1 … size11) against the text's (size6).
const SIZES = [0, 0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.2, 1.44, 1.728, 2.074, 2.488];
const ems = (v: string | undefined) => (v !== undefined && v.endsWith("em") ? parseFloat(v) : 0);
const hasClass = (n: TreeNode, c: string) => n.classes?.includes(c) ?? false;
const placedCache = new Map<string, Placed[] | null>();

function sizedScale(n: TreeNode, scale: number): number {
  if (!hasClass(n, "katex-sizing") && !hasClass(n, "fontsize-ensurer")) return scale;
  let from = 6;
  let to = 6;
  for (const c of n.classes ?? []) {
    const reset = /^reset-size(\d+)$/.exec(c);
    if (reset) from = Number(reset[1]);
    const size = /^size(\d+)$/.exec(c);
    if (size) to = Number(size[1]);
  }
  return (scale * (SIZES[to] ?? 1)) / (SIZES[from] ?? 1);
}

type Flow = { scale: number; out: Placed[] | null; align: "l" | "c" | "r"; op: boolean };

// Lays a node out from x on the baseline y (ems of the text, y up) and
// returns its width. flow.out takes each symbol drawn (none when null: a
// measure); a tall delimiter is measured only (KaTeX draws it in pieces,
// and the glyph check skips it too). flow.align: how a stack inside sets
// its rows.
function lay(n: TreeNode, x: number, y: number, flow: Flow): number {
  const st = n.style ?? {};
  const { scale } = flow;
  if (n.text !== undefined) {
    const left = ems(st.marginLeft) * scale;
    const width = (n.width ?? 0) * scale;
    const middle = flow.op || hasClass(n, "op-symbol") ? (((n.height ?? 0) - (n.depth ?? 0)) / 2) * scale : 0;
    // KaTeX sets a word (an operator's name, a \text) as one node: its
    // letters share its width.
    // (ħ is its h and its bar at one place, as symbolLevels counts it.)
    const chars = [...n.text].flatMap((ch) => (ch === "ħ" || ch === "ℏ" ? ["h", "ˉ"] : [ch]));
    if (flow.out) chars.forEach((ch, k) => ch.trim() !== "" && flow.out!.push({ ch, x: x + left + ((k + 0.5) * width) / chars.length, y: y - ems(st.top) * scale + middle, scale }));
    return left + width + (Math.max(0, n.italic ?? 0) + ems(st.marginRight)) * scale;
  }
  if (hasClass(n, "katex-tag") || hasClass(n, "katex-mathml")) return 0;
  const s = sizedScale(n, scale);
  const root = hasClass(n, "katex-root");
  const pad = hasClass(n, "x-arrow-pad") ? 0.5 * s : 0;
  const ml = (root ? 0.2778 : ems(st.marginLeft)) * s;
  const mr = (root ? -0.5556 : ems(st.marginRight)) * s;
  const pl = ems(st.paddingLeft) * s + pad;
  // A relative shift: top moves the box down, left moves it right.
  const yy = y - ems(st.top) * s;
  const from = x + ml + pl + ems(st.left) * s;
  // A stack centers its rows under a fraction, a big operator's limits, an
  // accent, a brace, an arrow, and in an array's centered column.
  const align: "l" | "c" | "r" =
    hasClass(n, "mfrac") || hasClass(n, "op-limits") || hasClass(n, "katex-accent") || hasClass(n, "x-arrow") || hasClass(n, "mover") || hasClass(n, "munder") || hasClass(n, "col-align-c")
      ? "c"
      : hasClass(n, "col-align-r")
        ? "r"
        : hasClass(n, "col-align-l") || hasClass(n, "msupsub")
          ? "l"
          : flow.align;
  const inner: Flow = {
    scale: s,
    out: hasClass(n, "delimsizing") || hasClass(n, "delimcenter") ? null : flow.out,
    align,
    op: flow.op || hasClass(n, "op-symbol"),
  };
  let width: number;
  if (hasClass(n, "vlist-t")) width = layStack(n, from, yy, { ...inner, align: flow.align });
  else {
    let cx = from;
    for (const c of n.children ?? []) cx += lay(c, cx, yy, inner);
    width = cx - from;
  }
  // An accent's body takes no width: the accent overhangs from its place.
  if (hasClass(n, "accent-body") && !hasClass(n, "accent-full")) width = 0;
  if (hasClass(n, "nulldelimiter")) width = Math.max(width, 0.12 * s);
  width = Math.max(width, ems(st.width) * s, ems(st.minWidth) * s);
  return ml + pl + width + pad + mr;
}

// A stack (KaTeX's vlist): each row a box raised by its top and strut, all
// from one left edge, centered or set right as flow.align says.
function layStack(n: TreeNode, x: number, y: number, flow: Flow): number {
  const list = (n.children ?? []).find((c) => hasClass(c, "vlist-r"))?.children?.find((c) => hasClass(c, "vlist"));
  if (!list) return 0;
  const { scale } = flow;
  const rows = (list.children ?? []).map((w) => {
    const kids = w.children ?? [];
    const strut = kids.find((k) => hasClass(k, "pstrut"));
    const items = kids.filter((k) => k !== strut);
    const ml = ems(w.style?.marginLeft) * scale;
    const mr = ems(w.style?.marginRight) * scale;
    let width = 0;
    for (const k of items) width += lay(k, 0, 0, { ...flow, out: null });
    return { items, rise: -(ems(w.style?.top) + ems(strut?.style?.height)) * scale, ml, width: ml + width + mr };
  });
  const total = Math.max(0, ...rows.map((r) => r.width));
  for (const r of rows) {
    let cx = x + r.ml + (flow.align === "c" ? (total - r.width) / 2 : flow.align === "r" ? total - r.width : 0);
    for (const k of r.items) cx += lay(k, cx, y + r.rise, flow);
  }
  return total;
}

/** Each symbol KaTeX draws for the LaTeX; null when KaTeX cannot read it. */
function placedSymbols(tex: string, display: boolean): Placed[] | null {
  const key = `${display ? "D" : "I"}${tex}`;
  if (placedCache.has(key)) return placedCache.get(key)!;
  let out: Placed[] | null = null;
  try {
    const tree = (katex as unknown as { __renderToHTMLTree: (t: string, o: object) => TreeNode }).__renderToHTMLTree(tex, {
      displayMode: display,
      throwOnError: true,
      strict: "ignore",
      macros: { ...KATEX_MACROS },
    });
    const all: Placed[] = [];
    lay(tree, 0, 0, { scale: 1, out: all, align: "l", op: false });
    out = all.map((p) => ({ ...p, ch: p.ch.normalize("NFKC").replace(INVISIBLE_RE, "") })).filter((p) => p.ch !== "");
  } catch {
    out = null;
  }
  if (placedCache.size > 20000) placedCache.clear();
  placedCache.set(key, out);
  return out;
}

// x = s·x' + t through points (x', x); null with fewer than two apart.
function fitLine(pairs: [number, number][], spread: number): { s: number; t: number } | null {
  if (pairs.length < 2) return null;
  const n = pairs.length;
  const mx = pairs.reduce((a, [u]) => a + u, 0) / n;
  const my = pairs.reduce((a, [, v]) => a + v, 0) / n;
  const vx = pairs.reduce((a, [u]) => a + (u - mx) ** 2, 0);
  if (Math.sqrt(vx / n) < spread) return null;
  const s = pairs.reduce((a, [u, v]) => a + (u - mx) * (v - my), 0) / vx;
  return { s, t: my - s * mx };
}

/** Each symbol of the LaTeX against its glyph: how far right (dx) and up
    (dy), in ems of the formula, KaTeX draws it from where the page does,
    once the two are mapped onto each other. Each glyph is matched to a
    symbol of its character on its row; one no symbol can take stands off
    its row (dy Infinity when every symbol of its character is on a row
    another glyph took). */
export function misplaced(latex: string, atoms: Atom[], display: boolean, size: number): { ch: string; dx: number; dy: number }[] {
  const drawn = placedSymbols(latex, display);
  if (!drawn) return [];
  const glyphs: (Placed & { size: number })[] = [];
  for (const a of atoms) {
    // A sized bar (\big| from the extension font's pieces) is a sized
    // delimiter too: KaTeX draws it as pieces, which the tree walk leaves
    // out, so the bar's glyph had no symbol to stand on (parse loop
    // finding: a quantum mechanics book's ⟨r⃗| R̂ \big| r⃗′⟩ failed on its
    // bar's row). So is a sized slash (\Big/): its origin is its top, no
    // baseline (parse loop finding: a statistics book's (11.69) failed on
    // the row of its two \Big/).
    if (!a.tex || a.cls === "piece" || a.cls === "radical" || (a.fam === "omx" && (a.cls === "open" || a.cls === "close" || a.tex === "|" || a.tex === "\\|" || a.entry?.size !== undefined))) continue;
    const own = placedSymbols(a.cls === "accent" ? `${a.tex}{}` : a.tex, display) ?? [];
    // A node of several symbols (a long arrow's label) is placed as a
    // whole: its symbols stay out of the comparison.
    if (own.length !== 1) continue;
    const hangs = hangingFamily(a.fam) && a.cls === "op";
    glyphs.push({ ch: own[0].ch, x: (a.x1 + a.x2) / 2, y: hangs ? (a.top + a.bottom) / 2 : a.yb, scale: 1, size: a.size });
  }
  const chars = [...new Set(glyphs.map((p) => p.ch))];
  const mine = drawn.filter((p) => chars.includes(p.ch));
  if (glyphs.length < 2 || mine.length < 2) return [];
  const once = chars.filter((c) => glyphs.filter((p) => p.ch === c).length === 1 && mine.filter((p) => p.ch === c).length === 1);
  // The formula's em on the page: a glyph's size over the size KaTeX sets
  // its symbol at (KaTeX sets math a fifth larger than its text).
  const ems = once.map((c) => glyphs.find((p) => p.ch === c)!.size / mine.find((p) => p.ch === c)!.scale).sort((a, b) => a - b);
  const em = ems.length > 0 ? ems[Math.floor(ems.length / 2)] : size;
  const page: Placed[] = glyphs.map((g) => ({ ...g, x: g.x / em, y: g.y / em }));
  // The map: fitted through the symbols each side has once; where they
  // are too few or too close, the two sides' extents and most common rows.
  const pin = (k: "x" | "y") => once.map((c): [number, number] => [mine.find((p) => p.ch === c)![k], page.find((p) => p.ch === c)![k]]);
  const extent = (k: "x" | "y") => {
    const [p1, p2] = [Math.min(...page.map((p) => p[k])), Math.max(...page.map((p) => p[k]))];
    const [r1, r2] = [Math.min(...mine.map((p) => p[k])), Math.max(...mine.map((p) => p[k]))];
    const s = r2 - r1 > 0.8 && p2 - p1 > 0.8 ? (p2 - p1) / (r2 - r1) : 1;
    return { s, t: p1 - s * r1 };
  };
  const within = (f: { s: number; t: number } | null) => (f && f.s > 0.6 && f.s < 1.7 ? f : null);
  // Too few pins to fit a scale: the extents' scale, and the pins' median
  // offset (with none, the rows' most common baselines on each other).
  const fallback = (k: "x" | "y") => {
    const e = extent(k);
    const pins = pin(k);
    if (pins.length > 0) {
      const offsets = pins.map(([u, v]) => v - e.s * u).sort((a, b) => a - b);
      return { s: e.s, t: offsets[Math.floor(offsets.length / 2)] };
    }
    if (e.s !== 1 || k === "x") return e;
    const mode = (list: number[]) => {
      const n = new Map<number, number>();
      for (const v of list) n.set(Math.round(v * 10), (n.get(Math.round(v * 10)) ?? 0) + 1);
      return ([...n].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? 0) / 10;
    };
    return { s: 1, t: mode(page.map((p) => p.y)) - mode(mine.map((p) => p.y)) };
  };
  const fx = within(fitLine(pin("x"), 0.5)) ?? fallback("x");
  const fy = within(fitLine(pin("y"), 0.4)) ?? fallback("y");
  const out: { ch: string; dx: number; dy: number }[] = [];
  for (const ch of chars) {
    const want = page.filter((p) => p.ch === ch);
    const got = mine.filter((p) => p.ch === ch).map((p) => ({ x: fx.s * p.x + fx.t, y: fy.s * p.y + fy.t }));
    // Each glyph takes a symbol on its row (a display's rows may stand
    // apart across, gathered where the page aligns them, and KaTeX's
    // spacing drifts along a long row): a matching of the two sides, each
    // glyph's nearest symbols first. A glyph no symbol can take stands off
    // its row.
    const near = want.map((w) =>
      got
        .map((g, j) => ({ j, dx: g.x - w.x, dy: g.y - w.y }))
        .filter((e) => Math.abs(e.dy) <= ROW_OFF)
        .sort((a, b) => Math.abs(a.dy) + Math.abs(a.dx) / 3 - (Math.abs(b.dy) + Math.abs(b.dx) / 3)),
    );
    const holder = new Array<number>(got.length).fill(-1);
    const take = (i: number, seen: boolean[]): boolean => {
      for (const e of near[i]) {
        if (seen[e.j]) continue;
        seen[e.j] = true;
        if (holder[e.j] < 0 || take(holder[e.j], seen)) {
          holder[e.j] = i;
          return true;
        }
      }
      return false;
    };
    want.forEach((_, i) => take(i, new Array<boolean>(got.length).fill(false)));
    const taken = new Set(holder.filter((i) => i >= 0));
    holder.forEach((i, j) => {
      if (i >= 0) out.push({ ch, dx: got[j].x - want[i].x, dy: got[j].y - want[i].y });
    });
    want.forEach((w, i) => {
      if (taken.has(i) || got.length === 0) return;
      const best = got.reduce((b, g) => (Math.abs(g.y - w.y) < Math.abs(b.y - w.y) ? g : b));
      out.push({ ch, dx: best.x - w.x, dy: Math.abs(best.y - w.y) > ROW_OFF ? best.y - w.y : Infinity });
    });
  }
  return out;
}

/** A formula's LaTeX from its glyphs and shapes (rules, and the page's
    paths around it), the check of it against them, and the paths it read.
    display and size say how it is set: in a display or in a line of text of
    that size. */
export function layoutLatex(
  glyphs: Glyph[],
  rules: Rule[],
  opts: { display: boolean; size: number },
  paths: Box[] = [],
): { latex: string; check: MathCheck; atoms: Atom[]; used: Set<Box> } {
  const { latex, atoms, unknown, used } = formulaToLatex(glyphs, rules, opts, paths);
  const check = latex ? checkLatex(latex, atoms, unknown, opts.display, opts.size) : { ok: false, missing: ["(no layout)"], extra: [] };
  if (check.ok) {
    // A symbol KaTeX draws more than half a line (0.7 em) up or down from
    // its glyph stands in another row: the formula fails.
    const off = misplaced(latex, atoms, opts.display, opts.size).filter((m) => Math.abs(m.dy) > ROW_OFF);
    if (off.length > 0) return { latex, check: { ok: false, missing: off.map((m) => `${m.ch}@row`), extra: [] }, atoms, used };
  }
  return { latex, check, atoms, used };
}
