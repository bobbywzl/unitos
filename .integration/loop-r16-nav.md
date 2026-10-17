# Round 16, nav package (loop/r16-nav)

**Intent:** fix the round 16 navigation findings NAV16-01 to 09: folders three deep, Delete folder's order, the project's own list, the phone's document list, Save for offline, back to Normal, the not-found line, Your data.

Screenshots are in `.qa-tmp/fix/` of the worktree and copied to `/mnt/project-files/interaction-loop/round-16/img/<ID>-before.png` and `-after.png`. Scripts are the audit's (`.qa-tmp/audit/r16/navigation/`), copied and pointed at :3145; three are new (`48b`, `48c`, `71b`, below). Before numbers come from my own run where the script could run on the base code (NAV16-03); for the rest they are the audit's runs of the same scripts at the same base commit 552f638, on :3111. The machine was at load 15-40 and the out-of-memory killer stopped my dev server five times; timing numbers are slow in absolute terms.

## Findings

| id | result | before → after |
|---|---|---|
| NAV16-03 | fixed | Top's Custom order after Delete folder on Middle: **Deep, Attention span, Reading speed, Working memory, Desirable difficulty** (database and screen) → **Working memory, Reading speed, Deep, Attention span, Desirable difficulty** while the pill shows, in the database after the commit (positions 0-4), and on screen after a reload. Undo still brings Middle back with its order. |
| NAV16-01 | fixed | 1440: Deep's list at x 643-969, over Top's list → Deep opens under its row inside Middle's list (x 969-1289); 1000: Middle's list at x 317-643, over the project's list → Middle opens under its row inside Top's list (x 637-963). No list covers another at any width. |
| NAV16-02 | fixed | 820: the open document's folders all closed (3 presses to see the path) → Top, Middle and Deep open on their own, the document bold (as at 390). |
| NAV16-04 | fixed | "No folder" / "Drop here to move it out of its folder" → "The project" / "Move to the project" (zh 本项目 / 移到本项目). |
| NAV16-05 | fixed | 390: the list ends at y 537 (480 px cap), 7 of 19 rows behind its edge → ends at y 742, above the bottom bar (790). |
| NAV16-06 | fixed | Dashboard save, then open the project: header reads Save for offline with no bar, a press starts a second save (two GETs of `/offline`, 19 pages fetched twice) → the header shows "Saving images… 41/103" and its button waits (disabled); a forced press starts nothing (1 GET of `/offline`); the toast and Remove offline copy follow. Fetches run four at a time. Time: audit 21-47 s for 19 pages and 46 images; mine 49 s for 17 pages and 103 images on a server that was compiling the pages and at load 20+, so no clean speed number (see Decisions). |
| NAV16-07 | fixed | Back to Normal: nothing moves for 0.6-1.8 s, then CLS 0.182 (from Top and Bottom 0.225) → the final layout at +150 ms (page x 156 w 724, toolbar x 630, tray x 1036; y unchanged 177/118), CLS 0 in 5 of 5 runs (`36-back-to-normal.mjs`, `34-view-times.mjs`). Side by Side and Top and Bottom are unchanged (they wait for the server's second pane): CLS 0.093 and 0.071, within round 15's range. |
| NAV16-08 | fixed | "This page does not exist, or its link is stale." → "This project was deleted, or it is no longer shared with you." under `/n/[notebookId]`; other unknown URLs keep the old line. |
| NAV16-09 | fixed | Your data had no row for kept conversations and did not name unsaved typed words → "Kept conversations | 10 | Your questions and the assistant's answers, one conversation per project and place, kept until you clear them."; In your browser only adds "typed words not saved yet". No control added. |

None of these findings is blocking. For NAV16-03, origin/main has the same behavior (`position: null` on every moved row in the folder DELETE route); nothing is lost there either, only the order.

## Where moved actions went
Nothing moved. A folder three deep that opened beside its row on a wide screen now opens under its row inside the list it came from; it opens by a press (a hover only opens a list beside its row), by →, or by a held drag, as a phone's lists do.

## Commits
- b39bad97 Reader: Delete folder keeps the rows' order and place (NAV16-03)
- efca7168 Reader: a folder's list never covers another list (NAV16-01, 02)
- 212eed3b Reader: one name for the project's own list (NAV16-04)
- e67f052a Reader: the phone's document list uses the screen's height (NAV16-05)
- a90ba210 Reader: one Save for offline per project, four fetches at a time (NAV16-06)
- 08789958 Reader: back to Normal moves at the press, not a second later (NAV16-07)
- fbf5c0cd Reader: a deleted project says so (NAV16-08)
- 68c0c3cf Settings: Your data names kept conversations and unsaved typed words (NAV16-09)

## Files
- `src/app/api/notebooks/[notebookId]/folders/[folderId]/route.ts`: DELETE takes an optional `{order}` (zod) and writes each named row's position in the delete's transaction; a named row not in the parent's or the folder's list is skipped; an empty body runs as before.
- `src/components/reader/document-folders.tsx`: Delete folder computes the parent's order with the folder's rows spliced in (only when either list has a placed row), draws it while the pill shows, and sends it; `roomBeside` lets only the project's list open a list on its left; → opens an under-row folder and moves the focus in; the first open path follows the rows' test (`beside`).
- `src/components/reader/document-bar.tsx`: the list's height cap below md is the window less 160 px.
- `src/lib/offline/saved.ts`: `startSave`, `runningSaves`, `subscribeRunning`, `noSaves` (one running save per project per tab); `eachLimit` fetches four at a time.
- `src/components/works/works-shelf.tsx`, `src/components/reader/workspace.tsx` (Save for offline): read the running save; the toast comes from its promise.
- `src/components/reader/reader-panes.tsx`: the view pick moved from local state to a small module store; `useDrawnView` draws Normal at the press.
- `src/components/reader/workspace.tsx` (tray): `split` and the tray's default fold read `useDrawnView(readerView)`.
- `src/components/not-found-page.tsx` (new), `src/app/not-found.tsx`, `src/app/n/[notebookId]/not-found.tsx` (new).
- `src/lib/account-data.ts`, `src/components/settings-form.tsx`: the Kept conversations count and row.
- `src/lib/i18n/dict/panes.ts` (`folderRoot`, `moveToProject` changed), `works.ts` (`projectNotFoundBody` new), `settings.ts` (`dataKeptChats`, `dataKeptChatsDesc` new; `dataBrowserValue` changed); en and zh each.
- `SPEC.md`: §6 Folders (fly-out placement, the path, Delete folder's order), §6 Reader views (Normal at the press), §17 Offline copies (one save per project, four at a time), the sync paragraph (the not-found line), §12 Your data.

## Decisions
- NAV16-03: the client sends the order it draws rather than the server computing it, because Custom order lists unplaced rows by last edit, which only the page computes (`documentEditedAt`). The route stays lenient (it skips stale rows) so an order made 12 s earlier never fails the delete. With no placed row in either list nothing is written, so a reader who never used Custom order keeps "unplaced, newest edit first" everywhere. A keepalive body is capped at 64 KB: a longer order goes without keepalive.
- NAV16-01: rather than flip a nested list left over an earlier list, it opens under its row inside its parent list (the audit's proposal). → on such a row also moves the focus into it, so the keyboard path three folders deep stays the same length (`84-keys-deep.mjs` passes).
- NAV16-06: the dashboard keeps "one save at a time" (a press on another card while one runs does nothing, as before). The background refresh of old copies (`refreshSaved`) stays outside the running-save map so it stays silent, as before. Four fetches at a time on a dev server means four page renders at once; on this loaded machine that does not show a speed-up, and production renders are cheaper. Measure the save again on a quiet machine.
- NAV16-07: only Normal draws at the press; a split still waits for the server, since its second pane is the server's render. The first pane keeps the split's pane header for the few hundred ms until the page lands; it has the title row's height, so nothing moves up or down.
- NAV16-08: the new key is in `works.ts` (the projects namespace), not `common.ts`, which the edge package owns.

## Data
My project "Audit r16 navigation" (`cmv0mt78000007d7inialgd5v`) was made through the routes by `00-setup.mjs`. Folder deletes and rebuilds, orders, a drag, a kept conversation (put and deleted), two offline copies (removed) all ran there. Two throwaway projects "Audit r16 navigation removed" were made and deleted with their documents by `95-removed-project.mjs` (one cleaned by hand after a server crash: document and project DELETE, both 200). At the end the project was deleted (`DELETE /api/notebooks/:id`, 200; it kept its 15 documents unattached, by design) and then each of its 15 documents with `DELETE /api/documents/:id` (all 200; each was held by my project only). Database after: 0 "Audit r16 navigation" projects, 0 of its documents, 0 kept conversations. The shared profile and settings were never written.

## Needs
- None in files I do not own. The lead merging: `workspace.tsx` hunks are the Save for offline block (~lines 305-360) and three lines for the tray (`drawnView`); `reader-panes.tsx` replaces the local `picked` state.
- Not done (decided this round): a History entry for a deleted folder.
