# loop/r10-reader

**Intent:** Fix the round 10 reader findings IM2, IM7, IM9, and the rest of E-12, then (from the coordinator, after merging the page editor package) IM6, IM20, and IM14 on the reader's side.

## Findings

Screenshots are in `.qa-tmp/fix/` of this worktree (git-excluded). The before shots of IM2, IM7, IM9, and E-12 are on the base (0903545); those of IM6, IM20, and IM14 on the base merged with `claude/reader-interaction-loop-5tgy75`. Test documents were "Reader fix 1" (Markdown), "Reader fix 2" (PDF), and "Reader fix 3" (Markdown added from a phone) in "Interaction QA", deleted at the end with their notes.

- **IM2: fixed.** On a phone the document pill lay over the +, so a tap on the + opened the document list, and the list ran past the screen (`scrollWidth` 458 on 390). Now the project's title and then the pill narrow (the pill is a flex box that shrinks; the project title shrinks first below sm), the + shows beside the pill and opens Add a document, and the list moves left to stay on the screen: it is measured against `documentElement.clientWidth`, because a phone's browser widens `innerWidth` to the overflow. Check: `v04-mobile-add.mjs` (the + itself under its centre; the tap opens the dialog; `scrollWidth` 390), `im2-list.mjs` (list 88–382 on 390), `a01-add-md.mjs 390 844 … touch` (an import added from the phone). `IM2-before.png`, `IM2-tap-before.png`; `IM2-after.png`, `IM2-tap-after.png`, `IM2-list-after.png`, `IM2-add-after.png`.
- **IM7: fixed.** The ask before Replace the edits now names the notes and the annotations whose quotes stand on words added since the import, five of each at most ("1 note quotes words added since the import. Its quote will lose its place:" and the names). `GET /api/documents/[id]/reparse` looks for each source's quote in the version kept at `importRev` with `resolveAnchor` (`lib/docs/reparse-losses.ts`), in projects the account can read; Replace the edits waits for that answer. What the replace does to data is unchanged. Check: `w08-own-words.mjs` and `im7-comment.mjs` (a note and a comment on typed words), `w04-addnotes.mjs` (a note on imported words), `im7-ask.mjs` (the ask lists the note and the comment, not the third), then `w05-reparse.mjs … replace`: exactly the two named sources orphaned, the third kept on its block. `IM7-before.png`, `IM7-after.png`.
- **IM9: fixed.** In Editing and Suggesting, a press outside the page (This document in the tray) took the browser's selection out of the page while the page still drew it and the toolbox stayed open; a press on those words then started a new selection. Now a capture `mousedown` on the reader puts the page's selection back (`view.focus()`) when the press lies inside the page's drawn selection and the browser holds none there, so the drag carries the quote; a click without a move still puts the caret. Check: `w14-quote-drag.mjs md editing` (drop with `application/x-unitos-quote`, the source on the note, the import's text unchanged), the same in `viewing` and `suggesting`, `im9-click.mjs` (caret at the click). `IM9-before.png`, `IM9-after-tray-press-before.png` (the drawn selection after the tray press); `IM9-after.png`, `IM9-after-dropped.png`.
- **E-12 (rest): fixed.** (1) On a phone the Reader view button is the last button of the bottom bar (a portal into `[data-reader-view-slot]` in `workspace.tsx`, chosen with a `(width < 48rem)` media query); its menu (the views and Feedback) opens above the bar. (2) A selection low in the pane opened the toolbox past the bottom bar: `fitToolbox` did move it above the words, but the coarse pointer's debounced `selectionchange` captured the same selection again 500 ms later (the tint puts the selection back over its marks) and replaced the fitted popover. The same words captured again now keep the open toolbox (`sameAnchor`). Check: `e12rest.mjs` (view button in the bar, over no line; toolbox 329–729 above the bar at 790; before 753–1110), `e12b.mjs` (one box after a word selection; the Feedback row opens the form from the bar's menu). `E-12-view-before.png`, `E-12-low-before.png`; `E-12-view-after.png`, `E-12-low-after.png`, `E-12-card-after.png`, `E-12-feedback-after.png`.
- **IM6 (toolbar side): fixed** with the page editor worker's tested patch: the toolbar stands right of the text when `toolbarShift` can move the page left for it. Check: `w13-place.mjs md 1440` (stack 854+ right of the text 122–846, no paragraph under it; before over three paragraphs), `w12-collapse-define.mjs md` (Define's stack beside the text). `IM6-before.png`; `IM6-after.png`, `IM6-define-after.png`.
- **IM20 (reader side): fixed** with the same patch (`hold()` sets `leftOffBlockId` for a page editor document). The note that the reading line fell under the page editor's header held: the reading line in the page editor is now 32px under its header (`readingLine`, `lib/reading-position.ts`), for reading a position and for placing one. Check: `x-im20.mjs md` (mark shows, "You left off here"), `im20-resume.mjs` (the account's copy in a new tab: header bottom 182, ribbon 199). `IM20-before.png`; `IM20-after.png`, `IM20-after-scrolled.png`, `IM20-resume-after.png`.
- **IM14: fixed.** A "reparse" template (Parsing, Saving) in `ingest-progress.tsx`; the re-parse of a stored file passes it; a web page's re-parse keeps the url steps (it fetches again). Check: `im14.mjs` (before "Uploading… 1/3" for 15 s; after "Parsing… 1/2", then Saving, Done; every source kept). `IM14-before.png`, `IM14-after.png`.

