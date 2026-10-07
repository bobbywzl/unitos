# r4-graph4

**Intent:** Fix the graph canvas from the round 4 walk and view audits: WALK4-01/10 (the view stays where the reader clicks, and a phone keeps the tapped node above the sheet), WALK4-04 (the open link is lit), VIEW4-05 (labels tell titles apart and stay inside the canvas), VIEW4-06 + P4 + VIEW3-08 + WALK4-13 (a quiet far zoom, pills, the key), and WALK4-15 (a sent reply and an Accept show at once).

**Files:**
- `src/components/graph/graph-view.tsx`: no refit when only a card's or a link panel's inset changes, and a reveal pan when the card would cover its node (node and neighbours on a phone, link ends). Hover freezes after the canvas moves itself until the pointer moves. The open link lights its curve and documents. Label-start labels, `LabelEdges` (labels slide in from the canvas edge), `data-far` below zoom 0.7, the key's new rows, `nodeExtent` shared by the fit and the reveal, and markAccepted on a curve list's Accept.
- `src/lib/graph/label-start.ts` (new) and `scripts/qa/graph-label-check.ts` (new): labels for runs of titles with the same long start.
- `src/components/graph/graph-layout.ts`: a tall canvas keeps to three grid columns, or its widest linked group.
- `src/components/graph/graph-notes.tsx`: the node chip reads "1 pending" rather than "0 •", and a one-note curve pill shows the mark alone (marksWidth follows).
- `src/app/globals.css`: the far-zoom rules (`[data-far]`).
- `src/components/graph/accepted-now.ts` (new), `graph-overlay.tsx` (the header counts plus Accept in the recommended list), and `link-panel.tsx`: the header counts an Accept at once.
- `src/components/collab/reply-thread.tsx`: a sent reply shows at once ("Sending…"). The draft is cleared only on confirmation.
- `src/components/graph/documents-list.tsx`: the parts line is capped at 8 with "N more parts".
- i18n: `graphNotes.ts` (key rows, noteCurveHint), `graphView.ts` (partsMore), `common.ts` (replySending). Both en and zh.
- `SPEC.md` §13. `scripts/qa/ui-graph-canvas4.mjs` (new). `scripts/qa/ui-graph-view.mjs` clicks a point on the curve, not its box's center.

**Decisions:**
- A shared-start label keeps a short head ("Beyond Good… VII. Our Virtues") rather than dropping the start, because no folder names the start yet (P3 waits on Linda).
- No refit when a card or a link panel opens or closes, including the panel opened from a curve's list. After a close the view stays where it was.
- Edge labels slide in rather than being shortened. On a phone the layout itself narrows, so the slide is small.
- The far-zoom "sage ring for notes" in P4 was not built: COVER4 draws coverage rings on the node dots. My node-dot change is none, and the node's notes chip only hides below zoom 0.7 (CSS).
- The reply fix sits in the shared ReplyThread, so notes, edits and links all get it.
