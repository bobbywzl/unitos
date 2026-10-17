# loop/r15-fixup

**Intent:** Fix the regressions verification found in the merged round 15 tree: TOOL15-07 (with TOOL15-14 at 390), TOOL15-09 at 390, TOOL15-10 at 1440 (verifier a), and R1, R2 (verifier b).

## Findings

All runs on this worktree's server (:3148), in the project "Fix r15 fixup" (copies of the reading document, one uploaded deck). The project and its documents were deleted through the app at the end. Screenshots: `/mnt/project-files/interaction-loop/round-15/img/<ID>-fix-before.jpg` and `-fix-after.jpg`.

- **TOOL15-07: fixed.** `p01-phone-plan.mjs`, 390 touch.
  - Before (`BLK=6 W0=12 W1=18`, and blocks 9, 10, 13, 18): card 300 wide at y 200–668, the turns in a 328 px scroll window scrolled 37 px, Accept at y 567 hidden, about 120 px free under the card.
  - Cause: not the over-card's lift alone. On the runs that failed, the touch hint row (`[data-edit-hint]`, 106 px, under the pane) was showing when the answer landed, so the pane was 616 px tall, not 722. The phone check capped the card to that room. The hint faded, the pane grew, and the cap stayed. A full-width card under a paragraph got the same stale cap (block 12: scroll window 348 px).
  - After (blocks 15 `W0=20 W1=26`, 6, 18, 13, 9): card 374 wide at x 8, for example y 269–775 or 200–705. Accept at y 567–637, in view, with no scroll window inside the card.
  - Screenshots: `TOOL15-07-fix-before.jpg`, `TOOL15-07-fix-after.jpg`.
- **TOOL15-14 at 390: made to agree.** `m01-match.mjs 390 844 touch`.
  - Before: the match card was 300 wide at x 12–312, y 335–603, over the paragraph, with cut words beside it.
  - After: the card is x 8–382, y 335–571, under the origin's words, which stay in view.
  - At 1440 nothing changes (`dockUnderWords` keeps 300 px when the pane is wide).
  - Screenshots: `TOOL15-14-fix-before.jpg`, `TOOL15-14-fix-after.jpg`.
- **TOOL15-09 at 390: fixed.** `tk09-phone-menu.mjs`.
  - Before (`BLK=17 W0=2 W1=8`): the menu box was at x −111, 176 wide, with its rows at x −104.
  - After at 390: the card is full width (above), ⋯ is at x 329, and the menu is at x 189–365.
  - After at 560 (`VW=560 BLK=6`, a 300 px card whose foot row wraps, ⋯ at x 29): the menu is at x 8, inside the screen.
  - After at 1440: the menu is right-aligned to ⋯ as before (713–889, ⋯ right edge 889).
  - Screenshots: `TOOL15-09-fix-before.jpg`, `TOOL15-09-fix-after.jpg`, `TOOL15-09-fix-after-560.jpg`.
- **TOOL15-10: fixed.** `c02-collapse-place.mjs`.
  - Before, at 1440: whole, block 12 at 0, scroll 2207. Collapse on: block 11 at −48, scroll 1084. Collapse off: block 11 at −112, scroll 2070.
  - After, at 1440 (two runs): Collapse on: block 12 at −1, scroll 1166. Collapse off: block 12 at 0, scroll 2207.
  - After, at 390 touch (two runs): block 12 at 0 in all three states (scroll 3949 → 1777 → 3949).
  - Cause: the collapsed article was too short to scroll the heading to the reading line, so the pane stopped at its end. Collapse off then kept the block the pane had stopped on.
  - Screenshots: `TOOL15-10-fix-before.jpg`, `TOOL15-10-fix-after.jpg` (Collapse off), `TOOL15-10-fix-after-on.jpg`.
- **R1 (Add to a note offline): fixed.** `n09-offline.mjs keep`.
  - Before: `url after Add chrome-error://chromewebdata/`, the "No internet" page.
  - After (two runs): the page stays. The header reads "Offline · … 1 saved for sync", and the line under the menu reads "Added to note #id". The queued `PATCH … {append}` lands once online: 1 copy, 1 source.
  - Screenshots: `R1-add-offline-fix-before.jpg`, `R1-add-offline-fix-after.jpg`.
