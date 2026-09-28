import { attr, child, children } from "@/lib/parse/office";

// Word equations (OMML, the m: namespace) as LaTeX the page editor's KaTeX
// draws, and as the readable characters a block document keeps in its text
// (decision 1 of the parse loop: no LaTeX in a block document's words). Each
// OMML element has one LaTeX form: a fraction \frac, a script ^ and _, a
// radical \sqrt, an n-ary operator with its limits, a delimiter \left \right,
// a function name, an accent, a bar, a brace, a matrix, an equation array.
// An element the table does not know is its children's LaTeX, never dropped.

// ── Characters ──────────────────────────────────────────────────────────────

// The math characters Word writes as themselves, as LaTeX commands. A
// character not here is written as it is (KaTeX draws most of them).
const COMMANDS: Record<string, string> = {};
function define(table: string) {
  for (const entry of table.trim().split(/\s+/)) {
    const cut = entry.indexOf("\\");
    COMMANDS[entry.slice(0, cut)] = entry.slice(cut);
  }
}
// Greek: Word's ε and φ are the curly forms LaTeX calls \varepsilon and \varphi.
define(`
  α\\alpha β\\beta γ\\gamma δ\\delta ε\\varepsilon ϵ\\epsilon ζ\\zeta η\\eta θ\\theta ϑ\\vartheta ι\\iota κ\\kappa
  λ\\lambda μ\\mu ν\\nu ξ\\xi π\\pi ϖ\\varpi ρ\\rho ϱ\\varrho σ\\sigma ς\\varsigma τ\\tau υ\\upsilon φ\\varphi
  ϕ\\phi χ\\chi ψ\\psi ω\\omega Γ\\Gamma Δ\\Delta Θ\\Theta Λ\\Lambda Ξ\\Xi Π\\Pi Σ\\Sigma Υ\\Upsilon Φ\\Phi
  Ψ\\Psi Ω\\Omega
  ±\\pm ∓\\mp ×\\times ÷\\div ⋅\\cdot ·\\cdot ∗\\ast ∘\\circ ∙\\bullet ⊕\\oplus ⊗\\otimes ⊖\\ominus ⊙\\odot
  ∪\\cup ∩\\cap ∖\\setminus ∧\\wedge ∨\\vee ⊔\\sqcup ⊓\\sqcap ⋆\\star †\\dagger ‡\\ddagger ≀\\wr
  ≤\\le ≥\\ge ≦\\leqq ≧\\geqq ≠\\ne ≈\\approx ≡\\equiv ∼\\sim ≃\\simeq ≅\\cong ∝\\propto ≪\\ll ≫\\gg
  ⊂\\subset ⊃\\supset ⊆\\subseteq ⊇\\supseteq ⊊\\subsetneq ⊋\\supsetneq ∈\\in ∉\\notin ∋\\ni ⊥\\perp
  ∥\\parallel ∣\\mid ∤\\nmid ⊢\\vdash ⊨\\models ≺\\prec ≻\\succ ⪯\\preceq ⪰\\succeq ≐\\doteq ≜\\triangleq
  ≍\\asymp ⊏\\sqsubset ⊐\\sqsupset ⊑\\sqsubseteq ⊒\\sqsupseteq ≮\\nless ≯\\ngtr ≰\\nleq ≱\\ngeq
  →\\to ←\\leftarrow ↔\\leftrightarrow ⇒\\Rightarrow ⇐\\Leftarrow ⇔\\Leftrightarrow ↦\\mapsto ↑\\uparrow
  ↓\\downarrow ↕\\updownarrow ⇑\\Uparrow ⇓\\Downarrow ⟶\\longrightarrow ⟵\\longleftarrow
  ⟷\\longleftrightarrow ⟹\\Longrightarrow ⟸\\Longleftarrow ⟺\\iff ↪\\hookrightarrow ↩\\hookleftarrow
  ⇀\\rightharpoonup ↼\\leftharpoonup ⇌\\rightleftharpoons ↗\\nearrow ↘\\searrow ↙\\swarrow ↖\\nwarrow
  ⟼\\longmapsto
  ∞\\infty ∂\\partial ∇\\nabla ∅\\emptyset ∀\\forall ∃\\exists ∄\\nexists ¬\\neg ℏ\\hbar ℓ\\ell ℘\\wp
  ℜ\\Re ℑ\\Im ℵ\\aleph ∠\\angle △\\triangle □\\square ◊\\lozenge ⋯\\cdots …\\ldots ⋮\\vdots ⋱\\ddots
  ∑\\sum ∏\\prod ∐\\coprod ∫\\int ∬\\iint ∭\\iiint ∮\\oint √\\surd ⌊\\lfloor ⌋\\rfloor ⌈\\lceil ⌉\\rceil
  ⟨\\langle ⟩\\rangle 〈\\langle 〉\\rangle ‖\\| ℕ\\mathbb{N} ℤ\\mathbb{Z} ℚ\\mathbb{Q} ℝ\\mathbb{R}
  ℂ\\mathbb{C} ℙ\\mathbb{P} ℍ\\mathbb{H} ′\\prime ″\\prime\\prime ‴\\prime\\prime\\prime °\\circ ∴\\therefore
  ∵\\because ⊤\\top ♯\\sharp ♭\\flat ♮\\natural ∡\\measuredangle 〈\\langle 〉\\rangle ∆\\Delta
  ⅆ\\mathrm{d} ⅇ\\mathrm{e} ⅈ\\mathrm{i} ⅉ\\mathrm{j} ⅅ\\mathrm{D}
`);
// Characters that mean something to LaTeX itself.
const ESCAPES: Record<string, string> = {
  "{": "\\{",
  "}": "\\}",
  "#": "\\#",
  $: "\\$",
  "%": "\\%",
  "&": "\\&",
  _: "\\_",
  "^": "\\hat{}",
  "~": "\\sim",
  "\\": "\\backslash",
  "−": "-",
  "\u00a0": " ",
};
// Invisible operators (function application, invisible times and comma) and
// the zero-width space: Word keeps them between letters; they draw nothing.
const INVISIBLE = /[\u2061-\u2064\u200b\u200c\u200d\ufeff]/g;

