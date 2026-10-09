# loop/r15-nav

**Intent:** Fix round 15's navigation package (section 4 of PACKAGES.md): the blocking NAV15-01 first, then NAV15-02 to 11 with EDGE15-11, EDGE15-14 and EDGE15-15, under the lead's decisions (every delete has Undo, one failure line, typed words survive), without adding a visible control.

Screenshots: `.qa-tmp/fix/<ID>-before.png` and `-after*.png` in this worktree, copied to `/mnt/project-files/interaction-loop/round-15/img/`. A "before" taken from the audit (same code, 6385f7f) is marked (audit). Every number is from my dev server on :3145, a webpack dev build on a machine shared with five other workers. The audit's scripts were copied to `.qa-tmp/nav/` and pointed at :3145 and my project "Fix r15 nav".

## Findings

### Blocking

- **NAV15-01 (fixed). Settings' Background and Feedback lost typed words; Settings never retried and dropped the last 700 ms at a tab close.**
  - Settings (`settings-form.tsx`): every change writes a browser draft at once (`unitos:draft:settings:<account>`, the profile fields and the text the server last confirmed). The save still runs 700 ms after the last key. The draft goes only when the server confirms the same text. A failed save retries with a doubling wait (2 s up to 30 s), and at once on online, focus and visibilitychange. A 4xx is not retried: its words stay in the draft and on screen. pagehide and unmount send the pending save with `keepalive`. On open, a draft newer than the server's text is restored; if the Background changed elsewhere meanwhile, both texts are kept (theirs, a blank line, mine). The status row shows one line: "Not saved. Try again." replaces "Changes save automatically".
  - Feedback (`feedback-button.tsx`): category, message, links and photos are kept in `unitos:draft:feedback:<account>` until a send lands. The failure line is "Not sent. Try again.".
  - Before (`21-background-draft.mjs`):
    - The status row read "Not saved. Try again.Changes save automatically".
    - With the network back, 10 s gave 0 retries.
    - A reload lost the words.
    - A tab closed 200 ms after the last key sent 0 PUTs, and the words were lost.
    - Feedback (`80-guide-feedback.mjs`) read "Send failed. Try again.", and a reload opened an empty form.
  - After:
    - The status row shows one line.
    - A reload while the save fails keeps the words.
    - The save retries within 10 s of the network coming back.
    - A tab close lands the keepalive PUT in the database.
    - Feedback (`80b-feedback-light.mjs`): "Not sent. Try again.", a reload keeps the words, and a send that lands clears the draft.
  - DB and reload proof (`21c-db-proof.mjs`):
    - While the network failed, the database did not hold the words (false) and a reload kept them in the field.
    - 12 s after the network came back, the database held them (true).
    - After the next reload the draft was gone (0 drafts).
    - The shared profile was then put back to its original text and checked in the database.
    - The real send added 2 Feedback rows (mine) to the local database; I left them.
  - origin/main: the same loss. `settings-form.tsx` there only debounces its save, with no draft, no flush and no retry; `feedback-button.tsx` keeps no draft.
  - Shots: `NAV15-01-before.png`, `NAV15-01-before-reload.png`, `NAV15-01-after.png`, `NAV15-01-after-reload.png`, `NAV15-01-after-db-reload.png`, and `NAV15-01-feedback-before.png`, `-feedback-before-reload.png`, `-feedback-after.png`, `-feedback-after-reload.png`.

### Friction and polish

