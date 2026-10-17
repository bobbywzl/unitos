# loop/r12-nav

**Intent:** fix round 12's navigation package (NAV12-01–05, 08, 09, 11–15, 17, 18; PAGE12-04; EDGE12-04, 05, 10, 16, 17) by taking controls away, merging them, or making them smaller, with every action still reachable.

## Findings

Counts were measured on :3145 at 1440×900 (390×844 touch for the phone) with the scripts under `.qa-tmp/nav/`. Screenshots are under `.qa-tmp/fix/`. The before shots are the audit's own.

| Id | State | Before → after | Screenshots |
|---|---|---|---|
| NAV12-01 | fixed | History controls on one screen 3 → 2 (header History, page editor Version history). Rail 8 → 7. Phone bar 7 → 5 (with EDGE12-05). The rail's Edit history is gone; History's "This document" scope lists its rows. Every edit row keeps Locate (the row opens the block), its replies (ReplyThread with resolve) and Revert / Restore paragraph. IQ project, open document: the rail listed 100 edits; This document lists all 174 edits the database holds for it, 0 of the rail's rows missing (rows from before this round included). | NAV12-01-before.png, NAV12-01-after-all-1440.png, NAV12-01-after-document-1440.png |
| NAV12-02 | fixed | Add two files: 4 presses → 3 (+, choose files, Continue). Continue in the dialog starts the add; the box's "Add 2 documents" step stays only for files dropped on the page. | NAV12-02-before.png, 03-add-done-1440.png |
| NAV12-03 | fixed | Dialog 7 → 6 controls (8 → 7 in a new project): Add to the list is gone; Enter still queues. One link: 5 presses + paste → 3 (+, paste into the field, Continue) with a mouse; the field takes focus on open only with a fine pointer, so on touch 4. Continue is on with a link typed and not queued (was off). The hint is the field's tooltip. | NAV12-03-before.png, NAV12-03-after-typed-1440.png, NAV12-03-after-continue-1440.png |
| NAV12-04 | fixed | A blank document's ⋯: 4 rows, 3 disabled → 2 rows (Move to folder, Delete document), 0 disabled. Row 14 of 14: every action row in view (was only Re-parse; the opened actions now scroll into view). Re-parse shows when the row has a file or URL, Print on the open document, Remove from this project when another project holds it. | NAV12-04-before.png, NAV12-04b-before.png, NAV12-04-after-blank-menu-1440.png |
| NAV12-05 | fixed | Phone header 5 → 3 (back, pill, +). History and the guide: not reachable → 2 presses (More, History / Guide). | NAV12-05-before.png, NAV12-05-after-phone-header.png, NAV12-05-after-phone-more.png, NAV12-05-after-phone-history.png |
| NAV12-08 | fixed | The pending count 3 places → 2 (the Notes badge, the tray's PENDING · 3). Header 8 → 7. A Notes press with notes pending and the tray off notes opens the notes with the first pending note in view and flashed (what the header pill did): 1 press, as before. | NAV12-08-before.png, NAV12-08-after-1440.png |
| NAV12-09 | fixed | Save for offline 139 × 34 px → 34 × 34 px icon (name in the tooltip, Ultra mark as a badge). On a phone it is a row of More. | NAV12-09-before.png, NAV12-08-after-1440.png |
| NAV12-11 | not fixed | Needs the page editor's title row to be the pane's picker (package 4's file). See Needs. | NAV12-11-before.png |
| NAV12-12 | fixed | Sort by 6 choices → 4 (Last edited, Added, Title A to Z, Kind); Added draws week headers when the list spans weeks. Find a document: scrolling only → type the first letters on the open list ("testi" → Testing effect 1; "nav audit s" → the next match). Added keeps its order (see Decisions). | NAV12-12-before.png, NAV12-12-after-sorts-1440.png, NAV12-12-after-typeahead-1440.png |
| NAV12-13 | partly | On my side "Week added" and "Month added" are gone, so the document list has no date-group choice to pair with the notes' "Week made". The notes Group by select's shape and its word "made" are package 3's (notes-tray.tsx). | NAV12-13-before.png, NAV12-12-after-sorts-1440.png |
| NAV12-14 | fixed (my part) | Extract glyphs 2 → 1 (the rail's funnel is now the quote glyph of the article's pill). The tab's "EXTRACT" label is gone: Extract on the tab 4 times → 3 (title, Extract from the project, Extract from the article). The pill tracks `distill-page`, the rail `distill`. The page editor toolbar's Extract is package 4's. | NAV12-14-before.png, NAV12-14-after-1440.png |
| NAV12-15 | fixed | A folder's list: 2 creation rows → 1 (New document here; New folder inside stays in the folder's ⋮, New folder at the root's foot). Tooltips: every row → only a row whose title is cut (checked: an uncut row has none, the 49-letter folder name has one). | NAV12-15-before.png, NAV12-15-after-folder-1440.png |
| NAV12-17 | fixed | History rows 84 px → 50 px; 5 → 10 rows in view. The head sentence is gone (it is History's tooltip). Restore sits at the row's right. | NAV12-17-before.png, NAV12-01-after-all-1440.png |
| NAV12-18 | fixed | The repeat ask: 2 headings → 1 ("You already added this document" is the box's heading); close controls 2 (✕, Cancel) → 1 (✕ cancels). Delete confirm: 2 lines → 1 ("Delete this document?" when one project holds it). | NAV12-18-before.png, 03-add-dup-1440.png, NAV12-18-after-delete-confirm-1440.png |
| PAGE12-04 | fixed | History controls 3 → 2 as NAV12-01. Look-alike clocks 2 → 1: History is the pencil, Version history keeps the clock. | PAGE12-04-before.png, EDGE12-17-after-1440.png |
| EDGE12-04 | fixed | As NAV12-05: header 5 → 3; the project title hides below sm; History and the guide reachable. | EDGE12-04-before.png, NAV12-05-after-phone-header.png |
| EDGE12-05 | fixed | Bar 7 → 5 (Assistant, Notes, Annotations, Extract, More). More holds Normal, Top and Bottom, Graph, History, Save for offline, Guide, Feedback. Notes pressed at rest: yes → no (pressed follows the sheet below md). | EDGE12-05-before.png, NAV12-05-after-phone-more.png |
| EDGE12-10 | fixed | 820 wide, first open: article column 368 px → 672 px; the tray folds below 1000 px (the rail stays; the reader's own choice is still remembered). | EDGE12-10-before.png, EDGE12-10-after-820x1180.png, EDGE12-10-after-820x900.png |
| EDGE12-16 | partly | The EXTRACT label is gone (mine). The red notice pill is package 3's (merge-undo.tsx), Run vs Send package 2's, the two save indicators package 4's (save-indicator.tsx). | EDGE12-16-before.png, NAV12-14-after-1440.png |
| EDGE12-17 | fixed | The dead Edit history tab is gone. On a page editor document History's This document reads "No edits to this document yet." and the title row's Version history holds its versions. | EDGE12-17-before.png, EDGE12-17-after-1440.png |

## Where each moved control went

- Rail and bar Edit history → History's "This document" scope (header History at md and up; More › History below md).
- Header History (clock popover) → a header button that opens the tray on History (pencil glyph); a second press folds the tray.
- Header "3 pending" pill → the Notes rail/bar button (a press with notes pending opens them on the first pending note).
- Save for offline pill → a 34 px icon in the header; More › Save for offline below md.
- Graph on the phone bar → More › Graph.
- Feedback in the phone's Reader view menu → More › Feedback.
- Guide on the phone → More › Guide (the nudge dot sits on More).
- Project title on the phone header → hidden below sm (Rename stays on the dashboard card's ⋯ and at sm and up).
- Add to the list → Enter in the link field, or Continue takes the typed link.
- Week added / Month added → Added draws week headers when the list spans weeks.
- New folder in a folder's list → the folder's ⋮ New folder inside, and New folder at the root's foot.
- The upload box's Cancel during the repeat ask → the box's ✕.

## Files

- `src/components/reader/workspace.tsx`: the History button and tab, the header shrink, the rail without Edit history, the phone's More menu, the Notes press with pending notes, `aria-current` that follows the sheet below md.
- `src/components/reader/reader-panes.tsx`: the view rows go into More's slot on a phone; Feedback left the view menu.
- `src/components/collab/history-control.tsx`: History as a tray panel with All / This document, 50 px rows, edit rows with Locate, replies and Revert / Restore paragraph.
- `src/components/panels/edits-panel.tsx`: deleted (its rows are History's).
- `src/components/panels/distill-panel.tsx`: the EXTRACT label dropped.
- `src/components/reader/add-document-dialog.tsx`, `upload-assistant.tsx`, `duplicate-ask.tsx`, `document-bar.tsx`, `document-delete.tsx`, `document-folders.tsx`, `document-organize.tsx`, `src/lib/document-order.ts`: NAV12-02, 03, 04, 12, 15, 18.
- `src/lib/i18n/dict/panes.ts`, `panels.ts`: words added and dropped (en and zh).
- Outside the package's list, each a small hunk the fix needed:
  - `src/app/n/[notebookId]/page.tsx`: the rail tab's edit query became `historyPage(…, { editsOnly: true })` for the open document (`documentHistory`).
  - `src/lib/history/list.ts`: an `editsOnly` option; edit rows carry before, after, meta and replies.
  - `src/app/api/notebooks/[notebookId]/history/route.ts`: an optional `documentId` for This document's Show older; people include reply authors.
  - `src/lib/types.ts`: `HistoryEntry.edit`.
  - `src/lib/i18n/dict/works.ts`: the guide's panel line and the rail nudge name History, not Edit history.
  - `src/components/icons.tsx`: EditsIcon's comment.
  - `src/lib/reading-position.ts`: the tray folds by default below 1000 px (EDGE12-10), in the hook and the restore script.
  - `src/components/reader/reader-interactions.tsx`: one line, the article pill's `data-track` is `distill-page`.
  - `SPEC.md`: the header, rail and bar; History §12; the queue; Sort by; the row menu; the delete confirm; the tray fold.

## Decisions

- History is a tray tab, not a popover: it sits where Edit history sat, so one place holds both; the header button toggles it.
- History takes the pencil-over-a-line glyph, so the page editor's clock means only Version history. The page editor's Editing mode has a plain pencil; if that reads as the same glyph, package 4 or the next round can pick another.
- The phone's More lives in the bottom bar (EDGE12-05), not the header (NAV12-05 offered either): the bar already had the Reader view menu, and the header keeps its room for the pill.
- Remove from this project stays in the row menu where it applies, not moved into Delete's confirm only: a reader who removes a document from one project should not have to open Delete for it.
- Added keeps oldest first. NAV12-12 asked for newest first, but flipping it moves every reader's list order (rule zero 5).
- The Extract tab keeps "Extract from the article": without it the tab could start an extraction of the project but not of the open document. The tab drops its label instead.
- The repeat ask's ✕ is Cancel; Add again and Open the one I have stay.
- The link field takes focus on open only with a fine pointer, so a phone does not raise its keyboard over the drop zone.
- A stored sort of "week" or "month" (localStorage) reads as Added; a stored tab "edits" reads as History.

## Needs

- Package 4 (page editor): NAV12-11, the pane's select as the title row in a split view; the toolbar's Extract glyph (NAV12-14); one save indicator (EDGE12-16).
- Package 3 (notes): Group by as the same pill as Sort by and one word for a row's date (NAV12-13); notices not in red (EDGE12-16, merge-undo.tsx).
- Package 2 (tools): one word, Send, for the assistant box and the card (EDGE12-16).

## Checks

- `npx tsc --noEmit` clean; eslint on every changed file: one warning that was there before (document-bar.tsx, `closeList` in a useEffect's list).
- Audit scripts run again: `18-dialog-draft` (a typed link and a queued file survive Escape and ✕), `14-keys` (as in the audit), `07-rail` (every tab as before; it stops at `[data-track="edits"]`, the tab that is gone), `03-add`, `08-add-link`, plus `f01-history`, `f04-list`, `f04b`, `f05-phone`, `f08`, `f14` for the fixes.

## Data

- Existing data: none touched. The history route and page only read. The rail's rows are all in History (checked against the database: 174 of 174 edits of the open document, 0 of the rail's 100 missing).
- Made for the checks and deleted through the app at the end: the project "Fix r12 nav", its 14 documents and its folder.
- Warning to other workers: `git stash` is shared by every worktree of the repository. A `git stash pop` here popped the dash worker's stash; it was put back (`c67ebf3`, on top of the stack) and nothing was lost. Do not use `git stash` in a worktree.
