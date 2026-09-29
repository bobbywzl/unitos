// One formula's glyphs and rules to LaTeX (research memo §1.8). The order:
// each glyph's entry in the TeX font tables, extensible pieces joined,
// composite symbols fused, braces and arrows over content, rules (radicals,
// fractions, overlines), accents, fenced groups (matrices, binomials,
// cases), aligned rows, big operators' limits, scripts, tokens. Geometry in
// PDF points, y up; an em is a glyph's size.

import type { Glyph, Rule } from "@/lib/parse/pdf/drawing";
import { isBoldFont, isItalicFont, isTextMath, isUnreadMath, type MathFamily } from "@/lib/parse/pdf/glyphs";
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
  fracPart?: number; // a fraction outside any other structure: its parts' size
};

const OPNAMES = new Set([
  "lim", "limsup", "liminf", "sup", "inf", "max", "min", "sin", "cos", "tan", "cot", "sec", "csc", "sinh", "cosh",
  "tanh", "coth", "log", "ln", "lg", "exp", "det", "dim", "ker", "deg", "gcd", "hom", "arg", "Pr", "arcsin",
  "arccos", "arctan",
]);
export const LIMIT_OPS = new Set(["lim", "limsup", "liminf", "sup", "inf", "max", "min", "det", "gcd", "Pr"]);
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
const FENCE_ENV: Record<string, string> = { "(": "pmatrix", "[": "bmatrix", "\\{": "Bmatrix", "|": "vmatrix", "\\|": "Vmatrix" };

// The formula being read: display or inline, and the size of the text it
// sits in (a fraction's parts that much smaller are a text-style fraction).
let style = { display: true, size: 10 };

