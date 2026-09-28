import "@/lib/pdf-runtime";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import katex from "katex";
import { getDocumentProxy } from "unpdf";
import { readDrawing, type FontLookup, type Glyph } from "@/lib/parse/pdf/drawing";
import { mathGlyph } from "@/lib/parse/pdf/math-fonts";
import { regionBounds, type Region } from "@/lib/video/types";
import type { Doc } from "./adapt";
import { ROOT } from "./load";
import { mathLeaves } from "./math";

// The checks that read the PDF's own glyphs (the P0-F memo §1.9 and §7): a
// TeX math glyph's character code names its symbol whatever the text layer
// says, so without a reference they tell which math symbols a candidate
// lost or misread, which figures are equations shown as pictures, and
// whether a display equation's LaTeX draws exactly the page's symbols at
// their script levels. The glyphs come from the parser's own walk of the
// operator list (drawing.ts); the symbols from the font tables
// (math-fonts.ts); the LaTeX's symbols from KaTeX.

/** A glyph as the checks read it. */
export type PageGlyph = Pick<Glyph, "family" | "code" | "unicode" | "x" | "y" | "w" | "size">;
export type PageGlyphs = { width: number; height: number; glyphs: PageGlyph[] };

/** A family of TeX's math fonts, whose codes the tables name. */
const MATH = new Set(["oml", "oms", "omx", "msa", "msb", "euf", "rsfs", "lasy"]);
/** Font names that carry TeX math families: a PDF without one is not read. */
const TEX_FONTS = /\+?(CMMI|CMMIB|CMSY|CMBSY|CMEX|MSAM|MSBM|EUF[MB]|RSFS|LASY|LMMath)/i;

const cache = new Map<string, Promise<PageGlyphs[] | null>>();
/** The walk's pages kept between runs (never committed): named by the PDF's
    bytes and the walk's own code, so a change to either reads them anew; a
    PDF keeps only its latest (a walk of a long PDF is 12 MB, and the walk's
    code changed often in round 1). */
const DISK = join(ROOT, ".bench", "cache", "glyphs");
const WALK_CODE = ["drawing.ts", "glyphs.ts"].map((f) => join(ROOT, "src", "lib", "parse", "pdf", f));

/** Let a file's glyphs go once no document still to score reads them. */
export function forgetGlyphs(path: string) {
  cache.delete(path);
}

/** Every page's glyphs, read once per file; null when the PDF sets no TeX
    math font (pdffonts says so without reading the pages). */
