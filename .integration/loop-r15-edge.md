# loop/r15-edge: saves that cross, the offline queue, queued deletes, the lost-edit line

**Intent:** fix round 15's edge package. EDGE15-01 is blocking: each note save sends the editor's text at send time, rebased on the merged text, and Done waits for the save in flight. EDGE15-02: two writers in one note, with no nested markers and no doubled words. EDGE15-03, EDGE15-04, NOTE15-06 and SEL15-08: one sender per edit, a refused write lets later writes through, and the header says one thing. EDGE15-05: Undo for a queued delete. EDGE15-09 and the note-save half of EDGE15-13: one line when the account can no longer edit.

Before numbers come from the base code (6385f7f) and after numbers from this branch. Both ran on :3146 against my project "Fix r15 edge" (database `dissect`, sign-in off). The two-account runs used a copy of that database, `dissect_r15fixedge`, with sign-in on and test readers 2 and 3. Scripts are the audit's, pointed at :3146: `.qa-tmp/fix/` (`z04c-slow-server.mjs`, `sa01-shared.mjs`, `q01-retry.mjs`, `d01-delete-reload.mjs`, `z01`, `z04`, `z06`, `z07`). I added two `d01` cases, `hlundo` and `hl500undo`: press Undo while the delete waits in the queue. Logs are in `.qa-tmp/fix/*-before.log` and `*-after*.log`. Screenshots are in `/mnt/project-files/interaction-loop/round-15/img/`.

The machine ran at load 15 to 26 with five other dev servers. Many runs ended on a crashed browser tab or a killed server, and `retry.sh` ran them again. Only runs that finished are counted below. A run counts as valid only when both editors were open (the logs show `"editing":true`).

## Findings

| Id | Result | Before → after | Screenshots |
|---|---|---|---|
| EDGE15-01 (blocking) | fixed | **`z04c-slow-server.mjs`** (two tabs, every PATCH held 0.75–2.25 s). Before: the audit had 6 of 6 runs LOST. My reruns on base had 2 of 2 finished runs LOST: `b1` kept only alphaA; `h1` kept `{"alphaA":1,"betaB":0,"gammaA":1,"deltaB":0}`. In `z04c-h1-requests.log`, A's Done sends the text it captured, without betaB and deltaB, over a base that already held them. After: 6 of 6 valid runs KEPT (`a2`–`a7`, `{"alphaA":1,"betaB":1,"gammaA":1,"deltaB":1,"markers":0}`), and the text is the same in the database after B's reload. Run `a1` does not count: A's editor never opened, so alphaA and gammaA were never typed. **`sa01-shared.mjs slow`** (two accounts, one note, slow server). Before: LOST, 0 of 4 words. After: 2 of 2 runs KEPT (`"Shared slow… base line editorB editorD\n\nSecond paragraph stays. ownerA ownerC"`), the same in the database after the editor's reload, with no markers. | `EDGE15-01-before.png`, `EDGE15-01-before-page.png`, `EDGE15-01-after.png` (B after reload), `EDGE15-01-shared-after.png` |
| EDGE15-02 | fixed | **`sa01-shared.mjs same`** (owner and editor each type three words into one note, alternating, then both press Done). Before: `owner0:0 owner1:0 owner2:0 editor0:1 editor1:1 editor2:1`; the owner's words were lost. The audit also saw nested "Changed in two places" blocks. After: 2 of 2 runs keep every word once: `owner0:1 owner1:1 owner2:1 editor0:1 editor1:1 editor2:1 markers 0`, giving `"Shared same…: the owner wrote this. editor0 editor1 editor2 owner0 owner1 owner2"`. The request logs (`sa01-same-requests-after3.log`) show each 409 merged and the editor's next save carrying the words it typed meanwhile. Unit cases (`npx tsx`) also pass: edits to different words of one line merge with no block; insertions at the same point keep mine first; the same replacement on both sides counts once; there is never a block inside a block; a stale retry adds no doubled words; Chinese works. | `EDGE15-02-before.png`, `EDGE15-02-after.png` |
| EDGE15-03 | fixed | **`q01-retry.mjs poison`** (one note's PATCH answers 500 forever; offline: edit it, edit a second note, make a highlight). Before at +10 s: the highlight had not landed (notes 29 → 29); the header read "Syncing 3 changes… / Not saved" (the audit saw the same through a reload). After at +10 s: the highlight landed (41 → 42) and the second note landed. The header reads "Syncing 1 change…" alone at +10, +40 and +70 s, and after a reload. The refused record is kept, not dropped (rule zero): it is tried again on the shared timer. | `EDGE15-03-before.png` (the audit's `q01-poison.png`), `EDGE15-03-after.png` |
| EDGE15-04 + NOTE15-06 | fixed | **`q01-retry.mjs spam`** (one offline note edit, two tabs open, the server answers 503 for 150 s). Before (audit): 48 requests (A 23, B 25) in pairs, and tab A ran 23 long tasks. Before (my rerun on base): 50 requests (A 25, B 25), in pairs (A at 21,21 / 41,41 / 61,61,61 s…), and the header read "Syncing 1 change… / Not saved" the whole time. After: 13 requests in 150 s (A 7, B 6). After the first tries there is one try every 15 s for the whole browser, alternating between the tabs (B 17, B 32, A 47, A 62, B 77 …). Tab A ran 4 long tasks (398 ms in all, max 141 ms). The header reads "Syncing 1 change…" alone. 35 s after the server came back the words were in the database once, the queue was empty, and both tabs read Saved. | `EDGE15-04-before.png`, `EDGE15-04-after.png`, `NOTE15-06-before.png`, `NOTE15-06-after.png` (server back) |
| SEL15-08 | fixed | Header while the queue holds writes. Before (`d01 hl500`): "Syncing 1 change…" and "Not saved" at once. After: "Syncing 1 change…" alone (`hl500`, `hl500undo`, `poison`, `spam`). A note card keeps its own Not saved mark (notes package), and Saving… still shows while a write is on its way. | `SEL15-08-before.png`, `SEL15-08-after.png` |
| EDGE15-05 | fixed | **`d01-delete-reload.mjs hl500`**. Before: no pill (`pill []`), history events 0, one DELETE in the queue. After: "Highlight deleted Undo ✕" shows, and the delete lands once the server is back (`db no row`, queue empty). **`hlundo`** (offline): the pill shows. Undo takes the queued DELETE out (queue `[]`) and the mark comes back (marks 0 → 1). Back online +15 s the row is still there (`live … sources=1`), with 0 history events, and after a reload the mark is there. **`hl500undo`**: the same, and the header reads Saved after Undo. **`hloffline`** without Undo: the pill shows offline, and the delete lands online (history events 1). While fixing this I found that, offline, the trash's `router.refresh()` turned into a full page load: the page went to the browser's offline page and the pill went with it. Those callers now use `refreshWhenOnline`. | `EDGE15-05-before.png`, `EDGE15-05-after.png` (offline, the pill up) |
| EDGE15-09 | fixed (the words-kept line) | **`sa01-shared.mjs kick`** (the owner removes the editor mid-edit). Before: after Done the row read "Project not found" and the words sat unseen in the draft. After: the row reads "Not saved: you can no longer edit this project. Your words are kept in this browser." The draft keeps the words. Once the owner adds the editor back, the words land within 25 s (`db … kick-before kick-after-removal`). A demoted editor's 403 ("You can view this project, not change it.") maps to the same line. I did not get a finished `demote` run after the change: every try crashed the browser. After a reload, the words are still drawn only from the draft; see Needs. | `EDGE15-09-before.png` (the audit's `sa01-demote-reload.png`), `EDGE15-09-after.png` |
| EDGE15-13 (note-save half) | fixed | The raw "Project not found" on a refused note save is gone (see EDGE15-09). The status and the server's text go to the console. Collapse's half belongs to package 2. | `EDGE15-13-before.png`, `EDGE15-13-after.png` |

