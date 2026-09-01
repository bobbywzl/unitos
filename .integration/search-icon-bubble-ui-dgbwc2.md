# search-icon-bubble-ui-dgbwc2

**Intent:** Move the search icon from the workspace header to the right side of the assistant button at the article's top left; clicking it expands a half-transparent bubble that searches the entire project, and it hides on scroll like the assistant button.

**Files:**
- `src/components/reader/workspace.tsx` — removed the header `ProjectSearch` and its import.
- `src/components/reader/reader-interactions.tsx` — the article menu now spans the pane (`inset-x-4`, pointer-transparent except its controls); a search icon sits beside the assistant button in one row; new `searchOpen` state mounts the `ProjectSearch` bubble under the row; opening the search closes the assistant menu and vice versa; container `z-10` → `z-30` so the open bubble paints over the sticky Distill controls and pane two's document select.
- `src/components/reader/project-search.tsx` — reworked from icon-plus-dropdown to the bubble only (`open`/`onClose` props, state stays mounted so a reopened bubble keeps its last query); half transparent (`bg-card/55 backdrop-blur-md`), `pop-in` expand from the top left, closes on Escape, outside click (`data-project-search` marks bubble and icon), and result click.

**Decisions:**
- The bubble lives per reader pane inside the article menu, exactly like the assistant button: per-pane in split view (two icons), absent on video documents (their assistant is the toolbar, and they keep their own Find panel) and on the empty project. The header spot is gone everywhere — "move", not "copy".
- Half transparent = `bg-card/55` with `backdrop-blur-md`; the article stays readable through the bubble.
- Search behavior unchanged: the existing `/api/search` route (semantic with `OPENAI_API_KEY`, substring without), 450 ms debounce, hits open `?doc=…&block=…` and flash the block.
- Trigger width is fixed at `w-[34px]` with stretched height: flex resolves main size before cross-axis stretch, so `aspect-square` could not mirror the assistant button's height.
- Verified in the running app (local docker Postgres, Playwright): icon beside the button, translucent bubble, hits across both documents, block jump, hide on scroll down and return at top, both panes in side view, 390 px viewport, outside-click close. Lint, tsc, and build pass.
