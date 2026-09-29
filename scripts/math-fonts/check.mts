// Checks the math font tables (src/lib/parse/pdf/math-fonts.ts) against TeX
// and KaTeX, and the parser's reading of TeX math glyphs:
//   1. round trip: every entry with a command is typeset alone with pdflatex
//      and read back through the drawing walk; the page must draw the
//      entry's family and code;
//   2. KaTeX renders every entry's command;
//   3. composites: each construct TeX builds from two glyphs (≠ ↦ ⟹ ≅ …),
//      and the symbols the text layer garbles, typeset without and with
//      pdfTeX's Unicode map, read as their characters in parsePdf's text;
//   4. displays that once passed the check wrong: each EQUATION on their
//      pages reads as one of the page's formulas (a crop or words pass).
// Needs pdflatex. The exit code is 1 when a check fails.
//
//   npx tsx scripts/math-fonts/check.mts [--verbose]
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import katex from "katex";
import { getDocumentProxy } from "unpdf";
import { PDF_CMAPS } from "@/lib/pdf-runtime";
import { parsePdf } from "@/lib/parse/pdf";
import { readDrawing, type Glyph } from "@/lib/parse/pdf/drawing";
import type { MathFamily } from "@/lib/parse/pdf/glyphs";
import { mathGlyph, type MathGlyph } from "@/lib/parse/pdf/math-fonts";

const verbose = process.argv.includes("--verbose");
const FAMILIES: MathFamily[] = ["oml", "oms", "omx", "msa", "msb", "euf", "rsfs", "lasy", "esint", "ot1"];
const SIZES = ["\\bigl", "\\Bigl", "\\biggl", "\\Biggl"];

// pdf.js prints font warnings; they are not the check's output.
const warn = console.warn;
console.warn = (...args: unknown[]) => {
  if (typeof args[0] === "string" && /^(Warning|Info):/.test(args[0])) return;
  warn(...args);
};

type Test = { label: string; tex: string; family: MathFamily; code: number };

// The LaTeX that draws an entry's glyph, or null when no command selects it
// alone (a piece, a radical, a size TeX picks by what it covers).
function sourceOf(family: MathFamily, code: number, e: MathGlyph): string | null {
  if (!e.latex || e.cls === "piece" && e.piece !== "not") return null;
  if (e.piece === "not") return "$a\\not=b$";
  if (family === "oml" && code >= 0x30 && code <= 0x39) return `$\\mathnormal{${code - 0x30}}$`;
  if (family === "oms" && code === 0x73) return "$\\smallint$";
  // Math takes these from OML and OMS; text takes them from OT1.
  if (family === "ot1" && [0x27, 0x2c, 0x2d, 0x2e, 0x2f].includes(code)) return `\\textrm{${e.latex}}`;
  if (e.wide) return family === "omx" ? `$${e.latex}{${["x", "xy", "xyz"][(code - 0x62) % 3]}}$` : null;
  if (e.cls === "accent") return `$${e.latex}{x}$`;
  if (family === "omx" && e.size) {
    const size = SIZES[e.size - 1];
    return e.cls === "close" ? `$${size.replace("l", "r")}${e.latex}$` : e.cls === "open" ? `$${size}${e.latex}$` : `$${size.slice(0, -1)}${e.latex}$`;
  }
  if (family === "omx" && e.piece === "vrep") return `$\\big${e.latex}$`;
  if ((family === "omx" || family === "esint") && e.cls === "op") return `$${e.display ? "\\displaystyle" : "\\textstyle"}${e.latex}$`;
  if (family === "ot1" && e.upright) return `$\\mathrm{${e.latex}}$`;
  return `$${e.latex}$`;
}

