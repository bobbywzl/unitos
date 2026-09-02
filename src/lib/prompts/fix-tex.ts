// TeX repair (SPEC.md §16): converted EQUATION blocks KaTeX could not parse go
// back to the model with the parser's error. Runs inside the conversion job
// (lib/handwritten/convert.ts), not through /api/derive. After notes2latex's
// fix-errors step (MIT, Advay Pakhale).
export type FixTexCtx = {
  equations: { index: number; tex: string; error: string }[];
};

export function fixTexPrompt(ctx: FixTexCtx): string {
  const listing = ctx.equations
    .map((e) => `[${e.index}] error: ${e.error}\n${e.tex}`)
    .join("\n\n");
  return [
    "The equations below were transcribed from handwritten pages as LaTeX. KaTeX could not parse them; each carries the parser's error. Fix the LaTeX so it parses.",
    "",
    "1. Fix only the error. Keep the mathematical content exactly as it is. Never add, drop, or change a symbol that is not part of the error.",
    "2. Use standard LaTeX math KaTeX renders: amsmath environments (aligned, cases, pmatrix, bmatrix), \\frac, \\sqrt, \\sum, \\int, Greek letters, \\text{}. No packages, no \\newcommand, no \\documentclass, no $ delimiters.",
    "3. Replace a macro KaTeX does not know with its standard spelling: \\dv{f}{x} → \\frac{df}{dx}, \\abs{x} → \\lvert x \\rvert, \\bra{a} → \\langle a \\rvert, \\ket{b} → \\lvert b \\rangle.",
    "4. An expression that cannot be repaired without changing its content: return it unchanged.",
    "",
    'Return ONLY JSON: {"fixes": [{"index": 0, "text": "…"}]}. One entry per equation, same index.',
    "",
    "Equations:",
    listing,
  ].join("\n");
}
