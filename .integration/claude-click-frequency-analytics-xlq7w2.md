# claude/click-frequency-analytics-xlq7w2

**Intent:** Record every click on a reader control — where it lives (top bar, sidebar, AI toolbar, article menu, reader, notes tray) and which control — in a database table, and add an admin page with a graph and tables of the counts.

**Files:**
- `prisma/schema.prisma`, `prisma/migrations/20260902120000_click_event/migration.sql` — new `ClickEvent` model: one row per click with `userId`, `notebookId`, `surface`, `control`, `createdAt`; indexes on `createdAt`, `(surface, control, createdAt)`, `(userId, createdAt)`.
- `src/lib/clicks.ts` — the shared vocabulary: the six surfaces, the control id pattern, the batch cap, the 180-day retention. Dependency-free; server and client import it.
- `src/components/click-tracker.tsx` — one capture-phase click listener on the document while the workspace is mounted. A click on an element with `data-track` inside a region with `data-track-surface` queues one click; the queue posts after 4 seconds or 200 clicks, and with `keepalive` when the page hides. A failed post drops its batch; offline, the batch waits.
- `src/app/api/clicks/route.ts` — `POST /api/clicks`: Zod-validated batch, stamped with the signed-in account, `createMany`.
- `src/app/admin/clicks/page.tsx` — the admin page: tiles (90d/30d/7d clicks, accounts, controls used), a 30-day daily chart stacked by surface with a legend, clicks by surface, top controls, top controls for each of the top bar, sidebar, and AI toolbar, a table of every control (90d/30d/7d counts, accounts, last click), and clicks by account.
- `src/components/admin/admin-nav.tsx` — the Clicks tab.
- `src/lib/i18n/dict/admin.ts` — the page's strings, en and zh.
- `src/app/api/cron/cleanup/route.ts` — deletes click rows older than 180 days.
- `src/components/reader/workspace.tsx` — mounts the tracker; marks the header (`topbar`), the rail (`sidebar`), and the tray (`tray`) as surfaces; `data-track` on every header and rail control.
- `src/components/reader/reader-interactions.tsx` — the article menu strip (`article-menu`) and the selection popover (`ai-toolbar`) as surfaces; `data-track` on every popover control (assistant, explain, simplify, extract, comment, link, highlight, add to notes, read aloud), the article menu asks, the Distill button, the tool cards, the plan card, and the link and voice controls.
- `src/components/reader/reader-panes.tsx` — the reader pane as the `reader` surface; the view switch.
- `src/components/guide-dialog.tsx` (surface `topbar`), `src/components/graph/graph-overlay.tsx` (surface `sidebar`), `src/components/reader/corpus-distill-page.tsx` (surface `tray`) — overlays rendered outside their opener's region carry the opener's surface.
- Every other component under the reader — `document-bar`, `add-document-dialog`, `upload-assistant`, `share-control`, `history-control`, `context-tab`, `notebook-title`, `project-search`, `reader`, `bibliography`, `block-view`, `conversion-strip`, `page-block`, `distill-page`, `notes-tray`, `note-card`, `note-editor`, `selection-bar`, `assistant-panel`, `distill-panel`, `annotations-panel`, `edits-panel`, `reply-thread`, and the video pane files — gained `data-track` on each button and link; no behavior changed.
- `scripts/qa/ui-clicks.mjs` — headless Chromium check: clicks the marked controls, asserts the posted surfaces and controls, screenshots the admin page in both themes and both languages.
- `SPEC.md` (§7), `README.md` — the click telemetry paragraph.

**Decisions:**
- Only explicitly marked controls record. A fallback that derived the control name from the button's label or title was rejected: labels translate, so one control would split into two rows by language, and some labels carry document titles, which would leak reader content into the admin table.
- Surface is the nearest ancestor with `data-track-surface`, so the reader surface is the default for everything inside the pane and the popover and article menu override it. Overlays rendered at the workspace root (guide, graph, corpus distilled page) carry their opener's surface.
- Six surfaces, not more: the user named three (top bar, sidebar, AI toolbar); article menu, reader, and notes tray cover the rest of the reader without exceeding what a stacked chart can show. The video pane counts as the reader.
- One control per function: the four highlight colors are one control (`highlight`), while the six formats are six (`format:h1`, …), because the admin question is "which function" not "which color".
- One row per click rather than counters, so the page can break down by day and by account; the cron bounds the table at 180 days. `notebookId` is stored but not shown yet.
- The chart uses the dataviz reference palette's first six categorical slots (validated with the skill's script on the app's card colors in both themes) rather than the app's clay and sage, which failed the chroma and separation checks.
- The Feedback pill overlaps the rail's More button at a 1400×900 viewport, so the QA script does not click More; that overlap predates this branch and is not fixed here.
- Validation: `npx prisma validate`, `npx prisma migrate deploy` on a local Postgres 16 with pgvector, `npx next typegen`, `npx tsc --noEmit`, and `npx eslint` on the changed files pass; `scripts/qa/ui-clicks.mjs` passes all 25 checks against the seeded local app.
