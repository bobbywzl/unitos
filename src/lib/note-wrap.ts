// A floating note stands in the article's scroll pane and the article's lines
// flow around it (SPEC.md §6). Each floating card measures the gap it needs
// (components/outline/floating-note-editor.tsx) and announces it; the
// reader draws the gaps (components/reader/reader.tsx) as float spacers at
// the top of the article. Several notes can float, so there is one gap per
// card, and the reader puts them together (wrapBands).
//
// The spacers sit at the article's content top, and `offset` is measured from
// there — not from a block. A float placed before a block lands at the
// block's margin edge, not its border edge, which put the gap a block margin
// too high; measured from the article's own content box the gap hugs the card
// exactly.

export const NOTE_WRAP_EVENT = "dissect:note-wrap";

/** The text's distance from a card, in px. The card measures with it
    and the reader's checks read it. */
export const NOTE_WRAP_GAP = 18;

/** Less room than this beside a card, or between two cards, and the text
    skips below instead. */
export const NOTE_WRAP_MIN_BESIDE = 200;

export type NoteWrapSpacer = {
  /** The floating note. */
  id: string;
  /** The side of the column the card sits on: the lines flow on the other side. */
  side: "left" | "right";
  /** The gap's width, from the column's edge on `side` to the card plus its margin. The column's full width: the text skips below the card. */
  width: number;
  /** How far below the article's content top the gap starts: the card's top edge, less its margin. */
  offset: number;
  /** The gap's height: the card's height plus its margins. */
  height: number;
  /** The width of the article's text column the gap was measured in. */
  column: number;
};

/** One card's gap, or null when the card needs none (it stands beside the
    text, or it is gone). */
export type NoteWrapChange = { id: string; spacer: NoteWrapSpacer | null };

export function announceNoteWrap(id: string, spacer: NoteWrapSpacer | null): void {
  window.dispatchEvent(new CustomEvent<NoteWrapChange>(NOTE_WRAP_EVENT, { detail: { id, spacer } }));
}

/** One stretch of the article's height with the same gaps beside it: how
    wide the gap on each side is from `top` to `top + height`. */
export type WrapBand = { top: number; height: number; left: number; right: number };

/** The gaps of every floating card as bands, from the article's content top
    down, with no hole between them. Where two cards stand at the same height
    the band takes the widest gap of each side; where the two sides leave
    less than NOTE_WRAP_MIN_BESIDE of text between them, the band takes the
    whole column and the text skips below. */
export function wrapBands(spacers: NoteWrapSpacer[]): WrapBand[] {
  if (spacers.length === 0) return [];
  const edges = [...new Set([0, ...spacers.flatMap((s) => [Math.max(0, s.offset), Math.max(0, s.offset + s.height)])])].sort(
    (a, b) => a - b,
  );
  const bands: WrapBand[] = [];
  for (let i = 0; i + 1 < edges.length; i++) {
    const top = edges[i];
    const bottom = edges[i + 1];
    let left = 0;
    let right = 0;
    let column = Infinity;
    for (const s of spacers) {
      if (s.offset >= bottom || s.offset + s.height <= top) continue;
      column = Math.min(column, s.column);
      if (s.side === "left") left = Math.max(left, s.width);
      else right = Math.max(right, s.width);
    }
    if (left + right > 0 && column - left - right < NOTE_WRAP_MIN_BESIDE) {
      left = column;
      right = 0;
    }
    const last = bands[bands.length - 1];
    if (last && last.left === left && last.right === right) last.height += bottom - top;
    else bands.push({ top, height: bottom - top, left, right });
  }
  return bands;
}