## Files

- `src/components/reader/document-bar.tsx`: the pill shrinks in a flex box (IM2); the list placed against the page's width (IM2); the ask's losses and Replace waiting for them (IM7); the re-parse passes "reparse" (IM14).
- `src/components/notebook-title.tsx`: below sm the project title shrinks before the pill (IM2).
- `src/app/api/documents/[documentId]/reparse/route.ts`: `GET` answers the losses (IM7).
- `src/lib/docs/reparse-losses.ts` (new): the read-only check (IM7).
- `src/components/reader/reparse-losses.tsx` (new): `useReparseLosses`, `ReparseLossList` (IM7).
- `src/lib/i18n/dict/panes.ts`: `reparseLoses*` in English and Chinese (IM7).
- `src/components/reader/reader-interactions.tsx`: `onPressSelection` (IM9); `sameAnchor` and the coarse `selectionchange` keeping the open toolbox (E-12); the toolbar's side with `toolbarShift` and `leftOffBlockId` in `hold()` (IM6, IM20; the page editor worker's patch).
- `src/components/reader/reader-panes.tsx`: the Reader view control as a variable, portaled into the bottom bar below md (E-12).
- `src/components/reader/workspace.tsx`: the bar's `[data-reader-view-slot]` (E-12).
- `src/lib/reading-position.ts`: `readingLine` (IM20).
- `src/components/reader/ingest-progress.tsx`: `IngestKind`, the "reparse" template (IM14).
- `SPEC.md`: the document list on a phone (Folders), the reading line in the page editor, the low toolbox on a touch screen, Reader views and Where Feedback is on a phone, the re-parse card (Re-parse document), the ask's losses (Re-parse of an import), the quote drag in Editing (The Unitos layer).

## Decisions

- IM2: the title still truncates without an ellipsis (§6's rule); the project title gives up room first on a phone, since the pill names the open document.
- IM7: the prediction reads the version kept at `importRev` (the text a re-parse brings back) rather than running a parse; a parser change since the import could differ in rare words. Notes and annotations are counted apart, in the fixed vocabulary; the "unresolved:" label on an orphaned quote (`markdown.tsx`) is unchanged.
- IM9: the fix restores the page's own selection on the press rather than starting a drag by hand, so the browser's drag (and moving words inside the page) works as it does when the selection is live.
- E-12: the Reader view button moves into the bottom bar (seven buttons on a phone) rather than the header, which is full on a phone (IM2).
- E-12: the toolbox keeps its place when the same words are captured again; a different selection still replaces it.
- IM20: the page editor's reading line is a property of the pane (under its header), so a position read at the old 80px line lands about 65px lower in the pane; the account's copy keeps no line, so it uses the pane's line as well.

## Needs

- Seen, not changed (`src/components/markdown.tsx`): an orphaned quote reads "unresolved:" with nothing after the colon (IM7's second half).
- Seen once under a slow route compile: a quote dropped on a note in Viewing put the words in the note but no source row, when the browser closed seven seconds after the drop while `PATCH /api/notes/[id]` compiled (rerun: the source lands). The drop may write the text and the source in two requests; a tab closed between them leaves the quote without its source. Worth a look by the notes package.
- `e21-phone` (fixed text offset in its script) and navigation `header.mjs` (waits on Save for offline) stop in their rigs, as the r10-open notes say. `v03-mobile-select.mjs` sets a selection in a Viewing editor's state only, so no toolbar opens, as in the audit's own run.

## Checks

- `npx tsc --noEmit`: clean. `npx eslint` on every changed file: one warning in `document-bar.tsx` (`closeList` missing from an effect's deps), the same as on the base.
- Imports scripts (`.qa-tmp/imports/reg/`): r01 (pdf, md), r02, r03, r04 (position 254 → 254, left-off mark true), v01, v02, v03, v04, w00, w01, w13 (md, pdf), w14 (viewing), w15, w16, w17, w19 exit 0. `im7-ask` stops on purpose once the PDF import was re-parsed (no longer edited, no ask).
- Edge and navigation (`.qa-tmp/reg2/`): e00, e02, e03, e15b, e12b, e12rest, docbar2, escape, leftoff, tab exit 0; e21-phone and header stop in their rigs.
- Not run: the tools scripts and the edge scripts that run Explain or Simplify on the shared QA documents (they write annotations on documents this branch did not make); a real phone's long press; the split pane with the Reader view in the bar.