// The names LaTeX sets upright as operators. Word writes them as plain runs.
const FUNCTIONS = new Set([
  "sin", "cos", "tan", "cot", "sec", "csc", "arcsin", "arccos", "arctan", "sinh", "cosh", "tanh", "coth",
  "exp", "log", "ln", "lg", "lim", "liminf", "limsup", "max", "min", "sup", "inf", "det", "dim", "ker",
  "deg", "gcd", "arg", "hom", "Pr",
]);
// Of those, the ones whose limits go under them, as \lim's do.
const LIMIT_FUNCTIONS = new Set(["lim", "liminf", "limsup", "max", "min", "sup", "inf", "det", "gcd", "Pr"]);

// Mathematical alphanumeric symbols (U+1D400–U+1D7FF): thirteen alphabets of
// 52 letters in this order, then Greek and digits. Each as the LaTeX font
// command over its plain letter; italic is math's own default.
const LATIN_STYLES = [
  "\\mathbf", "", "\\boldsymbol", "\\mathcal", "\\mathcal", "\\mathfrak", "\\mathbb", "\\mathfrak",
  "\\mathsf", "\\mathsf", "\\mathsf", "\\mathsf", "\\mathtt",
];
const GREEK = "ΑΒΓΔΕΖΗΘϴΙΚΛΜΝΞΟΠΡϴΣΤΥΦΧΨΩ∇αβγδεζηθικλμνξοπρςστυφχψω∂ϵϑϰϕϱϖ";
const GREEK_STYLES = ["\\boldsymbol", "", "\\boldsymbol", "\\boldsymbol", "\\boldsymbol"];
const DIGIT_STYLES = ["\\mathbf", "\\mathbb", "\\mathsf", "\\mathsf", "\\mathtt"];
// The letters Unicode left out of those alphabets because the Letterlike
// Symbols block had them first.
const LETTERLIKE: Record<string, [string, string]> = {
  ℎ: ["", "h"], ℬ: ["\\mathcal", "B"], ℰ: ["\\mathcal", "E"], ℱ: ["\\mathcal", "F"], ℋ: ["\\mathcal", "H"],
  ℐ: ["\\mathcal", "I"], ℒ: ["\\mathcal", "L"], ℳ: ["\\mathcal", "M"], ℛ: ["\\mathcal", "R"], ℯ: ["\\mathcal", "e"],
  ℊ: ["\\mathcal", "g"], ℴ: ["\\mathcal", "o"], ℭ: ["\\mathfrak", "C"], ℌ: ["\\mathfrak", "H"], ℨ: ["\\mathfrak", "Z"],
};

