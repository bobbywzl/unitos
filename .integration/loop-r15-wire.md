# loop/r15-wire

**Intent:** Round 15's wire leftovers, each its own signed commit with before/after proof: EDGE15-09 after a reload, NOTE15-13 (the editor through Group by), PAGE15-10 (the page editor's first paint at the reading position), the small leftovers, and a proposal for PAGE15-16.

Screenshots: `.qa-tmp/fix/WIRE-<n>-*.png` in this worktree, copied to `/mnt/project-files/interaction-loop/round-15/img/`. Every number is from my dev server on :3147, a webpack dev build on a machine shared with other sessions. Scripts: `.qa-tmp/wire/` (`w1-demote.mjs`, `notes/s1`–`s4`, `page/t20`, `t22`, `t23`, `w4-*.mjs`). Before runs used the base tree (the change reverted with `git checkout`, then applied again).

Data: the project "Fix r15 wire" in `dissect`, made through the app. At the end its 4 documents went through `DELETE /api/documents/:id` and the project through `DELETE /api/notebooks/:id` (0 rows left). The two-account runs used a copy, `dissect_r15wire`, which I made and dropped at the end.

## Items

1. **EDGE15-09 after a reload (21b1c06).** `use-outline.ts`: on load, when the account cannot edit, every note whose local draft holds words that differ from the server's text draws the kept words, marked Not saved (`save-state.tsx` takes a `tip`: "Not saved: you can no longer edit this project. Your words are kept in this browser."). The draft is never dropped.
   - Run (`w1-demote.mjs`, two accounts): the editor types, the owner makes them a viewer, they type more and press Done, then reload.
   - Before: after the reload the row shows the server's old text, no mark; the words sit only in localStorage.
   - After: the row draws the kept words with Not saved and the tip; a second reload draws them again. Made an editor again, the words land in the database and the draft clears.
   - Shots: `WIRE-1-before.png`, `WIRE-1-after.png`.
2. **NOTE15-13, the editor through Group by (09561d3).** `use-note-draft.ts`: `carryNoteEditors()` (called by the Group by setter and by a storage event from another tab) hands each open editor's text, save chain, and refs to the note's next card; the new card opens in its editor on that text and its saves queue after the old editor's. An editor no card claims closes as before (a 0 ms timeout). `note-card.tsx`/`use-outline.ts`: `editTaken` clears a handled edit request, so a remount never reopens an editor on old text.
   - s1 (an editor open, Group by): editors open after the switch, tray 0 → 1, notes full page 0 → 1.
   - s2 (type, Group by, type): 2/2 fast and 5/5 slow-server runs keep every word once in the database, the same after a reload. Two slow runs timed out at the first editor open, before the test; they are left out.
   - s3 (two tabs, Group by in one while both type): 5/5 runs keep Aone, Bone, Atwo, Btwo, Athree once each, 0 conflict markers (fast and slow, tray and page).
   - s4 (dock, type, Done, Group by): before, the stale edit request reopened the editor on the old text and saved it over the newest word (lost in the database); after, no editor opens and the word stays. **This loss is on main too.**
   - Shots: `WIRE-2-before.png`, `WIRE-2-after.png` (tray), `WIRE-2b-before.png`, `WIRE-2b-after.png` (notes full page).
3. **PAGE15-10, the first paint at the reading position (a3214f3).** `docs/ext/page.ts`: the page's text is drawn at opacity 0 (`data-docs-paging`, `page.css`) until the first pagination pass ends (or 600 ms), so the reading-position hold places it before the reader sees it.
   - t23 frames: before, "Foxtrot 6" or "Bravo 22" drawn first, then a jump 160–300 ms later; after, the reading-position paragraph from the first drawn frame, every run.
   - CLS (t20/t22) with no comments: 0.1294, 0.1294, 0.1294, 0.1297 → 0.011 ×4 (the vertical ruler alone). With 2 comments: 0.313, 0.313, 0.3135, 0.3123 → 0.0362–0.038 in 7 of 8 runs; one run 0.167, the page sliding left for the comment column, not this change.
   - Cost: 146–286 ms more blank between the loading lines and the words (dev). A new blank document still takes typing at once.
   - Left: comment cards first drawn at x 0 (0.0205) and the vertical ruler.
   - Shots: `WIRE-3-before.png`, `WIRE-3-after.png`.
4. **Leftovers (ad87e2b).**
   - Toasts: `annotationNoteMade`/`annotationNoteAdded` take `{id}` as `shortNoteId` gives it (with "#"); `annotation-menu.tsx`'s `bareId` is gone. Before and after alike on screen ("Added to note #2yaxfw", "New note #c7b4sw in Notes"); one place now owns the "#". Add to a note's tooltip says "annotation reference". Shots: `WIRE-4c-before.png`, `WIRE-4c-after.png`.
   - i18n removed (en, zh): `common.modelCallFailed`, `outline.voiceNoteFailed`, `reader.conversationRemoved` (listed unused in loop-r14-tools.md; the route stays). `derive/config.ts` has its own local `modelCallFailed` function, unrelated, kept.
   - `note-card.tsx`: the stale comment about the chips under a note is gone.
   - The band at 390 with a stored extraction: below sm Extract and Collapse draw `px-3 gap-1` and the row `gap-1.5`. Before: Extract (1) at y 84, Collapse NEW at y 120 (two rows). After: both at y 84 (98 + 132 px). At 360 they still take two rows. Shots: `WIRE-4-before.png`, `WIRE-4-after.png`.
   - TOOL15-15: the pending queue stands inside the list that holds the Note and Command row (the first section under Section, the grouped list under the other groupings), above the row; on a phone the row is `sticky bottom-0` in the sheet. 390x844, 3 pending notes: before, Command at y 877 under the fold; after, y 734 and it takes the tap, under Last edited and under Section. The sheet's scroll height is the same (867), and no control is added. A quote or a card let go on the queue still lands at the end of the last section (`data-tray-lead`). Shots: `WIRE-4b-before.png`, `WIRE-4b-after.png`.
