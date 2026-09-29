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
      for (const ch of text) out.push(`${ch}@${top.level}`);
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
  for (const a of atoms) {
    if (!a.tex || a.cls === "piece" || a.cls === "radical") continue;
    if (a.fam === "omx" && (a.cls === "open" || a.cls === "close")) continue;
    const r = a.size / size;
    // An extension font's glyph stands at the text's level whatever its
    // font's size; one set in a script's size is a script's (the ∑ of an
    // exponent Σd_j/2, arXiv 2506.08494 p. 5).
    const level = (hangingFamily(a.fam) && r >= 0.75) || r >= 0.85 ? 0 : r >= 0.6 ? 1 : 2;
    const own = symbolLevels(a.cls === "accent" ? `${a.tex}{}` : a.tex, display) ?? [];
    for (const x of own) {
      const at = x.lastIndexOf("@");
      want.push(`${x.slice(0, at)}@${Math.min(2, level + Number(x.slice(at + 1)))}`);
    }
  }
  const g = counts(got);
  const w = counts(want);
  const extra: string[] = [];
  for (const k of new Set([...g.keys(), ...w.keys()])) {
    const d = (g.get(k) ?? 0) - (w.get(k) ?? 0);
    for (let i = 0; i < Math.abs(d); i++) (d > 0 ? extra : missing).push(k);
  }
  return { ok: missing.length === 0 && extra.length === 0, missing, extra };
}

/** A formula's LaTeX from its glyphs and shapes (rules, and the page's
    paths around it), and the check of it against them. display and size say
    how it is set: in a display or in a line of text of that size. */
export function layoutLatex(
  glyphs: Glyph[],
  rules: Rule[],
  opts: { display: boolean; size: number },
  paths: Box[] = [],
): { latex: string; check: MathCheck; atoms: Atom[] } {
  const { latex, atoms, unknown } = formulaToLatex(glyphs, rules, opts, paths);
  const check = latex ? checkLatex(latex, atoms, unknown, opts.display, opts.size) : { ok: false, missing: ["(no layout)"], extra: [] };
  return { latex, check, atoms };
}
