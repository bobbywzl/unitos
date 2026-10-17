# loop/safety

**Intent:** fix the edge audit's data-safety findings E-01 to E-04 (and the tools audit's T1, the same cause as E-02) so no reader loses typed words.

## Findings

- **E-01 (blocking): fixed.** A save of a note's text names the text it was made from (`baseContent`); the note PATCH answers 409 with the stored text when the note changed since; the editor puts the two texts together (line-by-line three-way merge) and keeps every word: lines both sides changed differently are kept twice under marker lines, and the save state reads "Saved · both versions kept". Screenshots: `.qa-tmp/fix/E-01-before.png` (tab B saved over tab A: `base line B-words`, history one row), `.qa-tmp/fix/E-01-after.png` (both versions in the note and in its history row). Route check: `.qa-tmp/fix/route-check.log` (create twice with one id → one row; based save → 200; stale save → 409 with the current text; `onConflict: "keep"` → both texts; a save without a base → saves as before).
- **E-02 (blocking): fixed.** The Add to notes comment, the Comment box, and the assistant's box are toolbar drafts in localStorage, keyed by document, tool, and the selection's block and offsets; opening the same tool on the same words shows them; cleared only when the server confirms. Before: `.qa-tmp/fix/E-02-before.png`, `E-02-before-assistant.png` (the audit's run, `E-02-E-03-before.log`). After: `.qa-tmp/fix/after-e16-C-addnotes-after-reload.png`, `after-e16-E-comment-after-reload.png`, `after-e16-F-after-reload.png`; log `.qa-tmp/edge/out/e16b-after.log`, `e16f-after.log`.
- **T1 (tools audit, comment lost on Escape / a click / a new selection): fixed by the same store.** The per-popover `setCommentDraft("")` lines are gone. Before: `.qa-tmp/fix/T1-before-typed.png`, `T1-before.log`; after: `.qa-tmp/fix/t13-1440-after-comment-reopened.png`, `.qa-tmp/edge/out/t13b-after.log`.
- **E-03 (friction): fixed.** The composer's create carries an id chosen in the browser, written to its local draft before the create leaves; the restored composer adopts the note by that id and a create sent again answers with the note already made. Before: `.qa-tmp/fix/E-03-before.png` (db 2); after: `.qa-tmp/fix/after-e16-B-composer-duplicate.png`, `e16b-after.log` (`B … db 1`).
- **E-04 (friction): fixed.** A queued note create carries its id; the notes draw queued note writes from the IndexedDB queue, marked "Waiting to sync" (tooltip "Saved on this device · syncs when online"), until the queue drains. Before: `.qa-tmp/fix/E-04-before.png`, `E-04-before.log` (the tray kept 110 rows offline; the note showed only after the sync). After: `.qa-tmp/fix/E-04-after.png` (offline, the note is first in the tray, "Waiting to sync"), `.qa-tmp/fix/E-04-after-synced.png` (online, the same note id #h4d8t2, label gone), `.qa-tmp/fix/E-04-after.log` (`db 1` at +20 s, one row).

The before screenshots of E-02, E-03, E-04, and T1 are the audits' own runs of the same scripts on this code: my before runs on :3124 could not finish while the machine was out of memory (the psql checks inside the scripts took 30 minutes each, and the dev server was OOM-killed once). E-01's before is my own run on :3124.

Checks: `tsc --noEmit` exit 0; `eslint` exit 0 on every changed source file (reader-interactions.tsx included).

## Files

- `src/app/api/notes/[noteId]/route.ts` — `baseContent` and `onConflict` on PATCH: 409 with the stored text on a stale base; "keep" puts the texts together; the quote-source pruning reads the text actually saved.
- `src/app/api/notes/route.ts` — optional client-chosen `id` on POST; a create sent again answers with the note already made (same account and project, else 409); a concurrent duplicate (P2002) answers with the other one's note.
- `src/lib/notes/conflict.ts` (new) — `reconcileNoteText`, the line three-way merge with marker lines.
- `src/lib/notes/save-text.ts` (new) — `saveNoteText(noteId, content, base)`: PATCH with base, on 409 reconcile and resend (last try with "keep"); null base = old unbased write.
- `src/lib/notes/client-id.ts` (new) — `newNoteId()`, cuid-shaped.
- `src/lib/api.ts` — `ApiError` (status + body) instead of a bare Error for a refused call; `clientLang` exported; a queued note POST gets an `id` and returns `{queued, id}`; a queued note PATCH with a base gets `onConflict: "keep"`.
- `src/lib/note-drafts.ts` — note drafts keep `base` and `sent`; compose drafts keep `createId`; `noteDraftBase`.
- `src/lib/offline/queued-notes.ts` (new) — reads queued note writes from IndexedDB and overlays them on the tree, marked `queued`.
- `src/lib/types.ts` — `NoteView.queued?` (optional, additive).
- `src/components/outline/use-note-draft.ts` — saves go through `saveNoteText` one at a time with the editor's base; the editor takes the saved text after a conflict; keepalive flush sends base + "keep"; `openDraftSave` export; "both" save state.
- `src/components/outline/use-note-compose.ts` — create id in the draft before the create leaves; restore adopts by it; later saves based and chained; Save creates first when it can (offline: `addNote` with the id); Cancel deletes by the create id when the answer never came.
- `src/components/outline/use-outline.ts` — functions changed: the draft replay effect (replays with the draft's base through `saveNoteText`), `actions.addNote` (optional `id`), `actions.saveNote` (optional `base`; uses the open editor's save, else the tree's text as base), and the `scopedTree`/`pendingElsewhere` memos (read `shownTree` = tree + queued overlay from `useQueuedNoteWrites`). New imports only otherwise.
- `src/components/outline/note-card.tsx` — one line in the card header: the "Waiting to sync" label on a queued note (next to the editor's `SaveStateLabel`).
- `src/components/outline/save-state.tsx` — states "both" and "offline" ("Waiting to sync", tooltip "Saved on this device · syncs when online"; the long text hid the note's title).
- `src/lib/toolbar-drafts.ts` (new) — the toolbar draft store and `useToolbarDraft` / `useToolbarDraftRestore`.
- `src/components/reader/reader-interactions.tsx` — draft lines only: `commentDraft` from `useToolbarDraft`; the seven `setCommentDraft("")` lines on new popovers / document switch / annotate removed; clear after the annotation POST (and its offline queue); `addComment` from `useToolbarDraft`, cleared in `addedToNotes`; the assistant box writes its draft on change, restores it on open (`useToolbarDraftRestore`), clears it after the answer; a highlight takes a kept comment only while the comment box is open.
- `src/lib/i18n/dict/api.ts`, `src/lib/i18n/dict/outline.ts` — new keys (en, zh): `noteChanged`, `noteIdTaken`, `savedBoth`, `waitingSync`, `conflictOther`, `conflictYours`, `conflictEnd`.
- `SPEC.md` — §6 note auto-save (base, 409, merge, composer id), Toolbar drafts, §17 queued notes show.

## Decisions

- Version = the base text, not `updatedAt`: `updatedAt` moves on a gist write, a pin, or a reorder, which would raise false conflicts; the text moves only when the words do.
- On a conflict both texts stay in the note under plain marker lines, rather than a picker dialog: it costs the reader nothing to keep working, no click can drop a version, and the words reach the server at once. Lines only one side changed, or that both sides only added, merge with no markers.
- The merge runs in the editor after a 409 (so the editor shows it) and on the server only for writes that cannot read a 409 (offline queue, keepalive flush) — same pure function.
- History: no based save can replace unseen words any more, so the sitting row always holds every word (A's words are in the merged row). Unbased writes (old open tabs, the reader's annotation-card PATCHes) keep the old sitting rule.
- E-03 uses a client-chosen note id instead of a new `clientId` column: no migration; an id naming another account's note or another project's is refused.
- Toolbar drafts restore when the same tool opens on the same or overlapping words of the block; I did not reopen the toolbar by itself after a reload (that needs the placement code another worker owns).
- E-04 draws queued notes from the IndexedDB queue (survives an offline reload) rather than an in-memory optimistic insert; a note that just synced stays drawn up to 30 s until the refresh brings it.

## Needs (files I do not own)

- `src/components/reader/reader-interactions.tsx` annotation comment card saves (`api(`/api/notes/${card.noteId}`, "PATCH", { content })`, ~line 4880 and ~4911) send no base, so they still save over a change made elsewhere. They should use `saveNoteText(card.noteId, content, card.saved)`.
- The docked assistant chat card's follow-up box (`assistantChat.input`) is not a toolbar draft yet; the same `useToolbarDraft` would cover it.
- `src/lib/offline/queue.ts` still drops any 4xx; note writes are safe now (keep mode), but a 409 from any other route would drop.
