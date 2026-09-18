# claude/friendly-mendel-lop7wx

**Intent:** Add Contents (the article's parts at the top left of the reader, in place of the Assistant pill and the search icon), remove multi upload, and move Stitch and its generated content into the graph, where it reads the nodes picked or every document of the project.

**Files:**
- `prisma/schema.prisma`, `prisma/migrations/20260918120000_contents_drop_multi_upload`: `Document.contents` added; `MultiUpload`, `MultiUploadMember`, and `Document.generatedFromId` dropped. `generatedCommand` alone marks a generated document.
- `src/lib/contents.ts`, `src/lib/prompts/contents.ts`, `src/app/api/documents/[documentId]/contents/route.ts`, `src/components/reader/contents-menu.tsx`: the Contents feature (SPEC.md §26). `src/lib/parse/ingest.ts`: a re-parse clears the stored contents.
- `src/components/reader/reader-interactions.tsx`: the article menu is the Contents button; the Assistant pill, the frequent asks, `openArticleChat`, and the search icon are gone. `src/components/reader/project-search.tsx`, `src/app/api/search/route.ts`, `src/lib/embeddings.ts`: deleted (nothing used them after the icon went).
- `src/lib/graph/stitch.ts` (from `lib/multi/stitch.ts`), `src/lib/prompts/stitch.ts`, `src/app/api/notebooks/[notebookId]/stitch/route.ts` (from `/api/multi/[multiId]/stitch`): Stitch reads the project's attached documents, `documentIds` optional; "member" is "document" throughout; `StitchMember` is `StitchDocument`, the result's `members` is `documents`.
- `src/lib/graph/view.ts` (from `lib/multi/view.ts`): `documentsGraph` kept, `listGenerated` added, the multi upload loaders gone.
- `src/components/graph/graph-overlay.tsx`, `graph-view.tsx`, `stitch-box.tsx` (from `components/multi`), `generated-list.tsx` (from `components/multi`): the Stitch box at the foot of the canvas, node picking (⇧-click, or Pick documents), the Generated content list beside Recommended links.
- `src/components/multi/multi-page.tsx`, `src/app/n/[notebookId]/multi/[multiId]/page.tsx`, `src/app/api/multi/*`, `src/lib/multi/title.ts`, `src/lib/prompts/multi-title.ts`: deleted.
- `src/components/reader/upload-assistant.tsx`: the layout question is gone; every add lands separate pages. `document-bar.tsx`: the Multi uploads section is gone. `reader-panes.tsx`, `workspace.tsx`, `src/app/n/[notebookId]/page.tsx`: `?multi=` plumbing gone; `graph.generated` added.
- `src/lib/i18n/dict/stitch.ts` (from `multi.ts`, namespace `stitch`), `api.ts`, `panes.ts`, `reader.ts`, `works.ts`, `common.ts`, `dictionaries.ts`: keys for Contents and the pick; multi upload, project search, and article-menu ask keys removed.
- `src/lib/derive/config.ts`: `CONTENTS_*`; `MULTI_TITLE_*` gone. `src/lib/types.ts`, `src/lib/usage.ts`, `src/lib/clicks.ts`, `src/components/icons.tsx` (`PageIcon`, `ContentsIcon`).
- `scripts/qa/mock-kimi.mjs` (a contents branch; the multi title branch gone), `scripts/qa/ui-clicks.mjs` (contents in place of search).
- `SPEC.md` (§6, §7, §13, §15, §22 rewritten, new §26), `README.md`, `CLAUDE.md` (glossary).

**Decisions:**
- The Assistant pill and the search icon are removed, not moved, as asked. The sidebar assistant tab still takes any question about the article; project search has no entry point now, so its route and embeddings lib are deleted too (restorable from git if a new entry point is wanted). The `Block.embedding` column stays: dropping it is a data migration for no gain.
- Contents: one AI pass at low effort stores the parts; a failed pass answers the document's headings and stores nothing, so the next open tries again. Titles are never translated.
- Stitch's pick lives in the graph overlay's state for the session, not in the URL. Send ends picking.
- Existing multi upload rows are dropped by the migration. Generated documents keep their blocks, links, and command.

## Round two: context saving for Stitch

**Intent:** Make a Stitch command cost what it needs, not the project: every document carries a skeleton, the reading passes read skeletons and route to parts, lines are ranked when there are too many, and only the picked blocks' real text reaches the answer pass; the skeleton follows edits and rebuilds past a tenth changed.

**Files:**
- `prisma/schema.prisma`, `prisma/migrations/20260918150000_skeleton`: `Document.skeleton`, `Document.skeletonStartedAt`.
- `src/lib/graph/skeleton.ts` (new), `src/lib/prompts/skeleton.ts` (new): build (one call per 100k-char window, in parallel), hash per block, drift, patch for small edits, `ensureSkeleton` (Stitch), `refreshSkeleton` (background, locked).
- `src/lib/graph/rank.ts` (new): BM25 over lines, word and CJK-bigram tokens.
- `src/lib/graph/stitch.ts`, `src/lib/prompts/stitch.ts`: the reading passes over skeletons — select in one call; route pass and ranking past the budget; the per-document whole-text select call, the per-document cut, and the `leftOut` budget are gone. `StitchDocument.status` is `read | empty`.
- `src/lib/derive/config.ts`: `STITCH_ROUTE_EFFORT`, `STITCH_WHOLE_THRESHOLD`, `STITCH_SKELETON_BUDGET`, `STITCH_SELECTED_BUDGET`, `SKELETON_*`.
- Background hooks: `src/app/api/documents/route.ts`, `src/app/api/drive/import/route.ts`, `src/app/api/documents/[documentId]/reparse/route.ts`, `src/app/api/blocks/[blockId]/route.ts` (`after(refreshSkeleton)`), `src/lib/video/transcription-job.ts`, `src/lib/handwritten/convert.ts` (after the text lands), `src/lib/parse/ingest.ts` (a re-parse clears the skeleton).
- `src/components/graph/stitch-box.tsx`, `src/lib/i18n/dict/stitch.ts`, `src/lib/types.ts`, `src/lib/usage.ts`, `scripts/qa/mock-kimi.mjs`, `SPEC.md` §22, `CLAUDE.md`, `README.md`.

**Decisions:**
- The skeleton is built on Kimi K3 at low effort like every other reading pass; a cheaper model is one constant away but no second client is wired for Stitch, so none is used.
- Drift counts a removed block's line at ten times its length (the text is gone); a document with no skeleton is fully stale. Under a tenth, changed blocks read as their own first words with no model call.
- Embeddings were not restored: BM25 needs no key and no index, and it only runs when the routed lines still overflow the budget.
- The route pass runs only past 200k characters of skeleton text; under that one select call reads every skeleton, byte-identical turn to turn, so the prefix caches.

## Round three: Contents in two clicks

**Intent:** Contents opens the list; with nothing stored the list asks whether to generate the contents, offers Generate contents, and carries the disclaimer that AI-written parts may be off; Generate contents runs the one model call.

**Files:**
- `src/components/reader/contents-menu.tsx`: the two states — stored parts under the disclaimer; the ask, the Generate contents button, the disclaimer, and the article's headings under a rule when nothing is stored. A viewer reads that an editor can generate them.
- `src/app/api/documents/[documentId]/contents/route.ts`: `{generate?}`; a read never calls the model; a failed generate is a 422 the list shows.
- `src/lib/i18n/dict/reader.ts`, `SPEC.md` §26, `README.md`.

**Decisions:**
- The skeleton (§22) still builds the contents on its way when a document has none, so a document whose skeleton has built shows its parts on the first click; the two-click flow is for a document with nothing stored.
- The disclaimer shows in both states, not only before generation: the parts stay AI-written after they are stored.
