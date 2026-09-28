// Headings: what a numbered heading looks like, and each heading's level.

import { escapeHtml } from "@/lib/parse/pdf/text";
import type { Segment } from "@/lib/parse/pdf/types";

// Numbered heading: the number must close with "." or ")" or dot into a
// sub-number — "3.1 Results" and "1. Summary" match, "23 advertisers" does not.
// "3.1 Results", "2. Background", and the bare "2 Background" (ACL style).
// The word after the number starts uppercase — a body line rarely does.
export const HEADING_NUM_STRICT_RE = /^(\d{1,2}((\.\d{1,2})+\.?|[.)])?|[A-Z](\.\d{1,2})+\.?)\s+[\p{Lu}\p{Lo}]/u;
// An appendix section: "A Benchmarks and audits" — a letter alone, bold.
export const LETTER_HEADING_RE = /^[A-Z]\s+[\p{Lu}]/u;
// The number of a heading and its depth: "3" → 1, "3.2" → 2, "A.1" → 2.
const HEADING_NUMBER_RE = /^(\d{1,2}|[A-Z])((?:\.\d{1,2})*)\.?[.)]?\s/;
function headingDepth(text: string): number | null {
  const m = HEADING_NUMBER_RE.exec(text);
  if (!m) return null;
  return 1 + (m[2].match(/\./g)?.length ?? 0);
}

// ── Heading levels ──────────────────────────────────────────────────────────

// Ranked by size: the biggest heading size in the document gets the level its
// ratio to body earns (a modest largest heading starts at h2), each smaller
// cluster steps one level down, floor h3.
export function assignHeadingLevels(segments: Segment[], bodySize: number) {
  const sizes: number[] = [];
  for (const s of segments) {
    if (s.type !== "HEADING" || s.rawSize === undefined) continue;
    if (!sizes.some((v) => Math.abs(v - s.rawSize!) < v * 0.05)) sizes.push(s.rawSize);
  }
  sizes.sort((a, b) => b - a);
  const topRatio = sizes.length > 0 ? sizes[0] / bodySize : 1;
  const base = topRatio > 1.5 ? 1 : topRatio > 1.18 ? 2 : 3;
  // Numbered headings take their level from the numbering's depth ("3" one
  // step under the title, "3.2" the next), so a 12pt section and a 12pt-bold
  // subsection do not land in one bucket.
  const numberedBase = sizes.length > 1 && base === 1 ? 2 : base;
  for (const s of segments) {
    if (s.type !== "HEADING") continue;
    const idx = sizes.findIndex((v) => s.rawSize !== undefined && Math.abs(v - s.rawSize) < v * 0.05);
    const depth = headingDepth(s.text);
    const level = Math.min(
      3,
      depth !== null ? numberedBase + depth - 1 : base + Math.max(0, idx),
    ) as 1 | 2 | 3;
    s.html = `<h${level}>${escapeHtml(s.text)}</h${level}>`;
  }
}
