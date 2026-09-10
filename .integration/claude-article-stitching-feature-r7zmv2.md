# claude/article-stitching-feature-r7zmv2

**Intent:** Add multi upload (links and files of every kind queued together in the add dialog; two or more documents added onto one page — two side by side, three or more as a graph or a list) and Stitch (the assistant across the members: gather passages into a new page, draw links, find contradictions, write a synthesis), and remove custom upload instructions so every add imports the content faithfully.

**Files:**
- `prisma/schema.prisma`, `prisma/migrations/20260910120000_multi_upload` — `MultiUpload`, `MultiUploadMember`, `Document.generatedFromId` and `generatedCommand`, `Notebook.multiUploads`.
- `src/lib/types.ts` — `MultiMemberView`, `GeneratedDocumentView`, `MultiUploadView`, `MultiUploadSummary`, `StitchResult`.
- `src/lib/derive/config.ts` — `STITCH_MODEL`, `STITCH_EFFORT`, `STITCH_MAX_OUTPUT_TOKENS`.
- `src/lib/prompts/stitch.ts` — the Stitch template; `src/lib/prompts/upload-instructions.ts` deleted; `src/lib/prompts/upload-review.ts` — the instruction rules and fields dropped.
- `src/lib/multi/stitch.ts` — the members as one system message, the model call, quote resolution, links stored recommended, the generated document materialized with provenance links; `src/lib/multi/view.ts` — the page's loaders and the members' graph.
- `src/app/api/multi/route.ts`, `src/app/api/multi/[multiId]/route.ts`, `src/app/api/multi/[multiId]/stitch/route.ts` — create, rename, delete, and Stitch (heartbeat stream).
- `src/app/n/[notebookId]/multi/[multiId]/page.tsx` — the multi upload page; two members redirect to the reader side by side with `?multi=`.
- `src/components/multi/multi-page.tsx`, `stitch-box.tsx`, `generated-list.tsx` — the page (graph default, list, recommended links, rename, delete, tabs), the Stitch box (inline and docked), the generated content list.
- `src/components/graph/graph-view.tsx` — optional `docHref` for node clicks; `graph-overlay.tsx` — `RecommendedLinkList` exported.
- `src/components/reader/add-document-dialog.tsx` — the queue: Enter queues links (several at once, video links as videos, Drive links import on their own), the dialog owns its file inputs, Continue hands the queue to the box.
- `src/components/reader/upload-assistant.tsx` — `UploadItem`, the `batch` request kind, `OpenTarget`, the layout question (Separate pages / One page), the multi upload made after the batch, `addFile`/`addLink` shared by every path; instructions state, check, replies, and textarea removed.
- `src/components/reader/document-bar.tsx` — `onSubmit`/`onDriveLink` wiring, `?multi=` kept on open, the Multi uploads section of the document list, "One page with the open document" and "Every document on one page", the offline queue for a batch.
- `src/components/reader/reader-panes.tsx` — `viewHref` carries `multi`; `src/components/reader/workspace.tsx` — the docked Stitch box and the list; `src/app/n/[notebookId]/page.tsx` — reads `?multi=`, loads the multi upload and the project's list.
- `src/lib/derive/heartbeat-client.ts` — `runHeartbeat` for any heartbeat route.
- `src/lib/parse/ingest.ts`, `structure.ts`, `layout.ts`, `src/lib/upload-assistant.ts`, `src/app/api/uploads/review/route.ts`, `uploads/complete/route.ts`, `documents/route.ts`, `drive/import/route.ts` — instructions removed from every add path; the drop ceilings are fixed at 0.4.
- `src/lib/i18n/dict/multi.ts` (new namespace), `panes.ts`, `api.ts`, `common.ts`, `dictionaries.ts` — strings in both languages, the zh glossary terms.
- `SPEC.md` (§2, §14, §15, §16, new §22), `CLAUDE.md` (glossary), `README.md` — docs.

**Decisions:**
- The layout question lives in the upload assistant box, not the dialog, so drag-and-drop, Drive picks, several pages of one work, and a split ask it too.
- Enter after a link queues it; Continue sends the queue. A single add costs one more click than before, and every add path is the same.
- Two members always open side by side in the reader (no graph for two); the Stitch box docks at the bottom of the reader while `?multi=` is in the URL.
- Stitch links land as recommended links (the reader approves everything); a generated document is stored at once as a real document, with accepted provenance links from every part back to its member block, since the reader asked for the page.
- The generated document contract is parts (heading, verbatim quote, own text with sources), not free markdown, so every passage resolves against real block text and nothing invented lands.
- The Stitch conversation is kept per multi upload in the browser tab only, not persisted.
- No database was reachable in the session: the migration was validated by Prisma and the app type-checked, linted, and built, but not run against Postgres.
