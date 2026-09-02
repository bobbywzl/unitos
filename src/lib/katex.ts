import katex from "katex";

// KaTeX, shared by the reader's EQUATION render (components/reader/equation.tsx)
// and the conversion job's TeX verification (lib/handwritten/convert.ts), so
// what verifies is what renders.

// Macros pages use that KaTeX does not define. Each maps to KaTeX's own
// spelling; nothing here writes content. Found by the import compare loop.
export const KATEX_MACROS: Record<string, string> = {
  "\\mbox": "\\text{#1}",
  "\\hbox": "\\text{#1}",
  "\\textnormal": "\\text{#1}",
};

/** KaTeX's parse error for a TeX expression, null when it renders. The
    verification behind converted equations (SPEC.md §16): the compile-verify-fix
    loop of notes2latex (MIT, Advay Pakhale) with KaTeX standing in for latexmk. */
export function texError(tex: string): string | null {
  try {
    katex.renderToString(tex, {
      displayMode: true,
      throwOnError: true,
      strict: "ignore",
      macros: { ...KATEX_MACROS },
    });
    return null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return message.replace(/^KaTeX parse error:\s*/, "");
  }
}
