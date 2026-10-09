# loop/r14-edge: saves that fail, the offline queue, failure words, empty states

**Intent:** fix round 14's edge package: the offline queue never drops a note edit unless the server says it is stale (EDGE14-01, blocking), a write that fails while online queues and retries like an offline one (EDGE14-02), one failure line for the writes the helper covers (EDGE14-11, SEL14-07), and one shape for the empty states (EDGE14-12).

Before numbers come from the base code (ff4a7fd), after numbers from this branch, both on :3146 against my project "Fix r14 edge". Scripts: `.qa-tmp/s/` (the audit's `z06`, `z07`, `z01`, `z03`, and my `z08-queue-keep.mjs`, `z09-account-signin.mjs`); logs and screenshots: `.qa-tmp/fix/`, copied to `/mnt/project-files/interaction-loop/round-14/img/`.

## Findings

| Id | Result | Before → after | Screenshots |
|---|---|---|---|
| EDGE14-01 (blocking) | fixed | **5xx** (`z06 5xx` before, `z08 5xx` after): before, the edit queued twice, the second PATCH made from the first's text; 25 s after the server came back the database still had the old words and the queue had stopped trying (the audit saw it dropped after the 5th error). After: one queued PATCH; through 7 page loads of 503 it was tried 21 times by time (2 s → 30 s backoff), never dropped; the local draft stayed with the words, made from the server's text; the row read Not saved (⚠). Server back: the words landed once, no marker lines, draft cleared, queue empty, and a reload shows them. **409 account changed** (`z06 409` before, `z08 409` after): before, dropped at the first answer and the second PATCH landed as a no-op (LOST). After: kept, and landed on the next load (KEPT). **Account switch, client side** (`z08 account`, account cookie A → B → A): as B, 0 PATCHes sent, the pill counts nothing, the row does not draw A's words; back as A, the words land once (KEPT). **Account switch with sign-in on** (`z09`, a dev server on its own schema-only database `dissect_r14edge`, `test-login` readers 1 and 2): A edits offline and Done queues it; B signs in to the browser while A's tab is offline. Back online, A's frozen tab sends only its own words in A's name and the middleware answers `409 {code: "accountChanged"}` to each (nothing written); B's dashboard and B's own project send 0 writes for A's note in 37 s and through a reload, and draw none of A's words; A signs in again and the words land once (KEPT). | `EDGE14-01-before.png` (5xx), `EDGE14-01-409-before.png`, `EDGE14-01-after.png` (5xx after landing), `EDGE14-01-waiting-after.png` (Not saved while 503), `EDGE14-01-409-after.png`, `EDGE14-01-account-after.png`, `EDGE14-01-signin-A-tab-as-B.png`, `EDGE14-01-signin-B-project.png`, `EDGE14-01-signin-A-after.png` |
| EDGE14-02 | fixed | `z07`, the server answering 500 to the write. **Highlight:** before, "Internal error (test)" under the colors; notes 11 → 11 15 s after the server was back; the mark gone after a reload. After: the mark stays, the header reads Not saved and the pill "Syncing 1 change…"; notes 11 → 12 within 35 s; the mark is there after a reload. **Add to notes:** before, "Not saved" plus the raw line under Add to notes; 11 → 11. After: the toolbox closes, the note is drawn at the top of its section marked Not saved (⚠); 12 → 13. **Comment:** before, the raw line; comment in the database 0 after 15 s and after a reload (the words stayed in the box's draft). After: the comment is in the database (0 → 1), the box's draft cleared once it landed. | `EDGE14-02-before.png` (highlight), `EDGE14-02-add-before.png`, `EDGE14-02-comment-before.png`, `EDGE14-02-after.png`, `EDGE14-02-add-after.png`, `EDGE14-02-comment-after.png` |
| EDGE14-11 + SEL14-07 | fixed for the writes `api()` covers, and the fallback keys | One line, "Not saved. Try again." ("Not saved. Try again when you are online." offline), never a status code or the server's raw text; the status and the server's text go to the console ("Not saved: PATCH /api/… 500 boom"). A 4xx the route words for the reader still shows its words. A write that queues shows no line: the header's Not saved and the note's ⚠ say it, and it retries by itself. Calls that need a model keep their own words (the assistant's failure lines are package 2's). Keys reworded (en+zh): `reader.saveFailed`, `reader.annotationFailed`, `assistant.commentFailed`, `video.saveFailed`, `panes.titleSaveFailed`, `api.annotationNotSaved` → "Not saved. Try again."; `docs.saveFailed` → "Not saved" (the page editor retries by itself; its popup says which save failed). Wordings: 8 → 2 (the line, and its offline form). | covered by the EDGE14-02 after screenshots |
| EDGE14-12 | fixed in the dictionaries | One shape, "No <things> yet. <one way to make one>.": notes "No notes yet." → "No notes yet. Select text and press Add to notes."; the annotations full page now says what the tab says ("…highlight, comment, or link."); the graph "Attach at least two documents — …" → "Add at least two documents. The graph draws the links between them."; the folder "No documents in this folder" → "No documents in this folder yet."; the page editor's "Show the outline"/"Hide the outline" → "Show the contents"/"Hide the contents", "Headings you add to the document will appear here." → "No contents yet. Headings you add show here." (en+zh). | text only; no screenshot (keys) |

Rule-zero re-runs after the change (`.qa-tmp/fix/*-after.log`): z01 a–f (reload 150 ms after typing, 500s while typing, offline then online, tab closed offline, slow network, failed save then server back), z03 add/comment/assistant (KEPT ×3), z08 5xx/409/account (KEPT ×3), z09 (KEPT). Results are in the table under Checks.

**origin/main:** the same loss happens there. `git show origin/main:src/lib/offline/queue.ts`: `outcome()` drops any 4xx but 401 and a 5xx on its 5th try (`MAX_ATTEMPTS = 5`), and `use-note-draft.ts` confirms (clears) the draft when the save is queued.

## Files

- `src/lib/offline/queue.ts`: drops only a stale answer (4xx); a 5xx, 408, 429, network failure, 401, and the middleware's 409 `accountChanged` keep the record, and every kept try reschedules the drain (2 s → 30 s), with no cap (`MAX_ATTEMPTS` is gone). Records are sent, counted, drawn, and asked about only for the account signed in now (`queuedForThisAccount`, the account cookie); a write is tagged `tabAccount() ?? cookie`. A write identical to one that waits for its path is queued once. The queue mirrors the note texts it holds into the drafts' hold (`holdQueuedNoteDrafts`) and confirms a draft with the server's answered text once the record left the queue. `queueWrite(…, attempts)` and `isServerError()` for `api()`. On a drain, `settleQueuedWrites()`.
- `src/lib/note-drafts.ts`: a draft names its account and a page of another account neither reads nor sends it; `confirmNoteDraft` leaves a draft whose text the queue still holds (`holdNoteDraft`, `setHeldNoteDrafts`).
- `src/components/outline/use-note-draft.ts`: a queued save keeps the draft, made from the server's text (`confirmedRef`) and naming the queued text as `sent`; the save that repeats a queued text queues nothing (one PATCH per Done); a save queued with the browser online reads Not saved in the editor.
- `src/lib/offline/queued-notes.ts`: only the signed-in account's queued note writes are drawn; a note whose queued write the server answered with an error is marked Not saved (`unsaved`), not Waiting to sync.
- `src/middleware.ts`: the account-changed 409 carries `code: "accountChanged"`.
- `src/lib/api.ts`: a queueable write the server answers with 5xx/408/429 queues (Unitos Premium) and answers `{queued, serverError}`; `init.queue` lets a caller that takes a queued answer opt in (the toolbox's highlight and comment); one failure line (`common.notSaved`, `common.offline`), the status and raw text to the console; a reader-worded 4xx keeps its words; calls that need a model keep theirs.
- `src/lib/save-state.ts`: a failure that queued reads Not saved until the queue drains (`endWrite(…, queued)`, `settleQueuedWrites`).
- `src/components/reader/reader-interactions.tsx` (one hunk, the highlight/comment write in `annotate`): the raw `fetch` becomes `api(…, { queue: true })`; the hand-made offline queue branch and its `answered` flag go (the helper does it); a server-error queue shows no toast (the header says Not saved). Imports trimmed.
- `src/lib/i18n/dict/common.ts`: `notSaved` added, `offline` reworded, `offlineSyncingOne`/`offlineSyncing` lose "offline" (the pill also shows for a server-error queue online) (en+zh).
- `src/lib/i18n/dict/{reader,assistant,docs,video,panes,api,outline,panels,docsPage}.ts`: the failure and empty-state keys above, en+zh, key lines only.
- `SPEC.md`: §6 (note drafts: a queued save is not a confirmation; drafts name their account), §17 (Sync: what drops and what retries, accounts, server-error queueing, the failure line; queued notes marked Not saved; the pill's words), §29 (Show the contents; the page status words).

## Decisions

- "Stale" = any 4xx the route answers other than 401, 408, 429, and the middleware's 409 `accountChanged` (a 400, 403, 404, 409 conflict). Those can never land, and keeping them would block every later record behind them. A note edit dropped this way is still not lost: its local draft is kept until the server confirms the same text, so the card keeps the words marked Not saved and the notes' 20 s retry tries them again.
- No cap on 5xx retries: a record the server always fails holds the records behind it (they are kept, not lost). Rule zero 6 wins over queue liveness.
- The current account is the account cookie (what the middleware checks), not the tab's latch: a frozen tab of A after B signed in holds A's records instead of sending them into a 409. With sign-in off there is no cookie and nothing is filtered.
- Offline, a queued note still reads Waiting to sync; it reads Not saved once the server answered its write with an error (or the write queued with the browser online). Offline is not a failure the reader can act on.
- The drafts' hold is a mirror of the queue, set again from IndexedDB whenever a record leaves; a hold added during a read is kept, so a race never lets a queued text's draft be cleared.
- The use-outline retry (notes package) and the queue may both send the same words while the server is back; every such write is a merge from a base, so the second is a no-op and the draft stays until the server's answered text matches it.
- `docs.saveFailed` became "Not saved" for both page editor failures (round 13 had "Couldn't save your changes" for the document's own save); the popup body still says which save failed.
- I did not change `common.requestFailed`/`requestFailedStatus`: they are used by ~110 non-write paths (loads, AI calls) where "Not saved" would be wrong.

## Needs (files I do not own)

- Package 3 (notes), `src/components/outline/use-outline.ts`: the 20 s retry and the load replay read the note's text from the tree with the queue's overlay on it, so a note whose text is queued gets a retry made from the queued text (a harmless no-op merge today, because the draft stays). Read the server's text (the tree before `overlayQueuedNotes`) there. Also `confirmNoteDraft` after a queued answer (lines 485, 533) is now refused by the hold; no change needed, but `if (!saved.queued)` there would say so.
- Package 3: hide the Notes tab's "Notes 0" count when the list is empty, and the empty tray's lone full-page icon row (EDGE14-12, components).
- Package 1 (select): the unlabeled red ⚠ (the error log) still appears for a failure that does not queue; SEL14-07 says the code goes only to the log — the log keeps it, but the reader's line is now "Not saved. Try again." `reader.annotationFailedStatus` is no longer used by `annotate`.
- Package 5 (page): `docsPage.tabsOutlines` "Outline" is a second word for contents if it labels the same panel.
- Package 2 (tools): the assistant's failure lines still show the server's text or "Request failed (500)" (I left AI calls alone).
- `src/lib/notes/save-text.ts` (package 3): `SavedText` could carry `serverError` so the editor tells "server refused" from "offline" without reading `navigator.onLine`.

## Checks
- `npx tsc --noEmit` (dev server stopped): clean. `eslint` on the changed package files (`src/lib/offline/queue.ts`, `queued-notes.ts`, `src/lib/note-drafts.ts`, `src/lib/api.ts`, `src/lib/save-state.ts`, `src/middleware.ts`, `src/components/outline/use-note-draft.ts`, `src/lib/i18n/dict/common.ts`) and on `src/components/reader/reader-interactions.tsx`: clean.
- Rule-zero scripts after the change, against the database:

| Script | Case | Result |
|---|---|---|
| z01 a | reload 150 ms after typing | words in the database after the reload |
| z01 b | 500s while typing, then Done, then the server back | words landed at +12 s, once; kept after a reload; drafts cleared |
| z01 c | offline, then online | words landed by +35 s |
| z01 d | tab closed offline, a new tab online | words landed by +12 s |
| z01 e | slow network, reload | words landed by +6 s |
| z01 f | failed save, then the server back, editor reopened | words landed; page reads All changes saved |
| z03 add / comment / assistant | typed words, reload | KEPT ×3 |
| z04 interleave | two tabs, two paragraphs | all four words, 0 markers |
| z04 same | two tabs, the same paragraph | all three words kept, 1 marker block (both versions shown, the reader keeps one; the merge's behaviour, unchanged here) |
| z05 | two tabs, one blank document | both lines once (the first run lost the race to a dev-server memory restart while the route compiled, and closed the browser 12 s later; reruns 2/2 both lines; the page editor's save does not use `api()` or the queue) |
| s13 | note deleted in another tab while typing | 1 row, 0 markers, all five words |
| s18 | Escape keeps the words | kept, also after a reload |
| z08 5xx / 409 / account | queued note edit | KEPT ×3; one queued record per edit (after `d5981a2`) |
| z09 | account switch with sign-in on | KEPT, 0 writes sent as B |
| z07 highlight / add / comment | online 500 | queued and landed: mark kept after a reload, notes +1, comment 0 → 1 |

- Commits: `db09080` (EDGE14-01, EDGE14-02: the queue keeps every write short of stale, accounts, drafts held while queued, server-error queueing), `fe08a56` (EDGE14-11 + SEL14-07, EDGE14-12: one failure line, empty-state keys), `d5981a2` (one queued record per note edit; SPEC §17 timer line).
- Data I made: the project "Fix r14 edge" in `dissect` (removed through the app by `.qa-tmp/s/cleanup.mjs`: its six documents, held by no other project, then the project) and the database `dissect_r14edge` (mine, dropped). Nothing else was written or removed.
