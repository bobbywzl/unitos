// The math layout's unit test (research memo §1.8–1.9): formulas with known
// LaTeX, each typeset alone on a page with pdflatex, read back through the
// page's drawing, laid out (pdf/math/layout.ts), and checked against their
// glyphs (pdf/math/check.ts). A formula is right when its LaTeX and the
// reference render to the same KaTeX MathML, spacing aside.
//
//   npx tsx scripts/parse-bench/math-layout.mts [set] [--all]
//
// The sets: 60 tuning formulas, 40 held out (as displays and inline), 30
// harder fresh ones, and 30 fresh ones made after the layout was tuned. The
// PDFs are made once into .bench/math-layout/ (TeX Live's pdflatex; the app
// never needs it). Exit code 1 when a set scores under its floor.
import "@/lib/pdf-runtime";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import katex from "katex";
import { getDocumentProxy } from "unpdf";
import { readDrawing, type FontLookup } from "@/lib/parse/pdf/drawing";
import { layoutLatex } from "@/lib/parse/pdf/math/check";

const TUNING = String.raw`x^2 + y^2 = z^2
\frac{a+b}{c-d}
\sqrt{x^2+1}
\sqrt[3]{x}
\sum_{i=1}^{n} a_i
\int_0^1 f(x)\,dx
\lim_{n\to\infty} \frac{1}{n} = 0
\mathbb{E}[X] = \int_\Omega X\,d\mathbb{P}
P(A \cap B) = P(A)P(B)
\sigma(\mathcal{A}) \subseteq \mathcal{F}
f\colon X \to Y
x \mapsto x^2
a \neq b
x \notin A
A \Longrightarrow B
\|x\|_2 \le 1
\langle u, v \rangle = 0
\lfloor x \rfloor + \lceil y \rceil
\epsilon, \varepsilon, \phi, \varphi, \ell
\hat{x} + \bar{y} + \tilde{z} + \vec{v}
\binom{n}{k} = \frac{n!}{k!(n-k)!}
\begin{pmatrix} a & b \\ c & d \end{pmatrix}
f(x) = \begin{cases} 1 & x > 0 \\ 0 & \text{otherwise} \end{cases}
\left( \sum_{k=1}^{n} x_k \right)^2
e^{-x^2/2}
\frac{1}{\sqrt{2\pi}} e^{-\frac{x^2}{2}}
\prod_{j=1}^{m} (1 + x_j)
\bigcup_{n=1}^{\infty} A_n
\limsup_{n\to\infty} X_n
\sup_{t \in [0,1]} |B_t|
\overline{A \cup B} = \overline{A} \cap \overline{B}
a_{ij} = b_{ji}
x_{n+1} = x_n - \frac{f(x_n)}{f'(x_n)}
\mathbb{R}^n \times \mathbb{R}^m
\forall \epsilon > 0 \; \exists \delta > 0
\partial_t u = \Delta u
\nabla \cdot \mathbf{F} = 0
\sin^2\theta + \cos^2\theta = 1
\log(xy) = \log x + \log y
1_{A}(\omega)
\mathcal{N}(\mu, \sigma^2)
\operatorname{Var}(X) = \mathbb{E}[X^2] - (\mathbb{E}X)^2
\{ x \in \mathbb{R} : x > 0 \}
\frac{\partial^2 u}{\partial x^2}
\int_{-\infty}^{\infty} e^{-x^2}\,dx = \sqrt{\pi}
a_1, \ldots, a_n
a_1 + \cdots + a_n
\begin{aligned} a &= b + c \\ &= d \end{aligned}
A \cong B
\mathfrak{g} \oplus \mathfrak{h}
\mathscr{L}(X)
\hbar\omega
\alpha\beta\gamma\Gamma\Delta
X \sim \mathcal{U}[0,1]
\frac{a}{b} \cdot \frac{c}{d}
\sqrt{\frac{a}{b}}
|x - y| < \delta
P(X_n \to X) = 1
\mathbf{1}\{X > t\}
(a, b] \times [c, d)`;