- **NAV15-02 (fixed).** A click on a folder row that a hover already opened keeps its list open. In the fly-out the click opens the folder; it toggles only in the inline list. Before (`41-folder-click.mjs`): hover then click closed the list. After: it stays open. Shots: `NAV15-02-before.png`, `NAV15-02-after.png`.
- **NAV15-03 with EDGE15-11 (fixed for the vertical jump; a sideways move stays).** The pane header of a split view stands over the top of the article's scroller, in the place and height of what Normal has there:
  - For the page editor, that is the title row. `docs-editor.tsx` and its loading frame keep the row's slot, empty, in a split.
  - For a block article, that is the top padding, where Normal's controls float.

  Effects:
  - The pane no longer moves 68 → 112 and back, and the toolbar keeps its y (118).
  - The page editor keeps Collapse in its toolbar in both views, so Collapse no longer changes places.
  - Extract stays in the pane header.
  - Block toasts in a split sit under the header (top 60 px).
  - The split's Contents list now drops below the header, inside the pane. Before, it was centered on the row and ran above it: Presence wraps the nav, so `[&>nav]` never matched.

  | Switch | Before | After |
  |---|---|---|
  | Import, Side by Side (`32-split-shift.mjs`, `v01b.mjs`, `34-view-times.mjs`, 1440) | 0.166 | 0.0075, 0.093, 0, 0.093 (runs) |
  | Import, back to Normal | 0.244 | 0.015 to 0.188 |
  | Import, Top and Bottom | 0.273 | 0.071 |
  | Block document, Side by Side | 0.073 (my run; audit 0.084) | 0.049 |
  | Block document, back to Normal | 0.226 | 0 |

  Side by Side is drawn in 1.0 to 2.0 s (before 1.1 to 3.5 s).
  - What is left is sideways: the page re-centers in the narrower pane and the toolbar's right group follows the pane's edge. On the way back, the tray opens (x 1388 → 1036) in the same frame. A second small step (0.008 to 0.015) is the page editor's ≡ Contents leaving the toolbar a frame late (Needs).
  - Contents in the page editor still follows the room: beside the page when the margin holds it, ≡ in the toolbar when not, as in any narrow window. I kept that (Decisions).
  - Checked (`33b-split-check.mjs`):
    - The list drops at 119 to 344 px, absolute.
    - A Contents jump in a split block pane puts its heading at y 148, under the header's bottom at 112.
    - A scrolled pane's text runs under the header, which has the paper background.
    - In Top and Bottom, both headers stand at their pane's top.
  - Shots: `NAV15-03-before.png` (audit), `NAV15-03-after.png`, `NAV15-03-after-contents.png`, `NAV15-03-after-stack.png`, `EDGE15-11-before.png` (audit, block document), `EDGE15-11-after.png`.
- **NAV15-04 (fixed).** New project holds "Working…" until the new page is drawn (`useTransition` around the push), and a second press does nothing while it waits. Before (`92-new-project.mjs`, `93-new-project-twice.mjs`): the label came back at 6.5 s and two presses made 2 projects. After: "Working…" was held to 16.7 s and two presses made 1 project. Script 93 deletes only the ids it made. Shots: `NAV15-04-before.png`, `NAV15-04-after.png`.
- **NAV15-05 (fixed).**
  - The share page's add failures read "Not added. Try again." (new key `works.shareAddFailed`), or "Upload too large for the server." on a 413. A 4xx that has its own words keeps them, and the technical text goes to the console.
  - Delete project's confirm: a failed read shows "Not loaded. Try again." and Delete stays enabled; a press on Delete reads again.
  - Before (`90-share-page.mjs`, `91-delete-confirm.mjs`): the share page read "Request failed (500)", "(502)" and "(413)"; the confirm read "Request failed" with Delete disabled.
  - After: "Not added. Try again." twice and "Upload too large for the server."; the confirm reads "Not loaded. Try again." with Delete enabled, and a press re-reads.
  - Shots: `NAV15-05-share-before.png`, `-share-after.png`, `-delete-before.png`, `-delete-after.png`, `-delete-after-retry.png`.
- **NAV15-06 (fixed).** Feedback opened by Enter on the pill puts the focus in the message box. Escape and ✕ give the focus back to what opened it: the pill, or the guide's Feedback button and then the guide.
  - Before (`81b-feedback-keys.mjs`): the focus stayed on the pill and "abc" went nowhere.
  - After: the focus is in the textarea, "abc" is typed, and Escape and ✕ return the focus to the pill. In the reader's guide path (`81c-reader-feedback-keys.mjs`) the focus returns to the Guide button.
  - Shots: `NAV15-06-before.png`, `NAV15-06-after.png`, `NAV15-06-after-reader.png`.
- **NAV15-07 (fixed).** One key shape for every ⋯ and menu button (`src/lib/menu-keys.ts`): Enter or Space opens the menu with the focus on its first row; ↓ and ↑ move round its rows; Home and End go to the first and the last row; Escape gives the focus back to the button. The keys stop at the menu, so the document list's own ↓ ↑ never takes them.
  - Wired into the document row's ⋯, the folder's ⋯, Sort by, Reader view and the dashboard card's ⋯.
  - Before (`82-menu-keys.mjs`, `83-rowmenu-down.mjs`): ↓ jumped to the list's first row, or did nothing.
  - After: on all five menus, Enter goes to the first row, ↓ moves within the menu, and Esc returns to the button.
  - Shots: `NAV15-07-before.png` (audit), `NAV15-07-after.png`.
