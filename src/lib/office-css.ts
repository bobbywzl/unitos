// The styles of slides and sheets (SPEC.md §27): the replica's frame and
// shapes, the grid's cells and frozen panes. One string, so the reader
// (components/reader/block-view.tsx puts it in <head> once) and the
// server's picture render of a slide (lib/handwritten/slide-pictures.ts)
// draw the same page. Theme variables carry fallbacks for the server.
export const OFFICE_CSS = String.raw`
/* ── Slides (SPEC.md §27) ────────────────────────────────────────────────── */
/* The slide frame scales with the column: every length inside the slide
   is a share of the slide's width (cqw), so the replica keeps its layout
   at any size. */
.reader-slide .slide-frame {
  container-type: inline-size;
  width: 100%;
}
.reader-slide .slide {
  position: relative;
  width: 100%;
  overflow: hidden;
  background: #ffffff;
  border-radius: 10px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08), 0 0 0 1px color-mix(in srgb, var(--ink, #262320) 10%, transparent);
  font-family: Arial, Helvetica, sans-serif;
  color: #000000;
  line-height: 1.2;
}
.reader-slide .slide-number {
  position: absolute;
  right: 0;
  bottom: 0;
  transform: translate(calc(100% + 10px), 0);
  font-size: 11px;
  color: var(--sand-600, #857b6f);
  user-select: none;
}
.reader-slide .sh {
  position: absolute;
  box-sizing: border-box;
}
.reader-slide .sf {
  position: absolute;
  inset: 0;
  box-sizing: border-box;
}
.reader-slide .sv > svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
}
.reader-slide .scv,
.reader-slide .scv > svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
/* The chart's data rides under the drawing as the block's words: laid out
   in the box (so a selection sweeps through it in order), drawn invisible. */
.reader-slide .scd-hidden,
.reader-sheet .scd-hidden {
  position: absolute;
  inset: 0;
  overflow: hidden;
  opacity: 0;
  pointer-events: none;
  font-size: 1cqw;
}
.reader-slide .sf-missing {
  display: flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--ink, #262320) 6%, transparent);
  color: var(--sand-600, #857b6f);
  font-size: 1.4cqw;
  border-radius: 4px;
}
.reader-slide .st {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  overflow: visible;
}
.reader-slide .sp {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: break-word;
}
.reader-slide .sp-empty::before {
  content: "\00a0";
}
.reader-slide .sb {
  display: inline-block;
  text-indent: 0;
}
.reader-slide .si > img {
  position: absolute;
  left: 0;
  top: 0;
  object-fit: fill;
  display: block;
}
.reader-slide .si {
  overflow: hidden;
}
.reader-slide .sl {
  min-width: 1px;
  min-height: 1px;
  overflow: visible;
}
.reader-slide .sl > svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
}
.reader-slide .stbl {
  border-collapse: collapse;
  table-layout: fixed;
  width: 100%;
}
.reader-slide .stbl td {
  border: 0.1cqw solid color-mix(in srgb, var(--ink, #262320) 25%, transparent);
  vertical-align: top;
  overflow: hidden;
}
.reader-slide .sc {
  box-sizing: border-box;
  padding: 1cqw;
  border: 0.1cqw solid color-mix(in srgb, var(--ink, #262320) 20%, transparent);
  background: #ffffff;
  overflow: auto;
  font-size: 1.6cqw;
}
.reader-slide .sct {
  font-weight: 600;
  margin-bottom: 0.6cqw;
}
.reader-slide .scd td {
  padding: 0.3cqw 0.8cqw;
  white-space: nowrap;
}
.reader-slide a {
  color: var(--weblink, #1a56db);
  text-decoration: underline;
}
/* The slide's picture (a Drive import): drawn over the replica once it
   loads. The replica's words stay under it, transparent, so a selection
   and every mark still paint on them; the shapes hide. */
.reader-slide .slide-picture {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: fill;
  z-index: 0;
  pointer-events: none;
  user-select: none;
}
.reader-slide .slide-frame:not(.slide-pictured) .slide-picture {
  visibility: hidden;
}
.reader-slide .slide-pictured .sf,
.reader-slide .slide-pictured .si > img,
.reader-slide .slide-pictured .sl > svg,
.reader-slide .slide-pictured .sc {
  visibility: hidden;
}
.reader-slide .slide-pictured .sc td,
.reader-slide .slide-pictured .st,
.reader-slide .slide-pictured .st * {
  color: transparent !important;
  text-shadow: none;
}
.reader-slide .slide-pictured .st mark {
  color: transparent !important;
}
.reader-slide .slide-pictured .stbl td {
  border-color: transparent;
}
.reader-slide .slide-notes {
  margin: 10px 4px 0;
  padding: 10px 14px;
  border-left: 3px solid var(--sand-300, #d9d2c7);
  color: var(--sand-800, #4a433c);
  font-size: 14px;
  line-height: 1.55;
}
.reader-slide .slide-notes-label {
  display: block;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--sand-600, #857b6f);
  margin-bottom: 4px;
}
.reader-slide .slide-notes .sp {
  padding-left: 0 !important;
  text-indent: 0 !important;
  font-size: 14px !important;
}
.reader-slide .slide-notes .sp * {
  font-size: inherit !important;
}
.reader-slide .slide-notes .sb {
  width: auto;
  margin-right: 0.3em;
}

/* ── Sheets (SPEC.md §27) ────────────────────────────────────────────────── */
/* A sheet is a grid in a box that scrolls both ways, so frozen rows and
   columns, the column letters, and the row numbers stay in view while the
   page's own scroll stays the reader's. */
.reader-sheet .sheet {
  max-height: 78vh;
  overflow: auto;
  border-radius: 10px;
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--ink, #262320) 12%, transparent);
  background: #ffffff;
  color: #000000;
  font-family: Arial, Helvetica, sans-serif;
  font-size: 13px;
  line-height: 1.3;
}
.reader-sheet table {
  border-collapse: separate;
  border-spacing: 0;
  table-layout: fixed;
  font-variant-numeric: tabular-nums;
}
.reader-sheet th,
.reader-sheet td {
  box-sizing: border-box;
  border-right: 1px solid #e2e3e3;
  border-bottom: 1px solid #e2e3e3;
  padding: 2px 4px;
  vertical-align: bottom;
  text-align: left;
  background-clip: padding-box;
}
.reader-sheet td {
  background-color: #ffffff;
}
.reader-sheet th {
  position: sticky;
  background: #f8f9fa;
  color: #5f6368;
  font-weight: 400;
  text-align: center;
  vertical-align: middle;
  user-select: none;
  z-index: 2;
}
.reader-sheet thead th {
  top: 0;
  z-index: 3;
}
.reader-sheet .sheet-corner {
  left: 0;
  z-index: 5;
}
.reader-sheet .sheet-rn {
  left: 0;
  z-index: 4;
}
.reader-sheet .sheet-fc {
  position: sticky;
  z-index: 1;
}
.reader-sheet td.sheet-fc {
  border-right-color: #bdc1c6;
}
.reader-sheet .sheet-fr {
  position: sticky;
  top: var(--sheet-top);
  z-index: 2;
  border-bottom-color: #bdc1c6;
}
.reader-sheet td.sheet-fr.sheet-fc,
.reader-sheet th.sheet-fr {
  z-index: 4;
}
.reader-sheet thead .sheet-fc {
  z-index: 4;
}
.reader-sheet .sheet-num {
  text-align: right;
}
.reader-sheet .sheet-mid {
  text-align: center;
}
.reader-sheet .sheet-clip {
  white-space: nowrap;
  overflow: hidden;
}
.reader-sheet .sheet-over {
  white-space: nowrap;
  overflow: visible;
  z-index: 1;
}
/* An overflowing cell stacks over its empty neighbors; a frozen one is
   already positioned (sticky) and keeps its offset. */
.reader-sheet td.sheet-over:not(.sheet-fc):not(.sheet-fr) {
  position: relative;
}
.reader-sheet td.sheet-over.sheet-fc,
.reader-sheet td.sheet-over.sheet-fr {
  z-index: 2;
}
.reader-sheet a {
  color: var(--weblink, #1a56db);
  text-decoration: underline;
}
.reader-sheet .cell-gap,
.reader-slide .cell-gap {
  font-size: 0;
  line-height: 0;
}

/* Sheet drawings (SPEC.md §27): pictures, charts, and shapes anchored to
   cells, laid over the grid inside the scroll box, so they scroll with the
   cells they sit on. */
.reader-sheet .sheet-inner {
  position: relative;
}
.reader-sheet .sheet-drawing {
  position: absolute;
  overflow: hidden;
  z-index: 3;
}
.reader-sheet .sheet-drawing > img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: fill;
}
.reader-sheet .sheet-drawing > svg {
  display: block;
  width: 100%;
  height: 100%;
  background: #ffffff;
  border: 1px solid #d9d9d9;
}
.reader-sheet .sheet-drawing-shape {
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  padding: 4px 6px;
  font-size: 12px;
  overflow: hidden;
  white-space: pre-wrap;
}
`;
