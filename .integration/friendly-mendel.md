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
