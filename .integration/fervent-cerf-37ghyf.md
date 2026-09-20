# claude/fervent-cerf-37ghyf

**Intent:** Three units. (1) Let the reader start a blank document from the add-document dialog, opened straight into edit mode with the edit toolbar. (2) Put Jev (TypeSafe AI's System One decision model) behind three places: the lead tool of the selection toolbar, Stitch's route and select passes, and the nudges a reader has already earned. (3) Put Jev behind seven more: the figure audit's caption check, the sheet header and column check, the URL import's wall check, the digest's ranked cut, the tool checks with Extract's retry, the History panel's small edits, and a recording's chapters. Jev runs through OpenRouter as well as TypeSafe's own API.

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
- `src/lib/parse/figure-audit.ts`: `auditFiguresWithJev()`, one noul per short text block the regex passed over; `src/lib/parse/ingest.ts`: `saveDetail` awaits it with the title.
- `src/lib/parse/page-kind.ts` (new): `classifyPage()` (one choice over nine kinds) and `wallOf()` (a wall only under 4,000 characters, 0.7); `ingest.ts` throws `FetchPageError("wall")` before the model passes; `fetch-page.ts` exports `hostOf` and the `wall` failure; `ingest-error.ts` and `dict/api.ts`: `fetchWall`.
- `src/lib/parse/sheets.ts`: `repairSheet()` — header row (0.7 → `frozenRows` 1) and number columns (number-like text cells take the number kind); `parseDelimited` is async now.
- `src/lib/digest/rank.ts` (new): `rankDocumentsForQuestion()` orders the corpus digest's documents by one noul each when past the text budget; `api/assistant/route.ts` uses it at project scope.
- `src/lib/derive/check.ts` (new): `checkOutput()` and `flagOutput()` — the rubric's judgement criteria as nouls, a failed output flagged as a `ToolRating` with rating `flag`; `api/derive/route.ts`: Simplify and Summarize checked after the stream, Extract checked before it shows with one retry; `api/assistant/route.ts`: the answer checked; `scripts/eval/import-ratings.ts` imports flags.
- `src/lib/history/trivial.ts` (new): `trivialEdits()` — code, then one choice per short edit, the verdict written to `BlockEdit.meta.trivial`; `app/n/[notebookId]/page.tsx` marks entries; `lib/types.ts` `HistoryEntry.trivial`; `components/collab/history-control.tsx` folds runs; `dict/panes.ts` `historySmallEdits`, `historyShowSmall`, `historyHideSmall`.
- `src/lib/video/chapters.ts` (new): `chapterStarts()` and `buildChapters()`; `api/documents/[documentId]/contents/route.ts` builds chapters for a media document; `components/video/chapters-menu.tsx` (new) in the media pane's view bar; `dict/video.ts` `chapters*`; `dict/api.ts` `chaptersNeedKey`.
- `src/lib/jev.ts`: records the gateway's `usage.cost`; `src/lib/usage.ts` prices `typesafe/jev-1.13` too; `scripts/qa/mock-jev.mjs` answers `/decisions` as well.
- `src/lib/i18n/dict/panes.ts`: `blankDocument`, `blankDocumentTitle`, `untitledDocument`, en and zh.
- `.env.example`, `README.md`: `TYPESAFE_API_KEY`, `TYPESAFE_BASE_URL`, `TYPESAFE_MODEL`.
- `SPEC.md` §6 (the lead tool, the nudges), §7 (the ranked cut), §12 (small edits), §15 (the blank document, the wall check, the caption check), §22 (the passes on Jev), §25 (the check), §26 (chapters), §27 (the sheet repairs).

**Decisions:**
- Raw HTTP to Jev, not the `@typesafe-ai/sdk` package: the wire shape is three fields, and one fewer dependency. The SDK's type definitions were read to fix the shape.
- Every Jev use is additive and falls back: no key, or a failed pass, and the app runs as before. Jev never writes text and never changes stored state on its own.
- The select pass batches one part's lines per call (32 at most) rather than one line per call: the state stays small, which Jev's own docs say keeps it accurate, and calls stay in the hundreds, under the 1,200 per minute limit.
- The toolbar rows never move on a prediction; the predicted tool takes the recommended look in place. A late answer moving a button under the pointer is worse than no answer.
- The nudge step descriptions live in the route, keyed by the step ids in `nudges.tsx`; the client ignores unknown ids.
- The URL import's kind (paper, news, blog, docs, forum) is logged, not stored: storing it needs a column and a consumer, and nothing branches on it yet.
- Slides get no Jev repair: speaker notes are already separated by PowerPoint's placeholder type.
- The check holds no card: a streamed output is on screen before a check can answer, so Simplify, Summarize, and the assistant are flagged for the loop after the fact; Extract, JSON, retries once before it shows.
- The chapters' titles are their first line's opening words: Jev writes no text, and a titling model call was left out to keep one pass.
- The digest's ranked cut runs only past the text budget, so the prompt prefix stays cacheable under it.
- Verified against the live model through OpenRouter (`TYPESAFE_BASE_URL=https://openrouter.ai/api/v1`, `TYPESAFE_MODEL=typesafe/jev-1.13`): Stitch's passes, the wall check, the chapter starts, and the check all answered as designed.
- Not verified in a running app: this container has no Postgres and no Docker. The Stitch passes were run against the mock server; typecheck and eslint pass.
