"use client";

import katex from "katex";
import "katex/dist/katex.min.css";
import { useMemo } from "react";
import { KATEX_MACROS } from "@/lib/katex";

// EQUATION block: block.text is raw TeX; render it with KaTeX. Rendered DOM text
// differs from stored text, so selection anchoring is off for these blocks
// (data-math-block; whole-block anchors still work via data-source-id).
// On a TeX KaTeX cannot parse, fall back to the raw text — never invent content.
export function Equation({ tex }: { tex: string }) {
  const html = useMemo(() => {
    try {
      return katex.renderToString(tex, {
        displayMode: true,
        throwOnError: false,
        output: "htmlAndMathml",
        macros: { ...KATEX_MACROS },
      });
    } catch {
      return null;
    }
  }, [tex]);

  if (html === null) {
    return <pre className="my-4 overflow-x-auto rounded-2xl bg-sand-200 p-4 text-sm">{tex}</pre>;
  }
  return <div className="equation-block overflow-x-auto" dangerouslySetInnerHTML={{ __html: html }} />;
}
