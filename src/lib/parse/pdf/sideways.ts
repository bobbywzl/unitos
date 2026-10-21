// A sideways note: words set at a right angle in a page's margin, read as a
// paragraph beside the block they stand by (parse loop finding: Form W-9's
// "Print or type. See Specific Instructions on page 3.", set up the left
// margin of its fields table, read as nothing: a rotated item is no line
// of the page unless a table's rules hold it).
//
// The note's items run up the page (the usual turn, the top of the letters
// to the left) or down it; its lines stand side by side across the page.
// Read turned upright: a line's items in the order they run, the lines in
// the order a reader turned with them takes them. The note stands clear
// of the page's upright words, in the page's outer fifth, and holds a few
// words of letters, outside every graphic and picture: a rotated page, a
// chart's axis label, and a figure's turned words are none. A note printed sideways on page after page (a
// journal's "Downloaded from …") is furniture (parsePdf).

import { buildLines } from "@/lib/parse/pdf/lines";
import { blockText } from "@/lib/parse/pdf/segment";
import type { Box, Item, Line, Segment } from "@/lib/parse/pdf/types";

/** A rotated text item as the page sets it: the upright item index.ts
    made of it, its origin, its length along its run, and its turn (1 runs
    up the page, −1 down it). */
export type SidewaysItem = { item: Item; x: number; y: number; len: number; dir: 1 | -1 };

export type SidewaysNote = { lines: Line[]; box: Box; size: number; text: string };

const LETTERS_RE = /\p{L}/gu;

/** The sideways notes of a page: its rotated items no table took, in the
    margin, grouped into notes by their turn and their place. */
export function sidewaysNotes(items: SidewaysItem[], upright: Item[], pageWidth: number, page: number, pictures: Box[]): SidewaysNote[] {
  if (items.length === 0 || items.length > 12 || upright.length < 20) return [];
  const out: SidewaysNote[] = [];
  for (const dir of [1, -1] as const) {
    const own = items.filter((s) => s.dir === dir).sort((a, b) => a.x - b.x);
    if (own.length === 0) continue;
    // The note's lines: items whose origins share an x within half a size.
    const lines: SidewaysItem[][] = [];
    for (const s of own) {
      const last = lines[lines.length - 1];
      if (last && Math.abs(s.x - last[0].x) <= s.item.size * 0.5) last.push(s);
      else lines.push([s]);
    }
    const size = Math.max(...own.map((s) => s.item.size));
    const box: Box =
      dir === 1
        ? { x1: Math.min(...own.map((s) => s.x)) - size * 0.8, x2: Math.max(...own.map((s) => s.x)) + size * 0.2, y1: Math.min(...own.map((s) => s.y)), y2: Math.max(...own.map((s) => s.y + s.len)) }
        : { x1: Math.min(...own.map((s) => s.x)) - size * 0.2, x2: Math.max(...own.map((s) => s.x)) + size * 0.8, y1: Math.min(...own.map((s) => s.y - s.len)), y2: Math.max(...own.map((s) => s.y)) };
    // In the page's outer fifth, clear of upright words.
    if (box.x2 > pageWidth * 0.2 && box.x1 < pageWidth * 0.8) continue;
    if (upright.some((it) => it.x < box.x2 && it.x + it.w > box.x1 && it.y < box.y2 && it.y + it.size > box.y1)) continue;
    // A figure's turned words (an axis label) are the figure's.
    if (pictures.some((b) => b.x1 < box.x2 && b.x2 > box.x1 && b.y1 < box.y2 && b.y2 > box.y1)) continue;
    // Turned upright: a run up the page reads left to right at x = y, its
    // lines from the left at y = −x; a run down the page reads at x = −y,
    // its lines from the right at y = x.
    const turned: Item[] = own.map((s) => ({ ...s.item, x: dir === 1 ? s.y : -s.y, y: dir === 1 ? -s.x : s.x, w: s.len }));
    const built = buildLines(turned, page);
    const text = built.map((l) => l.text).join(" ");
    const words = text.split(/\s+/).filter((w) => LETTERS_RE.test(w));
    if (words.length < 3 || words.length > 60 || (text.match(LETTERS_RE) ?? []).length < 12) continue;
    out.push({ lines: built, box, size, text });
  }
  return out;
}

/** The note as a paragraph segment, at its place among the page's
    segments: before the first block it stands beside (the block's lines
    overlap its height and stand to its right or left), else last. */
export function placeSidewaysNote(segments: Segment[], note: SidewaysNote, page: number): void {
  const segment: Segment = { type: "PARAGRAPH", ...blockText(note.lines), page, box: note.box, lineBox: note.box, lineSize: note.size, mathShare: 0 };
  const beside = segments.findIndex((s) => s.box !== undefined && s.box.y1 < note.box.y2 && s.box.y2 > note.box.y1 && (s.box.x1 >= note.box.x2 - 2 || s.box.x2 <= note.box.x1 + 2));
  if (beside >= 0) segments.splice(beside, 0, segment);
  else segments.push(segment);
}