## Files

- `src/components/outline/use-note-draft.ts`: when a save leaves the chain, it sends the editor's words as they stand then. If an earlier save came back merged, the words are rebased with `reconcileNoteText(from the text in flight, onto the merged text)`. The merged text is set with `flushSync`, so it is painted before the next key. Done waits for the chain and sends the editor's words. The editor stays registered until its saves settle, so the outline's 20 s retry does not send an older copy beside a closed editor's save. `confirmNoteDraft` runs once the server holds the words.
- `src/lib/note-editable.ts` (no package owns it): `keptOffset(before, after, at)` keeps the caret on its words when the merged text replaces the editor's text. `setText` uses it when the editor has focus.
- `src/lib/notes/conflict.ts`: a word-level pass (`mergeWords`) runs before the marker block. Edits to different words of one line merge. An identical change counts once. When one insertion holds the other, the longer run is kept, so a stale retry adds no doubled words. A block never goes inside a block (`both()` nesting guard).
- `src/lib/offline/queue.ts`:
  - The drain walks every record. A record that gets a retry answer blocks only the ids it names (path ids and the body's ids), and the drain moves on to the rest.
  - `waitsInQueue(path, body)`: a new write naming an id that still waits is queued behind it (`queueWrite(…, behind)`).
  - The retry timing (2, 4, 8, then every 15 s) is kept in localStorage (`unitos-offline-tried`) and shared by every tab. A timed try takes the lock only when it is free (`ifAvailable`). A server answer (`serverAnswered`, from api.ts) or a shown tab tries again at once.
  - `attempts` is set once.
  - `dropQueuedWrite(path, method)` removes this account's last matching record. When no write waits any more, it clears the header's Not saved (`forgetFailedPath`, `settleQueuedWrites`).
  - `landedDelete(path)` keeps the answer of a queued DELETE that landed, so Undo restores it from History.
- `src/lib/offline/queued-notes.ts`: the drawn state stays the same object when nothing drawn changed, so a failed retry re-renders nothing.
- `src/lib/api.ts`:
  - A queueable write whose ids wait in the queue goes into the queue behind them instead of being sent.
  - `serverAnswered()` runs on every ok answer.
  - `lostEdit()`: a 403 `api.viewingOnly` or a 404 `common.corpusNotFound` reads `common.notSavedNoEdit`, and the details go to the console.
- `src/lib/save-state.ts`: `forgetFailedPath(path)`.
- `src/components/save-indicator.tsx`: while the queue holds writes, Saved and Not saved hide; the offline pill says it. Saving… still shows.
- `src/lib/notes/undo-pill.ts` (notes package, one hunk in `deleteNoteWithUndo`): a queued delete posts the same pill. Undo drops the queued DELETE and puts the marks back. If the delete has already landed, Undo restores it from History, as online.
- `src/components/reader/reader-interactions.tsx` (`deleteWithPill`), `src/components/panels/annotations-panel.tsx` (`mutate`), `src/components/panels/annotations-full-page.tsx` (`deleteAnnotation`): one line each, `router.refresh()` → `refreshWhenOnline(router)` after the write. Offline, a refresh is a full page load.
- `src/lib/i18n/dict/common.ts`: `notSavedNoEdit` (en, zh).
- `SPEC.md`: the lines below.

## Decisions

- **The same point:** when both writers insert at the same point, mine goes first, then theirs. Either order keeps both, and mine first keeps the caret's writer reading their own words in place.
- **Word merge before the marker block:** two edits to different words of one line merge with no block. A block is left only for edits that overlap the same words.
- **The nesting guard:** if either side's text already holds a block, the other side's words go in as plain `**yours**`/`**other**` lines inside it. A block is never opened inside a block.
- **The 15 s ceiling (round 14 used 30 s):** a server that comes back is found within 15 s. Any answered request or a shown tab tries at once. One tab tries at a time, so the server sees about 4 requests a minute for the whole browser, however many tabs are open.
- **Queue behind instead of sending:** while an id waits in the queue, a later write to it waits behind it rather than racing it. This holds whether the later write comes from the editor, the outline's retry, a reply, or an annotation. Order is kept per id, not across the whole queue.
- **`attempts` is set once:** only the first try marks a record as tried. So a failed retry changes nothing that is drawn.
- **A refused write is kept:** a write the server always refuses (a 5xx) still stays in the queue and is tried on the timer (rule zero 6). It no longer blocks anything else.
- **Not fixed:** Cancel on a note editor reverts to the text the editor opened on. If another writer's words landed while it was open, they are reverted too. This was not asked for, and the History event keeps them.

## Needs (files I do not own, and the lead)

- Package 3 (notes), `src/components/outline/use-outline.ts`: after a reload, a viewer (or a removed editor added back) sees the server's text. Their kept words are in the local draft only. The row could draw the draft's words marked Not saved, with the same line (EDGE15-09 after a reload).
- Package 3: `src/lib/notes/undo-pill.ts` gets one hunk (the queued-delete branch of `deleteNoteWithUndo`).
- Package 1 (select) / reader owner: one line in `reader-interactions.tsx` `deleteWithPill`. Package 3 / panels: one line each in `annotations-panel.tsx` and `annotations-full-page.tsx`, plus their imports.
- `src/lib/note-editable.ts` (no package): `keptOffset` and the caret in `setText`.
- i18n: `common.notSavedNoEdit` (en, zh), new.
- SPEC.md lines changed:
  - 342: the undo-pill sentence for a queued delete.
  - 346 (§6): note auto-save, which covers the send-time words, the word merge, no block inside a block, the caret, and Done waiting.
  - 857 (§17): queued notes show, where the retry wait is now 2, 4, 8, then every 15 s, and at once on an answer or a shown tab.
  - 859 (§17): Sync, which covers the timing, the shared wait, one tab per try, blocking per id, `waitsInQueue`, and the lost-edit line.
  - 860 (§17): the save indicator hides Saved and Not saved while the queue holds writes.

## Checks

- `npx tsc --noEmit` (dev server stopped): clean. `eslint` on the 13 changed source files: clean.
- Commits are signed (`git cat-file commit HEAD | grep -c ^gpgsig` = 1 each). No migration, no `prisma generate`; nothing under `src/lib/parse/**` or `src/components/graph/**`.
- Rule-zero scripts after the change, against the database:

| Script | Case | Result |
|---|---|---|
| z01 a | reload 150 ms after typing | the words are in the database after the reload |
| z01 b | 500s while typing, then the server is back | the words land (+12 s) and survive a reload; the header reads "Syncing 1 change…" while failing |
| z01 c | offline typing and Done, then online | the words land in 10 s |
| z01 d | offline typing, tab closed, a new tab online | the words land in 12 s |
| z06 5xx | 503 through 5 loads, then back | KEPT, queue empty |
| z06 409 | the account changed once | KEPT |
| z04 | two tabs, interleaved | 4 of 4 words, no markers |
| z07 hl / comment / add / off | a 500 on each write, then back; offline | 67 → 68, 68 → 69 (comment in the database), 69 → 70, 70 → 72; the mark is there after a reload |
| z04c | slow server, two tabs | 6 of 6 KEPT |
| sa01 slow / same / kick | two accounts | KEPT 2/2, KEPT 2/2 with 6 of 6 words, the words land when the editor is back |
