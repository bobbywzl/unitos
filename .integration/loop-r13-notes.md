# loop/r13-notes

**Intent:** fix round 13's notes package (PACKAGES.md section 3): NOTE13-01, 02, 03 first (blocking, rule zero), then the other NOTE13 findings, EDGE13-04, EDGE13-13, the notes parts of EDGE13-10, and EDGE13-05 in the notes' own files.

Screenshots: `/home/user/wt/r13-notes/.qa-tmp/fix/<id>-before.png` / `-after*.png`. Scripts: `/home/user/wt/r13-notes/.qa-tmp/notes/`. Counts were taken on a clean project built like the audit's ("Fix r13 notes counts": 3 sections, 11 notes, 3 pending, one Markdown import), with the audit's own `01-counts.mjs` and `02-fullpage.mjs`.

## Findings

### Blocking

- **NOTE13-01 fixed.** The board's composer and the full page's composer are one composer per section (`use-note-compose.ts`: a module store per section id, read with `useSyncExternalStore`; the 900 ms save timer runs whichever surface is mounted). The page behind an open board is `inert`.
  Before (audit and my repro): board closed with words typed → 0 rows; + Note opened empty over the draft; after reload 0 rows. After: the words are on screen in the full page's composer, the note is created once (1 row), Escape saves, after reload 1 row. `NOTE13-01-before.png`, `-before-2-new-composer.png`, `-after.png`, `-after-reload.png`.
- **NOTE13-02 fixed.** An open editor's saves send `keepSources: true`, so no source is pruned mid-sitting; the editor's close sends `pruneSourcesFrom` (the text it opened on) once, and the route prunes the sources of the quotes that sitting removed and did not bring back. Route: `src/app/api/notes/[noteId]/route.ts`. Pagehide flushes the same way.
  Before: sources 1 → 0 → 0 (quote deleted, brought back by Ctrl+Z, reload). After: Ctrl+Z run 1/1/1/1 and the source line after reload; Cancel run 1/1/1; Escape with the quote still deleted → 0 (the intended prune). `NOTE13-02-before.png`, `-after.png`, `-after-ctrlz-reload.png`, `-after-cancel-reload.png`.
- **NOTE13-03 fixed, no migration.** Section Delete keeps the section and every note in it (side chats, sources, edits, replies through the existing kept-note shape) in a `SECTION_REMOVE` NotebookEvent's `meta` Json, then deletes, in one transaction. The Undo pill (Section deleted · Undo) and History's Restore both run `POST /api/notebooks/:id/history/:eventId`, which rebuilds the section at its place with the same ids. The browser confirm is gone now that Undo exists. Delete and Rename sit beside the title: hidden at rest with a mouse, shown on hover and focus, shown at rest on touch (EDGE13-05).
  Before: notes 2 → 0, no Undo, History had no Restore. After: Delete → 0 notes, pill shown; event kept 2 notes; Undo → notes 2, sources 1, edits 1, section 1, same order, same after reload; History Restore on another deleted section → section 0 → 1, notes 2, sources 1, `restoredAt` set. `NOTE13-03-before.png`, `-before-history.png`, `-after-header-hover.png`, `-after-pill.png`, `-after-undo-reload.png`, `-after-history.png`.

### Friction and polish

