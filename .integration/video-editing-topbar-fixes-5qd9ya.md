# video-editing-topbar-fixes-5qd9ya

**Intent:** Fix four reported UX bugs: the video refusal toast never faded and its "Open as a video document" action did nothing for direct file links; the top bar was a horizontal pill row instead of a vertical hover dropdown; the + menu was clipped by the header (the + button looked dead); the distilled page spilled past its background onto the article.

**Files:**

- `src/components/reader/reader-interactions.tsx` — one showToast path with an optional action, every toast fades after 5 seconds; refuseMediaFigure dispatches the link to the document bar (`dissect:add-document-url`) instead of running its own fetch; also reads `<source src>`; the pane clips (`overflow-hidden`) while the distilled page is open.
- `src/components/reader/document-bar.tsx` — one active-document pill expanding a vertical document list on hover or click, per-document actions inline; shared `ingestFromUrl` used by Add URL, the video menu, and the reader's event; the video menu accepts direct media links.
- `src/components/reader/workspace.tsx` — removed the `overflow-x-auto` wrapper that clipped the + menu and pill menus.
- `src/components/reader/distill-page.tsx` — the page scrolls itself (`overflow-y-auto overscroll-contain`), so content taller than the pane stays on the opaque background.
- `src/app/api/documents/route.ts` — a direct media file URL becomes a media document, between the YouTube branch and the article parse.
- `src/lib/video/ingest-media-url.ts` — new: streamed download into staged UploadChunk rows, dedupe by sourceUrl and fileHash, VideoChunk copy, cleanup on failure.
- `src/lib/video/types.ts` — shared `MEDIA_EXTENSIONS` and `isMediaUrl` (moved from document-bar).
- `src/lib/outbound-fetch.ts` — OutboundResponse exposes `body` for streamed downloads.
- `src/components/reader/ingest-progress.tsx` — `media` step template (fetch, save).
- `src/lib/i18n/dict/api.ts`, `src/lib/i18n/dict/panes.ts` — `mediaUnavailable`, `stepFetchingMedia`, `documentList`; `onlyYouTube` renamed `notVideoLink` with copy matching the new behavior.

**Decisions:**

- The toast action routes through the document bar rather than fetching in the reader: one ingest code path, and the user sees the progress card and header errors. A window event is the seam, matching the existing `dissect:*` events.
- Media URL ingest reuses the upload staging machinery (UploadChunk → INSERT…SELECT into VideoChunk) instead of buffering the file, at the cost of a second copy inside Postgres during ingest.
- Media URLs are recognized by path extension only; an extensionless stream link still falls to the article parse and fails readably. sniffMedia validates the first chunk regardless.
- The distilled page stays an absolute overlay that scrolls itself; the alternative (hiding the article and rendering in flow) would have touched the scroll save/restore and the sticky chrome for no visible gain.
- The toast fades at 5 seconds even with an action button, per the report; re-triggering the gesture brings it back.
