import { JSDOM } from "jsdom";
import katex from "katex";
import { KATEX_MACROS } from "@/lib/katex";

// Math as one canonical token sequence. LaTeX renders with KaTeX to
// presentation MathML (the app's own macros); a source's MathML (LaTeXML) is
// read as it is. Both reduce the same way: structure stays (sub, sup, frac,
// sqrt, over and under, tables), and what does not change the meaning goes
// (mrow nesting, spacing, attributes, invisible operators, italic against
// upright). Similarity is 1 − the edit distance of two sequences over the
// longer one's length; a glyph in the wrong variant is half an edit.

let host: HTMLElement | null = null;

function parseMath(markup: string): Element | null {
  host ??= new JSDOM("<!doctype html><body></body>").window.document.createElement("div");
  host.innerHTML = markup;
  return host.querySelector("math");
}

// ── Characters ──────────────────────────────────────────────────────────────

/** A glyph and its look-alikes as one token. */
const CHAR_MAP: Record<string, string> = {
  "-": "−", "‐": "−", "‒": "−", "–": "−", "*": "∗", "·": "⋅", "∙": "⋅", "∣": "|", "∥": "‖", "'": "′", "’": "′",
  "⋯": "…", "∶": ":", "〈": "⟨", "〉": "⟩", "~": "∼", "\\": "∖", "∊": "∈",
};

/** An accent over or under a letter, by its many code points. */
const ACCENT_MAP: Record<string, string> = {
  "^": "^", "ˆ": "^", "\u0302": "^", "~": "~", "˜": "~", "\u0303": "~", "∼": "~", "¯": "¯", "ˉ": "¯", "‾": "¯",
  "\u0304": "¯", "\u0305": "¯", "_": "¯", "−": "¯", "-": "¯", "→": "→", "\u20D7": "→", "˙": "˙", "\u0307": "˙",
  ".": "˙", "¨": "¨", "\u0308": "¨", "ˇ": "ˇ", "\u030C": "ˇ", "˘": "˘", "\u0306": "˘", "´": "´", "ˊ": "´",
  "\u0301": "´", "`": "`", "ˋ": "`", "\u0300": "`", "˚": "˚", "\u030A": "˚",
};

const INVISIBLE = /[\u2061-\u2064\u200B\uFEFF\s]/u;

/** The variant a mathvariant names, as a token prefix: bold, blackboard,
    calligraphic (script), fraktur, sans-serif, monospace. Italic and upright
    are one. */
function variantTag(value: string | null): string {
  if (!value) return "";
  if (value.includes("double-struck")) return "bb";
  if (value.includes("script")) return "cal";
  if (value.includes("fraktur")) return "frak";
  if (value.includes("sans-serif")) return "sf";
  if (value === "monospace") return "tt";
  if (value.includes("bold")) return "b";
  return "";
}

// The Mathematical Alphanumeric Symbols block by the variant each range draws.
const ALNUM_RANGES: [number, string][] = [
  [0x1d400, "b"], [0x1d434, ""], [0x1d468, "b"], [0x1d49c, "cal"], [0x1d504, "frak"], [0x1d538, "bb"], [0x1d56c, "frak"],
  [0x1d5a0, "sf"], [0x1d670, "tt"], [0x1d6a4, ""], [0x1d6a8, "b"], [0x1d6e2, ""], [0x1d71c, "b"], [0x1d756, "sf"],
  [0x1d7ca, "b"], [0x1d7d8, "bb"], [0x1d7e2, "sf"], [0x1d7f6, "tt"],
];
const LETTERLIKE: Record<string, string> = {};
for (const ch of "ℂℍℕℙℚℝℤⅅⅆⅇⅈⅉ") LETTERLIKE[ch] = "bb";
for (const ch of "ℬℰℱℋℐℒℳℛℯℊℴ") LETTERLIKE[ch] = "cal";
for (const ch of "ℭℌℑℜℨ") LETTERLIKE[ch] = "frak";
LETTERLIKE["ℎ"] = "";

/** One glyph as a token: a styled letter's variant and base ("bb:R" for ℝ
    and for \mathbb{R}), look-alikes as one; "" for what adds nothing. */