- **NOTE13-04 fixed.** A reject on the board shows the Undo pill over the board; the full page's own reject pill became the shared pill (one pill everywhere). Before: pill on top = false; after: true. `NOTE13-04-before.png`, `-after.png`.
- **NOTE13-05 fixed** with NOTE13-01 (one composer per section, one create).
- **NOTE13-06 fixed.** The board is `role="dialog" aria-modal` and takes the focus on open; Tabs 1–3 land on its Note, Command, Close; Escape returns the focus to the section's title. Before: the first Tab went to the page behind. `NOTE13-06-before.png`, `-after.png`.
- **NOTE13-07 fixed.** A closed composer gives the focus to its section's + Note; collapse keeps the focus on the note; Accept, Reject, Delete hand it to the next note; Ctrl/⌘+Z outside a text box presses the pill's Undo (the pill's tooltips name the key). Run `k5-after.mjs`: composer Escape → focus on + Note, saved 1; Delete → focus on the next row; Ctrl+Z → note back, still in the db after 13 s. `NOTE13-07-after.png`.
- **NOTE13-08 fixed.** Alt+↑ / Alt+↓ on a note move it one place, and across into the section above or below at the ends (the existing reorder and move routes); the hold tooltip names the keys. ↑ / ↓ on a note's control move to the same control on the next note. Run: Alt+↓ swapped the first two notes in the db.
- **NOTE13-09 fixed (no visual change).** `touch-hit.ts`: on a coarse pointer a transparent 6px band above and below. Hit heights measured with `elementFromPoint` on a coarse pointer (`hit.mjs`): Accept 20 → 32, Reject 24 → 36, Copy / History / Delete 17 → 31, the id 16 → 28, Accept all 17 → 29, the select circle 18 → 29; ✕ stands 4px further from Accept on touch. Before = the drawn box (the audit's 390 log). `NOTE13-09-before.png`, `-after-section.png`.
- **NOTE13-10 not fixed.** One editor bar for four surfaces is a larger rework of `note-editor.tsx` and `floating-note-editor.tsx`; left for its own round.
- **NOTE13-11 fixed.** The full page's head is the tray's queue head: "PENDING · 3" and Accept all, in place of the pending pill and the key hint. Keys stay; Accept all's tooltip names them (⏎ accept · ⌫ reject · e edit · g source). Counts (`02-fullpage.mjs`, 1440): full page in view 43 → 44 (Accept all added; the pill and the hint were not controls, so they did not count), Accept all now one press on the page (before: none on the page). Accept all run: pending 3 → 0 in the db, after reload no queue head. `NOTE13-11-before.png`, `-after.png`.
- **NOTE13-12 not fixed.** One ⋯ menu for an annotation's actions on the card, the tab, and the full page touches `src/components/docs/layer/comment-card.tsx` (package 5's) and the reader's comment card; left for the lead to place.
- **NOTE13-13 fixed (first part).** Annotation rows say Expand / Collapse annotation, Copy annotation ID, "Annotation {id} · click to copy"; the Annotations tab's Expand all / Collapse all say "every annotation". Run `07-annotations.mjs nomake`: tab and full page read "Expand annotation", "Copy annotation ID". Not fixed: "Output was not valid JSON" comes from `src/lib/derive/json-call.ts` (not this package).
- **NOTE13-14 fixed.** The pencil reads Edit; the e key is named in Accept all's tooltip, where it works. `01-counts.mjs`: every "Edit (e)" → "Edit".
- **NOTE13-15 half fixed.** Command draws its glyph alone everywhere (full page 87×25 → 33×21, board 87×25 → 33×21). Not fixed: the figure suggestion's ✓ (package 2's `figure-suggestion.tsx`). `NOTE13-15-before.png`.
- **NOTE13-16 fixed.** A search that finds nothing shows its own line alone. Before: "No notes yet." and "No notes match …"; after: `[ 'No notes match “zzznomatch”.' ]`. `NOTE13-16-after.png`.
- **NOTE13-17 not fixed.** Keeping a note being edited in the list while a search hides it needs the grouping code to carry an "editing" exception through every grouping; the words were already kept (audit: rows holding it 1). Left open.
- **NOTE13-18 not fixed.** The Feedback pill belongs to package 4 (`feedback-button.tsx`).
- **EDGE13-04 fixed (notes part).** Failed note saves are tried again while the page stays open: on `online`, when the tab is shown, and every 20 s, for every local draft that holds words its note lacks and that no editor holds open (`use-outline.ts`). The reopened editor reads Not saved while the server still lacks the words. Run `e04.mjs` (PATCH answers 500, then back): before (audit) +10/+30/+60 s db old, reopened editor said Saved; after: reopened while failing "Not saved", server back → db has the words by +15 s, draft cleared, row error gone, same after reload; the reload replay alone also saves them (`RELOAD=1`). `EDGE13-04-before.png`, `-after-reopened.png`, `-after.png`. Not fixed: the page editor's status blaming the document (`docs-editor.tsx`, package 5).
- **EDGE13-05 fixed in my files.** Section Rename and Delete show at rest on touch (`pointer-coarse:opacity-100`). Phone run (`phone-head.mjs`): section header at rest = drag, title, Rename 36×36, Delete 36×36, Note, Command (before: Rename and Delete opacity 0). `EDGE13-05-before.png`, `-after.png`.
- **EDGE13-10 notes parts fixed.** The view menu takes ↑ ↓ Home End and puts the focus on its checked row on open; Escape returns the focus to its button (k2: arrows moved, before stuck; Escape → button). Notes list: ↑ / ↓ between notes. Edit (e) → Edit. Not fixed: "the first Tab lands on the pending card" (I could not find what puts it there in the notes' code; may be the rail's order, package 4). `EDGE13-10-before.png`, `-after.png`.
- **EDGE13-13 fixed** with NOTE13-11: no key hint on the page at all (phone run: key hint on page false). `EDGE13-13-before.png`, `-after.png`.

