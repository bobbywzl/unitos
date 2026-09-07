# claude/article-gif-sidebar-layout-92lw9w (round 2)

**Intent:** A selection over several blocks is one passage for every tool — the tint covers the whole selection from the moment the pointer lifts, Explain, Simplify, the assistant, comments, highlights, and Add to notes work on all of it, and Simplify's sentence mirroring pairs rewritten sentences with source sentences across blocks; the browser render never loses a script-drawn figure to a failed chart capture, and the document bar says when a re-parse left a caption without its figure.

**Files:**
- `src/lib/anchors/passage.ts` — new: `segmentsSchema`, `resolvePassage` (each segment through the ladder, one per block, in block order), `passageSources`.
- `src/lib/derive/context.ts` — `passageContext`: the segments' quotes one paragraph each, context before the first and after the last.
- `src/app/api/derive/route.ts`, `src/app/api/annotations/route.ts`, `src/app/api/notes/route.ts`, `src/app/api/assistant/act/route.ts` — take `segments` beside the anchor; one source per segment.
- `src/lib/sentences.ts` — a line break is a sentence boundary, so the passage's numbering is the per-block numbering.
- `src/components/reader/reader-interactions.tsx` — `Anchor` carries `segments`; the selection captures one segment per block; the selection tint, the card anchor tint, the fresh sweeps, the optimistic marks, Read aloud, and Simplify's mirroring cover every segment; `truncated` now means an equation or page was left out.
- `src/lib/i18n/dict/reader.ts`, `src/lib/i18n/dict/panes.ts` — the popover's note; the document bar's re-parse figure line.
- `src/lib/parse/render-page.ts`, `src/lib/parse/capture-animation.ts` — the scrolled page is serialized before the capture and stands when the capture fails or runs out of time; the clock install failing is logged, not fatal; the loop recording stops at the deadline; render failures log their reason.
- `src/lib/parse/ingest.ts`, `src/components/reader/document-bar.tsx` — the re-parse's save stage carries the figure check with `scriptedFigures`; the silent re-parse shows one notice line when a caption is left without its figure.
- `SPEC.md` — §5 passages, §6 the tint over the passage, §15 the re-parse notice.

**Decisions:**
- A passage stays several single-block sources rather than a new multi-block source shape: the ladder, orphaning, jumps, and the Annotations tab already work per source.
- Links and Extract keep the first segment: a link end and an extract origin are one span by design.
- The sanitizer's segments cap is 40 blocks.
- Type check and lint did not run in this session: the sandbox refused installing the repository's dependencies.
