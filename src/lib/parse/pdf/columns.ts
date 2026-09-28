// Reading order: a page's lines in one column, or in two columns read left
// then right between the lines that span both.

import { buildLines } from "@/lib/parse/pdf/lines";
import type { Item, Line } from "@/lib/parse/pdf/types";

// Two-column pages: find a middle gutter that almost no text crosses, with two
// prose-shaped columns. A wide table also leaves a gutter, but its sides start
// at many x positions and its left and right lines share baselines — those
// pages stay in one pass so rows keep their reading order.
export function pageLines(items: Item[], pageWidth: number, page: number): Line[] {
  const chars = (list: Item[]) => list.reduce((n, i) => n + i.str.length, 0);
  const total = chars(items);
  if (total === 0) return [];

  let best: { g: number; crossChars: number } | null = null;
  for (let g = pageWidth * 0.44; g <= pageWidth * 0.58; g += pageWidth * 0.02) {
    const crossers = items.filter((i) => i.x < g && i.x + i.w > g && i.str.trim().length > 0);
    const crossChars = chars(crossers);
    if (!best || crossChars < best.crossChars) best = { g, crossChars };
  }
  const g = best ? best.g : pageWidth / 2;
  const left = items.filter((i) => i.x + i.w <= g);
  const right = items.filter((i) => i.x >= g);
  const full = items.filter((i) => i.x < g && i.x + i.w > g);

  // Prose columns start their lines at the body edge or the paragraph indent —
  // two x positions cover almost every line. Table sides scatter across many.
  const columnShaped = (side: Item[]): boolean => {
    const lines = buildLines(side, page);
    if (lines.length < 6) return false;
    const counts = new Map<number, number>();
    for (const line of lines) {
      const x = Math.round(line.x / 4) * 4;
      counts.set(x, (counts.get(x) ?? 0) + 1);
    }
    const sorted = [...counts.values()].sort((a, b) => b - a);
    return (sorted[0] ?? 0) + (sorted[1] ?? 0) >= lines.length * 0.62;
  };
  // Shared baselines do NOT discriminate: LaTeX sets both columns on one
  // baseline grid, so real columns share most baselines. Shape decides.
  const twoColumn =
    best !== null &&
    best.crossChars / total < 0.15 &&
    chars(left) / total > 0.2 &&
    chars(right) / total > 0.2 &&
    columnShaped(left) &&
    columnShaped(right);

  if (!twoColumn) return buildLines(items, page);

  const leftLines = buildLines(left, page);
  const rightLines = buildLines(right, page);
  const fullLines = buildLines(full, page).sort((a, b) => b.y - a.y);

  const ordered: Line[] = [];
  let pendingLeft = [...leftLines];
  let pendingRight = [...rightLines];
  for (const boundary of fullLines) {
    const above = (l: Line) => l.y > boundary.y;
    ordered.push(...pendingLeft.filter(above));
    ordered.push(...pendingRight.filter(above));
    pendingLeft = pendingLeft.filter((l) => !above(l));
    pendingRight = pendingRight.filter((l) => !above(l));
    ordered.push(boundary);
  }
  ordered.push(...pendingLeft, ...pendingRight);
  return ordered;
}