## Files

- `src/components/outline/use-note-compose.ts`: one composer session per section, shared by the full page and the board (NOTE13-01, 05).
- `src/components/outline/outline.tsx`: inert page behind the board; tray-like queue head with Accept all; one Undo pill for rejects; empty search line (NOTE13-01, 04, 11, 16).
- `src/app/api/notes/[noteId]/route.ts`, `src/lib/notes/save-text.ts`, `src/components/outline/use-note-draft.ts`: `keepSources` / `pruneSourcesFrom` (NOTE13-02).
- `src/app/api/sections/[sectionId]/route.ts`, `src/lib/notes/removed.ts`: keep a deleted section in a `SECTION_REMOVE` event; `restoreSection` (NOTE13-03).
- `src/app/api/notebooks/[notebookId]/history/[eventId]/route.ts`, `src/lib/history/list.ts`: **package 4's files** — Restore accepts `SECTION_REMOVE`; the list marks it restorable when `meta.kept` is there (NOTE13-03).
- `src/components/outline/use-outline.ts`: section delete Undo state; failed-save retry; `nudgeNote` (NOTE13-03, 08, EDGE13-04).
- `src/components/outline/merge-undo.tsx`: "Section deleted · Undo"; a reject's Undo; Ctrl/⌘+Z (NOTE13-03, 04, 07).
- `src/components/outline/section-item.tsx`: Rename + Delete beside the title, no confirm, shown at rest on touch; Command glyph (NOTE13-03, EDGE13-05, NOTE13-15).
- `src/components/outline/section-board.tsx`: dialog focus in and out; reject pill; Command glyph (NOTE13-04, 06).
- `src/components/outline/note-card.tsx`: focus moves, ↑ ↓, Alt+↑ ↓, touch hit areas (NOTE13-07, 08, 09).
- `src/components/outline/note-composer.tsx`: focus to + Note when it closes (NOTE13-07).
- `src/components/outline/note-groups.tsx`: view menu keys; one empty line; Command glyph (EDGE13-10, NOTE13-16, 15).
- `src/components/outline/touch-hit.ts` (new), `note-editor.tsx`, `notes-tray.tsx`, `section-action.ts`, `note-id.tsx`: touch hit areas (NOTE13-09); `note-id.tsx` also takes `annotation` (NOTE13-13); `note-editor.tsx` exports `useModKey`.
- `src/components/outline/voice-note.tsx`: comment only (Command glyph everywhere).
- `src/components/panels/annotation-card.tsx`, `src/components/collapsed-view-toggle.tsx`: annotation words (NOTE13-13). `collapsed-view-toggle.tsx` is shared by the tray and the Annotations tab (outside `outline/**`, small hunk).
- `src/lib/i18n/dict/outline.ts`: new keys (en + zh): `sectionDeleted`, `undoSectionDeleteTitle`, `sectionUndoFailed`, `copyAnnotationId`, `annotationIdTitle`, `collapseAnnotation`, `expandAnnotation`, `expandAllAnnotationsTitle`, `collapseAllAnnotationsTitle`; changed: `editTitle`, `acceptAllTitle`, `holdToDrag`, `holdToDragPage`; removed (unused now): `pageKeyHint`, `pendingCount`, `confirmDeleteSection`.
- `src/lib/i18n/dict/api.ts`: **outside my dict** — new key `historySectionRestored` (en + zh), used by the history route's 409.
- `SPEC.md` §6 (and the History line): one composer per section; sources pruned at editor close; section Delete with Undo and Restore; `SECTION_REMOVE` kept; board focus and reject pill; Ctrl+Z on the pill; failed-save retry; the full page's queue head, keys, arrows and Alt+arrows, focus moves; touch hit areas; Command glyph everywhere; the empty search line.

