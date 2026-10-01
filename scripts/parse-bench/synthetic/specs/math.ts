/**
 * A math stress sheet: 70 formulas from a single superscript to nested structures, each once inline in a
 * sentence and once as a numbered display, grouped by what they stress (scripts and accents, fractions and
 * roots, big operators, delimiters, fonts, relations and arrows, matrices and cases, harder combinations).
 * Rendered by amsart (Computer Modern, running heads from the title and the author) and by HTML with KaTeX
 * (KaTeX's own fonts). The reference's LaTeX is exactly the source's.
 */
import { eq, h, m, p, role, sc, title, type Spec, type SpecBlock } from "../spec";

/** One formula: the sentence that sets it inline, and its display with the next number. */
type Entry = [before: string, latex: string, after: string];

const GROUPS: [string, Entry[]][] = [
  [
    "Scripts and accents",
    [
      ["The square ", "x^2", " has one superscript."],
      ["A matrix entry ", "a_{ij}", " has a two-letter subscript."],
      ["The term ", "x_i^2", " stacks a subscript under a superscript."],
      ["Euler’s identity ", "e^{i\\pi}+1=0", " has a superscript of two symbols."],
      ["The isotope ", "{}^{14}_{6}\\mathrm{C}", " puts its scripts before the letter."],
      ["Three accents: ", "\\hat{x}+\\bar{y}+\\tilde{z}", "."],
      ["A vector and two time derivatives: ", "\\vec{v}\\cdot\\dot{x}+\\ddot{y}", "."],
      ["Wide accents stretch over their argument: ", "\\widehat{AB}+\\overline{z+w}", "."],
      ["Primes are superscripts too: ", "f'(x)+f''(x)", "."],
      ["A tower of exponents: ", "x^{y^{z}}", "."],
    ],
  ],
  [
    "Fractions and roots",
    [
      ["The simplest fraction is ", "\\frac{1}{2}", "."],
      ["A fraction of sums: ", "\\frac{a+b}{c-d}", "."],
      ["Text-style and display-style fractions side by side: ", "\\tfrac{1}{2}\\,\\dfrac{1}{2}", "."],
      ["The square root ", "\\sqrt{2}", " is irrational."],
      ["A cube root of a sum: ", "\\sqrt[3]{x^2+y^2}", "."],
      ["A continued fraction: ", "\\frac{1}{1+\\frac{1}{x}}", "."],
      ["The binomial coefficient ", "\\binom{n}{k}=\\frac{n!}{k!\\,(n-k)!}", " counts subsets."],
      ["Laplace’s equation in the plane: ", "\\frac{\\partial^2 u}{\\partial x^2}+\\frac{\\partial^2 u}{\\partial y^2}=0", "."],
    ],
  ],
  [
    "Big operators",
    [
      ["Gauss’s sum ", "\\sum_{i=1}^{n} i=\\frac{n(n+1)}{2}", " has limits under and over the sigma."],
      ["Euler’s product ", "\\prod_{p\\text{ prime}}\\frac{1}{1-p^{-s}}", " runs over the primes."],
      ["A definite integral: ", "\\int_0^1 x^2\\,dx=\\frac{1}{3}", "."],
      ["The Gaussian integral ", "\\int_{-\\infty}^{\\infty}e^{-x^2}\\,dx=\\sqrt{\\pi}", " has infinite limits."],
      ["A double integral over a region: ", "\\iint_{D}f(x,y)\\,dx\\,dy", "."],
      ["A contour integral: ", "\\oint_{\\gamma}\\frac{dz}{z}=2\\pi i", "."],
      ["A union and an intersection: ", "\\bigcup_{n\\ge 1}A_n\\subseteq\\bigcap_{k}B_k", "."],
      ["The limit ", "\\lim_{n\\to\\infty}\\left(1+\\frac{1}{n}\\right)^n=e", " defines the number e."],
      ["The upper limit of a sequence: ", "\\limsup_{n\\to\\infty}a_n", "."],
      ["A maximum over an index range: ", "\\max_{1\\le i\\le n}|x_i|", "."],
    ],
  ],
  [
    "Delimiters",
    [
      ["Parentheses that grow with a fraction: ", "\\left(\\frac{a}{b}\\right)", "."],
      ["A half-open interval: ", "\\left[0,1\\right)", "."],
      ["A set in braces: ", "\\left\\{x\\in\\mathbb{R}:x>0\\right\\}", "."],
      ["An absolute value and a norm: ", "\\left|x\\right|+\\left\\|v\\right\\|", "."],
      ["An inner product in angle brackets: ", "\\langle u,v\\rangle", "."],
      ["The floor and the ceiling: ", "\\lfloor x\\rfloor+\\lceil y\\rceil", "."],
      ["A delimiter sized by hand: ", "\\bigl(a+b\\bigr)^2", "."],
    ],
  ],
  [
    "Fonts",
    [
      ["Blackboard bold names a space: ", "\\mathbb{R}^n", "."],
      ["A calligraphic letter names a family of sets: ", "\\mathcal{F}\\subseteq 2^{\\Omega}", "."],
      ["A bold letter names an operator: ", "\\mathbf{E}[X]", "."],
      ["A Fraktur letter names a Lie algebra: ", "\\mathfrak{g}", "."],
      ["A script letter: ", "\\mathscr{L}", "."],
      ["An upright differential: ", "\\mathrm{d}x", "."],
      ["An operator name: ", "\\operatorname{Var}(X)", "."],
      ["A bold Greek letter: ", "\\boldsymbol{\\alpha}", "."],
      ["A sans-serif letter: ", "\\mathsf{A}", "."],
      ["Words inside a formula: ", "\\text{if }x>0", "."],
    ],
  ],
  [
    "Relations and arrows",
    [
      ["Four comparisons in a row: ", "a\\le b\\ge c\\ne d", "."],
      ["A function written by its rule: ", "x\\mapsto f(x)", "."],
      ["An implication and an equivalence: ", "A\\Longrightarrow B\\iff C", "."],
      ["A map between sets: ", "f:X\\to Y", "."],
      ["A congruence: ", "a\\equiv b\\pmod{n}", "."],
      ["Three kinds of nearness: ", "x\\approx y\\sim z\\simeq w", "."],
      ["A proper subset: ", "A\\subsetneq B", "."],
      ["Quantifiers: ", "\\forall\\varepsilon>0\\ \\exists\\delta>0", "."],
      ["The curl of a field: ", "\\nabla\\times\\mathbf{F}", "."],
    ],
  ],
  [
    "Matrices, cases, and arrays",
    [
      ["A matrix in parentheses: ", "\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}", "."],
      ["The identity in brackets: ", "\\begin{bmatrix}1&0\\\\0&1\\end{bmatrix}", "."],
      ["A determinant: ", "\\begin{vmatrix}a&b\\\\c&d\\end{vmatrix}=ad-bc", "."],
      ["A function by cases: ", "|x|=\\begin{cases}x,&x\\ge 0,\\\\-x,&x<0\\end{cases}", "."],
      ["A general matrix with dots: ", "\\begin{pmatrix}a_{11}&\\cdots&a_{1n}\\\\\\vdots&\\ddots&\\vdots\\\\a_{m1}&\\cdots&a_{mn}\\end{pmatrix}", "."],
      ["An array with a rule: ", "\\begin{array}{c|c}x&f(x)\\\\\\hline 0&1\\end{array}", "."],
    ],
  ],
  [
    "Harder combinations",
    [
      ["Two aligned lines: ", "\\begin{aligned}(a+b)^2&=a^2+2ab+b^2\\\\&\\ge 4ab\\end{aligned}", "."],
      ["Chebyshev’s bound for a mean: ", "\\mathbf{P}\\left(\\left|\\frac{S_n}{n}-\\mu\\right|>\\varepsilon\\right)\\le\\frac{\\sigma^2}{n\\varepsilon^2}", "."],
      ["The zeta function as a sum and a product: ", "\\zeta(s)=\\sum_{n=1}^{\\infty}\\frac{1}{n^s}=\\prod_{p}\\frac{1}{1-p^{-s}}", "."],
      ["The Fourier transform: ", "\\hat{f}(\\xi)=\\int_{\\mathbb{R}}f(x)\\,e^{-2\\pi i x\\xi}\\,dx", "."],
      ["A brace under a sum: ", "\\underbrace{1+1+\\cdots+1}_{n\\text{ times}}=n", "."],
      ["A brace over a sum: ", "\\overbrace{a+\\cdots+a}^{k}", "."],
      ["The sample standard deviation: ", "\\sqrt{\\frac{\\sum_{i=1}^n(x_i-\\bar{x})^2}{n-1}}", "."],
      ["A derivative of an integral with moving limits: ", "\\frac{d}{dt}\\int_{a(t)}^{b(t)}f(x,t)\\,dx", "."],
      ["Kolmogorov’s maximal inequality: ", "\\Pr\\Bigl[\\,\\max_{k\\le n}|S_k|\\ge\\lambda\\Bigr]\\le\\frac{\\mathbf{E}S_n^2}{\\lambda^2}", "."],
      ["The exponential series: ", "e^{x}=\\sum_{k=0}^{\\infty}\\frac{x^k}{k!}=1+x+\\frac{x^2}{2!}+\\cdots", "."],
    ],
  ],
];