const HELDOUT = String.raw`\mathbb{P}(|X_n - X| > \epsilon) \to 0
\sum_{k=0}^{\infty} \frac{\lambda^k}{k!} e^{-\lambda} = 1
F(x) = \int_{-\infty}^{x} f(t)\,dt
\mathbb{E}[X \mid \mathcal{G}] = Y
\|f\|_{p} = \left( \int |f|^p \, d\mu \right)^{1/p}
\mu(A) = \inf \{ \sum_n \mu(A_n) : A \subseteq \bigcup_n A_n \}
\frac{d}{dx} \left[ \frac{1}{1+x^2} \right] = -\frac{2x}{(1+x^2)^2}
\phi(t) = \mathbb{E}[e^{itX}]
\Pr(A_1 \cap A_2) \le \min(\Pr(A_1), \Pr(A_2))
x^{(n)} \to x
\tau_\epsilon = \inf\{t \ge 0 : |B_t| \ge \epsilon\}
\bar{X}_n = \frac{1}{n}\sum_{i=1}^n X_i
\sqrt{n}(\bar{X}_n - \mu) \Rightarrow \mathcal{N}(0, \sigma^2)
\langle f, g \rangle = \int_0^1 f(x) g(x)\,dx
\mathcal{F}_t \subseteq \mathcal{F}_s \subseteq \mathcal{F}
\binom{2n}{n} \sim \frac{4^n}{\sqrt{\pi n}}
\det \begin{pmatrix} 1 & x \\ y & 1 \end{pmatrix} = 1 - xy
|z|^2 = z\bar{z}
\hat{\theta} = \arg\max_{\theta} L(\theta)
\max_{1 \le i \le n} |X_i|
A^{\top} A = I
\lfloor n/2 \rfloor + \lceil n/2 \rceil = n
g \circ f\colon X \to Z
e^{i\pi} + 1 = 0
\int_{\mathbb{R}^d} |\hat{f}(\xi)|^2\,d\xi
\alpha \wedge \beta \in \Omega^2(M)
\mathfrak{su}(2) \cong \mathfrak{so}(3)
\nu \ll \mu \iff \mu(A) = 0 \Rightarrow \nu(A) = 0
\frac{\partial f}{\partial x_i}(x_0)
\prod_{p \text{ prime}} \frac{1}{1 - p^{-s}}
\sigma^2 = \mathbb{E}[(X - \mu)^2]
\bigcap_{n \ge 1} \overline{\{x_k : k \ge n\}}
1 - \frac{1}{2} + \frac{1}{3} - \cdots = \log 2
\vec{F} = m\vec{a}
\tilde{f}(x) = f(x) - f(0)
\left\lfloor \frac{n}{k} \right\rfloor
\mathscr{B}(\mathbb{R})
\omega \mapsto X(\omega)
a \not\equiv b \pmod{n}
\begin{bmatrix} 1 & 0 \\ 0 & 1 \end{bmatrix}`;

const FRESH = String.raw`\frac{1}{1 + \frac{1}{1 + \frac{1}{x}}}
e^{\sqrt{x}} \le 2^{x/2}
\begin{pmatrix} a_{11} & a_{12} & a_{13} \\ a_{21} & a_{22} & a_{23} \\ a_{31} & a_{32} & a_{33} \end{pmatrix}
\operatorname{sgn}(x) = \begin{cases} 1 & x > 0 \\ 0 & x = 0 \\ -1 & x < 0 \end{cases}
\begin{aligned} (a+b)^2 &= a^2 + 2ab + b^2 \\ &\ge 4ab \\ &> 0 \end{aligned}
\sum_{\substack{1 \le i < j \le n}} x_i x_j
\overbrace{1 + 1 + \cdots + 1}^{n}
\int_0^1 \frac{dx}{\sqrt{1 - x^2}} = \frac{\pi}{2}
\left| \sum_{k=1}^{n} a_k b_k \right| \le \|a\| \, \|b\|
\hat{A} + \tilde{\mathcal{F}}
x_1' + x_2''
\mathbf{x}^\top \mathbf{y} = \sum_i x_i y_i
\iint_D f(x,y)\,dx\,dy
\oint_{\partial \Omega} \omega = \int_\Omega d\omega
\lim_{h \to 0} \frac{f(x+h) - f(x)}{h}
\mathbb{P}\left( \bigcap_{i=1}^{n} A_i \right) = \prod_{i=1}^{n} \mathbb{P}(A_i)
\Gamma(z) = \int_0^\infty t^{z-1} e^{-t}\,dt
\zeta(s) = \sum_{n=1}^\infty n^{-s}
\nabla^2 \phi = \frac{\rho}{\varepsilon_0}
\{ (x, y) \in \mathbb{R}^2 : x^2 + y^2 \le 1 \}
f^{-1}(B) \in \mathcal{F}
\underline{\lim}_{n} a_n \le \overline{\lim}_{n} a_n
\sqrt[n]{a_1 a_2 \cdots a_n} \le \frac{a_1 + \cdots + a_n}{n}
\mathcal{L}^2(\Omega) \hookrightarrow \mathcal{L}^1(\Omega)
X_n \xrightarrow{d} X
u_t - \Delta u = 0 \quad \text{in } \Omega
\binom{n}{0} + \binom{n}{1} + \cdots + \binom{n}{n} = 2^n
\mathbb{E}\left[ \sup_{s \le t} |M_s|^2 \right] \le 4\,\mathbb{E}[M_t^2]
\varphi(x) = \frac{1}{\sqrt{2\pi}} \exp\left(-\frac{x^2}{2}\right)
\sigma\{X_s : s \le t\}`;

