# claude/pdf-handwriting-import-format-0trmcq

**Intent:** Bring the dancing/laps-running cat animation back to the upload flow — it existed in `ingest-progress.tsx`'s `IngestProgress` component, but the upload assistant box (which now drives every add per SPEC.md §15) had its own plain, cat-less step list.

**Files:**
- `src/components/reader/upload-assistant.tsx` — the box's "adding" phase now renders `<IngestProgress inline fileLabel={headline ?? subject} steps={steps} />` (the cat-bordered card) instead of the box's own bare `StepList`. `headline` (the "File i of n" / "Page i of n" line for multi-item adds) folds into `fileLabel` instead of rendering as a separate line above, since `IngestProgress` already shows a `fileLabel` row. The "review" phase (reading a URL in the sandbox, before anything is saved) keeps its own lightweight `StepList` — that step isn't "uploading," so it doesn't get the cat.

**Decisions:**
- Reused `IngestProgress`'s existing `inline` prop rather than building a second cat treatment — this is the same component/prop the older `add-document-dialog.tsx` used for its own now-dead inline progress branch, so the card-in-a-card visual (the box's own `bg-card shadow-float` around `IngestProgress`'s own `bg-card shadow-float`) is a proven, already-accepted pattern in this codebase, not a new one.
- The cat's lap animation (`.cat-runner`, `offset-path`) is `position: absolute` relative to `IngestProgress`'s own wrapper div, so it's self-contained regardless of what it's nested inside — no CSS changes needed.