- **NAV15-08 (fixed, pill only).** Delete folder asks nothing. The folder leaves the list at once, its documents and folders move up one level, and the Undo pill shows "Folder deleted | Undo | ✕" (12 s, Ctrl+Z). The server DELETE waits for the pill's commit and goes with `keepalive`. A failed commit puts the folder back and shows "Not saved. Try again.".
  - Before: 3 presses with an ask under the row.
  - After (`42-folder-delete.mjs`):
    - 2 presses, then the pill.
    - The database is unchanged until the commit.
    - Undo brings the folder back.
    - After the pill, the folder row is gone and its document is at the project level. A reload agrees.
  - No History event: none of the existing events can carry a folder (Decisions).
  - Shots: `NAV15-08-before.png`, `NAV15-08-after.png`, `NAV15-08-after-undo.png`, `NAV15-08-after-reload.png`.
- **NAV15-09 (fixed).** The offline page draws the dashboard's cards: two per row on a phone, the dashboard's sizes, and no Offline badge (the page is the list of saved projects). The Feedback pill hides on `/offline`, since Feedback cannot send offline. Before (`70-offline.mjs`, 390): card 342×529, a badge on every card, the Feedback pill over it, 2 controls. After: card 165×255, no badge, no Feedback, 1 control. Shots: `NAV15-09-before.png`, `NAV15-09-after.png`.
- **NAV15-10 (fixed).** A card's ⋯ menu on a phone opens just under the card's title, beside the ⋯, and stays inside the 16 px gutter: it is aligned to the left when right-aligning would cross the gutter. Before (`10b-card-menu.mjs`, 390): x 3 to 179, 64 px under the ⋯. After: x 147 to 323, 33 to 67 px under the title. Shots: `NAV15-10-before.png`, `NAV15-10-after.png`.
- **NAV15-11 (fixed).** New document here shows only in an empty folder. A folder that holds something has New document inside as the first row of its ⋯ (new key `panes.newFileInside`). Before (`40-folders.mjs`, 390): 2 New document here rows with a nested folder open. After: 0 rows, and the ⋯ has New document inside. Shots: `NAV15-11-before.png`, `NAV15-11-after.png`, `NAV15-11-after-menu.png`.
- **EDGE15-14 (fixed).** Each release has one notification per language. The dashboard lists only the rows of its language (and rows with no key); a dismissal in one language dismisses the others; a new language's row starts dismissed if another language's row was. Before (`e14-releases.mjs`): "1 of 6" in en and in zh. After: "1 of 3", with the zh row first in zh. A tsx test (`.qa-tmp/e14-dismiss.ts`, temporary user, removed) showed a zh dismissal hides the row in en. Shots: `EDGE15-14-before.png` (audit), `EDGE15-14-after.png`.
- **EDGE15-15 (fixed).** The live poll's 404 (the account lost access: removed as a collaborator, or the project deleted) renders the page again, which shows Page not found. It waits while the reader types or has a selection, as the poll's refresh does. Before (`e15-removed.mjs`, project deleted while open, since sign-in is off here): still shown after 25 s. After: Page not found after 1,004 ms. Shots: `EDGE15-15-before.png`, `EDGE15-15-after.png`.

Regression runs:
- `21`, `21c`, `80b`, `81b`, `81c`, `40-folders`, `41`, `42`, `82`, `83`, `92`, `93`, `90`, `91`, `70`, `10b`, `e14`, `e15`, `32`, `34`, `33b`, `v01b`.
- Chromium crashed several times from memory on the shared machine, and my dev server was killed twice. Each script was rerun until it finished.

Checks: `npx tsc --noEmit` is clean (run with the dev server stopped). Eslint is clean on every changed file.

## Files

- `src/components/settings-form.tsx`: the Settings draft, retry, keepalive flush on pagehide and unmount, and the one-line status (NAV15-01).
- `src/components/feedback-button.tsx`:
  - the Feedback draft (NAV15-01);
  - the focus going in and back, with `useEscapeLayer` (NAV15-06);
  - the pill hidden on `/offline` (NAV15-09).
- `src/components/reader/document-folders.tsx`:
  - the click keeps the fly-out open (02);
  - Delete folder with Undo (08);
  - New document inside (11);
  - menu keys on the folder ⋯ (07).
- `src/components/reader/document-bar.tsx`, `src/components/reader/document-organize.tsx`: menu keys on the row ⋯ and Sort by (07).
- `src/components/reader/reader-panes.tsx`: menu keys on Reader view (07); the PANE_HEADER comment (03).
- `src/lib/menu-keys.ts` (new): the one key shape for menus (07).
- `src/components/works/works-shelf.tsx`: New project holds Working… (04); the Delete project read failure (05).
- `src/components/works/work-card.tsx`: the menu placement (10); menu keys (07).
- `src/components/share-add.tsx`: the plain failure lines (05).
- `src/components/offline/offline-shelf.tsx`: the dashboard's cards (09).
- `src/lib/releases-server.ts`: one row per language, dismissals shared, and `releaseKeyFilter(lang)` (EDGE15-14).
- `src/app/page.tsx`: the dashboard reads only its language's release rows (EDGE15-14).
- `src/components/collab/use-sync.ts`: the 404 refresh (EDGE15-15). **Outside the package's list.**
- `src/components/reader/reader-interactions.tsx` (shared): small in-place hunks only:
  - the pane header inside the scroller, sticky, over the title slot or the top padding;
  - Collapse kept in the page editor's toolbar in a split;
  - the split Contents list anchored to the pane;
  - block toasts at top 60 px in a split (03 / EDGE15-11).