- **R2 (a highlight deleted offline from its card): fixed.** `e05b-offline-delete.mjs card`.
  - Before: when the pill went, the mark came back (mark 1), the queue was empty, and online +15 s gave the database "live", events 0.
  - After: when the pill goes, the mark stays hidden (mark 0) and the queue holds `DELETE /api/notes/:id`. Online +15 s: the database has no row, events 1.
  - The tab path is unchanged: queued, it lands online with events 1.
  - Screenshots: `R2-card-offline-fix-before.jpg`, `R2-card-offline-fix-after.jpg`.
- Also checked: an Explain card on a slide at 390 (`officecards.mjs KEY=deck W=390 TOUCH=1`). The slide is 192 px tall, under the threshold, so the card stays under the slide, full width, as before.

`npx tsc --noEmit` is clean (dev server stopped). `eslint` is clean on each changed file.

## Files

- `src/components/reader/reader-interactions.tsx`:
  - `dockUnderWords`: full width on a phone-width pane.
  - `layoutNarrowCards`: `phoneCapViewRef`. A phone cap measured against a smaller view is lifted, and the card is measured again.
  - Collapse place: the room under a short collapsed article, cleared on Collapse off and on a document change.
- `src/components/reader/card-more.tsx`: the ⋯ menu moves sideways to stay 8 px inside the screen. It opens below when the room above is short.
- `src/components/panels/annotation-menu.tsx`: `refreshWhenOnline(router)` in place of `router.refresh()`, in `run()` and in the Undo of Add to a note.
- `src/lib/deferred-delete.ts`: `send()` puts a delete in the offline queue (through `api()`) when there is no network. The pending sessionStorage record is forgotten once the queue holds the delete.
- `SPEC.md`: §6 (the phone card measured again, the full-width card over a tall block on a phone, the ⋯ menu inside the screen, the queued card delete) and §28 (the room under a short collapsed article).

## Decisions

- **TOOL15-07: what I fixed.** I fixed the stale cap, not only the over-card's lift. The over-card already stands just under the words, so it has nowhere to rise. The cap was the bug: it came from the moment the hint row was up.
- **TOOL15-14 and the narrow over-card: full width on a phone.** An over-card takes the pane's width when the strip beside a 300 px card would be under 160 px (pane under 476 px). The card still stands under the selected words, as select needed. Wider narrow panes (a tablet, a split pane) keep select's 300 px card. I did not narrow `overBlock` to slides, sheets and tables: a tall paragraph on a tablet without the bottom bar has no rise, and the over-card keeps its words close there.
- **TOOL15-09: clamp, not flip.** The menu keeps its right alignment and only moves when it would leave the screen. It is a fix in the one shared `CardMore`, which every tool card ⋯ uses (Explain, Analyze, Visualize, Simplify, and the assistant card). The other ⋯ menus (the Annotations tab's annotation menu, Group by) open at the right end of their rows. Line ▾ in the note editor already clamps (`placeMenu`). I left them alone.
- **TOOL15-10: room under the collapsed article.** A collapsed article too short to bring the reading block to the line gets that much blank room under its end, plus the height of the hint row under the pane. The room is padding on the pane, set inline. It only shows when the place needs it, and goes on Collapse off or a document change. Keeping the pre-collapse position across the round trip would have fixed Collapse off only. The brief asked for both directions.
- **R1: no Undo for a queued add.** Offline, Add to a note shows the "Added to note #id" line, not the pill. Undo offline would mean dropping the last queued PATCH of that note. That could drop words the reader typed in the note afterwards, so I left Undo to the online path.
- **R2: what the queue takes.** Only network failures go to the queue (offline, or `fetch` throws). A server that answers 5xx still puts the mark back with "Not saved. Try again.", as before. `api()` queues the 5xx case for the tab path, but the brief named only the network case. A delete whose path the queue does not take (extraction and match PATCHes on the attachment or the project) fails as before. The pending record is forgotten once the queue holds the delete. Keeping it could send the DELETE again from a later page after a History Restore, and delete the restored note.

## Needs

- None in files outside this branch. The lead merging: the reader-interactions hunks are small and in the narrow-card, ⋯ and Collapse regions. `card-more.tsx` and `deferred-delete.ts` are whole-function edits.