export function pdfGlyphs(path: string): Promise<PageGlyphs[] | null> {
  let hit = cache.get(path);
  if (!hit) {
    hit = (async () => {
      const fonts = execFileSync("pdffonts", [path], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
      if (!TEX_FONTS.test(fonts)) return null;
      const bytes = readFileSync(path);
      const pdfKey = createHash("sha1").update(bytes).digest("hex").slice(0, 16);
      const code = createHash("sha1");
      for (const file of WALK_CODE) code.update(readFileSync(file));
      const name = `${pdfKey}-${code.digest("hex").slice(0, 16)}.json`;
      const stored = join(DISK, name);
      if (existsSync(stored)) return JSON.parse(readFileSync(stored, "utf8")) as PageGlyphs[];
      const pdf = await getDocumentProxy(new Uint8Array(bytes));
      const pages: PageGlyphs[] = [];
      for (let p = 1; p <= pdf.numPages; p++) {
        const page = await pdf.getPage(p);
        const viewport = page.getViewport({ scale: 1 });
        const ops = (await page.getOperatorList()) as { fnArray: number[]; argsArray: unknown[] };
        const lookup: FontLookup = (id) => {
          try {
            const font = page.commonObjs.get(id) as { name?: string; fontMatrix?: number[]; vertical?: boolean } | null;
            return font ? { name: font.name ?? "", fontMatrix: font.fontMatrix, vertical: font.vertical } : null;
          } catch {
            return null;
          }
        };
        const glyphs = readDrawing(ops, lookup, viewport.width, viewport.height).glyphs.map(({ family, code, unicode, x, y, w, size }) => ({ family, code, unicode, x, y, w, size }));
        pages.push({ width: viewport.width, height: viewport.height, glyphs });
      }
      await pdf.loadingTask.destroy();
      mkdirSync(DISK, { recursive: true });
      // This PDF's walks by older code, and walks named before PDFs kept one.
      for (const old of readdirSync(DISK)) if (old !== name && (old.startsWith(`${pdfKey}-`) || /^[0-9a-f]{40}\.json$/.test(old))) rmSync(join(DISK, old), { force: true });
      writeFileSync(stored, JSON.stringify(pages));
      return pages;
    })();
    cache.set(path, hit);
  }
  return hit;
}

// ── Symbols and script levels, by KaTeX ─────────────────────────────────────

const INVISIBLE = /[\s​-‍⁠﻿]/u;
const drawnMemo = new Map<string, string[] | null>();

/** Each symbol KaTeX draws for a formula (display style), with its script
    level from the HTML's sizing classes (size 5–6: 0, 3–4: 1, 1–2: 2), as
    "symbol@level"; null when KaTeX cannot read it. */
function drawn(latex: string): string[] | null {
  if (drawnMemo.has(latex)) return drawnMemo.get(latex) ?? null;
  let html: string | null = null;
  try {
    html = katex.renderToString(latex, { output: "html", displayMode: true, throwOnError: true, strict: "ignore" });
  } catch {
    html = null;
  }
  let out: string[] | null = null;
  if (html !== null) {
    out = [];
    const stack = [0];
    for (const m of html.matchAll(/<span([^>]*)>|<\/span>|<svg[\s\S]*?<\/svg>|([^<]+)/g)) {
      if (m[0].startsWith("<svg")) continue;
      if (m[0] === "</span>") {
        stack.pop();
        continue;
      }
      if (m[1] !== undefined) {
        const size = /sizing reset-size\d+ size(\d+)/.exec(m[1]);
        stack.push(size ? (Number(size[1]) >= 5 ? 0 : Number(size[1]) >= 3 ? 1 : 2) : (stack.at(-1) ?? 0));
        continue;
      }
      const text = (m[2] ?? "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, "&");
      for (const ch of text.normalize("NFKC")) if (!INVISIBLE.test(ch)) out.push(`${ch}@${stack.at(-1) ?? 0}`);
    }
  }
  drawnMemo.set(latex, out);
  return out;
}

// ── A formula's atoms ───────────────────────────────────────────────────────

type Atom = { tex: string; cls: string; piece?: string; fam: string; code: number; size: number; x1: number; x2: number; y: number };

/** \not over a relation, as KaTeX spells the pair. */
const NOT: Record<string, string> = {
  "=": "\\neq",
  "\\in": "\\notin",
  "<": "\\nless",
  ">": "\\ngtr",
  "\\leq": "\\nleq",
  "\\geq": "\\ngeq",
  "\\subseteq": "\\nsubseteq",
  "\\supseteq": "\\nsupseteq",
  "\\sim": "\\nsim",
  "\\mid": "\\nmid",
  "\\exists": "\\nexists",
};
/** Two glyphs TeX joins into one arrow (\joinrel's overlap): left, right, the arrow. */
const JOINED: [string, string, string][] = [
  ["-", "\\rightarrow", "\\longrightarrow"],
  ["\\leftarrow", "-", "\\longleftarrow"],
  ["\\leftarrow", "\\rightarrow", "\\longleftrightarrow"],
  ["=", "\\Rightarrow", "\\Longrightarrow"],
  ["\\Leftarrow", "=", "\\Longleftarrow"],
  ["\\Leftarrow", "\\Rightarrow", "\\Longleftrightarrow"],
  ["lhook", "\\rightarrow", "\\hookrightarrow"],
  ["\\leftarrow", "rhook", "\\hookleftarrow"],
  ["\\mid", "=", "\\models"],
];

/** A formula's glyphs as atoms, the pieces TeX builds one symbol from
    joined into it (memo §1.5): \not over a relation, \mapstochar before an
    arrow, arrows joined by an overlap, three dots in a row. A glyph no
    table names makes the formula unreadable here: null. */
function atomsOf(glyphs: PageGlyph[]): Atom[] | null {
  const atoms: Atom[] = [];
  for (const g of glyphs) {
    if (!g.family) return null;
    const entry = mathGlyph(g.family, g.code);
    if (!entry) {
      if (g.unicode.trim()) return null;
      continue;
    }
    atoms.push({ tex: entry.latex, cls: entry.cls, piece: entry.piece, fam: g.family, code: g.code, size: g.size, x1: g.x, x2: g.x + Math.max(0, g.w), y: g.y });
  }
  atoms.sort((a, b) => a.x1 - b.x1 || b.y - a.y);
  const named = (a: Atom, name: string) => a.tex === name || a.piece === name;
  for (let i = 0; i < atoms.length; i++) {
    const a = atoms[i];
    const em = a.size;
    const find = (test: (b: Atom) => boolean) => atoms.findIndex((b, j) => j !== i && Math.abs(b.y - a.y) < 0.05 * em && test(b));
    if (a.piece === "not" || a.piece === "mapstochar") {
      const j = find((b) => Math.abs(b.x1 - a.x1) < 0.15 * em && (a.piece === "not" ? b.cls === "rel" : b.tex === "\\rightarrow" || b.tex === "-"));
      if (j < 0) continue;
      const b = atoms[j];
      if (a.piece === "not") b.tex = NOT[b.tex] ?? `\\not${b.tex}`;
      else {
        const k = b.tex === "-" ? find((c) => c.tex === "\\rightarrow" && Math.min(b.x2, c.x2) - Math.max(b.x1, c.x1) > 0.05 * em) : -1;
        if (k >= 0) {
          atoms[k].tex = "\\longmapsto";
          atoms.splice(Math.max(i, j), 1);
          atoms.splice(Math.min(i, j), 1);
          i = -1;
          continue;
        }
        b.tex = "\\mapsto";
      }
      b.cls = "rel";
      atoms.splice(i, 1);
      i = -1;
      continue;
    }
    const join = JOINED.find(([left]) => named(a, left));
    if (join) {
      const j = find((b) => named(b, join[1]) && b.x1 > a.x1 && Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1) > 0.08 * em && Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1) < 0.3 * em);
      if (j >= 0) {
        atoms[j].tex = join[2];
        atoms[j].cls = "rel";
        atoms.splice(i, 1);
        i = -1;
        continue;
      }
    }
    if ((a.tex === "." && a.fam === "oml") || a.tex === "\\cdot") {
      const j = find((b) => b.tex === a.tex && b.x1 > a.x2 && b.x1 - a.x2 < 0.3 * em);
      const k = j >= 0 ? find((c) => c.tex === a.tex && c.x1 > atoms[j].x2 && c.x1 - atoms[j].x2 < 0.3 * em) : -1;
      if (k >= 0) {
        atoms[k].tex = a.tex === "." ? "\\ldots" : "\\cdots";
        atoms[k].cls = "ord";
        for (const d of [i, j].sort((p, q) => q - p)) atoms.splice(d, 1);
        i = -1;
      }
    }
  }
  return atoms;
}