function charToken(ch: string, variant: string, accent = false): string {
  if (INVISIBLE.test(ch)) return "";
  const cp = ch.codePointAt(0) ?? 0;
  let tag = variant;
  let base = ch;
  if (cp >= 0x1d400 && cp <= 0x1d7ff) {
    tag = "";
    for (const [start, t] of ALNUM_RANGES) if (cp >= start) tag = t;
    base = ch.normalize("NFKC");
  } else if (ch in LETTERLIKE) {
    tag = LETTERLIKE[ch];
    base = ch.normalize("NFKC");
  }
  base = accent ? (ACCENT_MAP[base] ?? CHAR_MAP[base] ?? base) : (CHAR_MAP[base] ?? base);
  return tag ? `${tag}:${base}` : base;
}

// ── MathML to tokens ────────────────────────────────────────────────────────

const LEAVES = new Set(["mi", "mn", "mo", "mtext", "ms"]);
const DROPPED = new Set(["mspace", "mphantom", "annotation", "annotation-xml", "none", "mprescripts", "maligngroup", "malignmark"]);
const WRAPPERS = new Set(["mrow", "mstyle", "mpadded", "menclose"]);

type Canon = { tokens: string[]; leaves: string[] };

function leaf(el: Element, out: Canon, accent: boolean) {
  const variant = variantTag(el.getAttribute("mathvariant"));
  const text = el.textContent ?? "";
  for (const ch of text) {
    const token = charToken(ch, variant, accent);
    if (token) out.tokens.push(token);
  }
  const reading = [...text].filter((c) => !INVISIBLE.test(c)).join("").normalize("NFKC");
  if (reading) out.leaves.push(reading);
}

/** The element under wrappers and invisible operators, when it is one. */
function core(el: Element): Element {
  if (!WRAPPERS.has(el.localName)) return el;
  const kids = [...el.children].filter((k) => !(k.localName === "mo" && ![...(k.textContent ?? "")].some((c) => !INVISIBLE.test(c))));
  return kids.length === 1 ? core(kids[0]) : el;
}

/** A base whose scripts are limits (∑, ∫, lim, max): under and over read as sub and sup. */
function takesLimits(base: Element | undefined): boolean {
  if (!base) return false;
  const c = core(base);
  return c.localName === "mo" || (c.localName === "mi" && (c.textContent ?? "").trim().length > 1);
}

/** Is this over or under script an accent (one accent glyph)? */
function isAccent(el: Element | undefined, parent: Element, attr: string): boolean {
  if (!el) return false;
  if (parent.getAttribute(attr) === "true") return true;
  const c = core(el);
  const text = (c.textContent ?? "").trim();
  return LEAVES.has(c.localName) && [...text].length === 1 && text in ACCENT_MAP;
}

function walk(el: Element | undefined, out: Canon, accent = false): void {
  if (!el) return;
  const name = el.localName;
  if (DROPPED.has(name)) return;
  if (LEAVES.has(name)) return leaf(el, out, accent);
  const kids = [...el.children];
  const group = (open: string, node: Element | undefined, isAccentScript = false) => {
    out.tokens.push(open);
    walk(node, out, isAccentScript);
    out.tokens.push("}");
  };
  switch (name) {
    case "semantics":
      return walk(kids[0], out);
    case "msub":
      walk(kids[0], out);
      return group("_{", kids[1]);
    case "msup":
      walk(kids[0], out);
      return group("^{", kids[1]);
    case "msubsup":
      walk(kids[0], out);
      group("_{", kids[1]);
      return group("^{", kids[2]);
    case "munder": {
      walk(kids[0], out);
      if (takesLimits(kids[0])) return group("_{", kids[1]);
      return group("_u{", kids[1], isAccent(kids[1], el, "accentunder"));
    }
    case "mover": {
      walk(kids[0], out);
      if (takesLimits(kids[0])) return group("^{", kids[1]);
      return group("^o{", kids[1], isAccent(kids[1], el, "accent"));
    }
    case "munderover": {
      walk(kids[0], out);
      if (takesLimits(kids[0])) {
        group("_{", kids[1]);
        return group("^{", kids[2]);
      }
      group("_u{", kids[1], isAccent(kids[1], el, "accentunder"));
      return group("^o{", kids[2], isAccent(kids[2], el, "accent"));
    }
    case "mfrac": {
      const thickness = el.getAttribute("linethickness");
      out.tokens.push(thickness !== null && parseFloat(thickness) === 0 ? "binom{" : "frac{");
      walk(kids[0], out);
      out.tokens.push("}{");
      walk(kids[1], out);
      out.tokens.push("}");
      return;
    }
    case "msqrt":
      out.tokens.push("sqrt{");
      for (const k of kids) walk(k, out);
      out.tokens.push("}");
      return;
    case "mroot":
      out.tokens.push("root{");
      walk(kids[1], out);
      out.tokens.push("}{");
      walk(kids[0], out);
      out.tokens.push("}");
      return;
    case "mtable":
    case "mtr":
    case "mlabeledtr":
    case "mtd": {
      out.tokens.push(name === "mtable" ? "table{" : name === "mtd" ? "cell{" : "row{");
      // A labeled row's first cell is its equation number: not math.
      for (const k of name === "mlabeledtr" ? kids.slice(1) : kids) walk(k, out);
      out.tokens.push("}");
      return;
    }
    case "mfenced": {
      const separators = [...(el.getAttribute("separators") ?? ",").replace(/\s/g, "")];
      const push = (text: string) => {
        for (const ch of text) {
          const token = charToken(ch, "");
          if (token) out.tokens.push(token);
        }
      };
      push(el.getAttribute("open") ?? "(");
      kids.forEach((k, i) => {
        if (i > 0) push(separators[Math.min(i - 1, separators.length - 1)] ?? "");
        walk(k, out);
      });
      push(el.getAttribute("close") ?? ")");
      return;
    }
    default:
      for (const k of kids) walk(k, out);
  }
}

