# busy-einstein-9uyeil

**Intent:** Add Define: the first row of the AI toolbar, right under the highlight colors, shown only when the selection is one word and never on Chinese text, on every document the reader draws (articles, PDFs, transcripts, formalized articles, slides, sheets, converted handwritten pages, blank documents in the page editor, cores in the collapsed view); it shows what the word means in its sentence. Then let the reader stop Collapse and the other long runs the same way.

**Files:**
- `prisma/schema.prisma`, `prisma/migrations/20260928100000_define_derivation/migration.sql` — `DEFINE` in `DerivationType`. The pipeline's per-type config is keyed on the enum, and the ToolRating comment names the new tool.
- `src/lib/define.ts` — `definable(text)`: the "one word" rule (no space or word-separating punctuation inside, quotes and punctuation around it ignored, 64 characters, no Chinese or Japanese characters), shared by the toolbar and the route. `defineKey` for lookups.
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
- `scripts/eval/cases.ts`, `scripts/eval/rubrics.ts`, `scripts/eval/run.ts`, `scripts/eval/import-ratings.ts` — the Define rubric, seven one-word cases (two with the Chinese interface on English text), the adapter with its mechanical checks, and ratings imported as cases.
- `scripts/qa/mock-kimi.mjs`, `scripts/qa/ui-define.mjs` — the mock's Define answer, and the browser check (44 checks: the route, an article, a phrase, a sentence, a sentence end, a key term, a core, a transcript, slides, a sheet, a blank document in the page editor, Chinese, a touch screen).
- `SPEC.md` (§2, §4, §6, Phase 7, §18, §25, §28), `README.md`, `CLAUDE.md` (definition in the vocabulary) — the docs, and the rule "Stop on every long run" in §6.
- `src/components/thinking.tsx` — `StopPill`: the Stop pill inside a button whose run is on its way; a press on the button stops the run.
- `src/components/reader/reader-interactions.tsx`, `src/lib/i18n/dict/reader.ts` — Collapse: the button reads Collapsing… with Stop while the cores are written; a press aborts the request (the route already passed `req.signal` to the model calls), and leaving the document does too.
- `src/components/reader/contents-menu.tsx`, `src/lib/contents.ts`, `src/components/video/chapters-menu.tsx`, `src/lib/video/chapters.ts`, `src/app/api/documents/[documentId]/contents/route.ts`, `src/lib/i18n/dict/video.ts` — Generate contents and Generate chapters: Stop, and the route passes the abort to the model call and the Jev pass; nothing is stored.
- `src/components/reader/translation-bar.tsx`, `src/app/api/documents/[documentId]/translate/route.ts`, `src/lib/i18n/dict/panes.ts` — Translate: Stop; the route stores nothing once stopped.
- `src/components/video/video-pane.tsx`, `src/components/video/transcript.tsx`, `src/app/api/documents/[documentId]/speakers/route.ts`, `src/lib/video/transcription-job.ts` — Detect speakers: Stop; a stopped run saves nothing.
- `src/components/video/assistant-card.tsx` — Regenerate article: Stop (the route already passed the abort on).
- `src/components/graph/graph-overlay.tsx` — Recommend links: Stop on the abort that was wired and never pressed.
- `src/components/outline/use-outline.ts`, `src/components/outline/note-card.tsx`, `src/lib/notes/merge.ts`, `src/app/api/notes/merge/route.ts`, `src/lib/i18n/dict/outline.ts` — Merge with AI: Stop on the card's Merging line; the notes come back, and the route merges nothing once stopped.
- `src/components/assistant/assistant-panel.tsx`, `src/lib/i18n/dict/assistant.ts` — the Summary card keeps Stop in its header for the whole stream.
- `src/lib/clicks.ts` — the Stop controls in the admin clicks page's AI group.
- `public/sw.js` — the service worker lets every call go to the network untouched while the browser is online. It used to fetch every AI call itself, and a call it fetched did not end when the page stopped it: Translate, Detect speakers, and Recommend links ran on, and a stopped Merge with AI still merged. Offline, an AI call still answers 503 with the plain message.
- `scripts/qa/mock-hang.mjs`, `scripts/qa/ui-stop.mjs` — a model that never answers, and the browser check (23 checks, with the service worker in control of the page) that presses each Stop and reads that the call was closed and nothing stored.

**Decisions:**
- Define persists nothing: a word lookup is not an annotation, so it adds no mark, no Annotations entry, and no kind color. Viewers may call it.
- The definition opens inside the toolbar under the row (like the assistant's box), not in a card beside the article: it is one or two sentences, read at a glance.
- GLM 5.3 Flash at low effort, with the whole document as the cached prefix and no corpus section: fast, and the document's own definitions are in reach.
- A one-word key term's Define shows the glossary's stored definition with no call; a longer key term has no Define (its hover shows the definition); any other definition is kept for the session by block and word.
- One word only, after the reader saw Define on a five-word list: a phrase, a list, or a sentence never shows it. Chinese and Japanese text never shows it either, since their words cannot be told apart; the Chinese interface still gets Define on English words, answered in Chinese (the reader's choice).
- Define is on the figure toolbar too, for a word selected in a caption; never on the hold-and-circle gesture, and never on equations.
- The template carries the glossary's "one sentence, two at most" rule in place of `STYLE_RULE`.
- The assistant's answers and the extract pages keep their own selection controls; Define is not added there.
- A long run's Stop is the button that started it (it reads what runs, with a Stop pill), not a new control beside it: the reader's eye is already there.
- Stopped runs store nothing, with two exceptions that follow the existing rules: Recommend links keeps the links it proposed before the stop and still counts the run (recorded before the scan starts), and Detect speakers lets its Gemini call finish on the server (the Gemini client takes no abort) while dropping the answer.
- Merge with AI must check the stop before the route's fallback to Join text, or a stopped AI merge would merge anyway.
- The service worker answers an AI call only when the browser says it is offline (`navigator.onLine`). Before, it answered the offline message whenever its own fetch failed; now a call made while the browser says online but the network is down fails with the browser's network error, as every other call does.
- Imports (adding a document, Re-parse, Transcribe again, the handwritten conversion) keep no Stop: they save progress on the server as they go, and stopping one needs its own design.
