# loop/r12-notes

**Intent:** Fix the round 12 notes package: NOTE12-01 to 10, 12, 13, 14 (`.qa-tmp/audit/r12/notes.md`), EDGE12-09 (rule zero), EDGE12-14 (the notes part), EDGE12-15, and EDGE12-18 (found during the merge: Escape threw away a sitting's words).

## Findings

Screenshots are under `.qa-tmp/fix/` in the worktree (ignored, not committed). Every after was taken on this worktree's server (:3143) in the test project "Fix r12 notes". A before marked "audit's" is the audit's own shot, copied from `/home/user/unitos/.qa-tmp/audit/r12/`. Counts use the audit's `controls()` and its scripts (`.qa-tmp/notes/*.mjs`, `.qa-tmp/edge/*.mjs`), at 1440×900 unless a width is named. The test project grew to about 80 notes in its first section during the race runs, so "controls in view" counts list more rows than the audit's; compare the per-surface counts and heights.

- **EDGE12-09 (rule zero): fixed.**
  - What changed: the kept note's next save is made from the text the server answered for it, not from the gone note's text. A stored text that only put words in at one place, which the reader's text holds and types on from, is not a conflict (`lib/notes/conflict.ts`). The kept note keeps the gone note's card (a stable React key, `actions.noteKey`), so its open editor goes on with every key typed and saves to the new note. Where a new editor opens instead (the floating card), the old one hands its exact text over through the local draft.
  - Proof, forced race (`.qa-tmp/edge/s13-gone-typing.mjs`: type, delete the note from another client, keep typing through the switch, one key every 120 ms). Before, on :3111: 1 marker line, alpha ×2, beta ×2, a word typed into the marker. After, 5 runs of 5: 0 markers, alpha, beta, gamma, delta, and epsilon each exactly once. The key log shows the editor's note id switch mid-word in each run (`EDGE12-09-s13-keyed--try*.log`).
  - Proof, the audit's two-tab repro (`s12-gone-repeat.mjs`): 5 runs of 5 show 0 markers and 1 copy of the words (the audit: triples in 2 of 5).
  - Screenshots: `EDGE12-09-before.png`, `-after.png`, `-after-twotab.png`.
- **EDGE12-18 (rule zero, found during the merge): fixed.**
  - What changed: Escape in a note's editor (tray, notes full page, floating card) closes it keeping the words, as Done does. The floating card's Back to the tray keeps them too. Cancel still puts the note back to its text when the editor opened, and the pill reads Edit canceled with Undo, which saves the typed words back. The composer's Cancel on a note with words saves them, then deletes the note with the delete's Undo.
  - Reproduced first on :3111 (`.qa-tmp/edge/s18-escape.mjs`): type a line, Escape. The database and a reload hold the old text.
  - After on :3143: the typed line is in the database after Escape and after a reload. Cancel, then Undo: the line is back in the database and after a reload. Composer: type, Cancel, then the pill shows Undo; Undo keeps the note with its words.
  - Screenshots: `EDGE12-18-before.png`, `-after.png`, `-after-cancel-undo.png`, `-after-composer-cancel.png`.
- **NOTE12-01: fixed.**
  - Hold under Last edited: before, lifted false and tooltip null. After: lifted true, and the tooltip reads "Hold to move, merge, or float the note" (`03b.log`).
  - A hold merges and floats in 6 of 6 groupings (before 1 of 6). Reorder and the move between sections stay Section-only: no drop line draws elsewhere.
  - Note is in 6 of 6 groupings (before 2) and Command is in 6 of 6 (before 1), writing in the first section.
  - Screenshots: `NOTE12-01-before.png` (audit's), `-after.png`.
- **NOTE12-02: fixed.**
  - A reorder is one PATCH `{order: 0}`. Before, it re-stamped all 6 notes of its section. After, it re-stamps 0: every time is unchanged, including the moved note's (`12.log`).
  - A move to another section, a pin, a color, a merge's Undo, a restore, and the gist keep the time too. Only new words or a new status move it.
  - Screenshots: `NOTE12-02-before.png` (audit's), `-after.png`.
- **NOTE12-03: fixed.**
  - Under Last edited, + Note, type, Escape. Before: at +601 ms the note was in neither the composer nor the list, and it showed at +2134 ms. After: the note is in the list at +602 ms, and 0 polls found it nowhere (`05b.log`).
  - Screenshots: `NOTE12-03-before.png` (audit's), `-after.png`.
- **NOTE12-04 and EDGE12-15: fixed.**
  - The tray header was 6 controls in 3 rows, plus the "Group by" label and the key hint. It is now 4 controls in 1 row: search, Expand all (icon), the view menu (which notes show and Group by), and the full page arrows.
  - Chrome before the first note at 1440: 210 px → 134 px. On the phone, from the search's top to the first note: 119 px → 75 px.
  - Scope and Group by moved into the view menu. The menu's button reads pressed, with a dot, while the tray shows This document.
  - Screenshots: `NOTE12-04-before.png`, `-before-390.png` (audit's), `-after.png`, `-after-390.png`; `EDGE12-15-before.png` (audit's), `-after.png`.
- **NOTE12-05: fixed.**
  - A pending card was 152 px with Accept (68×28) and Reject (61×26) on a row of their own. It is now 118 px, with Accept (58×20) and ✕ (24×24) in the header.
  - The body clamps to three lines, and a click opens it whole.
  - The key hint "⏎ accept · ⌫ reject" is replaced by an Accept all button. Enter and Backspace still work, and their tooltips say so.
  - Screenshots: `NOTE12-05-before.png` (audit's), `-after.png`.
- **NOTE12-06: fixed.**
  - A collapsed row was 56 px with 5 controls at rest. It is now 44 px with 2 at rest (the line and the pencil) and 4 on hover (plus the id and the select circle).
  - Title width: 159 px → 253 px at 1440 (181 px on hover), and 198 px → 268 px at 390.
  - The circles stay on every row while a note is selected, and on touch the circle stays. The chevron is now part of the row's one button.
  - Screenshots: `NOTE12-06-before.png` (audit's), `-after.png`.
- **NOTE12-07: fixed.**
  - An open note was 110 px with an empty 24 px band. It is now 92 px: Copy, History, and Delete sit in its header on hover and focus, and at rest on touch.
  - Screenshots: `NOTE12-07-before.png` (audit's), `-after.png`.
- **NOTE12-08: fixed in part.**
  - The tray editor went from 25 controls in 289 px to 20 controls in 231 px. With the assistant open, 432 px → 409 px.
  - H1 and the indent buttons are on the full page only (Tab and Shift+Tab still indent). One color button opens the four colors. The dash list and the checklist joined the bar.
  - The "More tools" link row is gone. The assistant shares the Done row. The title no longer shows twice.
  - The bar still wraps to two rows in the 315 px tray. Its 14 tools do not fit one row without dropping Undo and Redo, which touch users need. Commit a1eb0ee's subject ("one-row editor bar") overstates this.
  - Screenshots: `NOTE12-08-before.png` (audit's), `-after.png`.
- **NOTE12-09: fixed.**
  - By document is now Document columns, the last row of the full page's view menu, with the New glow and pill. Before, the full page had 2 controls for this (the By document button and the Group by select); now it has 1 (the view menu).
  - The board's "‹ Notes" is gone; ✕ and Escape close the board. Board header: 4 controls → 3.
  - The composer's Save now reads Done.
  - Counts: the tray section header, the full page, the board, and the section row count accepted notes (before 8 / 12 / 12). The tray title (workspace.tsx) still counts every note; see Needs.
  - Screenshots: `NOTE12-09-before.png`, `-before-board.png` (audit's), `-after.png`, `-after-board.png`.
- **NOTE12-10: fixed.**
  - Command has its own glyph: a microphone with the assistant's spark. In the tray it is the glyph alone, 87×25 → 33×21, its name in the tooltip.
  - The plain microphone now means voice typing only. The screen still has 3 such buttons with an editor and its assistant open, but they are 2 microphones and 1 Command glyph (`08-1440.log`).
  - Screenshots: `NOTE12-10-before.png` (audit's), `-after.png`.
- **NOTE12-12: fixed.** The full page's two columns use `items-start`, so each card keeps its own height. Before, a one-line card stretched to 155 px; now one-line rows are 60 px beside a taller pending card. Screenshots: `NOTE12-12-before.png` (audit's), `-after.png`.
- **NOTE12-13: fixed.** A board narrower than 500 px takes tiles from 150 px wide. On a phone that is 2 tiles across, 171 px wide and still at least 3:4 (before: 1 tile of 358×477 per screen). Screenshots: `NOTE12-13-before.png` (audit's), `-after.png`.
- **NOTE12-14: fixed.**
  - For 1.2 s after the landing (`FOLLOW_MS`), the floating card follows the paragraph it was let go over, across and down, while the tray folds.
  - Measured (`.qa-tmp/notes/14-float-follow.mjs`): let go over "Typing notes invites…" at x 222, the card ends at x 345 over the same paragraph. The paragraph moved from x 156 to x 279; before, the card stayed put and covered the next paragraph.
  - The tray still folds, and the article's left edge still moves. Keeping the edge would be a workspace.tsx change (package 5).
  - Screenshots: `NOTE12-14-before.png` (audit's), `-after.png`.
- **EDGE12-14 (notes part): fixed.**
  - An empty project's tray at 1440 showed Search, Expand all, the full page arrows, All notes, This document, and Group by, plus Note: 7 controls. It now shows the full page arrows, Note, and Command: 3 controls (`s06.log`).
  - The phone's empty-project screen shows no tray. The empty line and the bar tabs are other packages' part.
  - Screenshots: `EDGE12-14-before.png`, `-before-phone.png` (audit's), `-after.png`, `-after-phone.png`.
- **From the nav package's asks:**
  - The dated groupings read Week added and Month added (zh 添加周, 添加月), the word the document list uses.
  - The pill under the notes draws news (words kept as a new note, a quote without its source) in its own color; only a failure is red.
  - "Group by drawn as the same pill as Sort by" does not apply any more: Group by is no longer a select on the tray or the full page, but rows in the view menu.

## Where moved controls went

- All notes / This document and Group by → the view menu (the sliders icon beside Expand all), on the tray.
- Group by and By document → the view menu on the notes full page; By document is now its last row, Document columns.
- The pending key hint → the Accept all button. Enter and Backspace work as before.
- Accept and Reject → the pending card's header (✕ is Reject).
- Copy, History, and Delete → the open note's header, shown on hover and focus, and at rest on touch.
- A row's id and select circle → shown on hover and focus. The id also shows on the open note.
- The tray editor's H1, ⇤, and ⇥ → the notes full page's editor. In the tray, Tab and Shift+Tab indent, and the title field is the level-one heading.
- The "More tools on the notes full page" link → removed. The full page arrows sit in the tray header.
- The board's ‹ Notes → ✕ and Escape.
- The four color dots → behind the one color button.

## Files

- `src/lib/notes/order-writes.ts` (new), `src/lib/order.ts`, `src/app/api/notes/[noteId]/route.ts`, `src/app/api/notes/merge/undo/route.ts`, `src/lib/notes/gist.ts`, `src/lib/notes/gone.ts`, `src/lib/notes/removed.ts`: write `order` in raw SQL, and pass the row's own `updatedAt` back on moves, pins, colors, and the gist (NOTE12-02).
- `src/lib/digest/fingerprint.ts`: the note aggregate also hashes each note's section, order, and color, so a move or recolor that keeps `updatedAt` still rebuilds the digest (NOTE12-02).
- `src/lib/notes/conflict.ts`, `src/lib/notes/save-text.ts`, `src/lib/offline/queue.ts`, `src/components/outline/use-note-draft.ts`, `src/components/outline/use-outline.ts`: the kept note's base, the insertion rule, the stable card key, the handoff, the notice tone, and the canceled edit's Undo (EDGE12-09, EDGE12-18).
- `src/components/outline/note-groups.tsx`: the view menu (`NotesViewMenu` in place of `NotesOrganize`); hold, Note, and Command in every grouping; `items-start`; accepted counts (NOTE12-01, 03, 04, 09, 12).
- `src/components/outline/notes-tray.tsx`: the one header row, Accept all, the empty state, and the stable keys (NOTE12-04, 05, EDGE12-14, 15).
- `src/components/outline/outline.tsx`, `src/components/outline/document-columns.tsx`: the full page's view menu and Document columns (NOTE12-09).
- `src/components/outline/note-card.tsx`: row, header, pending, and open-note changes; Escape keeps the words; Cancel offers Undo (NOTE12-05, 06, 07, 08, EDGE12-18).
- `src/components/outline/note-editor.tsx`, `src/components/outline/note-composer.tsx`, `src/components/outline/use-note-compose.ts`: the tray bar, the composer's Done, and the composer's Cancel with Undo (NOTE12-08, 09, EDGE12-18).
- `src/components/outline/floating-note-editor.tsx`: following the paragraph after the landing; Escape and Back to the tray keep the words (NOTE12-14, EDGE12-18).
- `src/components/outline/section-board.tsx`, `src/components/outline/section-item.tsx`: phone tiles, no ‹ Notes, accepted counts (NOTE12-09, 13).
- `src/components/outline/voice-note.tsx`: Command's glyph and its compact form (NOTE12-10).
- `src/components/outline/merge-undo.tsx`: the Edit canceled pill, and news drawn plainly.
- `src/components/collapsed-view-toggle.tsx`: Expand all as an icon (NOTE12-04).
- `src/components/sortable.tsx`: `onDrop` is optional; without it no drop line draws, and hold-merge and float still work (NOTE12-01).
- `src/lib/i18n/dict/outline.ts`: acceptAll, acceptAllTitle, documentColumns, notesViewMenu, tipColors, editCanceled, undoCancelTitle, and Week added / Month added, in en and zh. Removed: trayKeyHint, byDocument, moreOnFullPage.
- `SPEC.md`: only the lines these findings touch, in §6.

## Decisions

- Group by became a menu (the view menu) rather than a select without its label. That folds scope, Group by, and on the full page By document into one icon: 3 controls → 1.
- Expand all became an icon, the same one the Annotations tab and the annotations full page use (they share `collapsed-view-toggle.tsx`). This changes package 5's surfaces too.
- The editor bar keeps Undo and Redo in the tray, for touch, so it stays two rows (see NOTE12-08).
- EDGE12-09 is fixed by keeping the card's React key across the gone → kept id change. That is what keeps the caret and every key; a hand-off between two editors alone lost a typed space in 2 of 5 runs.
- EDGE12-18: Cancel keeps reverting, but it can be undone (the existing pill, a new line), rather than removing Cancel. The note's History cannot always give a sitting's words back, because a sitting within 10 minutes overwrites its own entry.
- The digest fingerprint changes once for every project, so every stored digest rebuilds once on its next read. The rebuild reads the same rows and calls no model.
- `lib/offline/queue.ts` (package 6's file) changed in one place: `NOTE_KEPT_EVENT` carries the kept note's text, which the base fix needs.
- The test project "Fix r12 notes" is left in place with its race notes (about 80 in its first section), for the orchestrator to re-run the scripts. No other account's data was touched.

## Needs

- Package 5 (workspace.tsx): the tray title count "Notes 85" counts every note, pending ones included. Every other count now counts accepted notes, so this one should too (NOTE12-09).
- Package 5: Expand all is now an icon in the Annotations tab and on the annotations full page as well (shared component). Check it there.
- Package 5 (workspace.tsx): NOTE12-14's "keep the article's left edge while the tray folds for a floating note" is not done. The card follows its paragraph instead.
- Package 6: the one-line change in `lib/offline/queue.ts` above.
- Package 2 (NOTE12-11, voice typing) is untouched here.