const cx = (a: { x1: number; x2: number }) => (a.x1 + a.x2) / 2;
const overlapX = (a: { x1: number; x2: number }, b: { x1: number; x2: number }) => Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1);
const byX = (a: Atom, b: Atom) => a.x1 - b.x1;
const maxSize = (atoms: Atom[]) => Math.max(...atoms.map((a) => a.size), 1);
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
function atomsOf(glyphs: Glyph[]): { atoms: Atom[]; unknown: Glyph[] } {
  const atoms: Atom[] = [];
  const unknown: Glyph[] = [];
  for (const g of glyphs) {
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
const TEXT_CHAR_RE = /^[A-Za-z0-9,.;:()[\]=+−–·!/<>]$/;
const CM_NAME_RE = /cm(r|mi|mib|sy|bsy|ex|bx|ti|ss|tt|sl)\d/i;

function textAtom(g: Glyph): Atom | null {
  const ch = g.unicode;
  // A math font's glyph no table reads (MathTime's big parenthesis) is no
  // text: read as a small one, it made a row of its own over its formula.
  if (!TEXT_CHAR_RE.test(ch) || CM_NAME_RE.test(g.base) || isUnreadMath(g)) return null;
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
  return {
    fam: null,
    code: g.code,
    entry: null,
    // KaTeX draws "-" in a formula as the minus sign.
    tex: bold ? `\\${italic ? "boldsymbol" : "mathbf"}{${ch}}` : ch === "−" || ch === "–" ? "-" : ch === "·" ? "\\cdot" : ch,
    cls,
    size: g.size,
    x1: g.x,
    x2: g.x + Math.max(g.w, 0),
    yb: g.y,
    top: g.y + height * g.size,
    bottom: g.y - depth * g.size,
    upright: /[A-Za-z]/.test(ch) && !italic && !bold,
    // PLOS sets every formula's letters in Minion's italic ("dP_k/dt"):
    // those are math letters (isTextMath), not words.
    italic: /[A-Za-z]/.test(ch) && italic && !bold && !isTextMath(g),
  };
}

// ── Pieces: extensible delimiters, multiple integrals ──────────────────────

const PIECE_DELIM: Record<string, string> = { lparen: "(", rparen: ")", lbrack: "[", rbrack: "]", lbrace: "\\{", rbrace: "\\}" };

function assemblePieces(atoms: Atom[]): Atom[] {
  const pieces = atoms.filter((a) => a.fam === "omx" && (/^(l|r)(paren|brack|brace)-|^brace-rep$/.test(a.entry?.piece ?? "") || isPiece(a, "vrep")));
  const rest = atoms.filter((a) => !pieces.includes(a));
  const columns: Atom[][] = [];
  for (const p of pieces.sort(byX)) {
    const col = columns.find((c) => Math.abs(c[0].x1 - p.x1) < 0.15 * p.size && isPiece(c[0], "vrep") === isPiece(p, "vrep"));
    if (col) col.push(p);
    else columns.push([p]);
  }
  const fences: Atom[] = [];
  for (const col of columns) {
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
  const bars = fences.filter((a) => a.cls === "bar").sort(byX);
  for (const tex of ["|", "\\|"]) {
    const kind = bars.filter((b) => b.tex === tex);
    for (let i = 0; i + 1 < kind.length; i += 2) {
      kind[i].cls = "open";
      kind[i + 1].cls = "close";
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
      // stacked (\vdots) or on a diagonal (\ddots).
      if (a.tex === "." || a.tex === "\\cdot") {
        const next = (p: Atom, dx: [number, number], dy: [number, number]) =>
          out.find((b) => b !== p && b.tex === a.tex && b.x1 - p.x1 >= dx[0] * em && b.x1 - p.x1 <= dx[1] * em && p.yb - b.yb >= dy[0] * em && p.yb - b.yb <= dy[1] * em);
        const shapes: [string, [number, number], [number, number]][] = [
          [a.tex === "." ? "\\ldots" : "\\cdots", [0.2, 0.6], [-0.03, 0.03]],
          ["\\vdots", [-0.05, 0.05], [0.3, 0.5]],
          ["\\ddots", [0.3, 0.5], [0.2, 0.4]],
        ];
        for (const [tex, dx, dy] of shapes) {
          if (tex !== "\\ldots" && tex !== "\\cdots" && a.fam !== "ot1") continue;
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
function arrowRuns(atoms: Atom[]): Atom[] {
  const out = [...atoms];
  const shafts = out.filter((a) => a.tex === "-" && a.fam === "oms");
  for (const head of out.filter((a) => a.tex === "\\rightarrow" || a.tex === "\\leftarrow")) {
    const em = head.size;
    const right = head.tex === "\\rightarrow";
    const run: Atom[] = [head];
    for (;;) {
      const edge = run[run.length - 1];
      const next = shafts.find(
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
    const label = out.filter((b) => inside(b) && b.bottom >= head.yb && b.yb > head.yb + 0.1 * em && b.size < em * 0.9);
    const labelBelow = out.filter((b) => inside(b) && b.top <= head.yb && b.yb < head.yb - 0.1 * em && b.size < em * 0.9);
    let made: Atom;
    if (under.length > 0 && label.length === 0) {
      const body = linear(under.map((b) => ({ ...b })));
      made = node([...run, ...under], `\\over${right ? "right" : "left"}arrow{${body}}`, under[0].yb, under[0].size);
      for (const b of under) out.splice(out.indexOf(b), 1);
    } else if (label.length > 0 || labelBelow.length > 0 || run.length > 2) {
      const above = label.length ? linear(label.map((b) => ({ ...b }))) : "";
      const below = labelBelow.length ? `[${linear(labelBelow.map((b) => ({ ...b })))}]` : "";
      made = node([...run, ...label, ...labelBelow], `\\x${right ? "right" : "left"}arrow${below}{${above}}`, head.yb, em, { cls: "rel" });
      for (const b of [...label, ...labelBelow]) out.splice(out.indexOf(b), 1);
    } else continue;
    for (const r of run) out.splice(out.indexOf(r), 1);
    out.push(made);
  }
  return out;
}

// \overbrace and \underbrace: the brace tips and cusp are four pieces on
// one height, joined by rules; the content lies on the far side from the
// tips, the label on the near side.
function braces(atoms: Atom[], rules: Rule[], used: Set<Rule>): Atom[] {
  let out = [...atoms];
  const tips = out.filter((a) => /^hbrace-/.test(a.entry?.piece ?? "")).sort(byX);
  const groups: Atom[][] = [];
  for (const t of tips) {
    const g = groups.find((g) => Math.abs(g[0].yb - t.yb) < 0.1 * t.size && t.x1 - g[g.length - 1].x2 < 30 * t.size);
    if (g) g.push(t);
    else groups.push([t]);
  }
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
    const far = out.filter((b) => within(b) && (over ? b.top <= bottom + 0.1 * em : b.bottom >= top - 0.1 * em));
    const near = out.filter((b) => within(b) && !far.includes(b) && (over ? b.bottom >= top - 0.2 * em : b.top <= bottom + 0.2 * em));
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
      const index = pool.filter(
        (a) =>
          a !== rad &&
          !inner.includes(a) &&
          cx(a) < rad.x1 + (rad.x2 - rad.x1) * 0.7 &&
          cx(a) > rad.x1 - 0.3 * em &&
          a.size < rad.size * 0.8 &&
          a.bottom > rad.bottom &&
          a.top <= y + 0.3 * em,
      );
      const innerRules = hr.filter((q) => q !== r && !used.has(q) && q.x1 >= r.x1 - 0.1 && q.x2 <= r.x2 + 0.1 && ry(q) < y);
      for (const q of innerRules) used.add(q);
      const body = linear(structure(inner, innerRules, depth + 1));
      const idx = index.length ? `[${linear(structure(index, [], depth + 1))}]` : "";
      pool = pool.filter((a) => a !== rad && !inner.includes(a) && !index.includes(a));
      const size = inner.length ? maxSize(inner) : rad.size;
      nodes.push(node([rad, ...inner], `\\sqrt${idx}{${body}}`, inner.length ? mainBaseline(inner) : rad.yb, size, { x2: r.x2, top: y + r.thickness }));
      continue;
    }
    // A fraction bar: glyphs above and below within its extent.
    const within = (a: Atom) => cx(a) > r.x1 - 0.05 * em && cx(a) < r.x2 + 0.05 * em;
    const rest = hr.filter((q) => q !== r && !used.has(q));
    const above = chain(pool.filter((a) => within(a) && a.bottom >= y - 0.05 * em), y, 1, em, rest);
    const below = chain(pool.filter((a) => within(a) && a.top <= y + 0.05 * em), y, -1, em, rest);
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
      const num = linear(structure(above, nr, depth + 1));
      const den = linear(structure(below, dr, depth + 1));
      pool = pool.filter((a) => !above.includes(a) && !below.includes(a));
      // A fraction sits on the math axis: its baseline is a quarter em under
      // the bar. Parts set smaller than the formula make a text-style one.
      // Parts set smaller than the text the formula sits in make a
      // text-style fraction (or one in a script): its own size is a step up.
      const part = Math.max(maxSize(above), maxSize(below));
      const size = part >= style.size * 0.95 ? part : Math.min(style.size, part / 0.7);
      const extra: Partial<Atom> = { x1: r.x1, x2: r.x2 };
      if (depth === 0) extra.fracPart = part;
      nodes.push(node([...above, ...below], `\\frac{${num}}{${den}}`, y - 0.25 * size, size, extra));
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
// p. 20: the row's m and H went into the numerators).
function chain(cands: Atom[], y: number, dir: 1 | -1, em: number, rules: Rule[]): Atom[] {
  const taken: Atom[] = [];
  let edge = y;
  const sorted = cands.sort((a, b) => (dir > 0 ? a.bottom - b.bottom : b.top - a.top));
  for (const a of sorted) {
    const gap = dir > 0 ? a.bottom - edge : edge - a.top;
    if (gap > 0.9 * em) break;
    const near = dir > 0 ? a.bottom : a.top;
    const barred = rules.some(
      (r) => r.x1 < a.x2 && r.x2 > a.x1 && (r.y1 + r.y2) / 2 > Math.min(edge, near) && (r.y1 + r.y2) / 2 < Math.max(edge, near),
    );
    if (taken.length > 0 && gap > 0.25 * em && !barred) break;
    taken.push(a);
    edge = dir > 0 ? Math.max(edge, a.top) : Math.min(edge, a.bottom);
  }
  return taken;
}

/** The formula's baseline: the leftmost of its largest atoms that are no
    big operator or delimiter (those hang from their origin). */
function mainBaseline(atoms: Atom[]): number {
  const cands = atoms.filter((a) => !hangingFamily(a.fam));
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
  const vr = rules.filter((r) => r.dir === "v");
  if (vr.length === 0 || atoms.length === 0) return atoms;
  const em = maxSize(atoms);
  const y1 = Math.min(...vr.map((r) => r.y1));
  const y2 = Math.max(...vr.map((r) => r.y2));
  const band = atoms.filter((a) => a.yb > y1 - 0.3 * em && a.yb < y2 + 0.3 * em).sort(byX);
  // The array runs from the rules out to the first gap wider than a
  // column's (an em and a half): the formula's other atoms stand apart.
  const rx1 = Math.min(...vr.map((r) => r.x1));
  const rx2 = Math.max(...vr.map((r) => r.x1));
  const left = band.filter((a) => cx(a) < rx1);
  const right = band.filter((a) => cx(a) > rx2);
  if (left.length === 0 && right.length === 0) return atoms;
  let lo = band.indexOf(left[left.length - 1] ?? right[0]);
  let hi = band.indexOf(right[0] ?? left[left.length - 1]);
  while (lo > 0 && band[lo].x1 - band[lo - 1].x2 < 1.5 * em) lo--;
  while (hi < band.length - 1 && band[hi + 1].x1 - band[hi].x2 < 1.5 * em) hi++;
  const content = band.slice(lo, hi + 1);
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
  const cuts = [...ruleXs, ...columnCuts(rows, em).filter((c) => ruleXs.every((x) => Math.abs(x - c) > 0.5 * em))].sort((p, q) => p - q);
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
  const made = node(content, `\\begin{array}{${spec}} ${body.trim()} \\end{array}`, (top + bottom) / 2 - 0.25 * em, em, { top, bottom });
  return [...atoms.filter((a) => !content.includes(a)), made];
}

// ── Rows: matrices, binomials, cases, aligned lines ────────────────────────

// Baselines of main-size atoms at least 0.9 em apart, top first.
function rowLines(atoms: Atom[], unit: number): number[] {
  const ys = [...new Set(atoms.map((a) => Math.round(a.yb * 2) / 2))].sort((p, q) => q - p);
  const lines: number[] = [];
  for (const y of ys) {
    const last = lines[lines.length - 1];
    if (last !== undefined && last - y < 0.9 * unit) continue;
    lines.push(y);
  }
  return lines;
}

function splitRows(atoms: Atom[], lines: number[]): Atom[][] {
  const rows: Atom[][] = lines.map(() => []);
  for (const a of atoms) {
    let best = 0;
    lines.forEach((ly, i) => {
      if (Math.abs(ly - a.yb) < Math.abs(lines[best] - a.yb)) best = i;
    });
    rows[best].push(a);
  }
  return rows;
}

// Columns: gaps of 0.9 em or more open in every row that splits two cells.
function columnCuts(rows: Atom[][], em: number): number[] {
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
      if (x - start >= 0.9 * em) cuts.push((start + x) / 2);
      start = null;
    }
  }
  return cuts;
}

function cells(rows: Atom[][], cuts: number[]): string {
  return rows
    .map((r) => {
      const parts: Atom[][] = [[]];
      for (const a of [...r].sort(byX)) {
        while (parts.length - 1 < cuts.length && cx(a) > cuts[parts.length - 1]) parts.push([]);
        parts[parts.length - 1].push(a);
      }
      while (parts.length < cuts.length + 1) parts.push([]);
      return parts.map((p) => linear(p.map((a) => ({ ...a })))).join(" & ");
    })
    .join(" \\\\ ");
}

// A tall delimiter pair around stacked content is its own node, innermost
// first: a matrix, a binomial, or (a left brace with no closer) cases.
function fencedGroups(atoms: Atom[], em: number): Atom[] {
  let out = [...atoms];
  for (;;) {
    const fences = out.filter((a) => isTall(a, em) && a.fam === "omx").sort(byX);
    let made: Atom | null = null;
    for (let i = 0; i < fences.length && !made; i++) {
      const open = fences[i];
      if (open.cls !== "open") continue;
      const close = fences.slice(i + 1).find((d) => d.cls === "close");
      const inner = fences.slice(i + 1).find((d) => d.cls === "open");
      if (inner && close && inner.x1 < close.x1) continue; // innermost first
      const right = close ? close.x1 + 0.1 : Infinity;
      const content = out.filter((a) => a !== open && a !== close && a.x1 >= open.x2 - 0.1 && a.x2 <= right && a.top <= open.top + 0.2 * em && a.bottom >= open.bottom - 0.2 * em);
      if (content.length === 0) continue;
      const stackSize = maxSize(content);
      const mains = content.filter((a) => a.size >= stackSize * 0.95 && a.fam !== "omx");
      const lines = rowLines(mains, stackSize);
      if (lines.length < 2) continue;
      const rows = splitRows(content, lines);
      const cuts = columnCuts(rows, stackSize);
      const axis = (open.top + open.bottom) / 2;
      let tex: string;
      if (!close && open.tex === "\\{") tex = `\\begin{cases} ${cells(rows, cuts)} \\end{cases}`;
      else if (!close) continue;
      else if (open.tex === "(" && close.tex === ")" && rows.length === 2 && cuts.length === 0) {
        tex = `\\binom{${linear(rows[0].map((a) => ({ ...a })))}}{${linear(rows[1].map((a) => ({ ...a })))}}`;
      } else {
        const env = FENCE_ENV[open.tex] ?? "matrix";
        tex = `\\begin{${env}} ${cells(rows, cuts)} \\end{${env}}`;
      }
      made = node([open, ...content, ...(close ? [close] : [])], tex, axis - 0.25 * em, em);
      out = out.filter((a) => a !== open && a !== close && !content.includes(a));
      out.push(made);
    }
    if (!made) return out;
  }
}

// Unfenced rows: aligned when every row's first relation sits at one x,
// else gathered.
function alignedRows(atoms: Atom[], em: number): string | null {
  const mains = atoms.filter((a) => a.size >= em * 0.95 && !hangingFamily(a.fam) && !(a.fam === null && a.limits));
  const lines = rowLines(mains, em);
  if (lines.length < 2) return null;
  const rows = splitRows(atoms, lines);
  // Rows that are no more than a big operator's limits are no rows.
  if (rows.some((r) => !r.some((a) => a.size >= em * 0.95))) return null;
  const firstRel = (r: Atom[]) => [...r].sort(byX).find((a) => a.cls === "rel");
  const rels = rows.map(firstRel).filter((a): a is Atom => a !== undefined);
  const aligned = rels.length === rows.length && rels.every((a) => Math.abs(a.x1 - rels[0].x1) < 0.3 * em);
  if (aligned) {
    const body = rows.map((r) => {
      const s = [...r].sort(byX);
      const k = s.findIndex((a) => a.cls === "rel");
      return `${linear(s.slice(0, k).map((a) => ({ ...a })))} &${linear(s.slice(k).map((a) => ({ ...a })))}`;
    });
    return `\\begin{aligned} ${body.join(" \\\\ ")} \\end{aligned}`;
  }
  return `\\begin{gathered} ${rows.map((r) => linear(r.map((a) => ({ ...a })))).join(" \\\\ ")} \\end{gathered}`;
}

// ── Limits of big operators ─────────────────────────────────────────────────

function limits(atoms: Atom[], em: number): Atom[] {
  const out = [...atoms];
  // A text-size operator takes limits too (\sum\limits in a list item):
  // a limit sits wholly over its top or under its bottom, a script beside.
  for (const op of atoms.filter((a) => a.cls === "op" && (a.entry?.display || hangingFamily(a.fam)) && a.size >= em * 0.75)) {
    const inX = (b: Atom) => b !== op && Math.abs(cx(b) - cx(op)) < (op.x2 - op.x1) / 2 + 0.3 * em;
    // A limit grows along its baseline: "p prime" is wider than ∏.
    const grow = (seed: Atom[]) => {
      const set = [...seed];
      for (let added = true; added; ) {
        added = false;
        for (const b of out) {
          if (set.includes(b) || b === op) continue;
          if (set.some((c) => Math.abs(c.yb - b.yb) < 0.3 * c.size && (Math.abs(b.x1 - c.x2) < 0.6 * em || Math.abs(c.x1 - b.x2) < 0.6 * em || overlapX(b, c) > 0))) {
            set.push(b);
            added = true;
          }
        }
      }
      return set;
    };
    const up = grow(out.filter((b) => inX(b) && b.bottom >= op.top - 0.1 * em && b.size < op.size));
    const low = grow(out.filter((b) => inX(b) && b.top <= op.bottom + 0.1 * em && b.size < op.size && !up.includes(b)));
    if (up.length) op.upper = stackedLimit(up);
    if (low.length) op.lower = stackedLimit(low);
    op.limits = true;
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
  const em = maxSize(atoms);
  atoms = fencedGroups(atoms, em);
  const base = mainBaseline(atoms);
  // Big operators and delimiters sit on the math axis, a quarter em over
  // the baseline of their row: in a display of several rows each sum is its
  // own row's (arXiv 2506.08494 p. 12: every sum went to the first row). A
  // sum set in a script's size sits on the script's axis.
  for (const a of atoms) {
    if (hangingFamily(a.fam) && (a.cls === "op" || a.entry?.size || a.entry?.piece || a.cls === "open" || a.cls === "close")) a.yb = (a.top + a.bottom) / 2 - 0.25 * Math.min(em, a.size);
  }
  const rows = alignedRows(atoms, em);
  if (rows) return rows;
  // Tall delimiters pair up as \left … \right (an editor redraws them to
  // fit); one alone keeps its drawn size (\bigl( up to \Biggl(): a lone
  // \left does not parse.
  const tall = atoms.filter((a) => isTall(a, em)).sort(byX);
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
  const main = atoms.filter(onLine).sort(byX);
  const small = atoms.filter((a) => !main.includes(a));
  // An upright word from main[k]: its last index and its letters ("lim"
  // takes a following "sup" set a thin space apart).
  const wordAt = (k: number): { end: number; word: string } => {
    let end = k;
    let word = main[k].tex;
    while (
      (main[k].italic ? main[end + 1]?.italic : main[end + 1]?.upright) &&
      /^[A-Za-z]$/.test(main[end + 1].tex) &&
      (main[end + 1].x1 - main[end].x2 < 0.12 * em || (word === "lim" && main[end + 1].x1 - main[end].x2 < 0.3 * em))
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
  // The limit under \lim, \sup, \max in display is claimed before any
  // script: wider than the name, it starts left of it ("N → ∞" under "lim"
  // read as a subscript of the "=" before it).
  const nameLimits = new Map<Atom, Atom[]>();
  for (let k = 0; k < main.length; k++) {
    if (!main[k].upright || !/^[A-Za-z]$/.test(main[k].tex)) continue;
    const { end, word } = wordAt(k);
    if (LIMIT_OPS.has(word)) {
      const a = main[k];
      const mid = (a.x1 + main[end].x2) / 2;
      const half = (main[end].x2 - a.x1) / 2 + 0.4 * em;
      // A limit hangs wholly under the name's baseline; an inline subscript
      // reaches above it. Its baseline alone says so where its box is a
      // guess (a text font's "t" under Times' "lim" read as the subscript of
      // the "=" before it, Springer). It grows along its own baseline.
      const under = small.filter((s) => !s.claimed && (s.top < a.yb - 0.15 * em || s.yb < a.yb - 0.45 * em));
      const low = under.filter((s) => Math.abs(cx(s) - mid) < half);
      for (let added = low.length > 0; added; ) {
        added = false;
        for (const s of under) {
          if (low.includes(s)) continue;
          if (low.some((c) => Math.abs(c.yb - s.yb) < 0.3 * c.size && (Math.abs(s.x1 - c.x2) < 0.6 * em || Math.abs(c.x1 - s.x2) < 0.6 * em))) {
            low.push(s);
            added = true;
          }
        }
      }
      for (const s of low) s.claimed = true;
      if (low.length) nameLimits.set(a, low);
    }
    k = end;
  }
  const out: string[] = [];
  let prev: Atom | null = null;
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
    let tex = a.tex;
    let last = a;
    // A word in a text italic set apart as text is \textit (\text{ for all }
    // in a theorem's italic read as the math letters "forall"); its letter
    // alone, or letters set tight, stay math letters.
    if (a.italic && /^[A-Za-z]$/.test(a.tex)) {
      const { end, word } = wordAt(k);
      const next = main[end + 1];
      const trail = next ? next.x1 - main[end].x2 : 0;
      if (word.length > 1 && (((!prev || gap > 0.25 * em) && (!next || trail > 0.25 * em)) || /^[a-z]{4,}$/.test(word))) {
        k = end;
        last = main[k];
        const lead = prev && gap > 0.2 * em && !spaced ? " " : "";
        tex = `\\textit{${lead}${word}${trail > 0.2 * em && trail <= 0.9 * em && next ? " " : ""}}`;
      }
    }
    // Upright letters: an operator name, a word in text, or \mathrm.
    else if (a.upright && /^[A-Za-z]$/.test(a.tex)) {
      const { end, word } = wordAt(k);
      k = end;
      last = main[k];
      const trail = main[k + 1] ? main[k + 1].x1 - last.x2 : 0;
      // A name set tight against its argument's bracket is an operator
      // ("softmax(", "Var(").
      const applied = main[k + 1]?.cls === "open" && trail < 0.3 * em;
      // A word with a script set on it names a thing (SF_+): no text.
      const scripted = small.some((s) => !s.claimed && s.x1 >= last.x2 - 0.05 * em && s.x1 < last.x2 + 0.15 * em);
      if (OPNAMES.has(word)) tex = `\\${word}`;
      else if (word.length === 1 || scripted) tex = `\\mathrm{${word}}`;
      else if (!applied && (((!prev || gap > 0.25 * em) && (!main[k + 1] || trail > 0.25 * em)) || /^[a-z]{4,}$/.test(word))) {
        // A word set apart by spaces is text; the spaces stay inside it
        // ("\text{in }\Omega", not "inΩ"), unless a quad already holds them.
        const lead = prev && gap > 0.2 * em && !spaced ? " " : "";
        tex = `\\text{${lead}${word}${trail > 0.2 * em && trail <= 0.9 * em && main[k + 1] ? " " : ""}}`;
      } else tex = `\\operatorname{${word}}`;
      // (mod n): \pmod, its parentheses and quad included.
      if (word === "mod" && out.length && out[out.length - 1] === "(") {
        const close = main.findIndex((b, j) => j > k && b.tex === ")");
        if (close > k) {
          out.pop();
          while (out.length && /^\\q?quad$/.test(out[out.length - 1])) out.pop();
          out.push(`\\pmod{${linear(main.slice(k + 1, close).map((b) => ({ ...b })))}}`);
          prev = main[close];
          k = close;
          continue;
        }
      }
      // Limits set under \lim, \sup, \max in display.
      const low = nameLimits.get(a);
      if (low) tex += `_{${linear(low.map((s) => ({ ...s, claimed: false })))}}`;
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
    // Two digits set apart are two numbers: a matrix row's "−1 1" read as
    // −11 (Springer).
    else if ((prev?.cls === "punct" && gap > 0.4 * em) || (prev && /^[0-9]$/.test(prev.tex) && /^[0-9]$/.test(a.tex) && gap > 0.2 * em)) out.push("\\ ");
    if (a.fracPart !== undefined && nesting === 1) {
      if (style.display && a.fracPart < style.size * 0.8) tex = tex.replace(/^\\frac/, "\\tfrac");
      else if (!style.display && a.fracPart >= style.size * 0.9) tex = tex.replace(/^\\frac/, "\\dfrac");
    }
    const next = main[k + 1];
    // A bar with a relation's space on both sides is \mid, unless it closes
    // a bar opened before it (|X|^q = 0 read as |X\mid^q).
    const open = main.slice(0, k).filter((b) => b.tex === "|").length % 2 === 1;
    if (tex === "|" && !open && prev && next && a.x1 - prev.x2 > 0.22 * em && next.x1 - a.x2 > 0.22 * em) tex = "\\mid";
    if (tex === ":" && prev && a.x1 - prev.x2 < 0.25 * em && next && next.x1 - a.x2 > 0.3 * em) tex = "\\colon";
    const label = labels.get(a);
    if (label) tex = `\\overset{${linear(label.map((s) => ({ ...s, claimed: false })))}}{${tex}}`;
    const right = next ? next.x1 : Infinity;
    let mine = small.filter((s) => !s.claimed && s.x1 >= last.x2 - 0.25 * em && s.x1 < right - 0.05 * em);
    // A relation, an operator, punctuation, or an opening bracket takes a
    // subscript at most (\leq_{\text{lex}}): a raised glyph after one is the
    // next symbol's prescript ("= {}^{\rho}u", arXiv 2504.02736 p. 7), and
    // small glyphs over and under one are a fraction whose bar the page
    // drew as no rule ("= 1/6" read as =_{6}^{1}). They stay for the next
    // symbol's prescripts, or fail the formula.
    const high = mine.filter((s) => s.yb > last.yb + 0.03 * em);
    if (/^(rel|bin|punct|open)$/.test(a.cls) && high.length > 0) mine = [];
    for (const s of mine) s.claimed = true;
    if (a.lower) tex += `_{${a.lower}}`;
    if (a.upper) tex += `^{${a.upper}}`;
    if (mine.length) tex += scripts(mine, last.yb, em);
    out.push(tex);
    prev = { ...last, x1: a.x1, x2: Math.max(last.x2, ...mine.map((s) => s.x2), ...reach.map((s) => s.x2)) };
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

function join(tokens: string[]): string {
  const merged: string[] = [];
  for (const t of tokens) {
    const m = ALPHABET_RE.exec(t);
    const last = merged.length ? ALPHABET_RE.exec(merged[merged.length - 1]) : null;
    // One alphabet per run: \mathfrak{su}, not \mathfrak{s}\mathfrak{u}.
    if (m && last && m[1] === last[1]) merged[merged.length - 1] = `\\${m[1]}{${last[2]}${m[2]}}`;
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
    out.push({ fam: "oms", code: 0x70, entry, tex: "", cls: "radical", size: em, x1: sign.x1, x2: r.x1, yb: sign.y1, top, bottom: sign.y1, upright: false });
  }
  return out;
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

/** A formula's LaTeX from its glyphs and the shapes drawn with them (rules,
    and paths), and the atoms the check compares against (pieces joined,
    composites fused). */
export function formulaToLatex(
  glyphs: Glyph[],
  rules: Rule[],
  opts: { display: boolean; size: number },
  paths: Box[] = [],
): { latex: string; atoms: Atom[]; unknown: Glyph[] } {
  style = opts;
  lost = 0;
  read = new Set();
  const { atoms, unknown } = atomsOf(glyphs);
  const used = new Set<Box>();
  const radicals = drawnRadicals(atoms, rules, paths, used);
  // Arrow runs before composites: a minus and an arrowhead inside a long
  // arrow would otherwise fuse into \longrightarrow.
  const fused = fuseComposites(arrowRuns(assemblePieces([...atoms, ...radicals])));
  const copies = ruledArray(
    fused.map((a) => ({ ...a })),
    rules,
  );
  const bars = rules.filter((r) => r.dir === "h");
  const latex = linear(
    structure(
      copies,
      bars.filter((r) => !read.has(r)),
    ),
  );
  if (bars.some((r) => !read.has(r))) lost++;
  if (unreadShape(fused, rules, paths, used)) lost++;
  return { latex: lost > 0 ? "" : latex, atoms: fused, unknown };
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
