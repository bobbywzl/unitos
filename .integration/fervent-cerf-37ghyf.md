# claude/fervent-cerf-37ghyf

**Intent:** Two units. (1) Let the reader start a blank document from the add-document dialog, opened straight into edit mode with the edit toolbar. (2) Put Jev (TypeSafe AI's System One decision model) behind three places: the lead tool of the selection toolbar, Stitch's route and select passes, and the nudges a reader has already earned.

**Files:**
- `src/app/api/documents/blank/route.ts` (new): `POST {notebookId, title}` (editor) creates a document with no file and no source, one empty PARAGRAPH block with `originalText: ""`, attaches it, answers `{id, title}`.
- `src/components/reader/add-document-dialog.tsx`: `onCreateBlank` prop and the Blank document button, first in the row under the queue.
- `src/components/reader/document-bar.tsx`: `createBlank()` calls the route, closes the dialog, opens the document with `edit=1`.
- `src/components/reader/reader-interactions.tsx`: `edit=1` seeds edit mode on mount and focuses the first block; the lead tool prediction (`/api/jev/lead-tool` on popover open, keyed by the popover's anchor) and the recommended look on the predicted row or bubble.
- `src/components/reader/block-view.tsx`: an empty paragraph keeps a line's height in reading mode.
- `src/lib/jev.ts` (new): the Jev client — `jevEnabled()`, `systemOne()` (raw `POST /v1/systemone`, Zod-validated answers, retries on 429/529/5xx, a 12 s timeout, usage recorded), `mapLimit()`.
- `src/lib/graph/stitch-jev.ts` (new): `jevRouteParts()` (one call per document, one noul per part; 0.4 or the document's top two) and `jevSelectLines()` (one call per 32 skeleton lines of one part, one noul per line; 0.5, most likely first per document). Either answers null on failure.
- `src/lib/graph/stitch.ts`: the Jev passes run first when the key is set; the GLM passes are the fallback. `SkeletonView` types exported.
- `src/app/api/jev/lead-tool/route.ts` (new): one choice over the kind's tools from the selection and the reader's ai-toolbar clicks of the last 90 days; confidence 0.5; writes `lead-predicted:<tool>` to ClickEvent.
- `src/app/api/jev/nudges/route.ts` (new): one noul per nudge step from the reader's click log of the last 180 days; 0.75.
- `src/components/nudges.tsx`: fetches the earned steps once per tab and passes them over.
- `src/lib/usage.ts`: `jev-latest` priced at $0.042 per million input tokens, output free; provider `typesafe`.
- `src/lib/clicks.ts`: the `lead-predicted:` row documented.
- `scripts/qa/mock-jev.mjs` (new): a deterministic Jev mock on :3398 for the QA loop.
- `src/lib/i18n/dict/panes.ts`: `blankDocument`, `blankDocumentTitle`, `untitledDocument`, en and zh.
- `.env.example`, `README.md`: `TYPESAFE_API_KEY`, `TYPESAFE_BASE_URL`, `TYPESAFE_MODEL`.
- `SPEC.md` §6 (the lead tool, the nudges), §15 (the blank document), §22 (the passes on Jev).

**Decisions:**
- Raw HTTP to Jev, not the `@typesafe-ai/sdk` package: the wire shape is three fields, and one fewer dependency. The SDK's type definitions were read to fix the shape.
- Every Jev use is additive and falls back: no key, or a failed pass, and the app runs as before. Jev never writes text and never changes stored state on its own.
- The select pass batches one part's lines per call (32 at most) rather than one line per call: the state stays small, which Jev's own docs say keeps it accurate, and calls stay in the hundreds, under the 1,200 per minute limit.
- The toolbar rows never move on a prediction; the predicted tool takes the recommended look in place. A late answer moving a button under the pointer is worse than no answer.
- The nudge step descriptions live in the route, keyed by the step ids in `nudges.tsx`; the client ignores unknown ids.
- Not verified in a running app: this container has no Postgres and no Docker. The Stitch passes were run against the mock server; typecheck and eslint pass.
