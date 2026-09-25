# busy-einstein-9uyeil

**Intent:** Add Define: the first row of the AI toolbar, right under the highlight colors, shown only when the selection is one word or one phrase, on every document the reader draws (articles, PDFs, transcripts, formalized articles, slides, sheets, converted handwritten pages, blank documents in the page editor, cores in the collapsed view); it shows what the word means in its sentence.

**Files:**
- `prisma/schema.prisma`, `prisma/migrations/20260928100000_define_derivation/migration.sql` — `DEFINE` in `DerivationType`. The pipeline's per-type config is keyed on the enum, and the ToolRating comment names the new tool.
- `src/lib/define.ts` — `definable(text)`: the "one word or one phrase" rule (6 words, 64 characters, 12 CJK characters, no sentence end, no CJK clause break), shared by the toolbar and the route. `defineKey` for lookups.
- `src/lib/prompts/define.ts`, `src/lib/prompts/index.ts` — the DEFINE template: the word's meaning in its sentence, the document's own definition when it has one, one sentence, and a second only when the everyday meaning differs; in the reader's language.
- `src/app/api/derive/route.ts` — DEFINE through the one pipeline: the anchor is required, it must be one block and pass `definable` (400 `api.defineNeedsWord` otherwise), it streams text like EXPLAIN, persists nothing, and viewers may run it like FIND and ASK.
- `src/lib/derive/config.ts`, `src/lib/feature-models.ts`, `src/app/admin/gateway/page.tsx`, `src/lib/i18n/dict/admin.ts` — the model (GLM 5.3 Flash), effort (low), and output budget; the `define` feature, so the admin can change its model and usage records it.
- `src/components/reader/reader-interactions.tsx` — `define` in the text and figure toolbars; `offersDefine`; the row as the toolbox's first row (on a coarse pointer, right after the colors row); the definition panel under it (the word, the streamed definition, Stop, the rating); the glossary's definition for a key term with no call; a session cache by block and word; the call stops when the toolbar closes; the lead-tool prediction sends Define only when it shows.
- `src/components/icons.tsx` — `DefineIcon`, an open book.
- `src/app/api/jev/lead-tool/route.ts` — Define is one of the tools Jev can predict as the lead.
- `src/components/rating-buttons.tsx`, `src/app/api/ratings/route.ts` — `define` ratings.
- `src/lib/clicks.ts` — `define` counts as an AI toolbar function on the admin clicks page.
- `src/lib/releases.ts`, `src/lib/i18n/dict/works.ts`, `src/components/guide-dialog.tsx` — the 2026-09-25 release (dashboard notification, New glow on the row) and the guide's entry.
- `src/lib/i18n/dict/reader.ts`, `src/lib/i18n/dict/api.ts`, `src/lib/i18n/dict/common.ts` — the strings in English and Chinese; 定义 in the zh glossary.
- `scripts/eval/cases.ts`, `scripts/eval/rubrics.ts`, `scripts/eval/run.ts`, `scripts/eval/import-ratings.ts` — the Define rubric, seven cases, the adapter with its mechanical checks, and ratings imported as cases.
- `scripts/qa/mock-kimi.mjs`, `scripts/qa/ui-define.mjs` — the mock's Define answer, and the browser check (37 checks: the route, an article, a phrase, a sentence, a sentence end, a key term, a core, a transcript, slides, a sheet, a blank document in the page editor, Chinese, a touch screen).
- `SPEC.md` (§2, §4, §6, Phase 7, §18, §25), `README.md`, `CLAUDE.md` (definition in the vocabulary) — the docs.

**Decisions:**
- Define persists nothing: a word lookup is not an annotation, so it adds no mark, no Annotations entry, and no kind color. Viewers may call it.
- The definition opens inside the toolbar under the row (like the assistant's box), not in a card beside the article: it is one or two sentences, read at a glance.
- GLM 5.3 Flash at low effort, with the whole document as the cached prefix and no corpus section: fast, and the document's own definitions are in reach.
- A key term's Define shows the glossary's stored definition with no call; any other definition is kept for the session by block and word.
- Define is on the figure toolbar too, for a word selected in a caption; never on the hold-and-circle gesture, and never on equations.
- The template carries the glossary's "one sentence, two at most" rule in place of `STYLE_RULE`.
- The assistant's answers and the extract pages keep their own selection controls; Define is not added there.
