# loop/r14-nav

**Intent:** Fix round 14's navigation package (section 4 of PACKAGES.md): the two blocking findings first (NAV14-01, PAGE14-01), then NAV14-02 to 14 and EDGE14-07, without adding a visible control.

Screenshots: `.qa-tmp/fix/<ID>-before.png` and `-after.png` in this worktree, copied to `/mnt/project-files/interaction-loop/round-14/img/`. A "before" taken from the audit (same code, ff4a7fd) is marked (audit). Every number is from my dev server on :3145, a webpack dev build on a machine shared with five other workers; timings are noisy, so each speed fix also gives a count that does not depend on the machine.

## Findings

### Blocking

- **NAV14-01 (fixed). An add that waits its turn never ran; a reload lost it.** Cause: the upload box called the `onClose` of the render it started in, which read an empty wait list; only the running add's links were kept in the browser. Now the box calls the bar's latest callbacks (a ref updated every render), the wait list is a ref, and `unitos:add-links:<project>` holds the failed links, the running add's, and every waiting add's until each lands.
  - Before (`54-queue-slow.mjs`): the queued link never started; the project went 16 → 17 documents (the slow page only); the store held 1 link. After: the queued link's box starts as soon as the first add lands (+39 s on this server) and ends in its own failure line (example.com is unreachable here) with the link back in Add a document; the store held both links while waiting; after a reload (`RELOAD=1`) Add a document shows both links queued.
  - DB / reload proof: before 1 document from 2 adds; after, the second add ran (its failure is the server's, and the link is kept); reload: both links back (`NAV14-01-after-reload.png`).
  - origin/main: the same loss. `document-bar.tsx` there reads `pending` from the stale `onClose` (`const [next, ...rest] = pending`, line 1410) and stores no links at all.
  - Shots: `NAV14-01-before.png`, `NAV14-01-before-queued.png`, `NAV14-01-after.png`, `NAV14-01-after-queued.png`, `NAV14-01-after-reload.png`.
- **PAGE14-01 (fixed). After Blank document the first words went into Add a document.** Cause: round 13's `useModalFocus` gave the focus back to + on every close; the page editor takes the caret only when the focus is on the body. Now `useModalFocus(ref, open, handedOff)` takes a flag: Add a document sets it on Blank document, Continue, and a Library pick, and then the close blurs the dialog's control instead of focusing +. ✕, Escape, and a click outside clear it and give the focus back as before.
  - Before (`s07-blank-focus.mjs mouse 1440`): focus Blank document → + at 268 ms; after typing "Start here": page "", dialog open, link field "here". After (`s07-proof.mjs`): focus Blank document → body → the page; page "Start here", All changes saved, the Block row's text "Start here" in the database, and "Start here" after a reload — by mouse at 1440, by keys at 1440, and by touch at 390.
  - origin/main: not there (`src/lib/escape-layers.ts` does not exist on main; round 13 added it).
  - The proposal's belt and braces in `docs-editor.tsx` (`justMade`) was not needed.
  - Shots: `PAGE14-01-before.png`, `PAGE14-01-after.png`.

### Friction and polish

- **NAV14-02 (fixed).** The repeat add's ask in the box now takes Escape and a click outside as Cancel, as ✕ and the offline ask do (`dismiss()`); it never hides under an "Adding …" chip. Before (`51-repeat-cancel.mjs`, Escape): "Adding add-1.md…" chip for 25 s, the ask behind it. After (Escape, outside, ✕): chip none, box none, documents 25 → 25. Shots `NAV14-02-before.png`, `NAV14-02-after.png`.
- **NAV14-03 (fixed).** A held or carried row carries `data-held`; the tooltip's long press skips it, as it skips a held note card. After (`26-touch-cut-title.mjs`, 390 touch): tip at 600 ms null (before: the full title), a hold let go in place opens the document (before: nothing opened), mid-drag tip null. Shots `NAV14-03-before.png` (audit), `NAV14-03-after.png`.
- **NAV14-04 (fixed).** Sort by is kept per project (`unitos-documents-sort:<project>`; a project without its own choice reads the old browser key, which is never removed). A drop or an Alt+arrow move posts the notes' Undo pill ("Moved", Undo, ✕; Ctrl+Z) through the window event `dissect:undo-pill`; Undo PUTs the changed lists' Custom order as it was, the row back into its list, and Sort by back. Tested with the notes package's commit 9b939ee applied in the working tree only (not committed here): drop → "Moved | Undo | ✕", Custom order, db changed; Undo → db positions as before, Last edited; Alt+↓ then Ctrl+Z → db as before. The touch hold for the list stays 300 ms, as the lead decided. Shots `NAV14-04-before.png` (audit), `NAV14-04-after.png`, `NAV14-04-after-undo.png`.
- **NAV14-05 (fixed).** `showHint` sets the drop line only when it moves. `27b-drag-work.mjs`, 40 pointer moves over one place (CDP ScriptDuration): before 1795, 1724, 1054 ms; after 263, 108, 117 ms (a second run: 161, 116, 148). Frame gaps (`27-drag-frames.mjs`) were too noisy on this machine to compare. Shots `NAV14-05-before.png` (audit), `NAV14-05-after.png`.
- **NAV14-06 (fixed).** Remove from this project leaves the row menu; it stays one press away in Delete document's confirm, beside Delete document (unchanged). The rows draw at the press: `REACH_WAIT_MS` and the hover prefetch go. Phone tap (`70b-captures-after.mjs`): rows at +100 ms 0 → 2. Steps for Remove: 3 → 4. Shots `NAV14-06-before.png` (audit), `NAV14-06-after.png`.
- **NAV14-07 (partly fixed).** The rail's glyph and the menu's check change at the press (`80-after.mjs`: glyph changed by +300 ms: true; before: no change for 1.7 s). The two jumps when the split draws need the editor to know the split from a prop (Needs). Shots `NAV14-07-before.png` (audit), `NAV14-07-after.png`.
- **NAV14-08 (partly fixed).** Restore tells the notes at once (`dissect:note-back`), and their refresh is the one the row waits for. `61-restore.mjs`: page refreshes 2 → 1; time to the tray's switch 7080 and 1305 ms before, 4293, 1935 and 3204 ms after (noise from the machine dominates). The full proposal (the route returns the note, the tray takes it from the answer) is in Needs. Shots `NAV14-08-before.png` (audit), `NAV14-08-after.png`.
- **NAV14-09 (fixed).** Enter on an empty folder puts the focus on New document here; Escape and ← there close only that folder's list and return to its row. `31-keys.mjs`: Enter → `folder-new-file` in the fly-out (before: the folder row); Escape → the folder row, list open (before: the whole list closed). Shots `NAV14-09-before.png` (audit), `NAV14-09-after.png`.
- **NAV14-10 (fixed).** Escape in the new folder box returns the focus to New folder (or, inside a folder, the folder's row); in the rename box, to the folder's row. `32-namebox-keys.mjs`: body → `folder-new`, body → `folder-open`. Shots `NAV14-10-before.png` (audit), `NAV14-10-after.png`.
- **NAV14-11 (fixed).** Contents draws the article's own headings from the page at the press; the read replaces them when it lands. At +60 ms: "Loading…" before, the five headings after. Shots `NAV14-11-before.png` (audit), `NAV14-11-after.png`.
- **NAV14-12 (mostly fixed).** One word, Feedback, everywhere (the floating pill's tip, which repeated its label, goes). At md+ in the reader Feedback leaves Reader view and is a button in the guide's head beside ✕; the guide still opens with the focus on ✕ (`data-autofocus`). Reader view rows: Normal, Side by Side, Top and Bottom. Phone: More keeps it. Not done: Settings on a phone still shows the floating pill (Needs). Shots `NAV14-12-before.png` (audit), `NAV14-12-after.png`, `NAV14-12-after-view-menu.png`.
- **NAV14-13 (fixed).** The list is `sm:max-h-[calc(100dvh-96px)]` (the phone keeps `min(60vh,480px)`): 21 rows in view at 900 px, list 804 px tall (before: 12 rows, 480 px). Shots `NAV14-13-before.png` (audit), `NAV14-13-after.png`.
- **NAV14-14 (fixed).** Alt+↑ and Alt+↓ on a focused row move it one place (the drag's `reorder`, the same Undo); the focus stays on the row. Sort by's tip drops "Nothing moves." and says how Custom order is made; the guide's list line and its key column name Alt + ↑ ↓. Shots `NAV14-14-before.png` (audit), `NAV14-14-after.png`, `NAV14-14-after-alt.png`.
- **EDGE14-07 (fixed).** The rail's Notes and Annotations, pressed by a key, move the focus to the panel's first control, as History does; Escape on a control there with no menu or card open (`escapeLayerOpen()`) gives it back to the rail's button. A mouse press leaves the focus where it was. `82-rail.mjs`: Enter → `rail:notes` before, `tray:Search notes` after; Tab → `rail:annotations` before, inside the tray after. Shots `EDGE14-07-before.png`, `EDGE14-07-after.png`.

Regression runs: `30-focus-after-mouse.mjs` (19 mouse actions, no ring; caught the guide's first focus moving to Feedback, fixed with `data-autofocus`), `31-keys.mjs` (full folder Enter/Escape/Escape still one layer at a time; typing in the page editor with the list open by hover still types), `32-namebox-keys.mjs`, `51-repeat-cancel.mjs`, `54-queue-slow.mjs`, `s07` by mouse, keys, and phone. `50-add.mjs` crashed the browser twice (memory on the shared machine) after the box started; the two-file add reached Uploading 1/3 as before. `npx tsc --noEmit` clean; eslint clean on every changed file (one warning in `document-bar.tsx:481`, there before).

## Files

- `src/components/reader/upload-assistant.tsx` — the box calls the latest callbacks; one `dismiss()` for ✕, Escape and a click outside (the ask's Cancel). NAV14-01, 02.
- `src/components/reader/document-bar.tsx` — the wait list as a ref; the links store holds failed, running and waiting adds; Sort by per project; the row menu without Remove and without the wait; the list's height. NAV14-01, 04, 06, 13.
- `src/components/reader/add-document-dialog.tsx` — `handedOff` on Blank document, Continue, a Library pick; ✕/Escape/outside clear it. PAGE14-01.
- `src/lib/escape-layers.ts` — `useModalFocus(..., handedOff)`; `escapeLayerOpen()`. PAGE14-01, EDGE14-07.
- `src/components/reader/document-folders.tsx` — `data-held`; `undoDrop` and the pill post; the drop line set only when it moves; `entriesOf` split from `layout`; `nudge` (Alt+arrows); the fly-out's foot takes Escape/←; `focusFlyout` falls back to New document here; `escapeTo` on the name boxes. NAV14-03, 04, 05, 09, 10, 14.
- `src/components/reader/document-organize.tsx` — `useDocumentSort(projectId)`. NAV14-04.
- `src/components/tooltip.tsx` — the long press skips `[data-held]`. NAV14-03.
- `src/components/reader/contents-menu.tsx` — `headingsOnPage`. NAV14-11.
- `src/components/reader/reader-panes.tsx` — `picked` view at the press; Feedback out of Reader view. NAV14-07, 12.
- `src/components/feedback-button.tsx` — one word; comments. NAV14-12.
- `src/components/guide-dialog.tsx` — Feedback in the head; ✕ keeps the first focus; the list key column. NAV14-12, 14. (No package owns this file; the edits are two small hunks.)
- `src/components/collab/history-control.tsx` — note-back first, one refresh. NAV14-08.
- `src/components/reader/workspace.tsx` — `intoPanel`, `backToRail` on the rail's Notes and Annotations. EDGE14-07.
- `src/lib/i18n/dict/panes.ts` — new `rowMoved` (en "Moved", zh "已移动"); `documentsSortTip` (en, zh).
- `src/lib/i18n/dict/works.ts` — `guideKeyList` (en, zh); `guidePanelReaderViewBody` (en, zh). `works.sendFeedback` is no longer used; kept.
- `SPEC.md` — the ask's Escape (§15 line on repeat adds), Sort by per project, Alt+arrows and the drop's Undo, the row menu, where Feedback is, the rail line.

## Decisions

- NAV14-01: the box reads its callbacks from a ref rather than the bar reading `pending` from a ref alone, so the early-open id (`assistantOpened`) is current too. The store keeps a failed add's links until the reader submits from Add a document (the field holds them then), not until the next add closes.
- PAGE14-01: the hand-off blurs the dialog's control rather than focusing the new page directly, so the page editor's own rule (caret when nothing has the focus, never in Viewing) decides; a Library pick of a block document leaves the focus on the page.
- NAV14-04: the Undo pill is the notes' (posted by event), not a new pill in the list. Undo restores the Custom order the lists had (`sortByPosition`), which also places rows that had no position; their order under Custom order is the same.
- NAV14-06: Remove from this project moved into Delete document's confirm only (it was already there), as the audit proposed: Remove 3 → 4 steps, every other row draws at once.
- NAV14-12: Feedback in the guide's head is a text button, not a new control: it replaces the Reader view row. Settings on a phone was left (not my file).
- NAV14-13: the phone keeps its height; `sm:` and up take the window.
- EDGE14-07: Escape-back is guarded by `escapeLayerOpen()` and skips text fields, so a menu, card, or editor in the tray keeps its own Escape.

## Needs (files I do not own)

- **Notes (package 3):** NAV14-04's pill needs the notes' `dissect:undo-pill` listener (`lib/notes/undo-pill.ts`, commit 9b939ee on `loop/r14-notes`). Without it the drop works and no pill shows. The lead's touch-hold decision (300 ms for notes and board tiles) is in `lib/hold-drag.ts`, not changed here.
- **Notes / History route:** NAV14-08's full fix: `POST /api/notebooks/[id]/history/[eventId]` returns the restored note, and `use-outline.ts` puts it in the tray from that answer, so no refresh is waited for.
- **Page (package 5):** NAV14-07's two jumps: `docs-editor.tsx` should take the split as a prop (`ReaderPanes` knows the view; `page.tsx` builds `paneHeader` only for a split) so `headerHidden` is right in the split's first frame.
- **Settings (`src/app/settings`):** NAV14-12 on a phone: a `FeedbackHeaderButton` in the Settings header and `max-sm:hidden` on the floating pill there (`feedback-button.tsx` hides it by path; add `/settings` to `onDashboard || onFullPage` once the header button is there).
- Seen, not fixed: Tab from the last control of a folder's fly-out goes to the page body (the fly-out is a portal at the body's end); Shift+Tab comes back. It was so before for every fly-out.

## Data

All writes went to my project "Fix r14 nav" (`cmuzfi2cc00007dbs2805e46q`), made with `00-setup.mjs` through the app's routes, plus blank documents from the PAGE14-01 runs, two slow pages from a local page on 127.0.0.1:3495, three notes for the History runs, and Markdown files from the add runs. I deleted the project and its documents through the app's routes at the end.
