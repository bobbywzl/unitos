# loop/r11-nav

**Intent:** fix the round 11 navigation package of the reader interaction loop: NAV11-02 to NAV11-16 (`.qa-tmp/audit/r11/navigation.md`) and EDGE11-04, -08, -09, -11.

## Findings

Screenshots are under `/home/user/wt/r11-nav/.qa-tmp/fix/` (git-excluded), `<id>-before.png` and `<id>-after*.png`.

- **NAV11-02 (blocking): fixed.** History showed the newest 100 rows and nothing older, so an older removed note had no Restore. Show older, under the last row, reads the 100 before them (`GET /api/notebooks/[id]/history?beforeAt=&beforeId=`, keyset on createdAt and id). Checked: 110 rows reached, "Removed note 001" restored (DB confirmed). Read-only on existing rows. `NAV11-02-after.png`, `NAV11-02-after-restored.png`.
- **NAV11-03 (blocking): fixed, revised after review.** Delete project opens an in-app confirm that names the documents only that project holds and says they stay in the library. The delete writes a `KeptDocument` row (new table, owner only) for each such document in the same transaction, and the signed-in Library lists a document in no project only for an account that kept it or wrote in it (edit, version, rich-text save, a link it made). Reading is no claim: a reading position lists nothing, so a collaborator who only read the document does not get it (CLAUDE.md rule 2). No document is ever deleted. Existing orphans checked read-only: 0 on the shared database today. Tested: the confirm named both documents; after the delete the owner has two KeptDocument rows and the owner's trace lists both; an account with only a reading position lists none (`.qa-tmp/fix/claims.mts`). `NAV11-03-after.png`.
  Remove from this project (review item): offered only while another project the reader can open (any role) holds the document; the route refuses otherwise (409); the footprint returns `openProjects`. Tested: in two projects, Remove is enabled and leaves the other; in one project, Remove is disabled with "This document is in no other project you can open", the route answers 409, Delete's confirm says "It is in this project only"; with sign-in on, another account's project is not openable. `NAV11-03-remove-one.png`, `NAV11-03-remove-notice.png`.