/** The symbols the atoms draw, each atom rendered alone at its script level
    (its size against the formula's largest glyph outside the extension
    font: 0.85 or more is 0, 0.6 or more is 1, else 2); null when KaTeX
    cannot read an atom. Pieces and radical signs draw as rules or pictures
    in KaTeX: they are left out on both sides. */
function atomSymbols(atoms: Atom[]): string[] | null {
  const big = Math.max(0, ...atoms.filter((a) => a.fam !== "omx").map((a) => a.size)) || Math.max(1, ...atoms.map((a) => a.size));
  const out: string[] = [];
  for (const a of atoms) {
    if (a.piece || a.cls === "piece" || a.cls === "radical" || !a.tex) continue;
    const r = a.size / big;
    const level = a.fam === "omx" ? 0 : r >= 0.85 ? 0 : r >= 0.6 ? 1 : 2;
    const own = drawn(a.cls === "accent" ? `${a.tex}{}` : a.tex);
    if (!own) return null;
    for (const s of own) {
      const at = s.lastIndexOf("@");
      out.push(`${s.slice(0, at)}@${Math.min(2, level + Number(s.slice(at + 1)))}`);
    }
  }
  return out;
}

const bag = (list: string[]) => {
  const m = new Map<string, number>();
  for (const x of list) m.set(x, (m.get(x) ?? 0) + 1);
  return m;
};

