# claude/assistant-ux-improvements-5tnyxh

**Intent:** Fix "Anchor does not resolve in this document" after a re-parse, make opening, closing, and collapsing move smoothly, show a Thinking row with a Stop control on every AI tool, and say in plain words why a URL or PDF could not be added (added mid-round).

**Files:**

Anchors (SPEC.md §5 ladder on every anchored route)
- `src/lib/anchors/resolve.ts` — `resolveAnchor` is the one ladder (block id and offsets, then the quote inside the block, then the quote across the document, else null) plus `documentBlocks`; `resolveDocumentSources` uses it.
- `src/app/api/derive/route.ts` — anchor schema carries the quote selectors; the anchor resolves through the ladder before the prompt, the stored EXPLAIN/SIMPLIFY source, and the EXTRACT origin use the resolved position.
- `src/app/api/assistant/act/route.ts` — same; the conversation note stores the resolved anchor.
- `src/app/api/annotations/route.ts`, `src/app/api/links/route.ts`, `src/app/api/notes/route.ts` — resolve through the ladder instead of rejecting a mismatched block id or offsets; store what resolved.
- `src/components/reader/reader-interactions.tsx` — every anchored request sends `quotedText`, `prefix`, `suffix` (`anchorBody`).
- `src/lib/i18n/dict/api.ts` — one message for one outcome (`anchorNotResolvedInDocument`); removed keys that lost their last caller.

Ingest reasons (mid-round request)
- `src/lib/parse/fetch-page.ts` — the one page fetch: browser-shaped headers, PDF links read as PDFs, human-check pages recognized, the Wayback Machine's archived copy tried when a site refuses, `FetchPageError` names the failure.
- `src/lib/parse/ingest-error.ts` — `describeIngestError`: every ingest failure as one plain sentence with the next step.
- `src/lib/parse/url.ts` — `parseUrl` fetches through `fetchPage`; `parseFetchedPage` parses a PDF link as a PDF.
- `src/lib/parse/ingest.ts` — a PDF link adds the PDF itself (stored bytes, same judgment as an upload, the link kept as `sourceUrl` for dedupe); `ingestUrl` takes the user id for classification usage.
- `src/lib/upload-assistant.ts` — the review fetches through `fetchPage`; takes the request signal.
- `src/app/api/documents/route.ts`, `src/app/api/uploads/complete/route.ts`, `src/app/api/uploads/review/route.ts`, `src/app/api/drive/import/route.ts`, `src/app/api/documents/[documentId]/reparse/route.ts` — send the described reason instead of a fixed line.
- `src/components/reader/upload-assistant.tsx`, `src/components/reader/document-bar.tsx` — a stream that ends without its result says the add was cut off; the review failure line no longer promises "You can still add the content".
- `src/lib/i18n/dict/api.ts`, `src/lib/i18n/dict/panes.ts` — the reason strings, en and zh.

Thinking + Stop (SPEC.md §6)
- `src/components/thinking.tsx` — `ThinkingIndicator` takes `onStop` (a Stop pill), `stopLabel`, `stopTitle`; `aria-live`.
- `src/components/reader/reader-interactions.tsx` — Explain, Simplify, Extract hold an AbortController; the cards show Stop while streaming and close when stopped empty; Extract shows a status pill with Stop instead of a timed toast; the popover's assistant box shows the Thinking row while a turn runs.
- `src/components/assistant/assistant-panel.tsx` — tasks and Recommended summaries stop; the Recommended card shows Thinking while it generates.
- `src/components/video/assistant-card.tsx`, `src/lib/video/formalize-client.ts` — the formalize skills stop.
- `src/components/video/video-pane.tsx`, `src/components/video/find-panel.tsx`, `src/components/reader/page-block.tsx`, `src/components/reader/document-bar.tsx`, `src/components/reader/upload-assistant.tsx` — video Explain, Find, Circle & ask, the recommended-links scan, and the upload review stop.
- `src/components/reader/distill-page.tsx`, `src/components/reader/corpus-distill-page.tsx` — Cancel moves into the Thinking row.
- `src/app/api/derive/route.ts`, `src/app/api/assistant/route.ts`, `src/lib/connect.ts`, `src/app/api/documents/[documentId]/connect/route.ts`, `src/app/api/uploads/review/route.ts` — the request signal reaches the model call (streaming, FIND, SALIENCE, EXTRACT, tasks, connect, review), so Stop ends the generation.
- `src/lib/api.ts` — optional `{ signal }`; an aborted call rethrows so callers read `signal.aborted`.
- `src/lib/i18n/dict/common.ts` (`stop`), `src/lib/i18n/dict/panes.ts` (`recommendLinksRunning`), `src/lib/i18n/dict/video.ts` (`streaming` removed).