/** A styled math letter as its font command and plain letter, or null. */
function mathAlphanumeric(ch: string): { font: string; base: string } | null {
  const letterlike = LETTERLIKE[ch];
  if (letterlike) return { font: letterlike[0], base: letterlike[1] };
  const cp = ch.codePointAt(0) ?? 0;
  if (cp >= 0x1d400 && cp < 0x1d400 + 13 * 52) {
    const at = cp - 0x1d400;
    const k = at % 52;
    return { font: LATIN_STYLES[Math.floor(at / 52)], base: String.fromCharCode(k < 26 ? 65 + k : 97 + k - 26) };
  }
  if (cp >= 0x1d6a8 && cp < 0x1d6a8 + 5 * 58) {
    const at = cp - 0x1d6a8;
    return { font: GREEK_STYLES[Math.floor(at / 58)], base: [...GREEK][at % 58] ?? "" };
  }
  if (cp >= 0x1d7ce && cp <= 0x1d7ff) {
    const at = cp - 0x1d7ce;
    return { font: DIGIT_STYLES[Math.floor(at / 10)], base: String(at % 10) };
  }
  return null;
}

/** One character as LaTeX. */
function charLatex(ch: string, inArray: boolean): string {
  if (ch === "&" && inArray) return "&";
  const command = COMMANDS[ch];
  if (command) return /[A-Za-z]$/.test(command) ? `${command} ` : command;
  const escaped = ESCAPES[ch];
  if (escaped !== undefined) return escaped;
  const styled = mathAlphanumeric(ch);
  if (styled) {
    const base = COMMANDS[styled.base] ?? styled.base;
    return styled.font ? `${styled.font}{${base}}` : /[A-Za-z]$/.test(base) && base.startsWith("\\") ? `${base} ` : base;
  }
  return ch;
}

// ── Run properties ──────────────────────────────────────────────────────────

type RunLook = { plain: boolean; bold: boolean; italic: boolean; script: string | null; text: boolean };

/** A math run's look: m:sty ("p" plain, "b" bold, "i" italic, "bi"), m:scr
    (the alphabet), m:nor (normal text, not math). */
function runLook(r: Element): RunLook {
  const rPr = child(r, "rPr");
  const sty = attr(child(rPr, "sty"), "val");
  return {
    plain: sty === "p" || sty === "b",
    bold: sty === "b" || sty === "bi",
    italic: sty === "i" || sty === "bi",
    script: attr(child(rPr, "scr"), "val"),
    text: child(rPr, "nor") !== null,
  };
}

const SCRIPT_FONTS: Record<string, string> = {
  "double-struck": "\\mathbb",
  script: "\\mathcal",
  fraktur: "\\mathfrak",
  "sans-serif": "\\mathsf",
  monospace: "\\mathtt",
};

/** A run's text: m:t, and the w:t of a plain Word run inside the equation. */
function runText(r: Element): string {
  let text = "";
  for (const c of r.children) {
    if (c.localName === "t") text += c.textContent ?? "";
    else if (c.localName === "tab") text += " ";
  }
  return text.replace(INVISIBLE, "");
}