- **NAV11-04: fixed.** The address drops `?src`, `?block`, `?link`, and `?annotation` once the reader scrolls on (wheel or touch in the panes, a scrolling key) or after 30 s; a reload after scrolling stays at 1450 px (was 118). `NAV11-04-after.png`.
- **NAV11-05: fixed.** The graph pushes one history entry; Back closes it and keeps the document; a document opened from the graph replaces that entry. `NAV11-05-after.png`.
- **NAV11-06: fixed.** A link to a document taken out of the project opens the first document with a notice at the foot of the panes (moved from the top after review: the page editor's toolbar covered it) that names the removed one and offers Add back (editors); History's detach row has Add back too. Both reattach through the normal attach, which puts the kept work back (DB confirmed). `NAV11-06-after.png`, `NAV11-06-after-history.png`, `NAV11-06-after-added.png`, `NAV11-06-after-page-editor.png`.
- **NAV11-07: fixed.** A list pressed open, or pressed inside, stays until a press outside, a second press, or Escape; a hover-opened list still closes on leave; the delete confirm survives the pointer leaving. `NAV11-07-after.png`.
- **NAV11-08: not fixed.** The jump is a window event every pane holding the block takes (`reader-interactions.tsx`), and the reading position key is per document (`lib/reading-position.ts`). Neither file is owned here. See Needs. `NAV11-08-before.png`.
- **NAV11-09: half fixed.** Feedback is on the Escape stack (Esc 1 closes Feedback, Esc 2 the card); the Reader view menu is too. The notes tray's search (`outline/notes-tray.tsx`) is not owned here. See Needs. `NAV11-09-after.png`.
- **NAV11-10: fixed.** ArrowDown on the pill opens the list; arrows move between rows; Escape returns focus to the pill. `NAV11-10-after.png`.
- **NAV11-11: fixed.** Where there is no room beside the list, a folder's list opens under its row (820 wide). `NAV11-11-after.png`.
- **NAV11-12: fixed.** The update notification is one card in the page above Projects; it covers no card. `NAV11-12-after.png`.
- **NAV11-13: fixed.** New folder draws its row at once (132 ms); Delete folder asks in the app's own confirm. `NAV11-13-after.png`, `NAV11-13-after-confirm.png`.
- **NAV11-14: fixed.** Kind reads Text file for a .txt or .md (the import line's name); Week added and Month added run oldest first like Added. `NAV11-14-after.png`.
- **NAV11-15: fixed.** The Keys card lists Ctrl+A, Shift+arrows, and the pending queue's Enter, Backspace, J, K, E, G (en and zh). `NAV11-15-after.png`.
- **NAV11-16: fixed.** The Library has a title search, a taller list, "(1 block)", and Delete from the library behind each row's ⋯. `NAV11-16-after.png`.
- **EDGE11-04 (blocking): fixed.** Below md the offline pill reads Offline and shrinks; the full label is its tooltip and aria-label. The phone header stays 390 px (was 558). `EDGE11-04-after.png`.
- **EDGE11-08: fixed.** On md and up the Reader view button is the rail's last button; 0 words under it at tablet portrait, tablet landscape, and phone landscape. `EDGE11-08-after.png`, `EDGE11-08-after-phone-landscape.png`.
- **EDGE11-09: fixed.** A phone offers Normal and Top and Bottom; `view=side` on a phone opens as Top and Bottom. `EDGE11-09-after-menu.png`, `EDGE11-09-after-link.png`.
- **EDGE11-11: fixed.** The Contents menu background is the solid card color. `EDGE11-11-after.png`.

## Re-run

The nav audit set (03, 05, 10 to 25, without the scripts that make, remove, or delete, which the fix scripts in `.qa-tmp/fix/` cover) and edge t03 and t81 ran on this branch at the end. Passes: History (100 rows, Show older), graph Back, reload after a jump (1450), split reload, list keys, touch list, sort, offline save, folder row (138 ms) and in-app confirm, view button (0 words under it), phone header (390 px). Script failures that are the scripts' assumptions, not the app: 10 and 14 look for the audit project's "Nav copy" documents; 12 expects a second press to reopen a pressed list (it now closes it, as SPEC says); 25 waits for the browser's confirm; 05 and 17 need block documents for cards and Contents (this account's test documents are imports in the page editor). 17 still shows NAV11-08.

Seen, not caused here: a wheel within about 1.2 s of a reload, before the page hydrates on the slow dev server, scrolls and is then put back by the reading-position hold's first apply (`reader-interactions.tsx` around line 1412). At 4 s the wheel stays. See Needs.

## Files

- `src/lib/history/list.ts` (new): one History page, keyset paging, Add back flags.
- `src/app/api/notebooks/[notebookId]/history/route.ts` (new): Show older.
- `src/app/n/[notebookId]/page.tsx`: History's first page through `historyPage`; the missing-document notice's data.
- `src/components/collab/history-control.tsx`: Show older, Add back.
- `src/lib/types.ts`: `HistoryEntry.addBackDocumentId` (outside the owned list; one optional field).
- `src/lib/documents/orphans.ts` (new): documents only one project holds, the account's claim (`ownTrace`), the kept-document write.
- `prisma/schema.prisma`, `prisma/migrations/20261006100000_kept_document/migration.sql` (new table `KeptDocument(userId, documentId, keptAt)`, key on the pair, FK to Document with cascade; IF NOT EXISTS; no existing column changes). Applied to the shared database with psql, not recorded in `_prisma_migrations`, so `migrate deploy` runs it on merge (idempotent). The worktree's generated Prisma client was regenerated after breaking its hardlinks to the other worktrees' copies.
- `src/app/api/documents/[documentId]/footprint/route.ts`, `src/app/api/documents/[documentId]/route.ts`, `src/lib/document-footprint.ts` (`openableNotebooks`), `src/components/reader/document-delete.tsx`: Remove from this project only while another project the reader can open holds the document.
- `src/lib/i18n/dict/api.ts`: the 409's words.
- `src/app/api/notebooks/[notebookId]/route.ts`: GET the documents only this project holds; DELETE writes the KeptDocument rows in the same transaction.
- `src/app/api/documents/route.ts`: the signed-in Library adds the account's documents in no project.
- `src/components/works/works-shelf.tsx`: the Delete project confirm.
- `src/components/works/notifications.tsx`: the notification in the page flow.
- `src/components/graph/graph-history.ts` (new), `graph-overlay.tsx`, `graph-view.tsx`, `generated-list.tsx`, `stitch-box.tsx`: the graph's history entry.
- `src/components/reader/jump-param.ts` (new), `reader-panes.tsx`: jump params, the notice, the view button in the rail, phone views, Escape.
- `src/components/reader/document-bar.tsx`: pressed list, arrows, focus return.
- `src/components/reader/document-folders.tsx`: flyout under the row, instant new row, in-app delete confirm.
- `src/components/reader/document-organize.tsx`, `src/lib/document-order.ts`: Text file kind name, oldest-first date orders (outside the owned list; the document list's sort).
- `src/components/reader/add-document-dialog.tsx`: Library search, height, plural, ⋯ menu.
- `src/components/reader/contents-menu.tsx`: opaque background.
- `src/components/feedback-button.tsx`: Escape layer.
- `src/components/guide-dialog.tsx`: Keys rows.
- `src/components/offline-status.tsx`: short label below md.
- `src/lib/i18n/dict/{common,panes,works}.ts`: the new strings, en and zh.
- `SPEC.md`: History, Delete project and Library, graph Back, reader views, jump params, the missing-document notice, the document list and folders, Sort by, the notification, the Library dialog.

## Decisions

- A document left in no project is reached through the deleting owner's Library by a `KeptDocument` row (first version used a reading position; the review rejected it because any reader keeps one). A writing trace still counts for pre-existing orphans; a reading position never does.
- Remove from this project counts projects the reader can open at any role, viewer included: the document stays reachable from there.
- A shared document (another account's project holds it, one the reader cannot open) offers Delete, whose confirm says it only leaves the reader's projects and nothing goes, as before.
- Every date order runs oldest first, matching Added (the order the list has always had), rather than turning Added newest first.
- Kind's name for Markdown and text is Text file, the import line's name, for both .md and .txt.
- The Reader view button moves to the rail on every md+ width, not only on tablets, so there is one place for it.
- On a phone, `view=side` becomes Top and Bottom (router.replace) instead of being refused.
- Jump params drop on the reader's own move or after 30 s, with `history.replaceState`, so the reader does not re-render.
- The graph's Back uses a module-level flag and one pushState; a document opened from the graph replaces the entry so Back returns to the previous document once.

## Needs

- **NAV11-08** (reader-interactions.tsx, lib/reading-position.ts): `dissect:flash-block` should carry the pane that asked, and only that pane should scroll; the tab's reading position should be keyed per pane when both panes hold one document.
- **NAV11-09** (outline/notes-tray.tsx): the tray's search should register with `useEscapeLayer` while it holds text and focus. `collab/share-control.tsx` and `export-menu.tsx` also listen for Escape on their own.
- **lib/collab.ts `documentAccess`**: a document in no project answers `owner` to every signed-in account, so anyone holding its id can attach or delete it. It should require a claim (`ownTrace`). Not changed here: collab.ts is shared by every route.
- **Reading-position hold** (reader-interactions.tsx): when the hold's effect mounts after the reader already scrolled (a slow hydration), it should not apply the position again; the inline script could mark the pane as moved by the reader.
- **NAV11-01** (another worker): once the queue keys are scoped, the guide's "In the pending queue" rows match.
