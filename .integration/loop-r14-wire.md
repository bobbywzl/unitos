# loop/r14-wire

**Intent:** Do round 14's leftovers: each package's Needs for another package (items 1–7), and the lead's items 8–12 from the verifiers, each its own signed commit with before/after proof.

Screenshots: `.qa-tmp/fix/WIRE-<n>-*.png` in this worktree, copied to `/mnt/project-files/interaction-loop/round-14/img/` (each item has `WIRE-<n>-before.png` and `WIRE-<n>-after.png`, plus the extras named below). Every number is from my dev server on :3147, a webpack dev build on a machine shared with the verifiers. Data: the project "Fix r14 wire", made through the app; at the end its 18 documents went through `DELETE /api/documents/:id` and the project through `DELETE /api/notebooks/:id` (0 rows left).

## Items

1. **NAV14-08, History's Restore (f0b58a1).** `history-control.tsx` hands the route's answer to `tellNoteBack` and shows the note; `refreshUntilRestored` and its wait are gone (a refresh runs only when the answer names no note).
   - Before: the note showed in the tray 7410 ms after Restore on a cold server, 1776 ms warm. After: 352–362 ms. The database holds the note once (1 row).
   - Shots: `WIRE-1-before.png`, `WIRE-1-after.png`.
2. **The finger hold's number (d561f83).** `tree-drag.ts` imports `TOUCH_HOLD_MS` from `lib/hold-drag.ts`; its own copy is gone.
   - Before and after alike: a 250 ms hold does not lift the row, a 380 ms hold does.
   - Shots: `WIRE-2-before.png`, `WIRE-2-after.png`.
3. **One Undo pill (bbbea6a).** `conversation-delete.ts` posts through `postUndoPill` with `outline.conversationDeleted`; the Explain (and Analyze, Visualize), Simplify, and conversation trashes in `reader-interactions.tsx` go through `deleteNoteWithUndo`.
   - Before: "Explanation removed", "Simplified removed", with no Undo. After: "Annotation deleted" and "Conversation deleted", each with Undo and ✕.
   - Database: each delete leaves 0 note rows and 1 NOTE_REMOVE event in History; the Explain note's Undo brings its row back (1).
   - Shots: `WIRE-3-before.png`, `WIRE-3-after.png`, `-before-explain`, `-before-simplify`, `-after-explain`, `-after-simplify`, `-after-conversation`.
4. **NAV14-07, the split from a prop (d56ce07).** `DocsEditor` and `DocsFrame` take `split`; `reader.tsx` passes it from `ReaderInteractions`. The DOM detection in `measure()` is gone.
   - Switched by the menu: before, 1 frame with the title row, and the toolbar jumping 160 → 124 px; after, 0 frames with the title row and one move instead of two (CLS 0.107 → 0.165 because the two moves now land in one frame).
   - Opened by its address: before, the title row in 162 of 162 frames of the load; after, 0 of 124. Back to Normal: the title row is there.
   - Shots: `WIRE-4-before.png`, `WIRE-4-after.png`, `-first-split-frame`, `-by-url-loading` (before and after).
5. **Settings' Feedback on a phone (acf4ce6).** Below sm the Settings header holds the Feedback icon (`FeedbackHeaderButton`, the existing dialog), and the floating pill hides there. `works.sendFeedback` (en, zh) was unused and is gone.
   - Before at 390: the pill at 281,744 over the plan's words. After: the icon at 328,32, no pill, and the form opens. At 1440: the pill shows, no header icon.
   - Shots: `WIRE-5-before.png`, `WIRE-5-after.png`, `WIRE-5-after-open.png`.
6. **Failure lines (9ab3748).** `api/derive` (Explain, Simplify, Analyze, Extract) and the suggest route word a failed model call with the assistant's `failureLine`; Extract's page reads a bare status with `noReason`; the assistant panel's list, conversation, attachments, and comment use `callFailure`/`callLine` (`components/assistant/failure.ts`) with "Not loaded. Try again." or "Not saved. Try again.". A non-500 answer with an error keeps the route's words. The sign-in deck's box reads "Tell the assistant what to do with the selected words…".
   - With a mock that answers every model call 401. Before: suggest `"The suggestions could not be written. The suggestions could not be written. The answer came back in a form Unitos could not read. Try again."`; Extract's stream `Extract failed. Invalid Authentication`; the Explain card `Invalid Authentication`; Extract's page under a 502 `Extract failed (502)`. After: each reads "No answer: the assistant had a problem. Try again."; the panel's list under a 500 with a Prisma message reads "Not loaded. Try again.".
   - i18n removed (en, zh): `api.deriveFailed`, `api.distillFailed`, `reader.distillFailedStatus`, `reader.deriveFailedStatus` (unused), `assistant.requestFailedStatus`, `assistant.commentFailed`. Added: `common.notLoaded`.
   - Shots: `WIRE-6-before.png` (Explain), `WIRE-6-after.png`, `-before-extract-502`, `-after-extract-502`, `-after-list`.
