# claude/wonderful-mendel-c28h4c

**Intent:** Stop a second segment from looking highlighted when a reader selects text while the selection toolbar is still open on an earlier selection.

**Files:**
- `src/components/reader/reader-interactions.tsx`: the selection-to-toolbar effect. A left press on the article, outside the toolbar and off the tinted text, closes the toolbar and the Close link chip at once, so the old tint leaves before the new drag draws its selection. The mouseup listens on the document, so a drag that starts on the article and lets go outside the pane still replaces the toolbar; a press that started outside the pane never opens or closes it.

**Decisions:**
- The tinted text under the toolbar keeps the toolbar on a press: a press there starts the drag that carries the passage as a quote, and the drag reads the toolbar's anchor.
- The cause was two tints of one color: the toolbar paints its text with the selection's color, and the browser's own selection uses the same color. A new selection made while the toolbar stayed open (the mouseup landed outside the pane, or focus sat in the toolbar's text box) showed both, and the tools read only the toolbar's anchor.
- Only the mouse path changed. Touch keeps the pointerup and selectionchange path as it was.
