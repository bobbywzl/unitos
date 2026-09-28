/**
 * LaTeXML's alttext as TeX that KaTeX renders: LaTeXML's leftovers removed, the paper's own macros expanded
 * (so the reference holds plain TeX, the kind a parse of the PDF can produce), and the render check.
 */
/** Macros of packages the papers load, with optional arguments KaTeX macros cannot express. Each reads its arguments. */
const PACKAGE_MACROS: Record<string, (read: Reader) => string> = {
  // physics: \derivative[n]{f}{x}, \derivative{x}; \partialderivative likewise; \absolutevalue, \norm, \evaluated, \Tr
  derivative: (read) => derivative(read, "\\mathrm{d}"),
  partialderivative: (read) => derivative(read, "\\partial"),
  absolutevalue: (read) => (read.star() ? `\\lvert ${read.arg()} \\rvert` : `\\left\\lvert ${read.arg()} \\right\\rvert`),
  norm: (read) => (read.star() ? `\\lVert ${read.arg()} \\rVert` : `\\left\\lVert ${read.arg()} \\right\\rVert`),
  evaluated: (read) => `\\left. ${read.arg()} \\right|`,
  Tr: () => "\\operatorname{Tr}",
};

function derivative(read: Reader, d: string): string {
  const order = read.optional();
  const first = read.arg();
  const second = read.peekGroup() ? read.arg() : null;
  const power = order ? `^{${order}}` : "";
  return second === null ? `\\frac{${d}${power}}{${d} ${first}${power}}` : `\\frac{${d}${power} ${first}}{${d} ${second}${power}}`;
}

/** Reads the arguments that follow a control sequence. */
class Reader {
  constructor(
    private tex: string,
    public pos: number,
  ) {}
  private skipSpaces() {
    while (/\s/.test(this.tex[this.pos] ?? "")) this.pos++;
  }
  star(): boolean {
    if (this.tex[this.pos] !== "*") return false;
    this.pos++;
    return true;
  }
  peekGroup(): boolean {
    const save = this.pos;
    this.skipSpaces();
    const open = this.tex[this.pos] === "{";
    this.pos = save;
    return open;
  }
  optional(): string | null {
    this.skipSpaces();
    if (this.tex[this.pos] !== "[") return null;
    const end = this.tex.indexOf("]", this.pos);
    const value = this.tex.slice(this.pos + 1, end);
    this.pos = end + 1;
    return value;
  }
  /** One argument: a brace group's content, a control sequence, or one character. */
  arg(): string {
    this.skipSpaces();
    const c = this.tex[this.pos];
    if (c === "{") {
      let depth = 0;
      for (let i = this.pos; i < this.tex.length; i++) {
        if (this.tex[i] === "\\") i++;
        else if (this.tex[i] === "{") depth++;
        else if (this.tex[i] === "}" && --depth === 0) {
          const value = this.tex.slice(this.pos + 1, i);
          this.pos = i + 1;
          return value;
        }
      }
      throw new Error(`unbalanced braces in ${this.tex}`);
    }
    if (c === "\\") {
      const m = /^\\([A-Za-z]+|.)/.exec(this.tex.slice(this.pos))!;
      this.pos += m[0].length;
      return m[0];
    }
    this.pos++;
    return c ?? "";
  }
}

/** Removes what LaTeXML leaves in alttext that is spacing or layout, not math. */
function cleanup(tex: string): string {
  const dim = String.raw`-?\s*\d*\.?\d+\s*(?:pt|em|ex|mm|cm|in|mu|bp|sp)`;
  return tex
    .replace(new RegExp(String.raw`\\penalty\s*-?\d*`, "g"), "")
    .replace(new RegExp(String.raw`\\(?:vskip|vspace\*?)\s*(?:\{${dim}\}|${dim})(?:\s*plus\s*${dim})?(?:\s*minus\s*${dim})?`, "g"), "")
    .replace(/\\begin\{array\}\[[a-z]*\]/g, "\\begin{array}")
    .replace(/\\(?:nonumber|notag)\b/g, "")
    .replace(/\\tag\*?\{[^}]*\}/g, "")
    .trim();
}

/**
 * Expands the paper's macros (KaTeX bodies with #1…) and the package macros above; LaTeXML's leftovers go first.
 * The names of the macros expanded are added to `used`.
 */
export function expandTex(tex: string, macros: Record<string, string> = {}, used?: Set<string>): string {
  let out = cleanup(tex);
  let expansions = 0;
  for (let pos = out.indexOf("\\"); pos !== -1 && pos < out.length; pos = out.indexOf("\\", pos)) {
    const m = /^\\([A-Za-z]+)/.exec(out.slice(pos));
    if (!m) {
      pos += 2; // an escaped character: "\{", "\\", "\,"
      continue;
    }
    const name = m[1];
    const body = macros[`\\${name}`];
    const handler = PACKAGE_MACROS[name];
    if (body === undefined && !handler) {
      pos += m[0].length;
      continue;
    }
    if (++expansions > 10_000) throw new Error(`macro expansion does not end: ${tex}`);
    used?.add(`\\${name}`);
    const read = new Reader(out, pos + m[0].length);
    let replacement: string;
    if (body !== undefined) {
      const count = Math.max(0, ...[...body.matchAll(/#(\d)/g)].map((a) => Number(a[1])));
      const args = Array.from({ length: count }, () => read.arg());
      replacement = body.replace(/#(\d)/g, (_, k: string) => args[Number(k) - 1]);
    } else {
      replacement = handler(read);
    }
    // a control word followed by a letter needs a space to stay one word
    const after = out.slice(read.pos);
    const joint = /[A-Za-z]$/.test(replacement) && /^[A-Za-z]/.test(after) && /\\[A-Za-z]+$/.test(replacement) ? " " : "";
    out = out.slice(0, pos) + replacement + joint + after;
  }
  return out.replace(/\s{2,}/g, " ").trim();
}
