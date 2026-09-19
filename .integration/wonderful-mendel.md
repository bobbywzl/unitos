# claude/wonderful-mendel-c28h4c

**Intent:** Stop a second segment from looking highlighted when a reader selects text while the selection toolbar is still open on an earlier selection.

**Files:**
- `src/components/reader/reader-interactions.tsx`: the selection-to-toolbar effect. A left press on the article, outside the toolbar and off the tinted text, closes the toolbar and the Close link chip at once, so the old tint leaves before the new drag draws its selection. The mouseup listens on the document, so a drag that starts on the article and lets go outside the pane still replaces the toolbar; a press that started outside the pane never opens or closes it.

**Decisions:**
- The tinted text under the toolbar keeps the toolbar on a press: a press there starts the drag that carries the passage as a quote, and the drag reads the toolbar's anchor.
- The cause was two tints of one color: the toolbar paints its text with the selection's color, and the browser's own selection uses the same color. A new selection made while the toolbar stayed open (the mouseup landed outside the pane, or focus sat in the toolbar's text box) showed both, and the tools read only the toolbar's anchor.
- Only the mouse path changed. Touch keeps the pointerup and selectionchange path as it was.

## Round two: the board shows notes whole when it has the room

**Intent:** On a section's board, a tile shows its whole body when the board has the room, and the tiles collapse to 3:4 only when the notes are many.

**Files:**
- `src/components/outline/section-board.tsx`: the board measures its room (a `ResizeObserver` on the scroll container): columns are as many 220px tiles as the width holds and no more than the notes; the height, less the composer and the gaps, is shared among the rows; a tile grows to its share and never under the 3:4 tile. The limits go to the grid as `--tile-cols`, `--tile-min`, `--tile-max`, and to the drag overlay's copy of the tile.
- `src/components/outline/note-tile.tsx`: the fade at the bottom shows only on a cut body (`.note-tile-cut`, a `ResizeObserver` on the body). The two-line clamp on the title is gone.
- `src/components/sortable.tsx`: `SortableGroup` takes a `style`.
- `src/app/globals.css`: `.note-board` columns from `--tile-cols` once sized, up to 480px wide; `.note-tiles-sized .note-tile` fills its stretched wrapper within the limits; the fade is 56px at the foot of a cut body.
- `SPEC.md` §6, `CLAUDE.md` glossary.

**Decisions:**
- Tiles of one row stretch to one height, so a row of unequal notes still lines up; a short note keeps empty space under its body.
- The widest tile is 480px: a wider column of 12.5px text reads badly. One or two notes sit left, not centered.
- Before the first measure the tiles keep the 3:4 aspect, so the board never paints in a third shape; the measure runs in a layout effect, before paint.
