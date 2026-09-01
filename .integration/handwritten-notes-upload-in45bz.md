# handwritten-notes-upload-in45bz

**Intent:** Import PDF judges each PDF with AI: a computer-text article parses to text blocks as before; rough handwritten notes and drawings become a handwritten document whose pages render in the reader with two tools — conversion to text blocks that imitate the notes' formatting, and Circle & ask directly on the page (SPEC.md §14, new).

**Files:**

- `SPEC.md` — new §14 Handwritten documents: classification, data model, conversion, Circle & ask.
- `prisma/schema.prisma`, `prisma/migrations/20260901120000_handwritten/` — BlockType `PAGE`; `Document.handwritten`, `conversionStatus` (new `ConversionStatus` enum, the transcript-status shape), `conversionError`, `conversionStartedAt`.
- `src/lib/handwritten/pages.ts` — new: page rendering from stored PDF bytes (unpdf + @napi-rs/canvas, loaded per call, not with the module), region crop for Circle & ask, `pageBlockText`. One place for every page render.
- `src/lib/handwritten/classify.ts`, `src/lib/prompts/classify.ts` — new: article-scale text yield (≥250 chars/page) is an article with no model call; below it a vision model reads sample pages; keyless fallback decides by yield (<40/page = handwritten).
- `src/lib/handwritten/convert.ts`, `src/lib/prompts/convert.ts` — new: the conversion job (guards, PENDING/READY/FAILED with stale-run recovery, concurrent page batches, HEADING/PARAGRAPH/LIST/TABLE/EQUATION rows with the reader's list markers and the invisible table cell separators, blocks written after the PAGE blocks). One failed batch fails the run with its reason; past 60 pages the cut is declared.
- `src/lib/parse/ingest.ts` — `ingestPdf` classifies and creates handwritten documents (bytes + PAGE blocks); `reparseDocument` takes `as: "article" | "handwritten"` for the shape switch.
- `src/app/api/documents/route.ts`, `src/app/api/uploads/complete/route.ts` — a fresh handwritten document chains conversion → glossary → recommended links in `after()`, the transcription pattern.
- `src/app/api/documents/[documentId]/page/[blockId]/route.ts` — new: PAGE block → PNG, the figure route's twin.
- `src/app/api/documents/[documentId]/convert/route.ts` — new: Retry / Convert again; glossary rebuild in `after()`.
- `src/app/api/documents/[documentId]/reparse/route.ts` — optional `{as}` body; a switch to handwritten kicks conversion.
- `src/app/api/derive/route.ts` — EXPLAIN takes `page: {blockId, region, question?}` (Circle & ask): the server renders the page and the circled crop, attaches both, and persists the streamed answer as an annotation with a region source on the PAGE block. Refuses `anchor`+`page` together. The single attached image generalized to a list.
- `src/lib/prompts/explain.ts`, `src/lib/prompts/types.ts` — the page variant: transcribe what is circled, never guess at illegible handwriting; `ctx.page`.
- `src/app/api/annotations/route.ts` — `page: {blockId, region, comment}` creates a page comment; exactly one of anchor/video/page.
- `src/lib/anchors/resolve.ts` — region sources on PAGE blocks skip the text ladder; after a shape switch they re-find their page by quoted text ("Page N") instead of orphaning.
- `src/components/reader/page-block.tsx` — new: the page image, stored marks as SVG loops carrying `data-source-id` (chip jumps and flashes land on them), the freehand draw, and the Circle & ask card (Ask / Explain / Comment, streamed answer). Marks are pure paint; the overlay hit-tests clicks, so a loop can be drawn starting over a mark.
- `src/components/reader/conversion-strip.tsx` — new: Converting… / failure + Retry / Converted text + Convert again; auto-fires for documents whose import-time kick-off died.
- `src/components/reader/reader.tsx`, `block-view.tsx`, `reader-interactions.tsx`, `src/app/n/[notebookId]/page.tsx` — PAGE blocks render through PageBlock with the strip after the last page; page marks build from the resolved sources (healed marks paint in the same render) and skip the text-highlight painting; selection capture and double-click-to-edit refuse PAGE blocks; new `pageMarksByBlock`/`conversion` props thread through.
- `src/components/reader/document-bar.tsx` — "Parse as text article" / "Open as handwritten pages" menu items (the escape hatch when the judgment got a PDF wrong); the parser-upgrade auto re-parse skips handwritten documents.
- `src/app/api/search/route.ts` — substring search skips PAGE blocks (embeddings already allowlist).
- `src/app/globals.css` — SVG marks flash by stroke under the generic `anchor-flash`.
- `src/components/guide-dialog.tsx`, `src/lib/i18n/dict/{api,common,panes,works}.ts`, `src/lib/derive/config.ts` — guide entry, en/zh strings and glossary terms (handwritten 手写 · page 页面 · conversion 转换 · Circle & ask 圈选并提问), `CLASSIFY_MODEL`/`CONVERT_MODEL`.
- `scripts/qa/mock-anthropic.mjs`, `scripts/qa/ui-handwritten.mjs` — the mock answers classify and convert prompts; a Chromium script drives the whole flow (11 checks, all passing against a local postgres: import → classification → pages → conversion → draw → Ask streams → mark paints → mark click opens the annotation).

**Decisions:**

- Handwritten documents are ordinary documents with PAGE blocks, not a new pane: the video-pane pattern was the alternative, but keeping the standard reader means converted text gets anchors, the selection popover, edit mode, and every derivation for free, and pages join the same block flow.
- Page anchors reuse `Source.region` (the §11 percent shapes) on PAGE blocks with offsets 0/0 and quotedText "Page N" — no new columns. They skip the text ladder and re-bind by quoted text after a shape switch; a page comment and a Circle & ask answer are ordinary annotation notes, so the Annotations tab, replies, attribution, and the digest need nothing new.
- Circle & ask rides EXPLAIN (one pipeline, SPEC.md §4): the optional `question` rides the existing prompt-ctx shape rather than a new DerivationType, and the server renders/crops the images from stored bytes instead of trusting a client capture.
- Classification is heuristic-first: article-scale text yield never pays a model call; only ambiguous PDFs (mostly image-only) go to vision. Misjudgments are recoverable from the document menu in both directions.
- Conversion fails whole on any failed batch rather than landing a silent gap (a declared marker only for the >60-page cap) — "never silently" outweighed partial progress; Retry is one click.
- The mock and the QA UI script extend the existing autoloop rather than adding a test framework; runs against local postgres verified import, conversion (PAGE block ids stable across Convert again), the shape switch round-trip with mark healing, and the full Circle & ask flow with zero console errors.
