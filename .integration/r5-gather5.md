# r5-gather5

**Intent:** Fix the path from the graph to writing: two tabs and a save in flight must not lose the gathered note (REV5-03, REV5-04), Find quotes at sentence bounds (WALK5-10), the new note clear of the Stitch sheet (WALK5-12), Write a page from these (VIEW5-05 step 1), and Add to note on a cited passage (VIEW5-04).

**Files:**
- `src/components/graph/note-gather.tsx`: the provider merges on write (reads the stored draft first, listens to `storage`, merges unseen words); `settle` removes only what a save sent; a ref guard keeps one save at a time; the saved line moves into the composer when words or quotes came after; Write a page from these as an icon in the header row; the dock measures the Stitch box and, under 1000 px, sits above it folded (unfold folds the box).
- `src/lib/note-drafts.ts`: exports `gatherDraftKey` for the storage event.
- `src/lib/graph/quote-span.ts` (new): `quoteSpan`, `sentencePrefix`.
- `src/lib/graph/find.ts`, `src/app/api/notebooks/[notebookId]/find/route.ts`: `passageQuote`; a Find passage carries `quote`.
- `src/components/graph/graph-find.tsx`: Add to note uses `p.quote` (falls back to the row's window).
- `src/components/graph/stitch-passage-card.tsx`: Add to note in the card's existing Open in reader row.
- `src/components/graph/stitch-box.tsx`: ONE line, `blockId={passage.blockId}` on the passage card.
- `src/components/graph/graph-overlay.tsx`: the dock's `onWritePage` (pick + `view2.askStitch`), `boxOpen`, `onFoldBox`.
- `src/app/globals.css`: at >= 1000 px, while the new note shows, the Stitch slot stands left of it (as beside a side list).
- `src/lib/i18n/dict/graphCover.ts`: composerWritePage / Title / Command, en and zh.
- `SPEC.md` §13 Add to note.
- `scripts/qa/quote-span-check.ts`, `scripts/qa/ui-graph-gather5.mjs` (new checks).

**Decisions:**
- No server idempotency key: a client ref guard (no schema change).
- A short block (<= 400 chars) is quoted whole; a sentence span over 800 chars falls back to the row's window; a CJK char weighs 4 toward the 80-char minimum.
- Concurrent words in two tabs: the typed text wins when it holds the other tab's, else both are kept (other tab's first). Never written over.
- Write a page from these is an icon (sparkle, assistant color) in the composer header, not a button row, per Linda's no-bloat direction; it adds to the pick (as Find's Ask Stitch) rather than replacing it. The saved-line copy of it was dropped.
- On a wide screen the box moves left of the note (CSS on `[data-gather]`) instead of the note lifting over the box.
