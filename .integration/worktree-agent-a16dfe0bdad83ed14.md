# worktree-agent-a16dfe0bdad83ed14

**Intent:** The image row: two to four images or figure objects side by side on one line of the page editor (a blank document or an import), made by a drop on an item's side or with Side by side with next image, taken apart with Separate images, with every item keeping its block id and paragraph index row.

**Files:**
- `src/components/docs/insert/image-row.ts` (new) — the `imageRow` node (content `(image | figure){1,4}`, not selectable, renders a flex div); Side by side with next image, Separate images, the drop beside an item (`joinBeside`), the move of a dragged image or figure as itself (keeps its block id), the upright drop line, and the appendTransaction that makes a row of one its item again.
- `src/components/docs/insert/image-row-menu.tsx` (new) — the two menu items for the image toolbar's More menu, with the New glow.
- `src/components/docs/extensions.ts` — registers `ImageRow`; TextAlign takes `imageRow` (the row's alignment).
- `src/components/docs/insert/figure.ts` — a figure object drags in Editing (draggable, its body the drag handle; never in Viewing or Suggesting); `--docs-figure-w` for its width in a row; a paste whose figures all stay out drops their row.
- `src/components/docs/insert/image.ts` — `--docs-img-w` (the width an image asks for in a row); the reader's figure gesture never sees a figure's drag either.
- `src/components/docs/insert/image-controls.tsx` — the row items in More; in a row the layouts other than In line and the image's own alignment are off, with the reason.
- `src/components/docs/insert/context-menu.tsx` — a right-click selects a figure object too; the row items for an image or a figure; `NewMenuItem` for the New glow.
- `src/components/docs/insert/icons.tsx` — two symbols.
- `src/components/docs/css/insert.css` — the row's drawing (flex, 6 pt gap, bottom aligned, one scale factor), In line inside a row, the drop caret hidden during a side drop.
- `src/components/docs/typing/drop.ts` — `DropLine` exported, with an upright line.
- `src/components/docs/typing/keys.ts` — Backspace after a row selects its last item.
- `src/components/docs/typing/paste.ts` — the caret under a new image in a row goes under the row.
- `src/components/docs/typing/markdown.ts` — a row's images on one line.
- `src/components/docs/page/download.ts` — Markdown: a figure's pictures stay in the row, captions after it; the web page's row CSS.
- `src/components/docs/page/paginate.ts` — a row is one unit, as tall as its tallest item.
- `src/components/docs/page/compare.ts` — a compared copy never keeps a row of one or none.
- `src/components/docs/suggest/assistant.ts` — the assistant's new blocks after an item go after its row.
- `src/lib/docs/schema.ts` — `imageRow` in RICH_NODE_TYPES (the save would drop it otherwise); `withImageRows` (the sanitizer and the figures' check keep a row of two to four, unwrap any other into its items, never drop an item).
- `src/lib/docs/blocks.ts` — comment only: the walk already visits a row's items, left first.
- `src/lib/docs/ops.ts` — a block route's sibling goes beside the row; removing an item unwraps a row of one.
- `src/lib/docs/export.ts` — Word: a one-row table without borders, cells bottom-aligned, items scaled by one factor.
- `src/lib/docs/merge.ts` — a row on one side and its item on the other merge into the row with the change; a block both copies hold that the merge left out goes back (this also fixes the same loss for a line one copy put in a list).
- `src/lib/i18n/dict/docsInsert.ts`, `works.ts`, `common.ts` — the strings (en, zh), the release notification, "image row" 图片行 in the zh glossary.
- `src/lib/releases.ts` — release 2026-10-16, feature `imageRow`.
- `SPEC.md` §29 (Image rows bullet, paragraph index, pagination, image drag) and §30 (figures drag in Editing); `CLAUDE.md` vocabulary: image row.
- `scripts/qa/image-row-check.ts` (new) — block identity through rows, the sanitizer, the figures' check, the block routes, and the merge.
- `scripts/qa/image-row-page.mts` (new) — the commands, undo and redo, normalization, Suggesting mode, Markdown, and the html copy in a headless page editor.
- `docs/screenshots/image-row/*.png` — screenshots from a page that mounts the page editor's own extensions, CSS, image toolbar, and right-click menu.

**Decisions:**
- The row is a container, never an indexed node: each item keeps its own FIGURE row and block id, so no anchor moves.
- Content is `{1,4}`, not `{2,4}`: a row of one exists for one transaction (an item dragged out) and the appendTransaction makes it the item, in the same undo step; a stored row of one (left by a server edit) still loads.
- The row is not selectable or draggable as a whole: a dragged row would be pasted with fresh ids.
- A dragged image or figure now moves as itself and keeps its block id (ProseMirror's own drop strips ids, which gave a moved image a new one). In Suggesting mode the old path stands and a figure does not drag.
- In Suggesting mode rows are neither made nor separated (the library would record a move as a copy under new ids); inserting or deleting an item or a row is a suggestion as before.
- "The image's menu" is the image toolbar's More menu (`toolbar/image-menu.tsx` is the Insert image menu, so it is unchanged).
- Side by side with next image needs the next block right after the item's line; an empty line between stops it (nothing is deleted to make a row).
- The app could not be run against its database here (the local Postgres refused the configured credentials, and changing its auth was refused), so the screenshots come from a harness page with the real editor code instead.