Motion
- `src/components/presence.tsx` — `Presence` (exit animations for unmounting blocks) and `Collapse` (grid-rows fold).
- `src/app/globals.css` — entry classes (`menu-in`, `dialog-in`, `content-in`, `panel-in`, `sheet-in`), the `presence-exit-*` exits, `folding-*`, `tray-column`.
- `src/components/reader/workspace.tsx` — the tray column slides shut to zero width (no transition while resizing), tabs cross-fade, the rail menu, graph overlay, and corpus distilled page leave through Presence.
- `src/components/reader/reader-interactions.tsx` — every card, the popover, the plan card, the toast, the banners, and the distilled page leave through Presence; the popover boxes and the article menu fold.
- `src/components/reader/document-bar.tsx` — the list drops in and leaves, row actions fold, the pill shows dots while the next document loads (`useTransition`).
- `src/components/reader/reader-panes.tsx`, `src/components/context-tab.tsx`, `src/components/collab/share-control.tsx`, `src/components/collab/history-control.tsx`, `src/components/reader/project-search.tsx`, `src/components/feedback-button.tsx` — panels drop in and leave.
- `src/components/guide-dialog.tsx`, `src/components/reader/add-document-dialog.tsx` — dialogs fade and lift, and leave the same way.
- `src/components/outline/notes-tray.tsx` — sections fold.
- `src/app/n/[notebookId]/page.tsx`, `src/components/reader/distill-page.tsx`, `src/components/reader/corpus-distill-page.tsx` — a newly opened document or page fades in.
- `scripts/qa/ui-motion-stop.mjs` — Playwright check for all of the above (27 checks pass against the seeded project with the mock model server).

**Decisions:**
- The root cause of the anchor error was the automatic upgrade re-parse (PARSER_VERSION moved to 11 this morning): the open reader kept the old block ids while the server had new ones, and the derive and act routes resolved by id and offsets only. The fix is the SPEC §5 ladder on the server, not a client refresh, so it also covers edits by a collaborator and the annotation, link, and note routes.
- The page fetch names itself at the end of a browser-shaped User-Agent (`… Safari/537.36 Unitos/1.0`) instead of `compatible; Unitos/1.0`. Sites that turn away "compatible" agents now serve the page; the app still identifies itself.
- On a bot wall or a rate limit the fetch tries the Wayback Machine's latest snapshot (`web.archive.org/web/2id_/<url>`, 20 s cap) before giving up. The stored `sourceUrl` stays the original link. Reuters (DataDome, HTTP 401) has no snapshot for the article in the screenshot, so the reader gets the plain reason and the save-as-PDF path; there is no server-side way through a JavaScript captcha.
- The ingest error messages recognize pdf.js error names for password-protected and damaged PDFs and the model's "overloaded" and key errors; anything else keeps its own text after a plain lead. The three fixed messages (`pdfParseFailed`, `urlIngestFailed`, `reparseFailed`) are gone.
- One Stop per surface: the chats keep their Send/Run button turning into Stop; every other tool gets the Stop pill in the Thinking row (or in the card header while text is already streaming). The Distill pages keep the word "Cancel" (SPEC §6) but in the same row.
- A stopped Explain or Simplify keeps whatever streamed in and closes an empty card; nothing persists server-side because the derive route only saves the annotation after the stream completes, and the AI SDK does not call `onEnd` on an abort.
- Presence renders a `display: contents` wrapper and keeps the last children in state (adjust-during-render), because the repo's ESLint forbids reading refs during render. Collapse's classes are `folding-*` because Tailwind's own `collapse` utility hides elements.
- The pane and workspace entry animation is opacity only: a transform would re-anchor the `position: fixed` controls inside a pane (Stop reading, the linking banner) while it plays.
- The tray stays mounted while collapsed (zero width, `inert`) so it can slide; below md the aside keeps its old bottom-sheet behavior plus a slide-up on open, no exit animation.
- A React key warning ("Check the render method of Workspace… passed a child from NotebookPage") shows in the dev overlay. It is present on the round's base commit without this branch's changes, so it was left alone.
- The Playwright QA run needed a local Postgres with a stand-in `vector` type (no pgvector on this machine) and `scripts/qa/mock-anthropic.mjs`; those setup steps are not in the repo.
