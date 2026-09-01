# claude/content-upload-assistant-7x0eq7

**Intent:** The upload assistant: a box that opens on every add, reviews a URL's content in a private server-side sandbox before anything is saved (recommendations, multi-part page picking, a split question for very long content), and takes upload instructions it either follows during ingest or honestly answers that it cannot.

**Files:**

- `SPEC.md` — new §14 documenting the upload assistant.
- `src/components/reader/upload-assistant.tsx` — the box: review state, page checkboxes, split pills, instructions field with per-instruction replies, in-box add progress (one streamed request per page or file).
- `src/components/reader/document-bar.tsx` — every add path (Add URL, Upload PDF, Upload video, drag-and-drop, file pickers) now opens the box; `uploadFiles`/`uploadChunked` moved into the box. The media-figure toast event and re-parse keep the old floating-card path.
- `src/lib/upload-assistant.ts` — server lib: `reviewUpload` (sandbox fetch, ingest-identical parse, same-site link harvest from the raw DOM, model review validated against the real link list) and `checkInstructions` (model for url/pdf; deterministic honest reply for video; keyless fallback reply).
- `src/app/api/uploads/review/route.ts` — POST: with `url`, streamed review; with `kind` alone, plain-JSON instruction check. Editor-gated like `/api/documents`.
- `src/lib/prompts/upload-review.ts`, `src/lib/prompts/upload-instructions.ts` — the two prompt templates (one function per file).
- `src/lib/parse/split.ts` — block partitioning at the shallowest repeating heading level; exact part count via smallest-neighbor merges; page-estimate constants shared with the review.
- `src/lib/parse/ingest.ts` — `IngestOptions {instructions, split}` on `ingestUrl`/`ingestPdf`; split saves N documents (`sourceUrl#unitos-part-N`, per-part cited references, `extra` in the return); split parts and re-parse guard; `review` ingest stage.
- `src/lib/parse/url.ts` — `parseUrl` split into `fetchPageHtml` + `parseHtmlContent` so the review parses the same HTML it fetched once.
- `src/lib/parse/structure.ts` — both AI passes accept optional instructions; instructed structure pass raises the drop ceiling 0.4 → 0.9.
- `src/app/api/documents/route.ts` — URL schema gains `instructions`/`split`; split attaches every part with per-part glossary and connect scans; PDF multipart gains `instructions`; `maxDuration` 120 → 300 for the split parse.
- `src/app/api/uploads/complete/route.ts` — `instructions` for chunked PDFs.
- `src/lib/ingest-response.ts` — `progressResponse` generic over its terminal line.
- `src/lib/derive/config.ts` — `UPLOAD_MODEL`.
- `src/lib/i18n/dict/panes.ts`, `api.ts`, `common.ts` — box strings en+zh; three api strings; zh glossary gains 上传助手/审阅/页面/拆分/上传要求.

**Decisions:**

- Multi-page adds loop on the client, one `/api/documents` request per page: serverless time limits hold per page, one dead page never kills the batch, and progress is per page. `pages` never became a server-side parameter.
- The instruction check runs before the first Add, and an unfollowable instruction stops that Add once so its reply is read; Add again proceeds with only the feasible part. A reasonable alternative was replying during the paste — rejected because the honest reply should precede saving.
- Split parts carry `sourceUrl` + `#unitos-part-N`: dedupe on re-add works, provenance stays visible, and `reparseDocument` refuses them (a re-parse would paste the whole page over one part). Re-adding the bare URL without split creates a fresh whole document by design.
- Instructions on PDFs run the existing URL structure pass over the parsed blocks — only when instructions were given, so uninstructed PDF ingest is byte-identical to before.
- Video/audio adds get a deterministic honest reply (no model call): nothing in media ingest can follow paste instructions, and pretending to check would be dishonest. Library attach opens no box (nothing new uploads).
- Review degrades without `ANTHROPIC_API_KEY` or on model failure to parsed facts plus the length-triggered split question; adding is never blocked by a failed review.
- Verified live against a local Postgres with Playwright: URL review → instruction pause → add; 56-page article → split question → exactly 3 parts saved with heading titles; PDF box → add; video box honest note; Escape/cancel. Model-dependent outputs (summary, page list, per-instruction replies) ran on the keyless fallback here — worth one keyed pass after merge.