// Made after the layout was tuned on the sets above: never tuned on.
const LATER = String.raw`\mathbb{P}(A \cup B) = \mathbb{P}(A) + \mathbb{P}(B) - \mathbb{P}(A \cap B)
\lim_{n \to \infty} \mathbb{P}\left( \left| \frac{S_n}{n} - \mu \right| > \epsilon \right) = 0
\sigma(\mathcal{A}) = \bigcap \{ \mathcal{G} : \mathcal{A} \subseteq \mathcal{G} \}
\int_{\Omega} X \, d\mathbb{P} = \sup_{n} \int_{\Omega} X_n \, d\mathbb{P}
f(x) = \begin{cases} x^2 & \text{if } x \ge 0, \\ -x & \text{otherwise}. \end{cases}
\begin{aligned} \mathbb{E}[X] &= \sum_{k} k\,\mathbb{P}(X = k) \\ &= \lambda \end{aligned}
\|u\|_{H^1}^2 = \|u\|_{L^2}^2 + \|\nabla u\|_{L^2}^2
\hat{f}(\xi) = \int_{\mathbb{R}} f(x) e^{-2\pi i x \xi} \, dx
\det(A - \lambda I) = 0
\sum_{n=1}^{\infty} \frac{1}{n^2} = \frac{\pi^2}{6}
x \in \overline{B(0, r)}
\frac{\partial}{\partial t} p_t(x, y) = \frac{1}{2} \Delta_y p_t(x, y)
\mathbf{1}_{\{X > 0\}}
\operatorname{Cov}(X, Y) = \mathbb{E}[XY] - \mathbb{E}[X]\mathbb{E}[Y]
\limsup_{n \to \infty} \frac{S_n}{\sqrt{2n \log \log n}} = 1
A^{-1} = \frac{1}{ad - bc} \begin{bmatrix} d & -b \\ -c & a \end{bmatrix}
\langle x, y \rangle \le \|x\| \, \|y\|
\bigcup_{i \in I} A_i \in \mathcal{F}
F^{-1}(u) = \inf\{ x \in \mathbb{R} : F(x) \ge u \}
\binom{n}{k} p^k (1-p)^{n-k}
e^{x} = \sum_{k=0}^{\infty} \frac{x^k}{k!}
\tilde{\mu}_n \Rightarrow \mu
\mathbb{E}\left[ e^{\theta X} \right] \le e^{\theta^2 \sigma^2 / 2}
\{ \omega : X_n(\omega) \to X(\omega) \}
\int_0^t \int_0^s f(u) \, du \, ds
\varphi_X(t) = \mathbb{E}\, e^{i t X}
\mu \ll \nu \text{ and } \nu \ll \mu
\sqrt{\operatorname{Var}(X)}
\frac{a+b}{2} \ge \sqrt{ab}
\mathcal{F}_{\tau} = \{ A \in \mathcal{F} : A \cap \{\tau \le t\} \in \mathcal{F}_t \}`;

