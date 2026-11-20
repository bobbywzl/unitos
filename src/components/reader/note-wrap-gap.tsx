import { Fragment } from "react";
import type { WrapBand } from "@/lib/note-wrap";

// The gaps the article keeps around the floating notes (SPEC.md §6), drawn
// from their bands (lib/note-wrap.ts wrapBands): per band one float on each
// side, as wide as that side's gap and as high as the band, each clearing
// its own side, so the floats of a side stack from the article's content
// top down — the one position a card can measure against exactly. A band
// with no gap on a side draws a float of no width there, which only keeps
// the stack's height. Floats shorten the lines of every block their height
// covers, so the bands draw the gaps however many paragraphs a card spans.
export function NoteWrapGaps({ bands }: { bands: WrapBand[] }) {
  return (
    <>
      {bands.map((band) => (
        <Fragment key={band.top}>
          <div
            aria-hidden
            data-note-wrap-gap={band.left > 0 ? "left" : undefined}
            className="pointer-events-none"
            style={{ float: "left", clear: "left", width: band.left, height: band.height }}
          />
          <div
            aria-hidden
            data-note-wrap-gap={band.right > 0 ? "right" : undefined}
            className="pointer-events-none"
            style={{ float: "right", clear: "right", width: band.right, height: band.height }}
          />
        </Fragment>
      ))}
    </>
  );
}
