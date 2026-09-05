# claude/analyze-table-tool-restructure-ski2ov

**Intent:** Analyze (a figure or table) answers in three fixed sections — Insights, Quantitative, Linking to context — in the card beside the article instead of a pending note, and every AI tool's prompt carries one style rule and a tighter word cap so its answer is shorter and more direct.

**Files:**
- `src/lib/prompts/analyze.ts` — the new prompt: streamed markdown in three bold-labelled sections (`ANALYSIS_SECTIONS`, per language), ≈ before estimated values, "(text)" after a value taken from the document, links to the document by `[block <id>]` and to the project when the corpus section is there, under 220 words.
- `src/lib/prompts/types.ts` — `STYLE_RULE`, the one style line every reader-facing template ends with; `corpus` on `PromptCtx` so Analyze asks for project links only when the corpus section is present.
- `src/app/api/derive/route.ts` — ANALYZE joins the streaming branch: it sees the corpus section EXPLAIN sees (scored by the whole block's text), persists in the hidden Annotations section like EXPLAIN, and ends its stream with the note token. The heartbeat JSON branch, the grid, and the `sectionId` landing are gone.
- `src/lib/derive/json.ts`, `src/lib/derive/analysis.ts` — the ANALYZE JSON schema and note-markdown builder removed; `analysis.ts` keeps only COMPARE's note text.
- `src/lib/derive/config.ts` — ANALYZE's output budget 4096 (three short sections); comments.
- `src/lib/derive/context.ts`, `src/lib/digest/build.ts`, `src/lib/digest/types.ts` — an ANALYZE annotation reads as "analysis" in the corpus section and the digest.
- `src/lib/derive/landing.ts`, `src/lib/derive/heartbeat-client.ts` — comments no longer list ANALYZE.
- `src/components/reader/reader-interactions.tsx` — `analyze()` and `explain()` share `streamBubble`: the analysis streams into the Explain card, titled Analysis under the chart glyph, with Stop, Delete, Close; the card reopens from a stored ANALYZE annotation; the toolbar button no longer has its own busy flag; `runDerivation` import dropped.
- `src/components/reader/block-view.tsx` — the narrow reader's tool icon after a mark knows the analyze tool (chart glyph, "Open the analysis").
- `src/components/panels/annotations-panel.tsx` — an Analyses group under the chart glyph in the Annotations tab.
- `src/app/n/[notebookId]/page.tsx`, `src/lib/types.ts` — annotation kind `analyze` for ANALYZE notes; it rides in `annotationBubbles` so the mark reopens the card.
- `src/lib/i18n/dict/reader.ts` — Analyzing…, Analysis, delete and removed strings; the Analyze tooltips describe the card. `analysisAdded` and `showNote` removed (no toast, no note). `dict/panels.ts` — Analyses. `dict/panes.ts` — Open the analysis. `dict/api.ts` — the old note headings and `analyzeFailed` removed.
- `src/lib/prompts/explain.ts`, `ask.ts`, `summarize.ts`, `synthesis.ts`, `distill.ts`, `compare.ts`, `find.ts`, `formalize.ts`, `simplify.ts`; `src/lib/glossary.ts`; `src/app/api/assistant/act/route.ts` — the style rule and tighter caps: Explain 150 words (was 200), Ask 150 (was 250), summaries 180 / 300 / 400 (were 250 / 400 / 600), the assistant's answer 250 unless the question needs more, the selection assistant's reply under 150; captions, compare points, find explanations, glossary definitions one sentence, two at most; Simplify keeps its rewrite close to the original's length; formalized bullets one line.
- `SPEC.md` — §4 ANALYZE destination and output contract, the style rule and caps under the pipeline; §6 the Annotations tab's groups and the reopen rule. `README.md` — the ANALYZE line.
- `scripts/qa/mock-anthropic.mjs` — the ANALYZE mock returns the three sections. `scripts/qa/ui-ai-tools.mjs` — checks the card beside the article (title, the three sections in order, ≈, Delete), that no note landed, the Annotations tab's Analyses group, and the figure route's streamed sections and note token.

**Decisions:**
- The analysis streams as markdown rather than JSON validated by Zod: the card shows it as it arrives, like Explain, and the three labels are the structure. The prompt fixes the labels per language (`ANALYSIS_SECTIONS`), so the model writes them, not the client.
- The analysis persists as an annotation (hidden Annotations section, ACCEPTED), the EXPLAIN rule from SPEC.md §1 principle 5, so it reopens from the block's side label and is searchable. An ephemeral card that vanished on close was the other reading of "just a window".
- Analyze and Explain share one card (`data-side-card="explain"`, one state) so placement, dragging, the connector line, and the narrow-reader redock hold without a second copy of the code; the kind sets the title and glyph.
- Section names: "Insights", "Quantitative", "Linking to context" (the request's words; "short insights" shortened to one word). Chinese: 洞见 / 数据 / 上下文关联.
- The 220-word cap for Analyze is above Explain's 150 because it carries three sections; the caps on the other tools came down by about a quarter to a third rather than more, so an explanation still explains.
- Analyze reads the whole block's text, not the table selection, to score the corpus passages: a selection of a few cells has no terms to match.