/** Symbols one bag holds more often than the other. */
function surplus(a: Map<string, number>, b: Map<string, number>): string[] {
  return [...a].flatMap(([k, n]) => Array.from({ length: Math.max(0, n - (b.get(k) ?? 0)) }, () => k));
}

/** The glyphs whose origin lies in a region of a page (percent of the page,
    y from the top, as the parser writes regions), word spaces aside. A math
    font's blank glyph stays: it is a symbol the text layer read as a space. */
function glyphsIn(page: PageGlyphs, region: Region): PageGlyph[] {
  const b = regionBounds(region);
  return page.glyphs.filter((g) => {
    const x = (g.x / page.width) * 100;
    const y = ((page.height - g.y) / page.height) * 100;
    return x >= b.x1 && x <= b.x2 && y >= b.y1 && y <= b.y2 && (g.unicode.trim() !== "" || (g.family !== null && MATH.has(g.family)));
  });
}

// ── The checks ──────────────────────────────────────────────────────────────

export type GlyphScores = {
  /** Math glyphs on the scored pages whose text layer string is not their symbol. */
  hazards: number;
  /** Of the symbols those glyphs draw, the ones the candidate prints fewer times than the pages draw them. */
  garbles: number;
  missing: [string, number][];
  /** Figures whose region holds only TeX fonts, a math glyph among them: equations shown as pictures. */
  mathImages: number;
  /** Display equations with a region, and those whose LaTeX draws exactly the region's symbols at their script levels. */
  checked: number;
  passed: number;
  fails: { latex: string; missing: string[]; extra: string[] }[];
};

/** A symbol as the garble count compares it: a relation with \not is one
    class (≠ ∉ ≰ …, precomposed), the maps-to arrows another. */
const NEGATED = "(negated relation)";
const MAPSTO = "↦";

/** Every character a candidate prints: its words, its list markers, its
    formulas (a parse's readable characters, else the glyphs KaTeX draws),
    and the glyph text under its equation pictures. */
function printedText(doc: Doc): string {
  const parts: string[] = [];
  const spans = (list: { text: string; latex?: string; mathml?: string }[] | undefined) => {
    for (const s of list ?? []) parts.push(s.text.trim() ? s.text : s.latex !== undefined || s.mathml !== undefined ? mathLeaves(s, false).join("") : "");
  };
  for (const b of doc.blocks) {
    switch (b.kind) {
      case "list":
        for (const item of b.items) {
          parts.push(item.marker);
          spans(item.spans);
        }
        break;
      case "table":
        spans(b.caption);
        for (const row of b.rows) for (const cell of row.cells) spans(cell.spans);
        break;
      case "equation":
        parts.push(mathLeaves(b, true).join(""), b.label ?? "");
        break;
      case "figure":
        if (b.mathImage) parts.push(b.mathImage);
        spans(b.caption);
        break;
      case "code":
        parts.push(b.text);
        break;
      case "separator":
        break;
      case "footnote":
        parts.push(b.label);
        spans(b.spans);
        break;
      default:
        spans(b.spans);
    }
  }
  return parts.join("\n");
}

/** Look-alikes a reader takes for one symbol: not a misreading. */
const LOOKALIKE: Record<string, string> = { "‖": "∥", "∆": "Δ", "-": "−", "*": "∗", "⋅": "·", "~": "∼", "'": "′", "∣": "|", "〈": "⟨", "〉": "⟩" };

function classOf(ch: string): string {
  if (ch === "↦" || ch === "⟼") return MAPSTO;
  if (ch !== "̸" && ch.normalize("NFD").includes("̸")) return NEGATED;
  return LOOKALIKE[ch] ?? ch;
}

