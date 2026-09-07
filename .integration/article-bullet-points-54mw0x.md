# claude/article-bullet-points-54mw0x

**Intent:** Add Distill (the article as anchored bullet points), rename the question-to-quotes page from Distill to Extract and the phrase-to-passages tool from Extract to Match-it, and add the feedback pipeline (a daily Routine that turns the inbox into pull requests and resolves feedback after a merge).

**Files:**
- `prisma/schema.prisma`, `prisma/migrations/20260907120000_keypoints/`: the KEYPOINTS derivation type and `NotebookDocument.keypoints`.
- `src/lib/prompts/keypoints.ts`, `src/lib/prompts/index.ts`, `src/lib/derive/config.ts`, `src/lib/derive/json.ts`: the Distill prompt (max effort), its registration, model settings, and output schema.
- `src/app/api/derive/route.ts`: the KEYPOINTS handler behind the heartbeat stream; spans resolve before anything persists.
- `src/app/api/notebooks/[notebookId]/documents/[documentId]/route.ts`: `removeKeypoints` on the attachment PATCH.
- `src/app/api/notes/route.ts`: origin `keypoints` lands PENDING.
- `src/lib/types.ts`: Keypoint, Keypoints, KeypointsView, keypointsStored; Match-it labels M1….
- `src/app/n/[notebookId]/page.tsx`: loads and heals the keypoints; passes them to the reader and the Distill tab; labels M1….
- `src/components/reader/keypoints-page.tsx` (new), `src/components/reader/reader-interactions.tsx`: the distilled page, its run/cancel/delete/add-to-notes, the Distill and Extract buttons and menu entries.
- `src/components/panels/distill-panel.tsx`, `src/components/reader/workspace.tsx`, `src/components/guide-dialog.tsx`, `src/components/icons.tsx` (QuoteIcon), `src/app/signin/page.tsx`: the tab, the guide, the sign-in function list.
- `src/lib/i18n/dict/*.ts`: every string of the three tools in en and zh; key prefixes map to tools (keypoints* = Distill, distill* = Extract, extract* = Match-it).
- `src/lib/digest/*`: the keypoints ride in the digest and its fingerprint.
- `src/lib/clicks.ts`: keypoints controls.
- `src/lib/parse/render-page.ts`: a copy into a plain-ArrayBuffer Uint8Array for Prisma Bytes; `next build` failed typecheck on it before.
- `src/app/api/admin/feedback/route.ts`: GET takes status, take, since.
- `.claude/skills/feedback-pipeline/SKILL.md`: the pipeline runbook.
- `SPEC.md`, `CLAUDE.md`, `README.md`: the three tools as the reader sees them, the vocabulary mapping, the pipeline.

**Decisions:**
- Code identifiers keep their names (DISTILL, EXTRACT, `distillations`, `extractions`); only user-facing strings changed. A rename of enum values and Json columns would need a data migration for no user-visible gain. The new tool is KEYPOINTS in code. CLAUDE.md's vocabulary records the mapping.
- One distillation per attachment; Distill again overwrites (like summaries), instead of a list like extractions.
- A point whose span does not resolve is dropped rather than kept as text: a bullet with nothing behind it is the model's own claim.
- The pipeline finds its pull requests by a `Feedback-Ids:` body line, not a label, so no repository setup is needed.
- The Routine itself was not created from the session (permission denied); its settings are in the session's final report.
