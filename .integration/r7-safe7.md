# r7-safe7

**Intent:** Fix round 7 review findings REV7-02, REV7-05, REV7-06 and REV7-07, and re-prove REV7-01 (already in the base 6cba8f59).

**Files:**
- `src/app/api/notes/route.ts`, `src/lib/constants.ts`: REV7-02. Any whole-number `x-unitos-replay` takes the keeping path; the duplicate lookup starts at min(queue time, now - REPLAY_SKEW_MS). `REPLAY_MAX_AGE_MS` is replaced by `REPLAY_SKEW_MS`.
- `scripts/qa/gather-replay-check.mjs`: the old, ahead and bare-1 headers now expect kept, each sent twice (no second note).
- `src/lib/graph/stitch.ts`: REV7-05. `copyPair(a, b, generated?)` counts containment only with a generated end or at `COPY_SHARE` (0.8); the call site passes whether an end is in a generated document.
- `scripts/qa/stitch-budget-check.ts`: the commentary case and the 0.8 case (334 ok).
- `src/app/api/links/[linkId]/hidden/route.ts`: REV7-06. `&edit=<editId>` answers 409 `api.linkUndoStale` when the newest LINK_REMOVE of the link in the project is another edit.
- `src/components/graph/link-panel.tsx`, `src/components/panels/annotations-panel.tsx`: Undo keeps its Remove's editId in a ref and sends it.
- `src/lib/i18n/dict/api.ts`: `linkUndoStale` en and zh.
- `scripts/qa/link-remove-check.ts` (40 ok), `scripts/qa/ui-link-remove.mjs`: the race and the Undo request's `edit`.
- `src/lib/document-order.ts`: REV7-07. `ATTACH_ORDER` / `ATTACH_ORDER_NEWEST`.
- `src/app/n/[notebookId]/page.tsx`, `notes/page.tsx`, `annotations/page.tsx`, `src/app/api/notebooks/[notebookId]/offline/route.ts`, `src/lib/graph/data.ts`, `src/lib/graph/view.ts`, `src/lib/digest/build.ts`, `src/lib/connect.ts`, `src/lib/graph/stitch.ts`: use it.
- `SPEC.md`: the offline Sync bullet (replay), §13 Undo, §22 copy check, §3 attach order (after NotebookDocument).

**Decisions:**
- REV7-02's optional queue fallback (put a 4xx'd note back in the gather draft) is not built: every quote failure now takes the keeping path; what still answers 4xx (a deleted section, a bad body, no access) is what SPEC calls stale.
- REV7-06: the newest removal is looked up among LINK_REMOVE edits on the link's from-document whose `notebookId` or `hiddenIn` names the project (50 newest). An Undo with no editId (a queued Remove, an older tab) keeps working as Restore.
- REV7-07: the newest-first list (listGenerated) breaks ties by documentId desc, the reverse of attach order.