function textLatex(text: string): string {
  return `\\text{${text.replace(/[\\{}#$%&_^~]/g, (c) => (c === "\\" ? "\\backslash " : `\\${c}`))}}`;
}

// Letters of a written language beyond ASCII: accented Latin, Cyrillic, CJK,
// Hangul. An upright run with one is words ("Siedém"), not math letters.
const WORD_LETTERS = /[À-ɏЀ-ӿ぀-鿿가-힯]/;

/** A math run as LaTeX: a function name upright as its operator, letters
    in their alphabet, every symbol through the character table. Upright
    words in a written language are text. */
function runLatex(r: Element, ctx: Ctx): string {
  const text = runText(r);
  if (!text) return "";
  // A run of spaces alone is spacing Word draws: LaTeX would drop a plain
  // space (a tie, never "\ ", which a trimmed group would cut to "\").
  if (!text.trim()) return text.replace(/ /g, "~");
  const look = runLook(r);
  if (look.text || (look.plain && !look.bold && WORD_LETTERS.test(text) && /^[\p{L}\s.'-]+$/u.test(text))) return textLatex(text);
  const word = text.trim();
  if (FUNCTIONS.has(word)) return `\\${word} `;
  let out = "";
  // Runs of Latin letters take the run's font; a bold Greek letter is a
  // bold symbol; everything else is charLatex.
  for (const part of text.match(/[A-Za-z]+|[\s\S]/gu) ?? []) {
    if (/^[A-Za-z]+$/.test(part)) {
      const font = look.script ? SCRIPT_FONTS[look.script] : look.bold ? (look.italic ? "\\boldsymbol" : "\\mathbf") : look.plain ? "\\mathrm" : "";
      out += font ? `${font}{${part}}` : part;
    } else if (/\s/.test(part)) out += " ";
    else if (look.bold && /\p{Script=Greek}/u.test(part)) out += `\\boldsymbol{${charLatex(part, ctx.inArray).trim()}}`;
    else out += charLatex(part, ctx.inArray);
  }
  return out;
}

// ── Elements ────────────────────────────────────────────────────────────────

type Ctx = { inArray: boolean };

/** A LaTeX group as a script's base or argument needs it: a single letter,
    digit, or command stands alone; anything longer takes braces. */
function atom(latex: string): string {
  const t = latex.trim();
  return /^(?:[A-Za-z0-9]|\\[A-Za-z]+)$/.test(t) ? t : `{${t}}`;
}

function arg(el: Element | null, ctx: Ctx): string {
  return el ? kids(el, ctx).trim() : "";
}

function kids(el: Element, ctx: Ctx): string {
  let out = "";
  for (const c of el.children) out += node(c, ctx);
  return out;
}

const DELIMITERS: Record<string, string> = {
  "(": "(", ")": ")", "[": "[", "]": "]", "{": "\\{", "}": "\\}", "|": "|", "‖": "\\|", "⟨": "\\langle",
  "⟩": "\\rangle", "〈": "\\langle", "〉": "\\rangle", "\u2329": "\\langle", "\u232a": "\\rangle", "⌊": "\\lfloor",
  "⌋": "\\rfloor", "⌈": "\\lceil", "⌉": "\\rceil", "/": "/", "\\": "\\backslash",
};

// A grouping character stretched over or under its base, as the LaTeX that
// draws it there: [over, under].
const GROUPS: Record<string, [string, string]> = {
  "⏞": ["\\overbrace", "\\underbrace"], "⏟": ["\\overbrace", "\\underbrace"], "⏜": ["\\overgroup", "\\undergroup"],
  "⏝": ["\\overgroup", "\\undergroup"], "→": ["\\overrightarrow", "\\underrightarrow"],
  "←": ["\\overleftarrow", "\\underleftarrow"], "↔": ["\\overleftrightarrow", "\\underleftrightarrow"],
  "¯": ["\\overline", "\\underline"],
};

/** A delimiter character for \left, \middle, or \right; "." for none. */
function delimiter(ch: string | null): string {
  if (!ch) return ".";
  return DELIMITERS[ch] ?? ".";
}

const NARY: Record<string, string> = {
  "∑": "\\sum", "∏": "\\prod", "∐": "\\coprod", "∫": "\\int", "∬": "\\iint", "∭": "\\iiint", "∮": "\\oint",
  "∯": "\\oiint", "∰": "\\oiiint", "⋃": "\\bigcup", "⋂": "\\bigcap", "⋁": "\\bigvee", "⋀": "\\bigwedge",
  "⨁": "\\bigoplus", "⨂": "\\bigotimes", "⨀": "\\bigodot", "⨄": "\\biguplus", "⨆": "\\bigsqcup",
};
const INTEGRALS = new Set(["∫", "∬", "∭", "∮", "∯", "∰"]);

const ACCENTS: Record<string, [string, string]> = {
  // combining mark: [one letter, wide]
  "\u0302": ["\\hat", "\\widehat"], "\u0303": ["\\tilde", "\\widetilde"], "\u0304": ["\\bar", "\\overline"],
  "\u0305": ["\\overline", "\\overline"], "\u0307": ["\\dot", "\\dot"], "\u0308": ["\\ddot", "\\ddot"],
  "\u20db": ["\\dddot", "\\dddot"], "\u030c": ["\\check", "\\check"], "\u0306": ["\\breve", "\\breve"],
  "\u20d7": ["\\vec", "\\overrightarrow"], "\u20d6": ["\\overleftarrow", "\\overleftarrow"],
  "\u20e1": ["\\overleftrightarrow", "\\overleftrightarrow"], "\u0301": ["\\acute", "\\acute"],
  "\u0300": ["\\grave", "\\grave"], "\u030a": ["\\mathring", "\\mathring"], "^": ["\\hat", "\\widehat"],
  "~": ["\\tilde", "\\widetilde"], "¯": ["\\bar", "\\overline"], "→": ["\\vec", "\\overrightarrow"],
};

/** The character a property element names (m:chr, m:begChr, …): its val,
    the default when the element is absent, "" when it names none. */
function chrOf(pr: Element | null, name: string, fallback: string): string {
  const el = child(pr, name);
  if (!el) return fallback;
  return attr(el, "val") ?? "";
}

function hidden(pr: Element | null, name: string): boolean {
  const el = child(pr, name);
  if (!el) return false;
  const v = attr(el, "val");
  return v === null || v === "1" || v === "on" || v === "true";
}

function node(el: Element, ctx: Ctx): string {
  switch (el.localName) {
    case "r":
      return runLatex(el, ctx);
    case "f": {
      const type = attr(child(child(el, "fPr"), "type"), "val");
      const num = arg(child(el, "num"), ctx);
      const den = arg(child(el, "den"), ctx);
      if (type === "lin" || type === "skw") return `${atom(num)}/${atom(den)}`;
      if (type === "noBar") return `\\genfrac{}{}{0pt}{}{${num}}{${den}}`;
      return `\\frac{${num}}{${den}}`;
    }
    case "sSup":
      return `${atom(arg(child(el, "e"), ctx))}^{${arg(child(el, "sup"), ctx)}}`;
    case "sSub":
      return `${atom(arg(child(el, "e"), ctx))}_{${arg(child(el, "sub"), ctx)}}`;
    case "sSubSup":
      return `${atom(arg(child(el, "e"), ctx))}_{${arg(child(el, "sub"), ctx)}}^{${arg(child(el, "sup"), ctx)}}`;
    case "sPre":
      return `{}_{${arg(child(el, "sub"), ctx)}}^{${arg(child(el, "sup"), ctx)}}${atom(arg(child(el, "e"), ctx))}`;
    case "rad": {
      const pr = child(el, "radPr");
      const deg = hidden(pr, "degHide") ? "" : arg(child(el, "deg"), ctx);
      const e = arg(child(el, "e"), ctx);
      return deg ? `\\sqrt[${deg}]{${e}}` : `\\sqrt{${e}}`;
    }
    case "nary": {
      const pr = child(el, "naryPr");
      const chr = chrOf(pr, "chr", "∫");
      const op = NARY[chr] ?? charLatex(chr, ctx.inArray).trim();
      const under = attr(child(pr, "limLoc"), "val");
      // Word's default places: under and over a sum, beside an integral —
      // LaTeX's own; only a place Word moved needs saying.
      const place = under === "undOvr" && INTEGRALS.has(chr) ? "\\limits" : under === "subSup" && !INTEGRALS.has(chr) ? "\\nolimits" : "";
      const sub = hidden(pr, "subHide") ? "" : arg(child(el, "sub"), ctx);
      const sup = hidden(pr, "supHide") ? "" : arg(child(el, "sup"), ctx);
      return `${op}${place}${sub ? `_{${sub}}` : ""}${sup ? `^{${sup}}` : ""} ${arg(child(el, "e"), ctx)}`;
    }
    case "d": {
      const pr = child(el, "dPr");
      const open = delimiter(chrOf(pr, "begChr", "("));
      const close = delimiter(chrOf(pr, "endChr", ")"));
      const sep = delimiter(chrOf(pr, "sepChr", "|"));
      const elements = children(el, "e");
      // A fraction without its bar in parentheses is a binomial coefficient.
      const lone = elements.length === 1 && elements[0].children.length === 1 ? elements[0].children[0] : null;
      if (open === "(" && close === ")" && lone?.localName === "f" && attr(child(child(lone, "fPr"), "type"), "val") === "noBar") {
        return `\\binom{${arg(child(lone, "num"), ctx)}}{${arg(child(lone, "den"), ctx)}}`;
      }
      const parts = elements.map((e) => arg(e, ctx));
      // A delimiter command (\langle) needs a space before a letter.
      return `\\left${open} ${parts.join(sep === "." ? " " : ` \\middle${sep} `)} \\right${close}${/[A-Za-z]$/.test(close) ? " " : ""}`;
    }
    case "func": {
      const name = arg(child(el, "fName"), ctx);
      const body = arg(child(el, "e"), ctx);
      const plain = name.replace(/\\mathrm\{([A-Za-z]+)\}/g, "$1").trim();
      const op = /^[A-Za-z]+$/.test(plain) ? (FUNCTIONS.has(plain) ? `\\${plain}` : `\\operatorname{${plain}}`) : name;
      return `${op}${/^\\left/.test(body) ? "" : " "}${body}`;
    }
    case "limLow": {
      const base = arg(child(el, "e"), ctx);
      const lim = arg(child(el, "lim"), ctx);
      const op = base.replace(/\s+$/, "");
      if (/^\\(?:[A-Za-z]+)$/.test(op) && LIMIT_FUNCTIONS.has(op.slice(1))) return `${op}_{${lim}}`;
      if (/^\\(?:underbrace|overbrace)\{/.test(op)) return `${op}_{${lim}}`;
      return `\\underset{${lim}}{${base}}`;
    }
    case "limUpp": {
      const base = arg(child(el, "e"), ctx);
      const lim = arg(child(el, "lim"), ctx);
      if (/^\\(?:underbrace|overbrace)\{/.test(base.trim())) return `${base.trim()}^{${lim}}`;
      return `\\overset{${lim}}{${base}}`;
    }
    case "acc": {
      const chr = chrOf(child(el, "accPr"), "chr", "\u0302");
      const base = arg(child(el, "e"), ctx);
      const pair = ACCENTS[chr];
      // A combining mark KaTeX has no accent for leaves the base as it is.
      if (!pair) return /[\u0300-\u036f\u20d0-⃿]/.test(chr) ? base : `\\overset{${charLatex(chr, ctx.inArray)}}{${base}}`;
      return `${/^(?:[A-Za-z0-9]|\\[A-Za-z]+)$/.test(base) ? pair[0] : pair[1]}{${base}}`;
    }
    case "bar": {
      const pos = attr(child(child(el, "barPr"), "pos"), "val");
      return `${pos === "top" ? "\\overline" : "\\underline"}{${arg(child(el, "e"), ctx)}}`;
    }
    case "groupChr": {
      const pr = child(el, "groupChrPr");
      const chr = chrOf(pr, "chr", "⏟");
      // Word's default place is under the base; a brace's own side wins.
      const pos = attr(child(pr, "pos"), "val");
      const top = pos ? pos === "top" : chr === "⏞" || chr === "⏜";
      const base = arg(child(el, "e"), ctx);
      const group = GROUPS[chr];
      if (group) return `${group[top ? 0 : 1]}{${base}}`;
      // A combining mark as the group character is an accent over the base.
      const accent = ACCENTS[chr];
      if (accent) return `${accent[1]}{${base}}`;
      if (/[\u0300-\u036f\u20d0-⃿]/.test(chr) || !chr) return base;
      return top ? `\\overset{${charLatex(chr, ctx.inArray)}}{${base}}` : `\\underset{${charLatex(chr, ctx.inArray)}}{${base}}`;
    }
    case "m": {
      const inner: Ctx = { ...ctx, inArray: false };
      const rows = children(el, "mr").map((row) => children(row, "e").map((e) => arg(e, inner)).join(" & "));
      return `\\begin{matrix}${rows.join(" \\\\ ")}\\end{matrix}`;
    }
    case "eqArr": {
      const inner: Ctx = { ...ctx, inArray: true };
      const rows = children(el, "e").map((e) => arg(e, inner));
      return rows.some((row) => row.includes("&"))
        ? `\\begin{aligned}${rows.join(" \\\\ ")}\\end{aligned}`
        : `\\begin{gathered}${rows.join(" \\\\ ")}\\end{gathered}`;
    }
    case "borderBox":
      return `\\boxed{${arg(child(el, "e"), ctx)}}`;
    case "phant": {
      const pr = child(el, "phantPr");
      const show = attr(child(pr, "show"), "val");
      const e = arg(child(el, "e"), ctx);
      return show === "0" || show === "off" || show === "false" ? `\\phantom{${e}}` : e;
    }
    case "oMath":
    case "e":
    case "box":
    case "num":
    case "den":
    case "sub":
    case "sup":
    case "deg":
    case "lim":
    case "fName":
      return kids(el, ctx);
    default:
      // Property elements (…Pr, m:ctrlPr) draw nothing; an unknown element
      // is its children, so its words stay.
      return el.localName.endsWith("Pr") ? "" : kids(el, ctx);
  }
}

/** One equation (m:oMath) as LaTeX, whitespace tidied. */
export function ommlLatex(oMath: Element): string {
  return node(oMath, { inArray: false }).replace(/\s+/g, " ").replace(/\s+([\^_])/g, "$1").trim();
}

// ── Readable characters ─────────────────────────────────────────────────────

const SUPERSCRIPTS: Record<string, string> = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
  "+": "⁺", "-": "⁻", "−": "⁻", "=": "⁼", "(": "⁽", ")": "⁾", n: "ⁿ", i: "ⁱ",
};
const SUBSCRIPTS: Record<string, string> = {
  "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉",
  "+": "₊", "-": "₋", "−": "₋", "=": "₌", "(": "₍", ")": "₎", a: "ₐ", e: "ₑ", o: "ₒ", x: "ₓ", h: "ₕ", k: "ₖ",
  l: "ₗ", m: "ₘ", n: "ₙ", p: "ₚ", s: "ₛ", t: "ₜ", i: "ᵢ", j: "ⱼ",
};

/** A script's characters raised or lowered, as Unicode writes them when it
    has every one; else "^" or "_" and the script, in parentheses past one
    character. */
function scripted(text: string, table: Record<string, string>, mark: string): string {
  const chars = [...text];
  if (chars.length > 0 && chars.every((c) => table[c])) return chars.map((c) => table[c]).join("");
  return chars.length === 1 ? `${mark}${text}` : `${mark}(${text})`;
}

/** A part in parentheses when it is more than one character. */
function grouped(text: string): string {
  return [...text].length <= 1 || /^\(.*\)$/.test(text) ? text : `(${text})`;
}

function readable(el: Element | null): string {
  if (!el) return "";
  switch (el.localName) {
    case "r":
      return runText(el);
    case "f": {
      // A fraction without its bar (a binomial's two rows) reads as its rows.
      const bar = attr(child(child(el, "fPr"), "type"), "val") !== "noBar";
      return `${grouped(readable(child(el, "num")))}${bar ? "/" : " "}${grouped(readable(child(el, "den")))}`;
    }
    case "sSup":
      return `${readable(child(el, "e"))}${scripted(readable(child(el, "sup")), SUPERSCRIPTS, "^")}`;
    case "sSub":
      return `${readable(child(el, "e"))}${scripted(readable(child(el, "sub")), SUBSCRIPTS, "_")}`;
    case "sSubSup":
      return `${readable(child(el, "e"))}${scripted(readable(child(el, "sub")), SUBSCRIPTS, "_")}${scripted(readable(child(el, "sup")), SUPERSCRIPTS, "^")}`;
    case "sPre":
      return `${scripted(readable(child(el, "sub")), SUBSCRIPTS, "_")}${scripted(readable(child(el, "sup")), SUPERSCRIPTS, "^")}${readable(child(el, "e"))}`;
    case "rad": {
      const pr = child(el, "radPr");
      const deg = hidden(pr, "degHide") ? "" : readable(child(el, "deg"));
      const root = deg === "3" ? "∛" : deg === "4" ? "∜" : deg ? `${scripted(deg, SUPERSCRIPTS, "^")}√` : "√";
      return `${root}${grouped(readable(child(el, "e")))}`;
    }
    case "nary": {
      const pr = child(el, "naryPr");
      const sub = hidden(pr, "subHide") ? "" : readable(child(el, "sub"));
      const sup = hidden(pr, "supHide") ? "" : readable(child(el, "sup"));
      return `${chrOf(pr, "chr", "∫")}${sub ? scripted(sub, SUBSCRIPTS, "_") : ""}${sup ? scripted(sup, SUPERSCRIPTS, "^") : ""} ${readable(child(el, "e"))}`;
    }
    case "d": {
      const pr = child(el, "dPr");
      return `${chrOf(pr, "begChr", "(")}${children(el, "e").map(readable).join(chrOf(pr, "sepChr", "|"))}${chrOf(pr, "endChr", ")")}`;
    }
    case "func": {
      const body = readable(child(el, "e"));
      return `${readable(child(el, "fName"))}${/^[(|[{⟨]/.test(body) ? "" : " "}${body}`;
    }
    case "limLow":
      return `${readable(child(el, "e"))}${scripted(readable(child(el, "lim")), SUBSCRIPTS, "_")}`;
    case "limUpp":
      return `${readable(child(el, "e"))}${scripted(readable(child(el, "lim")), SUPERSCRIPTS, "^")}`;
    case "acc": {
      const chr = chrOf(child(el, "accPr"), "chr", "\u0302");
      const base = readable(child(el, "e"));
      return /^[\u0300-\u036f\u20d0-⃿]$/.test(chr) ? `${base}${chr}` : base;
    }
    case "m":
      return `(${children(el, "mr").map((row) => children(row, "e").map(readable).join(" ")).join("; ")})`;
    case "eqArr":
      return children(el, "e").map(readable).join("; ");
    default: {
      if (el.localName.endsWith("Pr")) return "";
      let out = "";
      for (const c of el.children) out += readable(c);
      return out;
    }
  }
}

/** One equation's readable characters: what a block document keeps in its
    words where the page editor draws the formula. */
export function ommlText(oMath: Element): string {
  return readable(oMath).replace(/\s+/g, " ").trim();
}
