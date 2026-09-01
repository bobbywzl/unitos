# claude/pdf-handwriting-import-format-0trmcq

**Intent:** Two follow-up UI fixes after the PDF/Drive/welcome-flow round merged to `main`: shrink the /signin watermark to the page's top-left quadrant, and fix the selection popover's floating bubbles (Add to notes, highlight colors, voice) so they share one left edge.

**Files:**
- `src/app/signin/page.tsx` — the backdrop mark's wrapper div goes from `inset-0` (whole page) to `top-0 left-0 h-1/2 w-1/2` (top-left quadrant); `fit="cover"` still fills that box.
- `src/components/reader/reader-interactions.tsx` — hoisted the selection toolbox's computed `{top, left, width}` into a shared `popoverBox` const (was an inline IIFE used only by the toolbox itself). The "Add to notes" bubble (`w-44` = 176px, wider than the 116px toolbox) was `right-0`-anchored, which pulled its left edge up to 60px past the toolbox's own left edge — the visible misalignment against the highlight-color bubble, the toolbox, and the voice bubble below it (all `left-0`). It's now `left-0`-equivalent via a computed `addToNotesLeft` (0 by default, only negative — pulled back — when that would run its right edge past the pane), so all four floating pieces line up on the left in the common case.
- `SPEC.md` — the one sentence describing the /signin backdrop now says top-left quadrant instead of the whole page (the welcome-flow's own full-background mark is unchanged and still described as covering the whole background).

**Decisions:**
- Kept the "pull back only if it would overflow the pane" safety net for Add to notes rather than a bare `left-0`, since the original right-anchoring existed specifically to avoid right-edge clipping when the toolbox sits near the pane's right edge (`side: "right"`, clamped). A bare `left-0` would have reintroduced that clipping in that specific case.
- Did not touch the highlight-color bubble's clamp — it was already `left-0` and narrow enough (four dots) that it wasn't the element the user flagged; no change needed there.
