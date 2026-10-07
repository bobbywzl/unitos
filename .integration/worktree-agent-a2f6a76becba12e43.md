**Intent:** Package DATA (graph-notes audit GN-01, Package 0): links belong to the project they were made in, so one account's project never shows or changes another account's links, reasons, or replies.

**Files:**
- `prisma/schema.prisma`, `prisma/migrations/20261007100000_doclink_notebook/migration.sql`: nullable `DocLink.notebookId`, index, FK to Notebook `ON DELETE SET NULL`. Additive.
- `scripts/backfill-doclink-notebook.mjs`: dry run by default; `--apply` writes only `DocLink.notebookId` where null. Not run in production (waits for Linda).
- `src/lib/link-scope.ts`: `projectLinks(notebookId)` (the project's links plus links with no project) and `linkPath(linkId, notebookId)` for clients.
- `src/lib/collab.ts`: `linkAccess` (role in the link's project; 404 from another project), `legacyLinkSharedAcrossAccounts`, `withoutOtherProjectLinkEdits`.
- `src/app/api/links/route.ts`, `src/app/api/links/[linkId]/route.ts`, `src/app/api/replies/route.ts`, `src/app/api/replies/[replyId]/route.ts`: write and check the link's project.
- `src/lib/connect.ts`, `src/lib/graph/stitch.ts` (three one-line edits): write `notebookId`, dedupe within the project.
- `src/lib/graph/view.ts` (where-clauses and a `notebookId` argument), `src/app/n/[notebookId]/page.tsx`, `src/lib/digest/build.ts`: reads scoped.
- `src/components/{graph/graph-view,graph/graph-overlay,panels/annotations-panel,reader/reader-interactions,collab/reply-thread}.tsx`: send the project with link writes.
- `src/lib/i18n/dict/api.ts`: `linkSharedAcrossAccounts` (en, zh). `SPEC.md` §13: one paragraph.
- `scripts/qa/link-scope-check.ts`: the verification.

**Decisions:**
- A link with no project whose documents sit in projects of more than one account can be removed only by the account that made it (403) — the audit's guard, with a maker exception so A can still remove A's own old links.
- LINK_ADD/LINK_REMOVE edits carry `meta.notebookId`, and the Edits panel, History, and digest hide another project's link edits (found by the check: B's page carried A's link id through the Edits panel).
- `lib/assistant/transcript.ts` left as is: it reads link offsets only to keep chapter cuts off anchors, shows nothing.
