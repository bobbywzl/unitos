// Wrap text (SPEC.md §6): a floating note joins the article's scroll pane and
// the article's lines flow around it. The floating card measures the gap it
// needs (components/outline/floating-note-editor.tsx) and announces it; the
// reader draws it (components/reader/reader.tsx) as float spacers before the
// block the card's top edge falls in. One note floats at a time, so one gap,
// or none.

export const NOTE_WRAP_EVENT = "dissect:note-wrap";

export type NoteWrapSpacer = {
  /** The floating note. */
  id: string;
  /** The block the card's top edge falls in; the spacers go before it. */
  blockId: string;
  /** The side of the column the card sits on: the lines flow on the other side. */
  side: "left" | "right";
  /** The gap's width, from the column's edge on `side` to the card plus its margin. The column's full width: the text skips below the card. */
  width: number;
  /** How far below the block's top the gap starts: the card's top edge, less its margin. */
  offset: number;
  /** The gap's height: the card's height plus its margins. */
  height: number;
};

export function announceNoteWrap(spacer: NoteWrapSpacer | null): void {
  window.dispatchEvent(new CustomEvent<NoteWrapSpacer | null>(NOTE_WRAP_EVENT, { detail: spacer }));
}