// KaTeX's MathML with spacing, attributes, and empty operators set aside
// (scripts/parse-bench/math-layout.mts).
function canon(tex: string): string {
  try {
    return katex
      .renderToString(tex, { output: "mathml", throwOnError: true, displayMode: true })
      .replace(/<annotation[\s\S]*?<\/annotation>/, "")
      .replace(/<mspace[^>]*\/?>(<\/mspace>)?/g, "")
      .replace(/<mtext>[\s ⁡-⁤]*<\/mtext>/g, "")
      .replace(/<mo[^>]*><\/mo>/g, "")
      .replace(/ (?!mathvariant|linethickness)[a-z]+="[^"]*"/g, "")
      .replace(/<\/?mrow>/g, "")
      .replace(/\s+/g, " ");
  } catch (err) {
    return `ERR ${(err as Error).message}`;
  }
}

// A page's displays that once passed the check wrong: each EQUATION on the
// page (or each whose LaTeX pick matches) reads as one of the right
// formulas, its \tag aside; a crop or words pass.
type DisplayCase = { page: number; pick?: RegExp; right: string[] };

function wrongDisplays(blocks: { type: string; text: string; page?: number }[], cases: DisplayCase[]): string[] {
  const out: string[] = [];
  for (const b of blocks) {
    if (b.type !== "EQUATION") continue;
    const latex = b.text.replace(/\s*\\tag\*?\{[^}]*\}\s*$/, "");
    for (const c of cases) {
      if (c.page !== b.page || (c.pick && !c.pick.test(latex))) continue;
      if (!c.right.some((f) => canon(f) === canon(latex))) out.push(`p. ${b.page}: ${b.text}`);
    }
  }
  return out;
}

function typeset(dir: string, name: string, preamble: string, pages: string[]): string {
  const body = pages.map((p) => `\\noindent ${p}\\newpage`).join("\n");
  writeFileSync(join(dir, `${name}.tex`), `\\documentclass{article}\n${preamble}\n\\pagestyle{empty}\n\\begin{document}\n${body}\n\\end{document}\n`);
  execFileSync("pdflatex", ["-interaction=nonstopmode", "-halt-on-error", `${name}.tex`], { cwd: dir, stdio: "ignore" });
  return join(dir, `${name}.pdf`);
}

async function pageGlyphs(file: string): Promise<Glyph[][]> {
  const pdf = await getDocumentProxy(new Uint8Array(readFileSync(file)), PDF_CMAPS);
  const out: Glyph[][] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const viewport = page.getViewport({ scale: 1 });
    const ops = (await page.getOperatorList()) as { fnArray: number[]; argsArray: unknown[] };
    const fonts = (id: string) => {
      try {
        const font = page.commonObjs.get(id) as { name?: string; fontMatrix?: number[] } | null;
        return font ? { name: font.name ?? "", fontMatrix: font.fontMatrix } : null;
      } catch {
        return null;
      }
    };
    out.push(readDrawing(ops, fonts, viewport.width, viewport.height).glyphs);
  }
  return out;
}

