**Intent:** Make the graph's header, canvas and side lists denser and easier to use (round 6 CHROME6: VIEW6-02/03/04/05/06/08/10/11, WALK6-07/08/10) without adding features.

**Files:**
- `src/components/graph/graph-overlay.tsx`: header pills (Scan for links leaves, Generated content only when there is one, phone pills mark + count, list intros as pill tooltips); Recommended links list (Scan + ✕ head row, compact cards); written-page ids for the canvas.
- `src/components/graph/graph-view.tsx`: generated documents folded at every width except pages written in this visit (drawn, lit); phone fit frames every node with label LOD; key in three groups, two columns, only drawn marks; wide-pane fit keeps the side list's room and caps at 1.3.
- `src/components/graph/generated-list.tsx`: ✕, intro moved to the pill tooltip.
- `src/components/graph/documents-list.tsx`: one-line rows at every size, mine-first only past 20, opened rows kept across Back, counts under the title below 640 px.
- `src/components/graph/graph-notes-list.tsx`: one head row (Section + ✕), Open in notes on the title line on hover/focus, mark + count on a phone.
- `src/components/graph/graph-find.tsx`: Pick folds into Ask Stitch; narrower Find on a phone.
- `src/app/globals.css`: a written page draws bright.
- `src/lib/i18n/dict/panes.ts`, `graphNotes.ts`: `recommendedLinksScanHere`, `keyNotesGroup` (en, zh).
- `SPEC.md` §13: the behaviour above.
- `scripts/qa/ui-graph-{lists4,documents,r2}.mjs`, `ui-stop.mjs`: follow the moved controls; new `ui-graph-chrome6.mjs`.

**Decisions:**
- Kept the canvas's page button (provenance switch in the zoom stack) although WALK6-08 proposed cutting it: with generated documents folded at every width it is the one-click way to draw them.
- "Written in this visit" = a generated node that appears after the graph opened (no stitch-box.tsx change); a page another collaborator writes meanwhile is lit the same way.
- Phone fit (WALK6-07) uses the large project's label LOD below zoom 0.45 instead of shrinking labels.
- VIEW6-05: the wider cap (1.3) applies only on panes ≥ 1200 px and only when keeping the 412 px side room costs no zoom; otherwise the old fit.
- VIEW6-07 (coverage head) left to PANEL6, who owns `coverage.tsx`; links-list.tsx intro left to PANEL6 (its words are the Links pill's tooltip here).
- Node card's keys line (VIEW6-10 second half) not moved: node-card.tsx is PANEL6's.
