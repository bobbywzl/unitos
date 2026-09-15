# claude/pensive-mccarthy-s06py3

**Intent:** Delete the Explain and Match-it tools, fold their work into the selection assistant (the passages across the document that match the selection, cited in the answer), sharpen every prompt template, add the tool quality loop (eval harness, ratings, `/toolloop` skill), and label where each assistant history conversation comes from.

**Files:**
- `src/lib/prompts/explain.ts`, `extract.ts` (deleted), `index.ts`: EXPLAIN serves Circle & ask's Ask only; EXTRACT has no template.
- `src/lib/prompts/act.ts` (new): the selection chat's prompt, moved out of the route, with the matches step; `types.ts`: `GROUNDING_RULE`, `SPECIFICITY_RULE`.
- `src/lib/prompts/simplify.ts`, `salience.ts`, `keypoints.ts`, `summarize.ts`, `distill.ts`, `analyze.ts`, `ask.ts`, `find.ts`, `formalize.ts`, `synthesis.ts`: sharpened; same structure, grounding and specificity rules, "state the claim, not that a claim is made".
- `src/app/api/derive/route.ts`: EXTRACT handler and the text, figure, and video Explain paths removed; EXPLAIN requires a page and a question.
- `src/app/api/assistant/act/route.ts`: `matches` in the plan, resolved against the real text, appended to the reply as the Passages section.
- `src/components/reader/reader-interactions.tsx`, `video/video-pane.tsx`, `reader/page-block.tsx`, `guide-dialog.tsx`, `app/signin/page.tsx`, `lib/clicks.ts`, `src/lib/i18n/dict/*`: the two tools' entries, keys, and copy removed; stored extractions and explanations still render and delete.
- `src/components/assistant/assistant-history.tsx`, `src/app/n/[notebookId]/assistant/page.tsx`, `dict/assistant.ts`: the origin badge (Sidebar assistant / Selection chat / Tool conversation); no reader link for the sidebar's.
- `prisma/schema.prisma`, `prisma/migrations/20260915120000_tool_rating`, `src/app/api/ratings/route.ts`, `src/components/rating-buttons.tsx`, placements in the tool cards, the selection chat, and the assistant panel: the ratings.
- `scripts/eval/*` (new), `.claude/skills/toolloop/SKILL.md` (new), `package.json` (`eval`, `eval:ratings`, `typecheck`, `tsx`), `.gitignore`: the loop.
- `scripts/qa/mock-kimi.mjs`, `ui-ai-tools.mjs`, `ui-motion-stop.mjs`: the mock answers matches, keypoints, find; the UI checks no longer expect Explain or Match-it.
- `SPEC.md` (§1, §4, §6, §7, §11, §16, §21, new §25), `README.md`, `TIERS.md`.

**Decisions:**
- EXPLAIN stays as a DerivationType (Prisma enum and stored annotations) and still runs for Circle & ask's Ask on a handwritten page; the Explain button there is gone. Removing the enum value would need a data migration.
- Stored Match-it extractions keep rendering (layer, card, Delete) so no reader loses data; Regenerate is gone because nothing makes new ones.
- The matches ride inside the reply text as a Passages section with `[block <id>]` tags (the existing ¶ chip), not as a new client structure, so history, the digest, and the log carry them with no new code.
- The eval runs the templates directly on the model without a database or the Next server; the assistant case uses the document prefix as its system message, not the digest.
