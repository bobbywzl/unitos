import type { NoteWrapSpacer } from "@/lib/note-wrap";

// The gap the article keeps around a floating note in wrap mode (SPEC.md §6):
// a zero-width float pushes down to the card's top edge, then a float the
// card's size holds the lines off the card. Floats before a block shorten the
// lines of that block and of every block after it until the float's bottom,
// so one pair draws the gap however many paragraphs the card spans.
export function NoteWrapGap({ spacer }: { spacer: NoteWrapSpacer }) {
  return (
    <>
      <div aria-hidden className="pointer-events-none" style={{ float: spacer.side, width: 0, height: spacer.offset }} />
      <div
        aria-hidden
        data-note-wrap-gap
        className="pointer-events-none"
        style={{ float: spacer.side, clear: spacer.side, width: spacer.width, height: spacer.height }}
      />
    </>
  );
}
