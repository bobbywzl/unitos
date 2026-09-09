# claude/missing-figures-content-load-lwergn

**Intent:** Stop the URL import from losing figures (the IPC shopper survey page kept 1 of its 4 images), and add a deterministic media check so every image, video, iframe, and chart on a page is either loaded or named as lost.

**Files:**
- `src/lib/parse/url.ts` — `emitTextish` splits a paragraph at every media element inside it and emits the media as a figure between the text's parts; `flatten` reads no text out of media; the head-duplicate filter in `cleanBlocks` never drops a figure; `walkHtml` runs the media check after the figure repair and `parseHtmlContent` carries it as `ParsedDocument.mediaCheck`; the extract detail carries `media` and `mediaLost`.
- `src/lib/parse/figures.ts` — `WalkCtx.consumed` tracks the media a block carries; `meaningfulMediaIn`, `isInlineIcon`, `consumeMedia`; `checkMedia` rebuilds what no block carries where the page set it; `restoreFigures` puts back a figure the model passes dropped between two kept blocks.
- `src/lib/parse/ingest.ts` — `restoreFigures` after the passes; `saveDetail` carries `media` and `mediaLost` for the add, the split, the Markdown add, and the re-parse.
- `src/lib/parse/types.ts` — `MediaCheck`, `ParsedDocument.mediaCheck`, `PARSER_VERSION` 19 (stored URL documents re-parse on open).
- `src/lib/upload-assistant.ts`, `src/lib/prompts/upload-review.ts` — the review carries `media` and `mediaLost`; the model gets them as facts and must name lost media in its advice.
- `src/components/reader/ingest-progress.tsx`, `upload-assistant.tsx`, `document-bar.tsx` — the counts render: the progress card's lost line, the review's lost line and ok line, the done line, the document bar's line after a re-parse; a lost media keeps the box from opening the document early.
- `src/lib/i18n/dict/panes.ts` — en and zh strings for the media check.
- `SPEC.md` — §2 and §15 describe the split, the media check, and the restore.

**Decisions:**
- An image the page lays out narrower than 10% of the text column inside a paragraph is an inline icon, not a figure. Without a baked width it counts as a figure (safe side).
- A media element the walk missed lands after the block holding its container's text (a list item's, a table cell's) — so a gallery list's images follow the list — else after the block holding the nearest text before it.
- A figure the passes dropped is restored only when the text blocks beside it survived; one dropped with its neighbors was chrome. Chrome figures the passes drop are not counted as lost.
- The text check is not built: the walk's post-prune root lost no text node of 40+ characters on the five pages measured (IPC, Wikipedia, arXiv HTML, Cloudflare blog), and the AI passes drop chrome text by design.