7. **Header and rail during a load (35f5190).** Save for offline's place stands empty until the browser's copy is known (`offlineOn` is null until then); Reader view draws only once the rail or the bar is found.
   - Frame by frame, 3 loads each of a block document and a blank document at 1440: before, History 1334 → 1286 on every load, and Reader view at 16,853 (the pane's bottom left) then 1396,342 (the rail). After: History at 1286 from the first frame; Reader view first draws at 1396,342. Block reader CLS 0.0001 → 0.
   - Shots: `WIRE-7-before.png`, `WIRE-7-after.png`, `-before-page`, `-after-page`.
8. **EDGE14-07, Notes by a key with a pending note (51491ad).** `focusWhenDrawn` takes a list of selectors; `showNotes`'s pending branch calls `intoPanel` with the pending note's Accept first.
   - Before: the focus stays on the rail's Notes. After: it goes to the pending note's Accept; Escape returns to Notes; a mouse press leaves the focus on the button; with no pending note Enter goes to Search notes.
   - Shots: `WIRE-8-before.png`, `WIRE-8-after.png`.
9. **A section rename the server does not save (0f6d437).** `section-item.tsx` keeps the typed title in the field marked Not saved (refused, failed, or queued offline) until the section's title changes; `renameSection` returns `{queued, serverError}`.
   - Before: the old title came back and the field closed; on a 500 the title never landed. After, refused: the field holds the typed title, marked Not saved, the database unchanged; a shorter title then lands. After a 500 and the server back: Enter lands it (1058 ms).
   - Shots: `WIRE-9-before.png`, `WIRE-9-after.png`, `-before-refused`, `-before-500`, `-after-refused`, `-after-500`.
10. **The notes full page composer (ae7a592).** After a failed save the composer tries again every 20 s and on `online`, creating or patching the one note, and closes once the server holds the words. Escape on the composer's buttons closes it as Escape in the text does.
    - Before: not landed after 54 s; Escape on Done did nothing. After: landed at +22.9 s (16.6 s after the server came back), 1 row, the composer closed, 1 row after a reload; Escape on Done closes and saves 1 row.
    - Shots: `WIRE-10-before.png`, `WIRE-10-after.png`, `-before-retry`, `-after-retry`, `-before-escape-done`, `-after-escape-done`.
11. **Keys typed while Blank document is made (eca90f8).** `lib/docs/early-keys.ts` keeps the printable keys from the press until the page editor takes the caret (Backspace takes one back); the editor inserts them at the page's start as typing.
    - `11-blank.mjs`, "Typed at once, then " typed right after the press, "after it stood." once the editor stands. Before (editor at 12.7 s): the early words were dropped, and each of the 4 spaces pressed Blank document again: 5 Untitled documents from one press; page, Block row, and reload "After it stood.". After (mouse, editor at 7.8 s; keys, editor at 1.9 s with typing across it): 1 document; page, Block row, and reload "Typed at once, then after it stood.".
    - Shots: `WIRE-11-before.png`, `WIRE-11-after.png`, `WIRE-11-after-keys.png`.
12. **The link banner at 390 (eb05782).** Its sentence wraps instead of being cut; one line stays a 28 px pill (radius 14 px), more lines a rounded box. No control added.
    - On a block document (a .csv added through the dialog: the import switch is on, so a Markdown file opens in the page editor). Before: 390 px 246×28 "Linking “Wire sheet” from this doc…" (cut); 1000 px 452×28 cut. After: 390 px 246×64, three lines, uncut; 1000 px 452×46, two lines; 1440 px 524×28, one line in the band, unchanged.
    - Shots: `WIRE-12-before.png` (390), `WIRE-12-after.png` (390), `-before-1000`, `-after-1000`, `-before-1440`, `-after-1440`.

Checks: `npx tsc --noEmit` clean (dev server stopped). eslint on the 29 changed files: 0 errors, 1 warning that was there before (`document-bar.tsx` `closeList` dependency).

## Files

- `src/components/collab/history-control.tsx` — Restore hands the answer to `tellNoteBack` (1).
- `src/components/reader/tree-drag.ts` — imports `TOUCH_HOLD_MS` (2).
- `src/components/assistant/conversation-delete.ts`, `src/components/assistant/assistant-panel.tsx` — `postUndoPill`, `outline.conversationDeleted` (3); failure lines (6).
- `src/components/reader/reader-interactions.tsx` — the trashes through `deleteNoteWithUndo` (3); `split` into the page editor (4); the comment's failure line (6); the link banner wraps (12).
- `src/components/docs/docs-editor.tsx` — the `split` prop (4); takes the kept keys (11).
- `src/components/docs/frame.tsx`, `src/components/reader/reader.tsx` — `split` passed through (4).
- `src/app/settings/page.tsx`, `src/components/feedback-button.tsx` — Feedback in the header on a phone (5).
- `src/app/api/derive/route.ts`, `src/app/api/documents/[documentId]/suggest/route.ts`, `src/components/assistant/failure.ts`, `src/components/reader/corpus-distill-page.tsx`, `src/app/signin/deck/reader.tsx` — failure lines, the deck's placeholder (6).
- `src/components/reader/workspace.tsx` — Save for offline's place (7); Notes by a key to the pending note (8).
- `src/components/reader/reader-panes.tsx` — Reader view drawn once placed (7).
- `src/lib/escape-layers.ts` — `focusWhenDrawn` takes a selector list (8).
- `src/components/outline/section-item.tsx`, `src/components/outline/use-outline.ts` — the kept title (9).
- `src/components/outline/use-note-compose.ts`, `src/components/outline/note-composer.tsx` — the retry, Escape on a button (10).
- `src/lib/docs/early-keys.ts` (new), `src/components/reader/document-bar.tsx` — the kept keys (11).
- `src/lib/i18n/dict/{api,assistant,common,reader,works}.ts` — keys removed and added, en and zh together (3, 5, 6).
- `SPEC.md` — the lines each item made wrong: §12 Restore, the folders' hold, the trashes' Undo, §29 split, Feedback on Settings, §7 failure lines, the header and Reader views, the rail's Notes by a key, the section rename, the composer's retry, §15 Blank document, §6 the link banner.

## Decisions

- **6: what counts as the route's own words.** `callFailure` keeps an error the route wrote unless the status is 500 (a 500's text is a crash's text). A 4xx line such as a refusal or "no key" keeps its words, as the brief asks.
- **6: left raw.** The suggest route's order pass line (the tools package decided it), `heartbeatResponse` and the formalize line in `api/derive`. Other "Request failed (N)" sites outside the brief (`share-add.tsx`, `translation-bar.tsx`, `conversion-strip.tsx`, `page-block.tsx`, the collapse fetch in `reader-interactions.tsx`) were left: see Needs.
- **6: attachments read "Not loaded".** Reading a file in is a load, not a save.
- **7: an empty place, not a hidden button.** The reserved place is an `aria-hidden` span of the button's size, so no control shows before it works. A browser that cannot save offline drops the place once it knows (one 48 px move there, as before).
- **7: Reader view is not drawn before the effect** rather than reserving a rail slot: it is the rail's last button, so drawing it late moves nothing.
- **9: the kept title stays until the section's title changes** (the server's answer or a refresh), so a retry from the field or a later landing clears it; Escape and the bin clear it on purpose.
- **10: 20 s between tries**, plus the `online` event. A try that lands calls the same `save` the Done button calls, so the words land once and the composer closes.
- **11: keys are taken from the press, not from the POST's answer**, so the space that pressed Blank document again (5 documents) is caught too. Keys typed into a field, with a modifier, or during IME composition are left alone. After 20 s the listener stops; keys kept by then still go to the page when it stands.
- **12: wrap, not a shorter quote.** At 390 a 24-character quote takes four lines (about 80 px) over the title area under the controls; it covered the same place on one line before.
- **12: the test document is a .csv** added through the dialog, since the shared import switch is on and I did not change it.