5. **PAGE15-16 / PAGE14-15: not built; proposal below.**

## PAGE15-16 proposal: one shape, every way in kept

Every way in already goes through one function: `openBar` (reader-interactions.tsx ~7668). The figure's Assistant (`FIGURE_ASSISTANT_EVENT`), Ctrl+Alt+G (`onKey`), Search the menus and the right-click menu (`onTool` with `tool: "assistant"`, a chip run at once by `runBarRef`), and the toolbox's Assistant row in Editing (`barOffered ? openBar(popover)`) all call it. The follow-up replacing the pending edit lives in `runBar` (`replacing` from `barRunKey`). So the smallest change moves where the bar draws, not how it opens or runs:

1. Draw the `bar` at the words instead of at the pane's foot: absolute in the scroller, `top = bar.wordsBottom + 8` (the selection's last line, already measured for PAGE13-03; a figure's `yTop`), at the toolbox's width and left edge, the same frame as Viewing's box. Its rows stay as they are: the field, mic, Send; the 7 chips; Deep Thinking. Add Web on the foot row, as Viewing's box has.
2. The scroll effect (`barOpenKey`) changes from "scroll until the words stand 16 px above the bar" to "scroll until the box's foot is in view".
3. In Viewing, the toolbox's Assistant row keeps its box (no suggestions there); the two now share one frame and one place. Their field reads "Tell the assistant what to do with the selected words…" in both.
4. Nothing else moves: `openBar`, `runBar`, `barToCard`, the toolbar draft, the outside-press close, and the status row after an edit lands stay as they are.

Not built because each way in has to be proven with an answer that holds suggestions (the follow-up replacement), and the local mock's answer to the suggest prompt was not checked this round. Proof needed: the five ways in open the box at the words at 1440, 844x390, and 390; a chip and a typed command land suggestions; a follow-up replaces the pending edit (the old suggestions gone, the new ones in); the box never covers the selected words.

## Files

- `src/components/outline/use-outline.ts`: item 1 (a viewer's kept words after a reload); item 2 (`editTaken`).
- `src/components/outline/save-state.tsx`: item 1 (`tip`).
- `src/components/outline/use-note-draft.ts`: item 2 (`carryNoteEditors`, `carriedNoteText`, the carry in the activation and close effects, `DraftHandle.text`).
- `src/components/outline/note-card.tsx`: items 1, 2 (the carried editor opens; `editTaken`), 4 (comment).
- `src/components/outline/note-groups.tsx`: item 2 (Group by carries the editors); item 4 (the lead, `SectionComposer` as a fragment, the sticky row).
- `src/components/outline/notes-tray.tsx`: item 4 (the pending queue inside the list, `data-tray-lead`, the sticky row).
- `src/components/docs/ext/page.ts`, `src/components/docs/css/page.css`: item 3.
- `src/components/reader/reader-interactions.tsx`: item 4 (band classes and a comment; 3 class strings).
- `src/components/panels/annotation-menu.tsx`, `src/lib/i18n/dict/panels.ts`, `common.ts`, `outline.ts`, `reader.ts`: item 4.
- `SPEC.md`: §17 Sync (item 1), Group by (item 2), Pagination (item 3), Voice command and Collapse (item 4).

## Decisions

- Item 1 shows the kept words on the row rather than in a separate notice list: the row is where the reader left them. The notice is the one line Not saved already uses.
- Item 2 claims a carry by note id from a module map, kept until a 0 ms timeout so React StrictMode's second mount can claim it again. An editor nobody claims closes and saves as before.
- Item 3 hides the text, not the page: the gray canvas, the toolbar, and the title row draw at once. The 600 ms cap keeps a slow pass from leaving a blank page.
- Item 4's band: tighter padding below sm rather than a narrower reserve for Contents, so Contents keeps its 28 px clearance.
- Item 4's Command: the row sticks to the sheet's foot (the queue moved into the row's list, so the row's sticky box spans it) rather than a copy of Note and Command above the queue: no control is added, and the visual order is unchanged. Under a search that hides every section the queue stands alone, as before. Moving the queue between lists (Group by, or a search that hides every section) remounts pending cards; an open editor rides the item 2 carry under Group by, and otherwise closes with its words saved.
- Item 4's i18n: `reader.conversationRemoved` removed too, as loop-r14-tools.md listed it unused; its route is untouched.

## Needs

- Merge order: these touch shared files (`use-outline.ts`, `use-note-draft.ts`, `note-card.tsx`, `note-groups.tsx`, `notes-tray.tsx`, `reader-interactions.tsx`, the i18n dicts). The `reader-interactions.tsx` hunk is 3 class strings and a comment near the Extract and Collapse buttons and the band row.
- Item 2's `editTaken` fixes a loss also on main (a stale edit request reopening an editor on old text after a remount); verify s4 after merge.
- Selectors: `[data-pending-queue]` now sits inside `[data-tray-section]` (or the grouped list) when the list shows; audit scripts that took `[data-tray-section] [data-note-id]` as accepted notes should skip `[data-tray-lead]`.
- PAGE15-16 needs a mock answer to the suggest prompt before the proposal can be built and proven.
- `tsc --noEmit`: clean (full run, server stopped). eslint: clean on every changed file.
