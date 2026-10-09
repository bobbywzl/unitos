# loop/r14-page

**Intent:** fix package 5 "page" of round 14: PAGE14-03, 04, 05, 08, 09, 10, 12, 13, 14 and EDGE14-08 (`.qa-tmp/audit/r14/page.md`, `edge.md`). Fixes fold, move or speed up controls. They add no visible control.

## Findings

The screenshots are in this worktree's `.qa-tmp/fix/<ID>-before.png` and `<ID>-after.png` (git-excluded), and are copied to `/mnt/project-files/interaction-loop/round-14/img/` under the same names. Each before shot was taken on the base code (ff4a7fd's `src/components/docs`, `docsPage.ts` and `SPEC.md` checked out in the worktree and then restored; no stash). Each after shot was taken on this branch. The scripts are the audit's, copied to `.qa-tmp/page/` and pointed at :3144 and my own project "Fix r14 page". I added `t10-renders.mjs` (a correct render counter), `t11-load.mjs` (what the pane shows while a long import loads, with a CPU profile), `t-contents.mjs`, `ph03b-pages.mjs`, `runN.sh` and `after.sh`. The logs are `.qa-tmp/fix/<ID>-<tag>-<n>.out`.

### PAGE14-03. Find and replace was not modal: fixed
`k05-replace-menu.mjs`, `k06-replace-again.mjs`.

| | before | after |
| --- | --- | --- |
| `aria-modal` | none | `true` |
| Tab from Find | 5 fields, then out to the page and the header | 5 fields, Close, then back to Find |
| Escape with the focus outside | dialog stays open | closes; caret back in the text |
| click in the text, then Escape | stays open | closes |
| Ctrl+H on the open dialog | focus stays in the text | focus in Find |

The dialog uses the app's one focus trap (`installModalTrap`) and one escape layer (`useEscapeLayer`). `FindReplaceDialog` takes a `focusToken`. Shots: `PAGE14-03-before.png`, `PAGE14-03-after.png`.

### PAGE14-04. Undo and Redo were behind More tools on touch: fixed
`c02-touch-rows.mjs`. On a coarse pointer the history group folds last (`fold: 95`; it stays 60 for a mouse). Undo is on the row at 844×390 and 820×1180 (before: `undo: false` at both; after: `true`). Align and Line & paragraph spacing go into More tools there instead. 1000×900, 1180×820 and 915×412 are unchanged. Shots: `PAGE14-04-before.png`, `PAGE14-04-after.png`.

### PAGE14-05. A sideways phone left 190 px for text: fixed
`ph02-landscape.mjs 844x390`. A pane under 500 px tall now reads pageless in every mode, the same way a pane under 600 px wide does, with no ruler. On that short pane the text column starts 24 px under the toolbar instead of 70 px.

| 844×390 | before | after |
| --- | --- | --- |
| header bands | 68 + 78 (toolbar and ruler), zoom 0.912, pages | 68 + 62, no ruler, zoom 1, pageless |
| first paragraph's top | y 255 (audit) | **y 197** (the heading at about y 155) |
| Page setup's OK | y 383, under the screen | y 314, in view |

