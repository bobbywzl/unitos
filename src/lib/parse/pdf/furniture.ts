// Page furniture: lines repeated at the top or bottom of many pages (running
// heads and feet). parsePdf drops them before segmentation, and drops lone
// page numbers in its page loop.

import type { Line } from "@/lib/parse/pdf/types";

// ── Repeated page furniture ─────────────────────────────────────────────────

export function furnitureKeys(pages: Line[][], pageHeights: number[]): Set<string> {
  const normalize = (text: string) =>
    text.toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ").trim();
  const seenOn = new Map<string, Set<number>>();
  pages.forEach((lines, p) => {
    const h = pageHeights[p];
    for (const line of lines) {
      if (line.y > h * 0.085 && line.y < h * 0.915) continue;
      // A reference's last line ("425–429.") lands in the footer band on
      // more than one page; a footer never ends a sentence with a number.
      if (/\d\.$/.test(line.text.trim())) continue;
      const key = normalize(line.text);
      if (key.length === 0) continue;
      const set = seenOn.get(key) ?? new Set<number>();
      set.add(p);
      seenOn.set(key, set);
    }
  });
  const threshold = Math.max(3, Math.round(pages.length * 0.25));
  const furniture = new Set<string>();
  for (const [key, on] of seenOn) if (on.size >= threshold) furniture.add(key);
  return furniture;
}