- `src/components/docs/docs-editor.tsx`, `src/components/docs/frame.tsx`: the empty title-row slot in a split (03). **Page package files; 4 and 6 lines.**
- `src/lib/i18n/dict/works.ts`: `feedbackFailed` text changed ("Not sent. Try again." / "未发送。请重试。"); `shareAddFailed` added.
- `src/lib/i18n/dict/panes.ts`: `confirmDeleteFolder` replaced by `folderDeleted` ("Folder deleted" / "文件夹已删除"); `newFileInside` added ("New document inside" / "在里面新建文档").
- `SPEC.md`: the lines these behaviors touch:
  - the Settings profile autosave;
  - Feedback drafts;
  - folders (click, Delete folder, New document inside, menu keys);
  - New project Working…;
  - the Delete project read failure;
  - the card menu;
  - the offline page;
  - release notifications;
  - the sync 404;
  - §6 pane header, §28 Collapse in the page editor, and §29 the title row in a split.

## Decisions

- Settings keeps one draft for all profile fields (name, symbol, color, background), keyed by account; a picture is not drafted (it saves on pick).
- If the Background changed elsewhere while a draft waited, the restore keeps both texts (theirs, a blank line, mine) rather than picking one. The reader deletes what they do not want.
- A 4xx save is not retried (the server refused the text); its words stay on screen and in the draft, with "Not saved. Try again.".
- The Feedback textarea takes the focus with `autoFocus` when the form opens, so typed letters land.
- Delete folder: the pill alone, no History event. The `NotebookEvent` kinds have no folder event, and the lead's rule forbids a new enum value.
- The card's ⋯ menu opens under the card's title, not at the ⋯'s foot, because SPEC keeps the title in view. It aligns left only when right alignment would cross the 16 px gutter.
- EDGE15-15: the 404 refresh waits while the reader types or has a selection, as the poll's other refresh does, so a refresh never cuts a word short. Typed words are in their drafts either way.
- NAV15-03: the smaller change won. Collapse in the page editor stays in the toolbar in both views, instead of moving Normal's Collapse into the title row. The page editor's Contents keeps its room rule (beside the page, or ≡ in the toolbar when the margin is too thin), instead of removing the floating button. The pane header for an article is sticky inside the scroller with `margin-bottom: -44px` (z 40, over the docs header's z 35), not an overlay outside it, so the scrollbar stays whole. A transcript keeps its header row above the media pane.

## Needs

- **Merge notes.**
  - `src/components/collab/use-sync.ts` is outside the package's owner list (7 lines).
  - `src/components/docs/docs-editor.tsx` (4 lines) and `src/components/docs/frame.tsx` (6 lines) belong to the page package. Both add one empty `docs-title-row` with `data-pane-header-slot` in a split. If the page package changed `headerHidden` or the frame's title row, keep this slot whenever `split` is true.
  - `reader-interactions.tsx` hunks: the split pane header block, `articleMenu`'s split classes, the toasts' `top`, and `aiControls: !embedded`.
- i18n: `works.shareAddFailed` (new), `works.feedbackFailed` (text changed), `panes.folderDeleted` (replaces `panes.confirmDeleteFolder`; no other user), `panes.newFileInside` (new). en and zh together.
- NAV15-03's last 0.008 to 0.015: the page editor learns that the outline has room a frame after a width change (`areas/page.tsx` sets `outlineRoom` in a `useEffect` from a measured width). So ≡ Contents shows in the toolbar for one frame after a split goes back to Normal. That is page package code.
- The sideways part of a view switch (the page re-centers, and the tray folds and opens) is how the split shares the width. Keeping the article's x would need the split to grow toward the tray, which is a larger workspace change.
- The real Feedback send in `80b` (REAL=1) added 2 Feedback rows from my runs to the local database; they are test rows.
- Cleanup done: the "Fix r15 nav" project's 15 documents were deleted with `DELETE /api/documents/:id`, then the project (0 left); the shared profile (user-1) holds its original Background.