/** The import keeps no equation's region: each of its equations takes the
    region of the parse's equation it was made from (the same LaTeX, in
    order). Without it the import's math went unchecked, and its composite
    left math out. */
export function placeEquations(parse: Doc, imported: Doc) {
  const placed = parse.blocks.filter((b) => b.kind === "equation" && b.at);
  let next = 0;
  for (const block of imported.blocks) {
    if (block.kind !== "equation" || block.at) continue;
    const i = placed.findIndex((b, k) => k >= next && b.kind === "equation" && b.latex === block.latex);
    if (i < 0) continue;
    block.at = placed[i].at;
    next = i + 1;
  }
}

/** The glyph checks of one candidate on its scored pages. */
export function glyphScores(pages: PageGlyphs[], doc: Doc, range: [number, number] | undefined): GlyphScores {
  const inRange = (p: number) => !range || (p >= range[0] && p <= range[1]);
  // Garbles: each math symbol the pages draw with a wrong text layer string,
  // against the times the candidate prints it.
  const expected = new Map<string, number>();
  const risky = new Set<string>();
  let hazards = 0;
  pages.forEach((page, i) => {
    if (!inRange(i + 1)) return;
    for (const g of page.glyphs) {
      if (!g.family || !MATH.has(g.family)) continue;
      const entry = mathGlyph(g.family, g.code);
      if (!entry || entry.cls === "accent") continue;
      const symbol = entry.piece === "not" ? NEGATED : entry.piece === "mapstochar" ? MAPSTO : entry.piece || !entry.unicode ? null : classOf(entry.unicode.normalize("NFC"));
      if (!symbol) continue;
      expected.set(symbol, (expected.get(symbol) ?? 0) + 1);
      const wrong = entry.piece ? g.unicode !== "" : g.unicode.normalize("NFC") !== entry.unicode.normalize("NFC");
      if (wrong) {
        hazards++;
        risky.add(symbol);
      }
    }
  });
  const printed = new Map<string, number>();
  for (const ch of printedText(doc).normalize("NFC")) printed.set(classOf(ch), (printed.get(classOf(ch)) ?? 0) + 1);
  const missing: [string, number][] = [...risky]
    .map((s): [string, number] => [s, (expected.get(s) ?? 0) - (printed.get(s) ?? 0)])
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);
  // Equations shown as pictures, and display equations checked.
  let mathImages = 0;
  let checked = 0;
  let passed = 0;
  const fails: GlyphScores["fails"] = [];
  for (const block of doc.blocks) {
    if (!block.at || !inRange(block.at.page)) continue;
    const page = pages[block.at.page - 1];
    if (!page) continue;
    const glyphs = glyphsIn(page, block.at.region);
    if (block.kind === "figure") {
      if (glyphs.length > 0 && glyphs.every((g) => g.family !== null) && glyphs.some((g) => MATH.has(g.family ?? ""))) mathImages++;
      continue;
    }
    if (block.kind !== "equation") continue;
    const atoms = atomsOf(glyphs);
    if (!atoms || atoms.length === 0) continue;
    checked++;
    const want = atomSymbols(atoms);
    // The printed label may lie inside the region or beside it.
    const label = block.label ? (/^\(.*\)$/.test(block.label) ? `\\tag{${block.label.slice(1, -1)}}` : `\\tag*{${block.label}}`) : "";
    const forms = [block.latex, ...(label ? [`${block.latex} ${label}`] : [])].map((latex) => drawn(latex));
    const results = forms.map((got) => (want && got ? { missing: surplus(bag(want), bag(got)), extra: surplus(bag(got), bag(want)) } : null));
    if (results.some((r) => r && r.missing.length === 0 && r.extra.length === 0)) passed++;
    else {
      const r = results.find((x) => x) ?? { missing: ["(KaTeX cannot read it)"], extra: [] };
      fails.push({ latex: block.latex, missing: r.missing, extra: r.extra });
    }
  }
  return {
    hazards,
    garbles: missing.reduce((n, [, k]) => n + k, 0),
    missing: missing.slice(0, 20),
    mathImages,
    checked,
    passed,
    fails,
  };
}