const blocks: SpecBlock[] = [
  title("A SHEET OF FORMULAS"),
  role("author", "ADA L. MERCER"),
  role(
    "abstract",
    sc("Abstract."),
    " This sheet sets each formula twice: once inline, in a sentence, and once as a numbered display. The formulas grow from single symbols to nested structures, so a parser can be scored on how far it gets.",
  ),
];
let number = 0;
GROUPS.forEach(([name, entries], index) => {
  blocks.push(h(2, sc(`${index + 1}. ${name}`)));
  for (const [before, latex, after] of entries) {
    number += 1;
    blocks.push(p(before, m(latex), after), eq(latex, `(${number})`));
  }
});

export const math: Spec = {
  name: "math",
  title: "A sheet of formulas",
  category: "math-tex",
  blocks,
  renderings: {
    tex: {
      documentClass: "amsart",
      classOptions: "11pt",
      preamble: "",
      headings: { 2: { command: "section", smallCaps: true } },
      front: "maketitle",
      smallCaps: "keep",
      bands: { top: 106, bottom: 90 },
      // amsart's 11pt sizes in Computer Modern as pdflatex prints them.
      fonts: {
        body: { shape: "serif", size: 10.91 },
        title: { shape: "serif", size: 10.91, bold: true },
        author: { shape: "serif", size: 8.97 },
        abstract: { shape: "serif", size: 8.97 },
        h2: { shape: "serif", size: 10.91 },
      },
      centered: [2],
      justified: true,
    },
    html: {
      css: `
@page { size: letter; margin: 1in 1in 0.9in; @top-center { content: "A sheet of formulas"; font: italic 9pt "Liberation Serif", serif; } @bottom-center { content: counter(page); font: 9pt "Liberation Serif", serif; } }
body { font: 11pt/1.45 "Liberation Serif", serif; }
p.title { font-size: 17pt; font-weight: bold; text-align: center; margin: 0 0 0.4em; }
p.role-author { font-size: 11pt; margin-bottom: 1.2em; }
p.role-abstract { text-align: justify; font-size: 10pt; margin: 0 2.5em 1.5em; }
h2 { font-size: 11pt; font-weight: normal; text-align: center; margin: 1.4em 0 0.6em; }
.display { break-inside: avoid; }
`,
      bands: { top: 60, bottom: 50 },
    },
  },
  notes: "Each formula stands twice: inline in a paragraph and as a display labeled (n). Every latex string renders in KaTeX as written.",
};