/** Three dots in a row are one ellipsis; an empty table cell (KaTeX's
    alignment and tag columns) is nothing. */
function tidy(tokens: string[]): string[] {
  const out: string[] = [];
  for (const t of tokens) {
    if (t === "." && out.length >= 2 && out.at(-1) === "." && out.at(-2) === ".") {
      out.splice(-2, 2, "…");
      continue;
    }
    if (t === "}" && out.at(-1) === "cell{") {
      out.pop();
      continue;
    }
    out.push(t);
  }
  return out;
}

function canonOfMarkup(markup: string): Canon | null {
  const math = parseMath(markup);
  if (!math) return null;
  const out: Canon = { tokens: [], leaves: [] };
  walk(math, out);
  return { tokens: tidy(out.tokens), leaves: out.leaves };
}

/** Plain text read as math: one token a glyph, no structure. */
function canonOfText(text: string): Canon {
  const tokens: string[] = [];
  for (const ch of text) {
    const token = charToken(ch, "");
    if (token) tokens.push(token);
  }
  return { tokens: tidy(tokens), leaves: text.split(/\s+/).filter(Boolean) };
}

const memo = new Map<string, Canon>();

/** A formula's canonical form: from its MathML when the source gives it,
    else from its LaTeX through KaTeX. A formula KaTeX cannot read is its
    LaTeX's glyphs. */
function canon(src: { latex?: string; mathml?: string }, display: boolean): Canon {
  const key = src.mathml ? `M${src.mathml}` : `${display ? "D" : "I"}${src.latex ?? ""}`;
  const hit = memo.get(key);
  if (hit) return hit;
  let out: Canon | null = src.mathml ? canonOfMarkup(src.mathml) : null;
  if (!out && src.latex !== undefined) {
    const html = katex.renderToString(src.latex, {
      output: "mathml",
      displayMode: display,
      throwOnError: false,
      strict: "ignore",
      macros: { ...KATEX_MACROS },
    });
    out = canonOfMarkup(html) ?? canonOfText(src.latex);
  }
  out ??= { tokens: [], leaves: [] };
  memo.set(key, out);
  return out;
}

/** The canonical token sequence of a formula. */
export function mathTokens(src: { latex?: string; mathml?: string }, display: boolean): string[] {
  return canon(src, display).tokens;
}

/** A formula's glyphs as a reader sees them, one string per MathML leaf. */
export function mathLeaves(src: { latex?: string; mathml?: string }, display: boolean): string[] {
  return canon(src, display).leaves;
}

/** Plain text (a formula a parse read as words) as a token sequence. */
export function textMathTokens(text: string): string[] {
  return canonOfText(text).tokens;
}

/** A styled glyph's base: "cal:F" is F. */
const baseOf = (token: string) => /^(?:b|bb|cal|frak|sf|tt):(.+)$/.exec(token)?.[1] ?? token;

/** 1 − the edit distance of two token sequences over the longer one's
    length. Two glyphs that differ only in their variant (𝓕 against F) cost
    half an edit. */
export function sequenceSimilarity(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  let prev = new Float64Array(b.length + 1);
  let cur = new Float64Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const x = a[i - 1];
      const y = b[j - 1];
      const swap = x === y ? 0 : baseOf(x) === baseOf(y) ? 0.5 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + swap);
    }
    [prev, cur] = [cur, prev];
  }
  return 1 - prev[b.length] / Math.max(a.length, b.length);
}
