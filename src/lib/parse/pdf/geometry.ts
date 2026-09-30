// Measures the modules share: the box, font size, and math share of lines, the
// union of two boxes, a box as a region, and the median.

import { charCount } from "@/lib/parse/pdf/glyphs";
import type { Box, Line } from "@/lib/parse/pdf/types";
import type { Region } from "@/lib/video/types";

// ── Geometry ────────────────────────────────────────────────────────────────

function boxOf(lines: Line[]): Box {
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const l of lines) {
    x1 = Math.min(x1, l.x);
    x2 = Math.max(x2, l.xEnd);
    y1 = Math.min(y1, l.yMin - l.size * 0.3);
    y2 = Math.max(y2, l.yMax + l.size * 0.85);
  }
  return { x1, y1, x2, y2 };
}

// The lines' extent at their own baselines: a line's scripts (X_n, EX⁺)
// reach past it, and a display's space is measured to the line itself.
function lineBoxOf(lines: Line[]): Box {
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const l of lines) {
    x1 = Math.min(x1, l.x);
    x2 = Math.max(x2, l.xEnd);
    y1 = Math.min(y1, l.y - l.size * 0.3);
    y2 = Math.max(y2, l.y + l.size * 0.85);
  }
  return { x1, y1, x2, y2 };
}

export function unionBox(a: Box, b: Box): Box {
  return {
    x1: Math.min(a.x1, b.x1),
    y1: Math.min(a.y1, b.y1),
    x2: Math.max(a.x2, b.x2),
    y2: Math.max(a.y2, b.y2),
  };
}

// What a segment's lines say about it: extent, font size, math share.
export function geom(lines: Line[]): { box: Box; lineBox: Box; lineSize: number; mathShare: number } {
  const chars = lines.reduce((n, l) => n + charCount(l.text), 0);
  const math = lines.reduce((n, l) => n + l.mathChars, 0);
  return {
    box: boxOf(lines),
    lineBox: lineBoxOf(lines),
    lineSize: median(lines.map((l) => l.size)),
    mathShare: chars > 0 ? math / chars : 0,
  };
}

// Share of a line's glyphs set in math fonts.
export function lineMathShare(line: Line): number {
  const chars = charCount(line.text);
  return chars > 0 ? line.mathChars / chars : 0;
}

// A box as the §11 percent-coordinate region shape (y measured from the top).
export function regionOf(box: Box, pageWidth: number, pageHeight: number): Region {
  const px = (x: number) => Math.min(100, Math.max(0, (x / pageWidth) * 100));
  const py = (y: number) => Math.min(100, Math.max(0, ((pageHeight - y) / pageHeight) * 100));
  const [l, r, t, b] = [px(box.x1), px(box.x2), py(box.y2), py(box.y1)];
  return {
    kind: "path",
    points: [
      [l, t],
      [r, t],
      [r, b],
      [l, b],
    ],
  };
}

// ── Shared math ─────────────────────────────────────────────────────────────

export function median(values: number[]): number {
  if (values.length === 0) return 10;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}