Only the drawn view changes. The stored page setup is not touched (round 13's split between the saved and the drawn setup), and Show pages still goes back. Shots: `PAGE14-05-before.png`, `PAGE14-05-after.png`.

### PAGE14-08. Each key re-rendered the toolbar: fixed (speed only, same behavior)
The audit's counter compared alternates and counted subtrees that did not take part in a commit, so it over-counted. The reader's header (DocumentBar and the rest) did not re-render per key even before. `t10-renders.mjs` counts the way React DevTools does. The numbers below are from the dev server with five other workers on 4 cores.

| | before | after |
| --- | --- | --- |
| 15 keys (`t10 blank keys`) | 18 commits, 159–255 renders (8 insert hosts and LinkBubble on every key) | **0 commits, 0 renders** |
| 132 keys and their saves (`t10 blank long`) | 143 commits, 1,548 renders | **2–8 commits, 6–42 renders** (the save status and its icon) |
| toolbox open (`t10 blank toolbox`) | 2 commits, 166 renders | 3 commits, 150 renders (that run also changed the style row's value) |
| `t01-typing.mjs blank 1440`, 134 keys: key event p50 / p90 | 48–64 / 88–224 ms (4 runs) | 40–48 / 64–104 ms (3 runs) |
| keys ≥ 100 ms | 11, 22, 28, 39 | 14, 8, 5 |
| long tasks while typing | 4–12 (299–1,101 ms) | 2–6 (170–505 ms) |
| frames over 50 ms | 15–39 | 6–17 |

How it works:
- `useEditorTick(editor, idle)` skips a transaction when the host drew nothing and still draws nothing.
- LinkBubble keeps its state when there is still no link at the caret.
- The save state and the Unitos tools reach the memoized toolbar row through a small store (`useLive`/`LiveSlot`), not through new props.
- Undo and Redo read the history in their own `HistoryButton`.
- The row's ResizeObserver also watches its right end, so it still refits when the status's words change.

Shots: `PAGE14-08-before.png` and `PAGE14-08-after.png` are the same typed page, which shows the behavior is the same.

### PAGE14-09. A dialog opened by the pointer drew the focus ring: fixed
`k03-dialog-ring.mjs`. Details opened from the menus by mouse: before, the focused button showed `outline: solid 2px`; after, `none`. A module-level tracker records the last input. A dialog opened by the pointer carries `data-quiet` until the first key, which brings the ring back. Word count, Preferences and Page setup were already quiet and stay so. Shots: `PAGE14-09-before.png`, `PAGE14-09-after.png`.

### PAGE14-10. Dialogs on a sideways phone: fixed
`ph03-dialogs.mjs 844x390` and `ph03b-pages.mjs 844x390` (Show pages first). A dialog is a column: its body scrolls and its title and buttons stay.

| 844×390 | before | after |
| --- | --- | --- |
| Page setup: Cancel / OK | y 383, cut | y 314 |
| Watermark: Cancel / OK | y 433, cut | y 314 (after Show pages; pageless, it waits for pages as SPEC says) |
| Preferences, Word count | the whole dialog scrolled | only the body scrolls |
| Special characters | 120..478, 88 px off the screen | 8..382, its body scrolls |

Shots: `PAGE14-10-before.png`, `-after.png`, `-before-special-characters.png`, `-after-special-characters.png`, `-after-watermark.png`.

### PAGE14-12. The table's pills: fixed
`f01-image.mjs 1440|390`. The column pill now stands on the table's top border, centered on it (`translate(-50%,-50%)`). Before, it stood 30 px above the table and covered "text goes on". The row pill is never left of the pane's edge: on a phone its x is 2–28, where before it was cut at 0–14. Shots: `PAGE14-12-before.png`, `-after.png`, `-before-390.png`, `-after-390.png`.

### PAGE14-13. "Outline" for the contents: fixed
`t-contents.mjs`. "Show the outline / Outline / Hide the outline" became "Show the contents / Contents / Hide the contents"; the zh strings are 显示目录 / 目录 / 隐藏目录. Search the menus still finds the panel by "outline" and "大纲". The panel is now named Contents, so an import's parts under the headings lose their own "Contents" title, which had no style and sat at x 0. They follow the headings under a line. Shots: `PAGE14-13-before.png`, `PAGE14-13-after.png`.

### PAGE14-14. ⋮ beside ⋯: fixed
`c03-glyphs.mjs` (its detector now reads the icon's shape). All six places now draw ⋯ (`MoreHorizIcon`): the comment card, the version row, the image toolbar's More, the toolbar's More tools, the find bar, and the autocorrect bubble. `MoreVertIcon` is gone from `docs/icons.tsx`. Shots: `PAGE14-14-before.png`, `PAGE14-14-after.png`.

### EDGE14-08. The page editor's empty pane while it loads: fixed; the long import's freeze: not fixed
`t11-load.mjs` on the 1,001-paragraph Markdown import.
- **Empty pane: fixed.** The frame now draws 10 pulsing gray lines where the words will stand, with `aria-busy`. Reduced motion stops the pulse. Before: 0 lines and no `aria-busy` at +500 and +1,500 ms, and at +3,000 ms in 2 of 3 runs. After: 10 lines and `aria-busy` until the words come.
- **Load time: the same.** The words came at +3,000, +5,000 and +5,000 ms before, and at +5,000 ms in 3 warm runs after.
- **The freeze: not fixed.** The longest load task was 2,965, 1,455 and 1,162 ms before, and 1,545, 1,662 and 1,456 ms after; at load average 15–19 that is noise. It is Tiptap's `EditorContent` mount: `createNodeViews` for 1,001 paragraphs, run twice under StrictMode in dev. That is library work, so I left it.
- **Corrections to commit messages.** Commit ae7acfd says "SPEC.md §26"; the line is in §30. Commit 1785578: Its message says skipping the second `setEditable` saved 616 ms. The before profiles do not show it: `setEditable` took 1–8 ms there. The guard stays, because it skips a call that does nothing, but it is not a measured speed gain.

Shots: `EDGE14-08-before.png` and `EDGE14-08-after.png` are at +1,500 ms; the other times are in `.qa-tmp/fix/EDGE14-08-<tag>-<ms>.png`.

## Files

- `src/components/docs/insert/ui.tsx`: `useEditorTick(editor, idle)` (08).
- `src/components/docs/insert/{at-menu,chip-cards,image-controls,equation,hosts}.tsx`: each host's idle test (08).
- `src/components/docs/insert/table-controls.tsx`: the idle test (08) and the pills' places (12).
- `src/components/docs/link-dialog.tsx`: LinkBubble keeps its state when there is still no link (08).
- `src/components/docs/docs-editor.tsx`:
  - `useLive`/`LiveSlot`; `SaveStatus` reads a live value (08).
  - A short pane reads narrow (05).
  - `setEditable` only when it changes (EDGE14-08).
- `src/components/docs/toolbar.tsx`: `HistoryButton` (08); the history group's fold on a coarse pointer (04).
- `src/components/docs/toolbar/overflow.tsx`: the observer on the right end (08); ⋯ (14).
- `src/components/docs/toolbar/dialog.tsx`: the dialog body scrolls (10); `data-quiet` after a pointer (09).
- `src/components/docs/css/toolbar.css`, `src/components/docs/css/insert.css`: dialog layout (10); the column pill (12).
- `src/components/docs/areas/page.tsx`: the 24 px top on a short pane (05).
- `src/components/docs/frame.tsx`, `src/components/docs/frame.css`: the loading lines (EDGE14-08).
- `src/components/docs/typing/find-ui.tsx`, `src/components/docs/areas/typing.tsx`: Find and replace is modal (03); ⋯ (14).
- `src/components/docs/page/outline.tsx`, `src/components/docs/css/page.css`: no second Contents title (13).
- `src/components/docs/page/commands.ts`: the "contents" and "大纲" keywords (13).
- `src/lib/i18n/dict/docsPage.ts`: `showOutline`, `hideOutline`, `tabsOutlines`, en and zh (13).
- `src/components/docs/icons.tsx`: `MoreHorizIcon` replaces `MoreVertIcon` (14).
- `src/components/docs/typing/autocorrect-bubble.tsx`, `insert/image-controls.tsx`, `versions/version-view.tsx`, `layer/comment-card.tsx` (the glyph only, line 259, and its import): ⋯ (14).
- `src/components/docs/toolbar/spacing.tsx`, `src/components/docs/css/versions.css`: comments say ⋯ (14).
- `SPEC.md`: the lines listed under Needs.

## Decisions

- **The 08 numbers use a corrected counter.** The audit's 428 toolbox renders and "the header per key" came from a counter that over-counts. I measured with `t10-renders.mjs` and report both sides with it.
- **The toolbox-open renders (150) were left as they are.** They are the toolbox itself and the toolbar's style row reacting to the selection. That is real work, not a wasted render.
- **What leaves the row for Undo (04).** On a coarse pointer at 844×390 and 820×1180, Undo and Redo stay on the row, and Align and Line & paragraph spacing move into More tools. A mouse keeps the old order.
- **The short pane's top room (05).** It is 24 px only under 500 px tall. Taller panes keep Google's 70 px.
- **The column pill straddles the border (12).** The audit asked for "inside the table's box". Inside, it covers the header cell's words; straddling covers neither those nor the line above (at 390 it touches the line's descenders by about 2 px).
- **The EDGE14-08 mount cost is left.** It is library work (node views for every paragraph). A virtualized editor would be a different project.
- **The ring after a pointer (09).** The dialog does not draw the ring until a key is pressed. I did not use `focus({focusVisible:false})`, because Chromium 141 ignores it.

## Needs

- **nav (package 4):**
  - Save for offline appears late, and History shifts 48 px while a document loads (`workspace.tsx` / `collab/history-control.tsx`).
  - The Reader view button moves during the load (`reader-panes.tsx`).
- **notes (package 3):** `layer/comment-card.tsx`'s trash hunk is theirs. I changed only the import line (`MoreVertIcon` → `MoreHorizIcon`) and the glyph at line 259. Their branch may need the same import.
- **Any branch that imports `MoreVertIcon` from `@/components/docs/icons`** will fail to build after this merge; use `MoreHorizIcon`. No other r14 worktree adds one today.
- **i18n:** only the values change, en and zh, for `docsPage.showOutline`, `docsPage.hideOutline` and `docsPage.tabsOutlines`. No key is added or removed.
- **SPEC.md lines changed:**
  - §30 Imports, Reading and editing: a pane shorter than 500 px reads pageless, and its text column starts 24 px under the toolbar.
  - §29 and §30: the toolbar's fold order (on a touch screen Undo and Redo fold last); ⋮ → ⋯ in 5 places; "outline panel" → "contents panel" and "(Show the contents)".
  - §29: the contents panel's parts sit under a line, with no second Contents title.
  - §29: the loading frame's lines; Find and replace is modal; the table pills' places.
- **Data:** none touched by any commit (rendering, layout, focus and words only). My test project "Fix r14 page" (`cmuzfdm4e00007d4h08ptzebt`) and its documents were made through the app for these checks and are still there. Nothing else was written or deleted.