const dir = mkdtempSync(join(tmpdir(), "math-fonts-"));
let failed = false;
try {
  // 1 and 2: every entry.
  const tests: Test[] = [];
  const lasyTests: Test[] = [];
  const esintTests: Test[] = [];
  const skipped: string[] = [];
  let katexFailures = 0;
  for (const family of FAMILIES) {
    for (let code = 0; code < 128; code++) {
      const e = mathGlyph(family, code);
      if (!e) continue;
      const label = `${family}:${code.toString(16).padStart(2, "0")} ${e.latex || e.piece}`;
      if (e.latex) {
        const tex = e.cls === "accent" ? `${e.latex}{x}` : e.piece === "not" ? "\\not=" : e.latex;
        try {
          katex.renderToString(tex, { throwOnError: true, strict: "ignore" });
        } catch (error) {
          katexFailures++;
          console.log(`KATEX ${label}: ${String((error as Error).message).slice(0, 80)}`);
        }
      }
      const source = sourceOf(family, code, e);
      if (source === null) {
        if (e.latex) skipped.push(label);
        continue;
      }
      (family === "lasy" ? lasyTests : family === "esint" ? esintTests : tests).push({ label, tex: source, family, code });
    }
  }
  const packages = "\\usepackage{amsmath,amssymb,mathrsfs,eufrak}";
  const runs = [
    { tests, file: typeset(dir, "table", packages, tests.map((t) => t.tex)) },
    { tests: lasyTests, file: typeset(dir, "lasy", "\\usepackage{latexsym}", lasyTests.map((t) => t.tex)) },
    { tests: esintTests, file: typeset(dir, "esint", "\\usepackage{esint}", esintTests.map((t) => t.tex)) },
  ];
  let passed = 0;
  let total = 0;
  for (const run of runs) {
    const pages = await pageGlyphs(run.file);
    run.tests.forEach((t, i) => {
      total++;
      const glyphs = pages[i] ?? [];
      if (glyphs.some((g) => g.family === t.family && g.code === t.code)) {
        passed++;
        return;
      }
      console.log(`MISMATCH ${t.label}: ${t.tex} draws ${glyphs.map((g) => `${g.family ?? g.base}:${g.code.toString(16)}`).join(" ")}`);
    });
  }
  const entries = FAMILIES.reduce((n, f) => n + [...Array(128).keys()].filter((c) => mathGlyph(f, c)).length, 0);
  console.log(`round trip: ${passed} of ${total} typeset commands draw their entry's glyph`);
  console.log(`KaTeX: ${entries - katexFailures} of ${entries} entries render (pieces with no command count as rendered)`);
  if (verbose) console.log(`not typeset alone (a size TeX picks, msb wide accents): ${skipped.join(", ")}`);
  if (passed < total || katexFailures > 0) failed = true;

  // 3: composites and garbled symbols, read by the parser, each inside a
  // sentence (a formula alone on a page reads as a picture). The last one
  // compares characters only: where a big operator and its limits land in
  // the line is the layout's business.
  const composites: [string, string][] = [
    ["a\\neq b", "a≠b"],
    ["x\\notin A", "x∉A"],
    ["x\\not\\in A", "x∉A"],
    ["A\\not\\subset B", "A⊄B"],
    ["a\\not\\equiv b", "a≢b"],
    ["x\\mapsto y", "x↦y"],
    ["x\\longmapsto y", "x⟼y"],
    ["a\\longrightarrow b", "a⟶b"],
    ["a\\longleftarrow b", "a⟵b"],
    ["a\\longleftrightarrow b", "a⟷b"],
    ["A\\Longrightarrow B", "A⟹B"],
    ["A\\implies B", "A⟹B"],
    ["A\\Longleftarrow B", "A⟸B"],
    ["A\\Longleftrightarrow B", "A⟺B"],
    ["A\\iff B", "A⟺B"],
    ["A\\xrightarrow{} B", "A⟶B"],
    ["A\\xleftarrow{} B", "A⟵B"],
    ["A\\hookrightarrow B", "A↪B"],
    ["A\\hookleftarrow B", "A↩B"],
    ["M\\models p", "M⊨p"],
    ["A\\bowtie B", "A⋈B"],
    ["A\\cong B", "A≅B"],
    ["a\\doteq b", "a≐b"],
    ["a\\dashrightarrow b", "a⇢b"],
    ["a\\dashleftarrow b", "a⇠b"],
    ["\\vec{v}", "v⃗"],
    ["\\hat{\\alpha}", "α̂"],
    ["\\widehat{\\Omega}", "Ω̂"],
    ["\\epsilon+\\ell+\\varphi+\\phi", "ϵ+ℓ+φ+ϕ"],
    ["\\mathcal{A}\\cup\\mathbb{R}\\cup\\mathfrak{g}\\cup\\mathscr{L}", "𝒜∪ℝ∪𝔤∪ℒ"],
    ["a\\ominus b\\oslash c\\odot d", "a⊖b⊘c⊙d"],
    ["\\lfloor x\\rfloor\\vdash\\square", "⌊x⌋⊢□"],
    // \Biggl( is code 0x20 and \bigl\langle code 0x0A: pdf.js reads them as
    // spaces and drops them, and the parser rebuilds them from the drawing. A
    // sized delimiter hangs from its origin: the parser stands it on its
    // baseline, so it reads in its place.
    ["\\Biggl(x\\Biggr)\\bigl\\langle y\\bigr\\rangle\\Bigl\\{z\\Bigr\\}\\Big|w\\Big|", "(x)⟨y⟩{z}|w|"],
    ["\\sum_{i}\\int_{0}\\bigcup_{n}", "∑∫⋃"],
  ];
  const unordered = new Set(composites.slice(-1).map(([tex]) => tex));
  // Prose above and below keeps the formula's line off the page's edges,
  // where a line repeated page after page reads as a running head.
  const prose = "Words fill this paragraph so that the formula sits in the middle of the page, well inside the text. ".repeat(3);
  const sources = composites.map(([tex]) => `\\vspace*{3cm}${prose}\\par\\noindent The formula $${tex}$ stands in this sentence.\\par\\noindent ${prose}`);
  for (const regime of ["\\pdfgentounicode=0", "\\pdfgentounicode=1"]) {
    const file = typeset(dir, "composites", `${packages}\n${regime}`, sources);
    const parsed = await parsePdf(new Uint8Array(readFileSync(file)));
    const byPage = new Map<number, string>();
    for (const b of parsed.blocks) byPage.set(b.page ?? 0, (byPage.get(b.page ?? 0) ?? "") + b.text);
    if (parsed.title) byPage.set(1, parsed.title + (byPage.get(1) ?? ""));
    let good = 0;
    composites.forEach(([tex, want], i) => {
      const text = (byPage.get(i + 1) ?? "").replace(/\s/g, "");
      const got = /Theformula(.*?)standsinthissentence/.exec(text)?.[1] ?? text;
      if (unordered.has(tex) ? [...want].every((c) => text.includes(c)) : got === want.normalize("NFC")) good++;
      else console.log(`COMPOSITE ${regime.slice(-1) === "0" ? "no map" : "pdfTeX map"}: ${tex} reads ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
    });
    console.log(`composites, ${regime.endsWith("0") ? "no Unicode map" : "pdfTeX's Unicode map"}: ${good} of ${composites.length} read right`);
    if (good < composites.length) failed = true;
  }

  // 4: displays that once passed the check wrong. Typeset in Times with
  // mathptmx, a formula's letters are a text italic's, as Springer's
  // MathTime sets them: round 2 read them as \mathrm. The corpus's pages run
  // when .bench holds them: Springer's (12) passed without the braces its
  // extension font hangs over its first row, (29) without the limits under
  // its two "lim"s, the page's last line; arXiv 2506.08494's Theorems 8
  // and 12 read their exponent Σd_j/2 as a big operator after the bracket,
  // (2.12) paired its norm with the absolute value's first bar, and (2.14)
  // set λ's subscript "max" on λ's baseline.
  const cases: { tex: string; words: string }[] = [
    { tex: "\\lim_{x\\to\\pm\\infty} a(x,t) = \\lim_{x\\to\\pm\\infty} b(x,t) = 0.", words: "The display ends the page, its limits on the page's last line." },
    { tex: "\\max_{k\\le n} |S_k| \\le \\sup_{t\\in[0,1]} |B_t|.", words: "A display with limits under two names stands between two sentences." },
  ];
  const sheet = cases.map((c, i) => `${c.words} Case ${i + 1} follows.\\begin{equation}${c.tex}\\end{equation}${i === 0 ? "" : "Words follow the display."}`);
  const times = await parsePdf(new Uint8Array(readFileSync(typeset(dir, "displays", `${packages}\n\\usepackage{mathptmx}`, sheet))));
  const wrong = wrongDisplays(times.blocks, cases.map((c, i) => ({ page: i + 1, right: [c.tex] })));
  const bold = "(\\mathbf{n},\\mathbf{m}";
  const norm = "\\left\\|\\prod_{j=1}^{n}f_j(\\xi_j)\\right\\|";
  const corpus: { file: string; cases: DisplayCase[] }[] = [
    {
      file: "real/springer-bmb-01377.pdf",
      cases: [
        { page: 6, right: [`\\frac{\\partial p}{\\partial t}${bold},t)=(\\mathcal{D}+\\mathcal{R})p${bold},t).`, `\\varphi${bold})=\\lim_{t\\to\\infty}p${bold},t)`, `0=(\\mathcal{D}+\\mathcal{R})\\varphi${bold}).`] },
        {
          page: 11,
          right: [
            "A\\xrightarrow{k_2}B\\xrightarrow{k_3}\\emptyset.",
            "\\frac{\\partial a}{\\partial t}=D_A\\frac{\\partial^2a}{\\partial x^2}-k_2a+2k_1\\delta(x),",
            "\\frac{\\partial b}{\\partial t}=D_B\\frac{\\partial^2b}{\\partial x^2}+k_2a-k_3b,",
            "\\lim_{x\\to\\pm\\infty}a(x,t)=\\lim_{x\\to\\pm\\infty}b(x,t)=0.",
          ],
        },
      ],
    },
    {
      file: "arxiv/2506.08494v1.pdf",
      cases: [
        {
          page: 4,
          pick: /\\eta_\{j\}/,
          right: ["\\left\\|\\prod_{j=1}^{n}\\left|(\\widehat{g}_j/\\widehat{e_{t_j}})(\\eta_j)\\right|^{p_j}\\right\\|_\\alpha\\le\\left\\|\\prod_{j=1}^{n}\\left|(g_j/e_{t_j})(\\xi_j)\\right|^{p_j}\\right\\|_1"],
        },
        {
          page: 4,
          pick: /\\mu\\xi/,
          right: [
            "\\left\\|e^{\\frac{|\\xi|^2}{2q\\lambda_{\\max}}}\\prod_{j=1}^{n}\\widehat{g}_j(\\mu\\xi_j)\\right\\|_q\\le(p\\lambda_{\\min})^{\\frac{\\sum k_j}{2}}\\left\\|e^{\\frac{|\\xi|^2}{2p\\lambda_{\\min}}}\\prod_{j=1}^{n}g_j(\\xi_j)\\right\\|_p",
          ],
        },
        { page: 5, pick: /d_\{j\}/, right: [`${norm}_q\\le\\max\\left\\{\\frac{1}{p\\lambda_{\\min}-1},q\\lambda_{\\max}-1\\right\\}^{\\sum d_j/2}${norm}_p`] },
        { page: 7, pick: /d_\{j\}/, right: [`${norm}_q\\le\\left(\\frac{q\\lambda_{\\min}-1}{p\\lambda_{\\min}-1}\\right)^{\\sum d_j/2}${norm}_p`] },
      ],
    },
  ];
  for (const { file, cases: pageCases } of corpus) {
    const pdf = join(import.meta.dirname, "..", "..", ".bench", file);
    if (!existsSync(pdf)) {
      console.log(`displays: .bench/${file} not there, skipped`);
      continue;
    }
    const parsed = await parsePdf(new Uint8Array(readFileSync(pdf)), { pages: pageCases.map((c) => c.page) });
    wrong.push(...wrongDisplays(parsed.blocks, pageCases));
  }
  for (const w of wrong) console.log(`WRONG DISPLAY ${w}`);
  console.log(`displays that once passed wrong: ${wrong.length === 0 ? "none reads wrong" : `${wrong.length} read wrong`}`);
  if (wrong.length > 0) failed = true;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
