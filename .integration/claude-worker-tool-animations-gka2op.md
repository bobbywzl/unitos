# worker-tool-animations

**Intent:** Refresh the tool animations: every assistant surface shows a thinking indication with a loading animation while the model works, and a new highlight sweeps in left to right.

**Files:**

- `src/app/globals.css` — mark tint classes now declare `--mark-bg` so the new `.mark-sweep` can animate the same color in (background-size 0→100%, left-aligned; underline fades in behind it); `.loading-dot` keyframes softened from a jump to a swell-and-lift wave; new `.thinking-spark` (breathing spark) and `.thinking-label` (left-to-right sheen, plain color under reduced motion); `bubble-in` reworked to rise-and-sharpen (translateY + scale + blur) for all tool cards; new `.pop-in` for the selection popover and on-mark cards.
- `src/components/thinking.tsx` — new. `ThinkingIndicator` (spark + sheen label, defaults to `reader.thinking`) and `LoadingDots`, shared so every tool shows the working state the same way. Dedupes the dot markup that lived in four files.
- `src/components/reader/reader-interactions.tsx` — explain bubble, simplify card, and assistant chat use `ThinkingIndicator` while streaming/busy; the popover's Run button shows `LoadingDots` while the assistant runs; popover and on-mark cards carry `pop-in`. Fresh-span tracking for the sweep: `freshSpansRef` (keys `blockId:start:end`) marked in annotate, addToSection, explain, simplify, runAssistant, and distill add-to-notes; `freshExtractIdsRef` for extractions, whose spans sweep staggered (origin first, then passages, 90 ms apart); both cleared on document switch; a post-merge pass flags matching anchor/simplify highlights `fresh`.
- `src/components/reader/block-view.tsx` — `Highlight` gains `fresh`/`freshDelay`; the mark that paints a segment adds `mark-sweep` and an inline `animationDelay` when its highlight is fresh.
- `src/components/assistant/assistant-panel.tsx` — busy state shows `ThinkingIndicator` instead of the plain "Working…" line; the Recommended buttons use shared `LoadingDots`.
- `src/components/video/assistant-card.tsx` — busy state shows `ThinkingIndicator` instead of spinner + "Working…".
- `src/components/reader/distill-page.tsx`, `src/components/reader/corpus-distill-page.tsx` — the scanning line is `ThinkingIndicator` with the scanning label, replacing raw dots.

**Decisions:**

- The sweep marks only spans made in this session (a session-scoped key set), so marks painted on load never re-animate, and the key survives the optimistic→server swap without restarting the animation. The class stays on after the run — its resting state is pixel-identical to the plain mark.
- The sweep rides `background-image` + `background-size` rather than clip-path so the text never hides, and a multi-line span fills continuously (inline backgrounds slice one box). Link marks (`link-mark`) deliberately do not sweep — a link paints two ends across panes/documents and the visual belongs to a different interaction.
- One term for the working state: the existing `reader.thinking` key labels every surface (TKey is a global union), instead of adding a `common.thinking` twin; the distill pages keep their more specific scanning labels on the same component. No new dictionary keys.
- All new animations are gated behind `prefers-reduced-motion: no-preference`; the shimmer label falls back to plain `--sand-600` text so `background-clip: text` never freezes an unreadable gradient.
- Verified in the running app (Playwright, routes held open to freeze busy states, CDP playback rate 0.2 to photograph the sweep mid-run): popover pop-in, two-line sweep filling line 1 then line 2, settled mark, Explain bubble thinking, Run-button dots, panel thinking.
