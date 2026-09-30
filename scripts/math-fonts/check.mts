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
//      pages reads as one of the page's formulas (a crop or words pass);
//      so does each formula of invented pages of the same shape;
//   5. what round 4 fixed, on invented pages of each shape: each read
//      wrong, or as a crop or words, before its fix.
// Needs pdflatex, and mf for bbm's fonts (.bench/fonts/bbm/). The exit code
// is 1 when a check fails.
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
import { readDrawing, type Glyph, type Rule } from "@/lib/parse/pdf/drawing";
import { unicodeMath, type MathFamily } from "@/lib/parse/pdf/glyphs";
import { layoutLatex } from "@/lib/parse/pdf/math/check";
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
// (scripts/parse-bench/math-layout.mts); spaced: every space the LaTeX
// writes stays, as one mark.
function canon(tex: string, spaced = false): string {
  const space = spaced ? "<space/>" : "";
  try {
    return katex
      .renderToString(tex, { output: "mathml", throwOnError: true, displayMode: true })
      .replace(/<annotation[\s\S]*?<\/annotation>/, "")
      .replace(/<mspace[^>]*\/?>(<\/mspace>)?/g, space)
      .replace(/<mtext>[\s ⁡-⁤]*<\/mtext>/g, space)
      .replace(/(<space\/>)+/g, space)
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
// inline: the case reads the blocks' inline formulas, not their EQUATIONs;
// spaced: the spaces they write count; found: the page must hold one that
// reads as one of them (a crop or words fail).
type DisplayCase = { page: number; pick?: RegExp; right: string[]; inline?: boolean; spaced?: boolean; found?: boolean };

function wrongDisplays(blocks: { type: string; text: string; page?: number; math?: { latex: string }[] }[], cases: DisplayCase[]): string[] {
  const out: string[] = [];
  const hit = new Set<DisplayCase>();
  for (const b of blocks) {
    const formulas = [
      ...(b.type === "EQUATION" ? [{ latex: b.text.replace(/\s*\\tag\*?\{[^}]*\}\s*$/, ""), inline: false }] : []),
      ...(b.math ?? []).map((m) => ({ latex: m.latex, inline: true })),
    ];
    for (const f of formulas) {
      for (const c of cases) {
        if (c.page !== b.page || Boolean(c.inline) !== f.inline || (c.pick && !c.pick.test(f.latex))) continue;
        if (c.right.some((r) => canon(r, c.spaced) === canon(f.latex, c.spaced))) hit.add(c);
        else out.push(`p. ${b.page}: ${f.latex}`);
      }
    }
  }
  for (const c of cases) if (c.found && !hit.has(c)) out.push(`p. ${c.page}: none reads ${c.right[0]}`);
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
      // Inline: "|x| = {" before the cases' rows lost its brace, the rows
      // passing as \begin{aligned}; a √ over a fraction lost its root.
      file: "synthetic/synth-math-tex.pdf",
      cases: [
        { page: 6, inline: true, pick: /x,/, right: ["|x|=\\begin{cases} x, & x\\ge 0, \\\\ -x, & x<0 \\end{cases}"] },
        { page: 7, inline: true, pick: /n-1/, right: ["\\sqrt{\\frac{\\sum_{i=1}^n(x_i-\\bar{x})^2}{n-1}}"] },
      ],
    },
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
  // Two formulas a word space apart read as two, or as one that writes the
  // space: read as one without it, the letters either side of the space
  // were a product (G ∪ HG, H ∈ ℱ), which the glyph check cannot see. On
  // the page they are the glue a control space inside one formula is.
  const pairs: { words: string; right: string[] }[] = [
    { words: "The family is closed under $G \\cup H$ $G, H \\in \\mathcal{F}$, as the next lemma shows for every family.", right: ["G\\cup H", "G,H\\in\\mathcal{F}", "G\\cup H\\ G,H\\in\\mathcal{F}"] },
    { words: "For each pair we have $s \\le t$ $t \\le u$ and so the order is a chain of the elements.", right: ["s\\le t", "t\\le u", "s\\le t\\ t\\le u"] },
    { words: "The two sums $x = 2$ $y = 3$ are the first values the recursion takes in this example.", right: ["x=2", "y=3", "x=2\\ y=3"] },
    // The tightest line TeX sets: a word space of 0.222 em, after a letter
    // with no italic correction.
    { words: "{\\spaceskip=0.222em\\relax In a tight line $p \\in x$ $q \\in Q$ still are two formulas.}", right: ["p\\in x", "q\\in Q", "p\\in x\\ q\\in Q"] },
    // A quad inside one formula stays, or splits it in two right formulas.
    { words: "The rule $f(x) = 1 \\quad x > 0$ holds for the positive values.", right: ["f(x)=1\\quad x>0", "f(x)=1", "x>0"] },
  ];
  const pairPages = pairs.map((c) => `\\parbox{\\textwidth}{${c.words}}`);
  const pairParse = await parsePdf(new Uint8Array(readFileSync(typeset(dir, "pairs", packages, pairPages))));
  wrong.push(...wrongDisplays(pairParse.blocks, pairs.map((c, i) => ({ page: i + 1, inline: true, spaced: true, pick: /\\cup|\\le|\\in|=|>/, right: c.right }))));
  // Limits side by side, each centered on its operator or name a thin space
  // from the next, and the words of one limit as far apart: grown along the
  // baseline, two sums read as one sum with both lower limits
  // (\sum_{i=1j=1}^{n}\sum^{m}), two lim as one; a subarray's second row,
  // wider than its first, went to the words under the display. The glyph
  // check cannot see either.
  const limitCases: { tex: string; right?: string }[] = [
    { tex: "\\sum_{i=1}^{n}\\sum_{j=1}^{m} a_{ij}" },
    { tex: "\\sum_{j=1}^{k}\\sum_{p,q=1}^{n} a_{jpq}" },
    { tex: "\\lim_{s \\to +\\infty}\\lim_{t \\to +\\infty} g(s, t)" },
    { tex: "\\max_{x \\in X}\\max_{y \\in Y} h(x, y)" },
    { tex: "\\min_{x \\text{ feasible}}\\max_{y \\in Y} g(x, y)" },
    { tex: "\\lim_{x \\to 0 \\text{ and } y \\to 0} f(x, y)" },
    { tex: "\\sum_{g' \\in S(g)}\\bigwedge_{h \\in G} x_{g'h}" },
    { tex: "\\sum_{\\begin{subarray}{l} i \\in \\Lambda \\\\ 0 < j < n \\end{subarray}} P(i, j)", right: "\\sum_{\\substack{i \\in \\Lambda \\\\ 0 < j < n}} P(i, j)" },
  ];
  const around = "The quantity below is the one the argument needs, and every term of it is finite for the values we take here.";
  const limitPages = limitCases.map((c) => `${around} ${around}\\[ ${c.tex} \\]${around} ${around}`);
  const limitParse = await parsePdf(new Uint8Array(readFileSync(typeset(dir, "limits", packages, limitPages))));
  wrong.push(...wrongDisplays(limitParse.blocks, limitCases.map((c, i) => ({ page: i + 1, right: [c.tex, ...(c.right ? [c.right] : [])] }))));
  // A list's bullet a math font draws (acmart's itemize, newtxmath's •) is
  // the item's marker, never its formula's: "• scan(Pred)" read
  // \bullet\text{ scan}, and the import drew two bullets.
  const acm = join(import.meta.dirname, "..", "..", ".bench", "real", "acm-damon25-3736236.pdf");
  if (existsSync(acm)) {
    const parsed = await parsePdf(new Uint8Array(readFileSync(acm)), { pages: [3] });
    for (const b of parsed.blocks) {
      for (const m of b.math ?? []) if (/^\s*\\(bullet|cdot|circ|ast|star)\b/.test(m.latex)) wrong.push(`p. ${b.page}: a formula takes the item's bullet: ${m.latex}`);
    }
  } else console.log("displays: .bench/real/acm-damon25-3736236.pdf not there, skipped");
  for (const w of wrong) console.log(`WRONG DISPLAY ${w}`);
  console.log(`displays that once passed wrong: ${wrong.length === 0 ? "none reads wrong" : `${wrong.length} read wrong`}`);
  if (wrong.length > 0) failed = true;

  // 5: what round 4 fixed. Each page sets its case between two lines of
  // words, so the page has a column to center a display in.
  const fixed: string[] = [];
  const fill = `${around} ${around}`;
  const wide = String.raw`\bigwedge_{i,j\in N}\Big(\bigwedge_{(a,b)\in E}\big((x^{s}_{i,a}\wedge x^{s}_{j,b}\wedge z^{s}_{i})\implies y^{s}_{i,j}\big)\wedge\bigwedge_{(a,b)\notin E}\big((x^{s}_{i,a}\wedge x^{s}_{j,b}\wedge z^{s}_{j})\implies\neg y^{s}_{i,j}\big)\Big)`;
  const brace = String.raw`v(T_k)=3\left\{\sup_{\beta\in B_1^{(k)}\cup B_0^{(k)}}L(\beta)-\sup_{\beta\in B_0^{(k)}}L(\beta)\right\}.`;
  const flags = String.raw`\bigwedge_{p,q\in P}\left(\neg\mathrm{sw}^{1}_{p,q}\wedge\neg\mathrm{sw}^{2}_{p,q}\wedge\neg\mathrm{sw}^{3}_{p,q}\right)`;
  const pages: { tex: string; cases: Omit<DisplayCase, "page">[] }[] = [
    // A display too wide for its label sets the label on a row of its own
    // under it, reaching under the formula's end: read as the formula's
    // stray glyph, it made the display a crop.
    { tex: `${fill}\\begin{equation}${wide}\\end{equation}${fill}`, cases: [{ found: true, right: [wide] }] },
    // An inline fraction whose parts stand off the line, after the line's
    // last word: both parts were lost.
    { tex: String.raw`${fill} The map $z = \dfrac{x-\mu}{\sigma}$\\ sends each value to its score. ${fill}`, cases: [{ inline: true, found: true, pick: /mu/, right: [String.raw`z=\dfrac{x-\mu}{\sigma}`] }] },
    // eqnarray's second row opens with a stacked arrow centered under the
    // first row's "=": two rows of one display, aligned there.
    {
      tex: String.raw`${fill}\begin{eqnarray} g(y+h_n)-g(y) &=& \frac{u^T}{\sqrt{n}}v_n-\frac{1}{2}u^TKu+o(1)\nonumber\\ &\stackrel{P}{\longrightarrow}& N\left(-\frac{1}{2}u^TKu,u^TKu\right).\end{eqnarray}${fill}`,
      cases: [{ found: true, right: [String.raw`\begin{aligned} g(y+h_n)-g(y) &= \frac{u^T}{\sqrt{n}}v_n-\frac{1}{2}u^TKu+o(1) \\ &\xrightarrow{P} N\left(-\frac{1}{2}u^TKu,u^TKu\right). \end{aligned}`] }],
    },
    // A first row whose limit holds an arrow before the row's "=": the rows
    // align at "=" and "≥", not at the limit's arrow.
    {
      tex: String.raw`${fill}\begin{align*} \lim_{n\to\infty} m(g_n) &= \sup_n\{m_0(\phi):\phi\in S\}\\ &\ge \sup\{m_0(\psi):\psi\in S\} = m(g). \end{align*}${fill}`,
      cases: [{ found: true, right: [String.raw`\begin{aligned} \lim_{n\to\infty} m(g_n) &= \sup_n\{m_0(\phi):\phi\in S\} \\ &\ge \sup\{m_0(\psi):\psi\in S\} = m(g). \end{aligned}`] }],
    },
    // A matrix with its rows named beside it: KaTeX has no \bordermatrix,
    // and the middle row's name read as a factor ("P = B(…)"). No
    // EQUATION reads it.
    { tex: String.raw`${fill}\[ P = \begin{matrix} A\\ B\\ C\end{matrix}\begin{pmatrix} .5 & .25 & .25\\ .5 & 0 & .5\\ .25 & .25 & .5\end{pmatrix} \]${fill}`, cases: [{ right: [] }] },
    // A fraction's bar that runs past its parts by a tenth of an em, as
    // LibreOffice draws it: read without its bar, the parts stood as two rows.
    {
      tex: String.raw`${fill} The ratio $\dfrac{x}{\mskip2mu -x+1\mskip2mu}$\\ tends to $-1$ as $x$ grows. ${fill}`,
      cases: [{ inline: true, found: true, pick: /x\+1/, right: [String.raw`\dfrac{x}{-x+1}`] }],
    },
    // A citation after a formula is the sentence's.
    { tex: String.raw`The bound holds for $\gamma > 1$ [57] and fails for the smaller values. ${fill}`, cases: [{ inline: true, found: true, pick: /gamma/, right: [String.raw`\gamma>1`] }] },
    // Upright names with scripts inside a display: read as words, they
    // made it a crop.
    { tex: `${fill}\\begin{equation}${flags}\\end{equation}${fill}`, cases: [{ found: true, right: [flags] }] },
    // A tall brace in pieces over limits with scripts: its top pieces stood
    // on a line of their own, and read as two crops of a lone brace.
    { tex: `${fill}\\[ ${brace} \\]${fill}`, cases: [{ found: true, right: [brace] }] },
    // A proposition's list item: short lines of words between its displays
    // are sentences, never displays.
    {
      tex: String.raw`${fill}\begin{proposition} Assume the following:\begin{enumerate}\item[(a)] A local expansion: for $M_n = o(1)$,\[ \sup_{h\in B_n}|\bar g(\eta+h)-q(\eta,h)| \quad=\quad o_P(1) \]where $B_n=\{h\in\mathbb{R}^n:\|h\|_3\le M_n\}$ and\[ q(\eta,h) \quad=\quad \bar g(\eta)+h^T\nabla_\eta\bar g(\eta)+\frac{1}{2}h^T\nabla^2_{\eta\eta}\bar g(\eta)h. \]Further, $\|n^{-1/2}\nabla_\eta\bar g(\eta)\|_2$ and $\|\nabla^2_{\eta\eta}\bar g(\eta)\|_2$ are $O_P(1)$.\end{enumerate}\end{proposition}${fill}`,
      cases: [
        {
          right: [
            String.raw`\sup_{h\in B_n}|\bar g(\eta+h)-q(\eta,h)|=o_P(1)`,
            String.raw`q(\eta,h)=\bar g(\eta)+h^T\nabla_\eta\bar g(\eta)+\frac{1}{2}h^T\nabla^2_{\eta\eta}\bar g(\eta)h.`,
          ],
        },
      ],
    },
  ];
  const fixParse = await parsePdf(new Uint8Array(readFileSync(typeset(dir, "fixed", `${packages}\n\\newtheorem{proposition}{Proposition}`, pages.map((p) => p.tex)))));
  fixed.push(...wrongDisplays(fixParse.blocks, pages.flatMap((p, i) => p.cases.map((c) => ({ ...c, page: i + 1 })))));
  // A text italic's letters that a page's math takes (Times with mathptmx,
  // as MathDesign's Utopia and MathTime's Times): a lone letter between
  // upright words is a formula, a letter 0.44 em from a relation is the
  // relation's, and a letter with its scripts is one formula; an italic
  // phrase's letter ("E. coli") and a page with no math keep their words.
  const italicPages = [
    String.raw`In any tree $t$, she takes a strategy $s$ such that $t \in A$ holds, and $u(l) > u(t_j)$ for each lottery $l \in L(t_i)$, so that $\max_{l\in L(t)} u(l)$ is reached at $t_k$. The bacterium \textit{E. coli} grows in it.`,
    String.raw`Plan \textit{B} is the fallback when the first plan fails, and the team keeps it ready for the whole season.`,
    // A fraction in the text font's digits, its parts off the line: they were lost.
    String.raw`Braces around the fraction give the result $-\dfrac{1}{2}$ and the whole fraction is negative.`,
  ];
  // Each as the parse writes it: a found case picks its formula by its text.
  const italicRight = ["t", "s", String.raw`t\in A`, String.raw`u(l)>u(t_{j})`, String.raw`l\in L(t_{i})`, String.raw`\max_{l\in L(t)}u(l)`, String.raw`t_{k}`];
  const italicParse = await parsePdf(new Uint8Array(readFileSync(typeset(dir, "italic", `${packages}\n\\usepackage{mathptmx}`, italicPages))));
  fixed.push(
    ...wrongDisplays(italicParse.blocks, [
      { page: 1, inline: true, right: italicRight },
      ...italicRight.map((r) => ({ page: 1, inline: true, found: true, pick: new RegExp(`^${r.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&")}$`), right: [r] })),
      { page: 2, inline: true, right: [] },
      { page: 3, inline: true, found: true, right: [String.raw`-\dfrac{1}{2}`, String.raw`\dfrac{1}{2}`] },
    ]),
  );
  // bbm's blackboard letters, a Metafont font pdfTeX embeds as an unnamed
  // Type 3 font: 𝕜 and ℕ read as \mathrm{k} and \mathrm{N}.
  const bbmSource = join(import.meta.dirname, "..", "..", ".bench", "fonts", "bbm");
  if (existsSync(join(bbmSource, "bbm10.mf"))) {
    const bbm = String.raw`\newfam\bbmfam \font\tenbbm=bbm10 \font\sevenbbm=bbm7 \font\fivebbm=bbm5 \textfont\bbmfam=\tenbbm \scriptfont\bbmfam=\sevenbbm \scriptscriptfont\bbmfam=\fivebbm \def\mathbbm#1{{\fam\bbmfam #1}}`;
    const env = process.env.MFINPUTS;
    process.env.MFINPUTS = `${bbmSource}:`;
    try {
      const page = String.raw`Let $\mathbbm{k}$ be a field and $M$ a module over $\mathbbm{k}[x]$ graded by $\mathbbm{N}$. ${fill}\[ \dim_{\mathbbm{k}} M_n = \sum_{i\in\mathbbm{N}} \beta_{i,n}(M) \]${fill}`;
      const parsed = await parsePdf(new Uint8Array(readFileSync(typeset(dir, "bbm", `${packages}\n${bbm}`, [page]))));
      fixed.push(
        ...wrongDisplays(parsed.blocks, [
          { page: 1, found: true, right: [String.raw`\dim_{\Bbbk}M_n=\sum_{i\in\mathbb{N}}\beta_{i,n}(M)`] },
          { page: 1, inline: true, right: [String.raw`\Bbbk`, "M", String.raw`\Bbbk[x]`, String.raw`\mathbb{N}`] },
        ]),
      );
    } finally {
      if (env === undefined) delete process.env.MFINPUTS;
      else process.env.MFINPUTS = env;
    }
  } else console.log("fixes: .bench/fonts/bbm/ not there, bbm skipped");
  // A formula MathJax sets in STIX's first fonts (OpenStax's books), drawn
  // here glyph by glyph: parentheses built of the size font's pieces, an
  // exponent's fractions and its own exponent at the exponent's size, and
  // a radical drawn as three strokes and a rule. It was a crop.
  const at = (unicode: string, x: number, y: number, w: number, size: number, font: string): Glyph => ({
    font,
    base: font === "piece" ? "STIXSizeOneSym-Regular" : `STIXGeneral-${font}`,
    family: null,
    code: 0,
    unicode,
    x,
    y,
    w,
    size,
    mode: 0,
  });
  const drawn = unicodeMath([
    ...[["g", 72, "Italic"], ["(", 77, "Regular"], ["y", 80.5, "Italic"], [")", 85, "Regular"], ["=", 90, "Regular"]].map(([u, x, f]) => at(u as string, x as number, 429, 4.4, 10, f as string)),
    at("1", 114.2, 432.5, 5, 10, "Regular"),
    ...[["τ", 98, "Italic"], ["⋅", 106, "Regular"], ["3", 116.7, "Regular"], ["⋅", 124.4, "Regular"], ["π", 130.1, "Italic"]].map(([u, x, f]) => at(u as string, x as number, 421.5, 5, 10, f as string)),
    at("⋅", 146.9, 429, 2.9, 10, "Regular"),
    at("e", 155.1, 429, 4.4, 10, "Regular"),
    at("−", 160.2, 437.9, 5.5, 8, "Regular"),
    at("1", 166.7, 440.9, 4, 8, "Regular"),
    at("3", 166.7, 433.1, 4, 8, "Regular"),
    at("⋅", 173.6, 437.9, 2.3, 8, "Regular"),
    at("⎛", 178.1, 441.9, 2.8, 6.3, "piece"),
    at("⎝", 178.1, 435.7, 2.8, 6.3, "piece"),
    at("y", 181.4, 442.6, 3.6, 8, "Italic"),
    at("−", 186.8, 442.6, 5.5, 8, "Regular"),
    at("ν", 194.3, 442.6, 4, 8, "Italic"),
    at("τ", 187.8, 435, 4, 8, "Italic"),
    at("⎞", 199.2, 441.9, 2.8, 6.3, "piece"),
    at("⎠", 199.2, 435.7, 2.8, 6.3, "piece"),
    at("2", 202.3, 445.3, 4, 8, "Regular"),
  ]);
  const bar = (x1: number, x2: number, y: number, thickness: number): Rule => ({ dir: "h", x1, x2, y1: y, y2: y, thickness });
  const strokes = [
    { x1: 112.2, y1: 425.6, x2: 113.1, y2: 427.3 },
    { x1: 113.1, y1: 421.3, x2: 114.4, y2: 427.3 },
    { x1: 114.4, y1: 421.3, x2: 116.7, y2: 429.9 },
  ];
  const stix = layoutLatex(drawn, [bar(97.3, 136.1, 431.5, 0.6), bar(116.7, 135.9, 429.9, 0.2), bar(166.1, 171.4, 440, 0.5), bar(180.6, 199.2, 440, 0.5)], { display: true, size: 10 }, strokes);
  const stixRight = String.raw`g(y)=\frac{1}{\tau\cdot\sqrt{3\cdot\pi}}\cdot\mathrm{e}^{-\tfrac{1}{3}\cdot\left(\tfrac{y-\nu}{\tau}\right)^{2}}`;
  if (!stix.check.ok || canon(stix.latex) !== canon(stixRight)) fixed.push(`STIX: ${stix.latex || "(no reading)"} ${JSON.stringify(stix.check)}`);
  for (const w of fixed) console.log(`NOT FIXED ${w}`);
  console.log(`round 4's fixes: ${fixed.length === 0 ? "each reads right" : `${fixed.length} read wrong`}`);
  if (fixed.length > 0) failed = true;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
