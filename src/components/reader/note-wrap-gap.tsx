import type { NoteWrapSpacer } from "@/lib/note-wrap";

// The gap the article keeps around a floating note in wrap mode (SPEC.md §6):
// a zero-width float pushes down to the card's top edge, then a float the
// card's size holds the lines off the card. The pair sits at the top of the
// article, so the first float's own top is the article's content top — the
// one position the card can measure against exactly. Floats shorten the lines
// of every block their height covers, so one pair draws the gap however many
// paragraphs the card spans.
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