## Decisions

- NOTE13-03 keeps a deleted section in `NotebookEvent.meta` (Json, already there) instead of a soft-delete column: no migration, and History's existing Restore path does the work. The 12 s Undo pill and History's Restore are the same request.
- No browser confirm on section Delete: the Undo replaces it (PACKAGES: keep the confirm until the Undo exists).
- NOTE13-02: prune at the editor's close, not per save, so a quote removed and brought back in one sitting never loses its source; a quote removed and left out still loses it when the editor closes.
- The retry (EDGE13-04) reads the local drafts, not an in-memory flag: an editor's failed Done leaves its words only in the draft. A draft younger than 5 s is skipped, so a save still on its way is not doubled; a doubled save is harmless anyway (the base makes it a no-op merge).
- The full page's Accept all is new on the page, but it takes the place of two things (the pending pill and the key hint), as PACKAGES allows. Accept all shows only with 2 or more pending notes, as in the tray.
- The touch hit band is vertical only (`-inset-y-1.5`), so buttons side by side never steal each other's presses.
- ↑ / ↓ move between notes only from a note's control (a button), never from inside an editor or the search.

## Needs (for the lead)

- Merge with package 4: `src/app/api/notebooks/[notebookId]/history/[eventId]/route.ts` and `src/lib/history/list.ts` gained the `SECTION_REMOVE` branch. `src/components/collab/history-control.tsx`'s Restore tooltip ("Put the note back in its section…") should read for a section on `SECTION_REMOVE` rows (`panes.historyRestoreTitle` is package 4's key).
- `src/lib/i18n/dict/api.ts`: one new key `historySectionRestored`.
- Package 4's `escape-layers.ts` focus trap should cover the board (`role="dialog" aria-modal` in `section-board.tsx`); the board takes and returns its focus on its own today.
- Not done here, owned elsewhere: NOTE13-18 (Feedback pill, package 4); NOTE13-15 figure suggestion's ✓ (package 2); "Output was not valid JSON" wording (`src/lib/derive/json-call.ts`); EDGE13-04's page editor status (`docs-editor.tsx`, package 5); NOTE13-12 needs `comment-card.tsx` (package 5).
- Left open: NOTE13-10 (one editor bar), NOTE13-17 (editor kept through a search), EDGE13-10 first Tab.
- Test data left in the shared database, all mine: projects "Fix r13 notes" (`cmuz2vmhq00007duyqd9mcii2`, with a block document `cmuz39oze00007d5sp0w319ay` copied in by SQL for the block-reader runs) and "Fix r13 notes counts" (`cmuz5w49l000g7d6cqxgenmyv`). Delete them from the dashboard when the round is merged.
- The audit's area scripts `04-tasks.mjs` and `07-annotations.mjs` (make step) stop on their own selectors against my projects' documents (paragraph text not found), not on an app error; the `nomake` count step of `07` passes. The other runs listed above pass.
