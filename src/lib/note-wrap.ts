// Wrap text (SPEC.md §6): a floating note joins the article's scroll pane and
// the article's lines flow around it. The floating card measures the gap it
// needs (components/outline/floating-note-editor.tsx) and announces it; the
// reader draws it (components/reader/reader.tsx) as float spacers at the top
// of the article. One note floats at a time, so one gap, or none.
//
// The spacers sit at the article's content top, and `offset` is measured from
// there — not from a block. A float placed before a block lands at the
// block's margin edge, not its border edge, which put the gap a block margin
// too high; measured from the article's own content box the gap hugs the card
// exactly.

export const NOTE_WRAP_EVENT = "dissect:note-wrap";

/** The text's distance from a wrapped card, in px. The card measures with it
    and the reader's checks read it. */
export const NOTE_WRAP_GAP = 18;

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
};

export function announceNoteWrap(spacer: NoteWrapSpacer | null): void {
  window.dispatchEvent(new CustomEvent<NoteWrapSpacer | null>(NOTE_WRAP_EVENT, { detail: spacer }));
}