type Set = { name: string; formulas: string[]; display: boolean; floor: number };
const lines = (s: string) => s.split("\n").map((l) => l.trim()).filter(Boolean);
const SETS: Set[] = [
  { name: "tuning", formulas: lines(TUNING), display: true, floor: 60 },
  { name: "heldout", formulas: lines(HELDOUT), display: true, floor: 38 },
  { name: "heldout-inline", formulas: lines(HELDOUT), display: false, floor: 38 },
  { name: "fresh", formulas: lines(FRESH), display: true, floor: 24 },
  { name: "later", formulas: lines(LATER), display: true, floor: 28 },
  { name: "later-inline", formulas: lines(LATER), display: false, floor: 28 },
];

const ROOT = join(import.meta.dirname, "..", "..");
const DIR = join(ROOT, ".bench", "math-layout");

// One formula a page, set alone, in the article class at 10 pt.
function pdfOf(set: Set): string {
  const body = set.formulas.map((f) => `\\noindent ${set.display ? `\\[ ${f} \\]` : `$${f}$`}\\newpage`).join("\n");
  const tex = `\\documentclass{article}\n\\usepackage{amsmath,amssymb,mathrsfs,eufrak}\n\\pagestyle{empty}\n\\begin{document}\n${body}\n\\end{document}\n`;
  const hash = createHash("sha1").update(tex).digest("hex").slice(0, 12);
  const pdf = join(DIR, `${set.name}-${hash}.pdf`);
  if (existsSync(pdf)) return pdf;
  mkdirSync(DIR, { recursive: true });
  const base = join(DIR, `${set.name}-${hash}`);
  writeFileSync(`${base}.tex`, tex);
  execFileSync("pdflatex", ["-interaction=nonstopmode", `-output-directory=${DIR}`, `${base}.tex`], { stdio: "ignore" });
  return pdf;
}

// KaTeX's MathML with spacing, attributes, and empty operators set aside.
function canon(tex: string): string {
  try {
    return katex
      .renderToString(tex, { output: "mathml", throwOnError: true, displayMode: true })
      .replace(/<annotation[\s\S]*?<\/annotation>/, "")
      .replace(/<mspace[^>]*\/?>(<\/mspace>)?/g, "")
      .replace(/<mtext>[\s ⁡-⁤]*<\/mtext>/g, "")
      .replace(/<mo[^>]*><\/mo>/g, "")
      .replace(/ (?!mathvariant|linethickness)[a-z]+="[^"]*"/g, "")
      .replace(/<\/?mrow>/g, "")
      .replace(/\s+/g, " ");
  } catch (err) {
    return `ERR ${(err as Error).message}`;
  }
}

const only = process.argv.slice(2).find((a) => !a.startsWith("--"));
const all = process.argv.includes("--all");
let failed = false;
const confusion = { passRight: 0, passWrong: 0, failRight: 0, failWrong: 0 };
for (const set of SETS) {
  if (only && set.name !== only) continue;
  const pdf = await getDocumentProxy(new Uint8Array(readFileSync(pdfOf(set))));
  let right = 0;
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const view = page.getViewport({ scale: 1 });
    const ops = (await page.getOperatorList()) as { fnArray: number[]; argsArray: unknown[] };
    const fonts: FontLookup = (id) => {
      try {
        const f = page.commonObjs.get(id) as { name?: string; fontMatrix?: number[] } | null;
        return f ? { name: f.name ?? "", fontMatrix: f.fontMatrix } : null;
      } catch {
        return null;
      }
    };
    const { glyphs, rules } = readDrawing(ops, fonts, view.width, view.height);
    const { latex, check } = layoutLatex(glyphs, rules, { display: set.display, size: 10 });
    const ok = canon(latex) === canon(set.formulas[p - 1]);
    if (ok) right++;
    confusion[`${check.ok ? "pass" : "fail"}${ok ? "Right" : "Wrong"}` as keyof typeof confusion]++;
    if (!ok || !check.ok || all) {
      const why = check.ok ? "" : `   check: missing ${check.missing.join(" ")} extra ${check.extra.join(" ")}`;
      console.log(`${ok ? "right" : "wrong"} ${check.ok ? "passes" : "fails "}  want ${set.formulas[p - 1]}\n                got  ${latex}${why}`);
    }
  }
  const under = right < set.floor;
  failed ||= under;
  console.log(`${set.name}: ${right} of ${pdf.numPages} right${set.floor ? ` (floor ${set.floor})` : ""}${under ? " — UNDER THE FLOOR" : ""}\n`);
}
console.log(`The check against the reference: ${JSON.stringify(confusion)}`);
process.exit(failed ? 1 : 0);
