# claude/worker-screenshot-ui-updates-nbjnn3

**Intent:** Reshape the reader's guide dialog: a Distill card leads, the selection section header reads "Select text and use the AI toolbar" with the tablet line removed, and the Reading and Editing sections are gone.

**Files:**
- `src/components/guide-dialog.tsx` — new Distill card at the top, in the same emphasized card style as Circle & ask; the tablet line under the selection header is removed; the Reading and Editing sections are removed; the header comment names the four remaining parts.
- `src/lib/i18n/dict/works.ts` — `guideSelectHeader` reworded (en + zh); `guideSelectTouch` removed; three new keys `guideDistillHeader`, `guideDistillBody`, `guideDistillNotesBody` (en + zh); every Reading and Editing key removed (`guideReadingHeader` through `guidePrintBody`, `guideEditingHeader` through `guideAnchors`, and `guideDistillBody1`/`guideDistillBody2`); `guideDistill` kept because the Side panel section still uses it; `firstStepsGuide` now says "Distill first" (en + zh) because it named what the guide leads with.
- `SPEC.md` — the two sentences that said the guide leads with Circle & ask (§ Welcome flow, § Circle & ask) now say Distill leads, then Circle & ask.

**Decisions:**
- "Add Distill to the top" read literally: the Distill card is the first section, above Circle & ask. The alternative was placing it second and keeping Circle & ask as the lead. Because Distill is first, the first-steps card copy and the two SPEC sentences were updated so nothing still claims Circle & ask is first.
- The Distill card body is two paragraphs of two or three sentences each, matching the Circle & ask card and the previous commit's "shorter descriptions" direction. It keeps the flow (press Distill at the top right, one question, distilled page, quotes with captions, jump to quote, Add to notes files a pending note, Distill tab lists every distillation) and drops the old Reading entry's details on Cancel, Delete, and the progress bar.
- The tablet line under the selection header was removed together with the header, since the screenshot showed both and the request said "remove this".
- The now-unused dictionary keys were deleted rather than left in place. `TKey` is derived from the dictionaries, so leaving them would still type-check but leave dead strings in both languages.
- Validation: `npx next typegen` then `npx tsc --noEmit` pass; `npx eslint` on the two changed source files passes. No test references the guide.
