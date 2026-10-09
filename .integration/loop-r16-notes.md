# loop/r16-notes

**Intent:** fix round 16's notes package (PACKAGES.md section 3): NOTE16-01 first (blocking: Cancel takes out only this editor's own words), then EDGE16-04 (blocking: the composer's draft belongs to the account that typed it), then NOTE16-02, 03, 04, 05, 06, 07, 09, 10.

Screenshots: `/home/user/wt/r16-notes/.qa-tmp/fix/<ID>-before.png` and `<ID>-after.png`, copied to `/mnt/project-files/interaction-loop/round-16/img/`. Scripts and logs: `/home/user/wt/r16-notes/.qa-tmp/notes/` (`before/`, `after/`). Test projects kept for the verifier: "Audit r16 notes fix" (`cmv0mx0kg00007dw1vpndlcuc`, 200 notes in Later, block document `cmv0mxkef00007dlmpl9iqiy8`) and "Audit r16 notes fix small" (`cmv0p8o0q000j7d7xpui8f77t`, block document `cmv0p9grx00007dyegqyozc1y`).

## Findings

### Blocking

- **NOTE16-01 fixed.** Cancel takes out only the words this editor typed. The editor records each change another writer made while it was open: every save that came back `changed`, and every three-way merge. Cancel computes the text it goes back to: the text the editor opened on, with each of those changes put back through `reconcileNoteText`. The close write sends `keepSources: true` (a quote another writer added stays) and `newEdit: true` (History starts a new row, so the words Cancel took out stay in History). `recordNoteEdit` also starts a new row when the text before the save is not the last row's text. Online, Cancel writes no revert draft; offline it does, as before. Undo on the Cancel pill waits for the close write, then saves the typed words on the text Cancel went back to. `c1-cancel.mjs`, `NOTE16-01-before.png`, `-after.png`:
  - merged: db "Base line of the note." (B's "betaB" lost; History had no betaB row) → "Base line of the note. betaB"; NoteEdit rows "…alphaA gammaA betaB" and "…betaB".
  - quote: sources 1 → 0, quote lost → quote kept, sources 1, two History rows.
  - unseen (B saved while A never saw it): marker block in the note → "…betaB", no markers.
  - b-open (B's editor still open): B's Done then wrote betaB away → "betaB deltaB".
  - undo: Undo brings back "alphaA gammaA betaB". The same after reload, in the db.
  - **origin/main has the same loss, wider**: every note save there is `PATCH { content }` with no base, so Cancel writes the opened text over any other writer's words, and the route prunes sources on every content write.
- **EDGE16-04 fixed.** A compose draft records its account (`tabAccount() ?? readAccountCookie()`) and lives under `unitos-note-compose:<sectionId>@<account>`. Read, write and clear touch only the account's own key; another account's draft stays in the browser, never shown, never deleted. A draft from before this round (the plain key, no account) is moved into the opening account's key, shown, and not saved by itself: the reader saves it. `e04-compose.mjs` (sign-in off, two accounts by the `dissect-account` cookie, `acct-editor` and `acct-owner`), `EDGE16-04-before.png`, `-after.png`: before, the owner's load POSTed the editor's draft (db 1 note created as the owner). After, the owner's load sends nothing; the draft stays under `@acct-editor`; the editor's return restores it and saves it (db 1, as the editor). `e04-legacy.mjs`: a plain-key draft is shown, moved to `@acct-owner`, and no POST. The two-account check with sign-in on (`edge/second-server.sh`) was not run: the machine ran out of memory. It is proved with two account ids in the stored drafts; the verifier should repeat it with sign-in on. On origin/main the same draft is shown to the other account but not saved by itself: a leak of words, no write.

### The rest

- **NOTE16-02 fixed.** A hold near the window's edge no longer scrolls the page away from its target: dnd-kit's auto-scroll is off while a note is covered (the hold ring is drawn), and its y band is 7 % of the window, not 20 %. `h200.mjs` (221 notes): scrollY 3694 → 3477 and no ring → scrollY steady at 3694, ring shown, merge ran ("2 notes merged into one"), Undo put both back. `NOTE16-02-before.png`, `-after.png`.
- **NOTE16-03 fixed.** Switching the rail between Notes and Annotations no longer renders every note card's body. The tray's on-screen state is an external store in `CardDropShown` (subscribe, not a new context value), so a switch re-renders only the drop targets' counters. `a1-tab-prof.mjs` (221 notes): Annotations press 3341 / 1144 ms → 329 / 461 ms; Notes press 1070 / 1300 ms → 343 / 933 ms. NoteCardBody is gone from the profile; NoteCard and SortableItem still render once (the tray re-renders on its `visible` prop). `NOTE16-03-after.png`; no before screenshot of its own (the profile log is the before: `before/a1-tab-prof.log`).
- **NOTE16-04 partly fixed (the board).** A board of 200 notes draws 12 tiles, then doubles the count each frame inside a transition (5 steps, not 17 of 12). `b4-board.mjs`: long tasks in the 4 s after opening, summed 2466 / 2503 ms → 395 / 291 ms; the longest 374 / 455 → 105 / 86 ms. The first open read 257–366 → 418–564 ms; the machine ran at load 10+ for the after run, so read it as noise. `NOTE16-04-before.png`, `-after.png`. Not fixed: Group by and search in the tray with 221 notes; they need windowing across groups, which is a larger change than this round.
- **NOTE16-05 fixed.** Typing in a note editor keeps the caret in view: after each change the editor scrolls each scrolling parent and the window by the least amount that shows the caret (8 px pad). `k2-caret`: 8 of 10 typed lines out of view → 0 of 10. `NOTE16-05-before.png`, `-after.png`.
- **NOTE16-06 fixed.** Enter on an empty nested list item takes it one level out, to a new item of its parent; Enter on an empty top-level item ends the list with a plain line (no indent left behind). The editor now shows what the note stores. `k3-lists`: cases B, D and E were drawn as a list in the editor and stored as an indented line → a plain paragraph after the list in both; the link card sits outside the list. Case C (Enter twice) → an outdented top-level item "- after C", the same in the editor and in storage. `NOTE16-06-before.png`, `-after.png`, `-after-C.png`.
- **NOTE16-07 fixed.** The annotation an annotation reference opens stands level with the row clicked, then is sticky; it is kept inside the window (top 24 px to the window's bottom less its height). A reopen draws at once from the kept copy (a 404 drops it; a failed read keeps the shown copy). `r7-side.mjs`: gapY −401 / −825 px → 0 / −88 px (the −88 is the clamp to the window's bottom); a reopen: "Loading…" for 478 ms → drawn in the first frame. `NOTE16-07-before.png`, `-after.png`, `-after-reopen.png`.
- **NOTE16-09 not fixed.** The × on a reply stops at Resolve's edge on a phone; the file is `src/components/collab/reply-thread.tsx`, which belongs to the page package. See Needs.
- **NOTE16-10 fixed.** A checklist box on a board tile ticks in one press and saves; it does not open the note. On a coarse pointer the box's press area is 33 px tall (a CSS `::after` band). `k1-parts`: tile box press → changed false, the note opened → changed true, stored true, no note opened. `NOTE16-10-before.png`, `-after.png`.
- **NOTE16-08** belongs to the edge package (moved from tools); not touched.

Every action stays where it was; no control moved, none was added.

## Files

- `src/components/outline/use-note-draft.ts` (cancel and close only, NOTE16-01): other writers' changes (`othersRef`, carried through Group by), `cancel()` returns the text it goes back to, the close write sends `keepSources` and `newEdit` and joins the save chain, `afterNoteClose(noteId)`.
- `src/lib/notes/edits.ts`: `recordNoteEdit(..., { before, fresh })` starts a new row when asked or when the text before is not the last row's text.
- `src/app/api/notes/[noteId]/route.ts`: `newEdit` in the body schema; passes `before` and `fresh` to `recordNoteEdit`.
- `src/components/outline/use-outline.ts`: `editCanceled(noteId, typed, back)`; Undo waits for `afterNoteClose` and saves on `back`.
- `src/components/outline/note-card.tsx`, `floating-note-editor.tsx`: Cancel uses the returned text; note-card passes the tray's on-screen store to `useCardDropTarget` and the anchor to the annotation side.
- `src/lib/note-drafts.ts` (EDGE16-04): compose drafts per account; the plain-key draft moved into the account's key.
- `src/components/outline/use-note-compose.ts`: a moved old draft is shown, not saved by itself.
- `src/components/sortable.tsx` (shared): `autoScroll` on `DndContext` (NOTE16-02).
- `src/components/outline/use-card-drop.ts`, `notes-tray.tsx`: `shownStore`, the context carries the store (NOTE16-03).
- `src/components/outline/section-board.tsx`: tiles grow by doubling in a transition (NOTE16-04).
- `src/lib/note-editable.ts` (the note editor; in no package's list): `revealCaret` (NOTE16-05); `nextMarker`, `parentItem`, Enter on an empty item (NOTE16-06).
- `src/components/outline/annotation-side.tsx`: placed level with its anchor, kept in the window, kept copy (NOTE16-07).
- `src/components/outline/note-tile.tsx`: `onToggleTask` on a tile (NOTE16-10).
- `src/app/globals.css` (shared): one `@media (pointer: coarse)` rule for `button.note-box::after` (NOTE16-10).
- `SPEC.md`: §6 Cancel lines (Done / Cancel / Esc, the pill line, the note's assistant Cancel sentence); §12 History line (a new entry when the text before is not the last entry's; Cancel always starts one); the compose draft per account; the nested-list Enter line; the annotation beside a note (level with the row, then sticky; the kept copy).

## Decisions

- Cancel online writes no revert draft in the browser (the close write carries it); offline it writes one, as before, so the queue still has it.
- Cancel's close write always starts its own History row (`newEdit`), so the words it took out are one Restore away.
- Undo on the Cancel pill waits for the close write before it saves, and saves with the text Cancel went back to as its base, so it merges rather than writes over.
- An old compose draft with no account goes to the first account that opens the section, is shown, and is not saved by itself: the reader presses save. Deleting it or leaving it for nobody would lose it.
- Auto-scroll during a drag: off while the hold ring is drawn; the y band 7 % (x stays at 20 %).
- The board grows by doubling inside `startTransition`; `content-visibility` was tried and dropped (it broke row heights and contained the tile's paint).
- The annotation beside a note is clamped to the window, so it never opens below the fold.
- The tile box's press band is a CSS `::after`, because `::before` draws the ✓.

## Needs

- **NOTE16-09** for the page package (`src/components/collab/reply-thread.tsx`): the × press area on a phone stops at Resolve's edge; give Resolve and × each `TOUCH_HIT` without overlap.
- **NOTE16-04, the rest:** the tray's Group by and search with 200+ notes need windowing across groups; left for a later round.
- **EDGE16-04:** repeat the two-account check with sign-in on (`/home/user/unitos/.qa-tmp/audit/r16/edge/second-server.sh`); here it ran with two account ids set by the `dissect-account` cookie.
- Merge notes: `use-note-draft.ts` is shared with the edge package (it keeps the offline paths; my hunks are cancel, close, and the other writers' changes). Shared files touched: `src/app/globals.css` (one rule), `src/components/sortable.tsx` (one prop), `src/lib/note-editable.ts`, SPEC.md lines above. No i18n keys added. No migration, no schema change.