## Needs

- **Lead, on merge:** `src/components/reader/reader-interactions.tsx` is touched by items 3, 4, 6, and 12; `docs-editor.tsx` by 4 and 11; `workspace.tsx` by 7 and 8. The loop branch's table pills fix (`docs/insert/table-controls.tsx`) is not touched here.
- **i18n:** removed keys `assistant.conversationDeleted`, `reader.explanationRemoved`, `reader.analysisRemoved`, `reader.simplifiedRemoved`, `reader.visualizationRemoved`, `works.sendFeedback`, `api.deriveFailed`, `api.distillFailed`, `reader.distillFailedStatus`, `reader.deriveFailedStatus`, `assistant.requestFailedStatus`, `assistant.commentFailed`; added `common.notLoaded`. A branch that still uses a removed key will fail to type-check.
- **Failure lines not in this brief:** "Request failed (N)" (`common.requestFailedStatus`) still shows in `share-add.tsx`, `translation-bar.tsx`, `conversion-strip.tsx`, `page-block.tsx`, and the Collapse fetch in `reader-interactions.tsx`; the suggest route's order pass line and `api/derive`'s `heartbeatResponse` and formalize line stay raw.
- **page:** a blank document's page still slides left in steps while it loads (x399 → 288 over about 150 ms, CLS about 0.046), measured by `07-load.mjs`; not in this brief.
