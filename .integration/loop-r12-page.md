# loop/r12-page

**Intent:** fix package 4 "page" of round 12 — the page editor's density and ease findings (PAGE12-01, 02, 03, 05, 06, 07, 08, 09, 10, 11, 12, 13, 14, 15, 16, SEL12-06, EDGE12-01, EDGE12-13 in `.qa-tmp/audit/r12/`) — by taking controls away, merging them, and cutting steps, without adding a control and without touching a reader's data.

## Findings

Before/after screenshots are under `.qa-tmp/fix/` in this worktree (git-excluded): `<ID>-before*.png` (the audit's own shot, copied) and `<ID>-after*.png` (my run). The measuring script is `.qa-tmp/page/fx.mjs` (`.qa-tmp/page/run.sh <tag> <ID…>` runs one finding per process and retries while the machine's memory kills Chromium; `.qa-tmp/page/up.sh` restarts my dev server when it is OOM-killed; `.qa-tmp/page/tablet.mjs` measures the outline button across widths). Counts are visible buttons and fields, as the audit counted them. `npx tsc --noEmit` exits 0 and eslint is clean on every file below.

### PAGE12-01. The toolbar keeps rare buttons and folds the frequent ones — fixed

Print and the spelling switch are off the Editing row (both stay in Search the menus; Viewing keeps Print), and each group carries a `fold` rank so the least used folds first instead of the rightmost.

| | before | after |
| --- | --- | --- |
| 1440, tray folded | 26 on the row, 11 in More, a 209 px gap | **34 on the row, 0 in More, a 32 px gap** |
| 1440, tray open | 18 on the row, 19 in More | **27 on the row, 8 in More** (voice, paint, zoom, styles, font, size) |
| 1000 | — | 27 on the row, 8 in More, a 13 px gap |
| 390 | 5 on the row, 32 in More, 127 px empty | **7 on the row** (Search, More, outline, status, clock, Collapse, mode), **29 in More**, a 65 px gap |

Bold, Italic, Underline, the colors, the lists, Align and the indents are on the row at 1440 and 1000; at 390 the row is Search the menus, More, and the right end, with every control one press away.

### PAGE12-02. On a phone the page is drawn at 42% — partly fixed, one question for the owner

A PDF import under 600 px now reads pageless with no bar: **zoom 0.42 with an 80 px "Read pageless / Keep pages" bar → zoom 1, 30 px lines, no bar**. A blank document in Editing is unchanged (zoom 0.419, 12 px lines).

I did not extend it to Editing, because of rule zero. The reflow is drawn by giving the page `{...pageSetup, pageless: true}`, and `areas/page.tsx` pushes that into the page store, which is what Page setup's dialog reads and saves (`page/setup-dialog.tsx:40,78`). Today that is safe only because Page setup is off in Viewing (`page/commands.ts`: `enabled: (editor) => editor.isEditable`). In Editing the dialog would open on the Pageless tab and OK would save `pageless: true` to the document — a setup the reader never asked for, on every account that holds it. Doing it properly means splitting the store's one `setup` into a saved setup and a drawn setup; 28 reads across 8 files hang off it. **Question for the owner:** should the store be split in a round of its own, or does the phone keep its pages in Editing?

### PAGE12-03. Search the menus shows nothing until a letter is typed — fixed

An empty query now lists the six menus; Right opens one, Left goes back, typing searches as before.

| | before | after |
| --- | --- | --- |
| rows with an empty query | 0 | **6** (File, Edit, View, Insert, Format, Tools) |
| rows after Right on Edit | — | 11 (Undo, Redo, Find and replace, Paste from Markdown, …) |
| rows after Left | — | 6 |
| typed "bold" | 1 | 1 (unchanged) |

### PAGE12-05. Restore asks again after Restore this version — fixed

The ask is dropped, under the owner's condition. I checked both halves in code and in the browser: `restore()` flushes the typing and POSTs the current text as a version, and refuses the restore if that POST fails (round 11's PAGE11-01), and the version list holds it afterwards. The transaction is one undo step. Ctrl+Z alone did not bring the words back in the script's run (the version view keeps the focus after Restore), so the fix rests on the version list, which the owner's condition allows ("Ctrl+Z **or** the version list brings the text back").

| | before | after |
| --- | --- | --- |
| presses to restore a version | 4 (clock → the version → Restore this version → Restore) | **3** |
| buttons in the ask | 2 | **0 (no ask)** |
| the replaced text afterwards | a version | a version (`versions (newest 3)` lists the unnamed version the restore wrote) |

### PAGE12-06. Voice typing needs two microphone presses — fixed

| | before | after |
| --- | --- | --- |
| presses to start listening | 2 | **1** |
| presses to stop | 1 | 1 (the toolbar's button, or Click to stop in the box) |

### PAGE12-07. The outline hides the line ends of a pageless import — fixed

The pageless column is worked out from the room left beside the open outline, and the outline panel lost its one-tab rows.

| | before | after |
| --- | --- | --- |
| line ends under the notes tray, outline open | ~50 px of every line | **0** (text right edge 982, tray 1036) |
| rows above the first heading | 2 ("Document tabs", "Tab 1") | **0** |

### PAGE12-08. The open suggestion card covers the lines under the caret — fixed

With no card column the card draws as the one-line card, as it already did in a split view.

| | before | after |
| --- | --- | --- |
| card at 1000 | 624×94 | **624×44** |
| lines covered at 1000 | 3 | **2.8** |
| card at 390 | 262×94 | **262×44** |
| lines covered at 390 | 8 | **6.3** |

The 390 figure is high only because a blank document in Editing is still drawn at 42% (12 px lines under a 44 px card) — see PAGE12-02. The card itself is one line at both widths.

### PAGE12-09. The grammar card offers Accept twice — fixed

The replacement words are the accept; the Accept button is gone.

| | before | after |
| --- | --- | --- |
| buttons on the card | 3 (the words, Accept, Ignore) | **2** ("He has", Ignore) |
| presses to accept | 1 | 1 |

### PAGE12-10. "Hide the menus" is a button at every width — fixed

| | before | after |
| --- | --- | --- |
| Hide-the-menus buttons on the row | 1 | **0** |
| ways to the command | 1 button + 1 command | **1 command** (Ctrl+Shift+F, found by "title row" and by "hide the menus") |
| header height when hidden | 114 px | **78 px** |

### PAGE12-11. Two Extract controls open the same page — fixed

| | before | after |
| --- | --- | --- |
| Extract controls on screen | 2 | **1** (the rail's) |

### PAGE12-12. 13 "Read this block whole" icons at rest — fixed

| | before | after |
| --- | --- | --- |
| core icons in view at rest | 13 | **0** |
| core icons with the pointer on a core | 13 | **1** ("Read this block whole") |

### PAGE12-13. Rulers in Viewing and on a phone; the title row repeats the document pill — fixed

| | before | after |
| --- | --- | --- |
| rulers, PDF at 1440 in Viewing | 2 | **0** |
| header, PDF at 1440 in Viewing | 114 px | **98 px** |
| rulers at 390 | 2 | **0** |
| title row at 390 | shown | **hidden** |
| header at 390 | 114 px | **62 px** (16 % of an 844 px screen, from 28 %) |

### PAGE12-14. Two save states with two wordings — fixed

| | before | after |
| --- | --- | --- |
| save states on screen with the page editor open | 2 ("Saved" in the top bar, the cloud) | **1** (the toolbar's status) |
| wordings | 2 | **1** ("All changes saved in Unitos") |

### PAGE12-15. Dialogs close three different ways — fixed

No ✕ where Cancel or OK stands. After: Make a copy `Cancel, OK`; Compare documents `Cancel`; Translate document `Cancel`; Details `OK`; Page setup `Cancel, OK`; Preferences `Cancel, OK`; Word count `OK`.

| | before | after |
| --- | --- | --- |
| closings in use | 3 (✕ + Cancel, Cancel only, ✕ + Cancel + OK) | **1** (the footer's button) |
| dialogs with a ✕ beside a Cancel or OK | 6 (Compare documents, Translate document, Preferences, Fonts, the dropdown editor, Insert drawing, Insert chart) | **0** |

### PAGE12-16. Show changes paints a whole first version — fixed

| | before | after |
| --- | --- | --- |
| marked runs on the oldest version | every word | **0** |
| marked runs on the second oldest | — | 0 for this document's versions (its text did not change between them) |
| Show changes switches | 2 | 2 (unchanged) |

### SEL12-06. "Highlight" names two tools — fixed

| | before | after |
| --- | --- | --- |
| tools named "Highlight" in the page editor | 2 | **1** (the annotation highlight) |

The toolbar's tool is "Text background", not the audit's "Background color": the table cell menu already has Background color, and two names that close together read as one tool. The hues under it keep their names (Highlight in clay, in sage, in gold, in plum).

### EDGE12-01. Page editor chrome pinned on a phone — fixed

| | before | after |
| --- | --- | --- |
| pinned chrome at 390 | 114 px (title row, toolbar, ruler) | **62 px** |
| share of a 844 px screen | 28 % | **7.3 %** |
| the title on screen | twice (the document pill and the title row) | **once** (the document pill; File > Rename renames) |
| controls in the pinned header | 1 row of 5 behind More | 6 (More, the outline, the status, the clock, Collapse, the mode) |

### EDGE12-13. The outline button covers the first letters of lines — fixed

The canvas measures the margin beside the text column and, with no room for the button, the toolbar's row carries it (`outlineRoom` on the page store). Measured with `.qa-tmp/page/tablet.mjs` on the Markdown import, scrolled 600 px:

| pane | before | after |
| --- | --- | --- |
| 390 | the button over the words | **in the toolbar's row** |
| 820 | the button over 1 line | **in the toolbar's row** |
| 1024 | the button over 1 line | **in the toolbar's row** |
| 1280 | the button over the words | **in the toolbar's row** |
| 1440 | beside the column, 0 lines | beside the column, 0 lines |

| | before | after |
| --- | --- | --- |
| lines whose first letters the floating button covers | 1–3 at every scroll, from 390 to 1280 | **0 at every width** |
| names for the panel | 2 ("Show tabs & outlines", a second name for Contents) | **1** ("Show the outline") |

At 820 and 1024 the script still counts 1–2 text rects inside the button's box: those are lines scrolled under the pinned header band, which every control in the header shares and which SPEC calls for ("the text scrolled under it shows through"). Nothing floats over the column any more.

## Files

- `src/components/docs/toolbar.tsx` — Print and the spelling switch off the Editing row; a `fold` rank per group; the Hide-the-menus button removed and its command renamed Hide the title row; the right end takes `status`; a `narrowPane` outline button; Search the menus gets the menu list (PAGE12-01, 10, 03, 13, 14, EDGE12-13).
- `src/components/docs/toolbar/overflow.tsx` — groups fold by `fold` rank, then right to left, instead of right to left alone; the width stage no longer named after Extract (PAGE12-01, 11).
- `src/components/docs/toolbar/search-menus.tsx` — an empty query lists the menus; Right opens one, Left goes back (PAGE12-03).
- `src/components/docs/toolbar/dialog.tsx` — no ✕ on a dialog that has a footer button (PAGE12-15).
- `src/components/docs/page/compare-dialog.tsx`, `typing/preferences-dialog.tsx`, `toolbar/fonts-dialog.tsx`, `insert/dropdown-ui.tsx`, `insert/drawing-dialog.tsx`, `insert/chart-dialog.tsx` — `closeButton={false}` where the footer closes (PAGE12-15).
- `src/components/docs/word-count.tsx` — OK alone, and the checkbox writes its choice at once (PAGE12-15).
- `src/components/docs/versions/version-view.tsx` — Restore runs at once; the ⋮ Restore waits in a ref for its version to be shown; the oldest version marks nothing (PAGE12-05, 16).
- `src/components/docs/docs-editor.tsx` — the pane's width measured on the shell; the title row hidden under 600 px; the status and the version clock moved into the toolbar's row; a narrow paged document reflows in Viewing; the ruler off when narrow; the outline button read from the store (PAGE12-02, 13, 14, EDGE12-01, EDGE12-13).
- `src/components/docs/areas/page.tsx` — the ruler only in Editing; no rulers on a narrow pane; the pageless column fits beside the open outline; the outline button's room measured (PAGE12-07, 13, EDGE12-13).
- `src/components/docs/page/store.ts` — `outlineRoom` on the state, and `useOutlineRoom` for the toolbar (EDGE12-13).
- `src/components/docs/page/outline.tsx`, `css/page.css` — the one-tab rows gone (PAGE12-07).
- `src/components/docs/page/reflow.tsx` — comment only (the renamed outline).
- `src/components/docs/typing/voice-typing.tsx`, `areas/typing.tsx` — the box starts listening when it opens; one toggle for the toolbar and the key (PAGE12-06).
- `src/components/docs/suggest/under-words.ts` (new), `suggest/layer.tsx`, `suggest/card.tsx`, `css/suggest.css` — the open card draws as one line where there is no card column (PAGE12-08).
- `src/components/docs/layer/collapse.tsx`, `css/collapse.css` — the core's read-whole button is quiet, and shows under the pointer (PAGE12-12).
- `src/components/docs/css/toolbar.css` — the right end's status; the status words hidden when the end folds (PAGE12-01, 14).
- `src/components/proofing/proofing-card.tsx` — the replacement words are the accept (PAGE12-09).
- `src/components/save-indicator.tsx` — the app's indicator yields while a page status is on screen (PAGE12-14).
- `src/components/reader/reader-interactions.tsx` — the page editor's second Extract removed (PAGE12-11); edited in place, one hunk.
- `src/components/reader/reader-panes.tsx` — comment only (the renamed outline).
- `src/lib/i18n/dict/docs.ts`, `docsPage.ts`, `docsTyping.ts`, `docsVersions.ts` — Text background; Hide/Show the title row; Show/Hide the outline; the keys the dropped controls used are gone; zh in step.
- `SPEC.md` — the lines these findings touch.

## Decisions

1. **"Text background", not the audit's "Background color"** (SEL12-06). The table cell menu already has Background color; two names that close together read as one tool. One term per concept.
2. **Viewing keeps Print** (PAGE12-01). A reader who only reads still prints; the Editing row is where the space is short.
3. **Fold ranks** (PAGE12-01): search 100, text (B/I/U) 90, lists 75, insert 70, paragraph 65, history 60, indent 50, colors 45, styles 40, size 35, font 30, tools (voice, paint, zoom) 10. The rank is the reader's use, not Google's row order; a tie folds right to left as before.
4. **The status and the version clock sit in the toolbar's row at every width** (PAGE12-13, 14), not only on a phone: two rows of chrome for one line of state is the finding, and one place to look is easier than two.
5. **Status words only for offline and error** (PAGE12-14). The cloud alone says "saved" and "saving"; the caption is for the two states a reader must act on. Only the app's *failed* state is merged into the page's — merging "saving" would spin the cloud for as long as a note draft is dirty, which is not the document's state.
6. **The title row is hidden under 600 px of pane** (PAGE12-13, EDGE12-01), with the title in the document pill and File > Rename, and the status and the clock in the toolbar's row. The reader can bring it back with Ctrl+Shift+F.
7. **PAGE12-02 is done for Viewing only.** See the finding above: a browser-only pageless view in Editing would let Page setup save `pageless: true` on the document. Rule zero outranks the finding. The owner's call is noted as a question.
8. **"Show the outline", not "Contents"** (EDGE12-13). Contents is a fixed term for an article's parts; the panel is the outline.
9. **The outline button's place is measured, not guessed by pane width** (EDGE12-13). A width threshold fails at 1024, where the pane is wide but the column's margin is thin. The canvas measures the margin and the toolbar reads one flag, so exactly one button shows at every width.
10. **The under-words store is module-wide** (PAGE12-08). In a split view with one wide pane and one narrow, both panes draw the one-line card. Per-pane would be truer; one module store is small, and a split view has no card column in either pane in practice.
11. **Voice: the toolbar's button and Ctrl+Shift+S toggle the box, and the box starts listening** (PAGE12-06). The box stays the listening card, as every other surface's is.
12. **PAGE12-12 is done with `quiet` plus the page editor's own CSS**, not by changing `CoreToggle`'s own default: `CoreToggle` belongs to package 1 (TOOL12-18), and the block reader's own core button is not this finding.
13. **I repaired my own test document** (`Page r12`): an aborted PAGE12-05 run had left " Fixafterword" typed inside "Charlie paragraph." and I put the paragraph back. No reader's data; no other row touched.

## Needs

1. **Package 5 (nav), NAV12-14:** the page editor toolbar's Extract is gone (PAGE12-11), so the rail's Extract tab must keep "Extract from the article" for page editor documents. It is the only Extract for them now.
2. **Package 5 (nav), ask (2):** there is no Extract icon in the page editor's chrome any more, so there is nothing to match to the rail's. Nothing for me to do.
3. **Package 5 (nav), ask (4):** the page editor's Editing mode pill uses the pencil (`EditIcon`, `docs/toolbar/mode.tsx`), as Google Docs does, and SPEC §29 names the mode pill. If the rail's History now uses a pencil too, the second symbol should move on the rail's side: one symbol per concept, and the pencil already means "you are editing" in this pane.
4. **Package 5 (nav), NAV12-11:** half of it falls out of PAGE12-13 — in a split view the page editor's pane is under 600 px, so its title row is hidden and the document is named twice instead of three times. The pane's document picker is in `reader-panes.tsx`/`workspace.tsx`, which is package 5's; I did not touch it.
5. **Every package's scripts:** the aria-labels changed. "Show tabs & outlines" → "Show the outline" / "Hide the outline"; "Hide the menus" → "Hide the title row" / "Show the title row"; "Highlight color" → "Text background". The page editor's save status is now "See document status: …" in the toolbar, not in the app's top bar.
6. **Nothing needed in `workspace.tsx`** for PAGE12-14: the app's indicator yields through `save-indicator.tsx`.
7. **A shared-stash incident, for the record.** `git stash` is one list for every worktree of this repository. A `git stash pop` of mine applied and dropped loop/r12-tools' stash `a138f692`. I put it back with `git stash store -m "WIP on loop/r12-tools: 0c1d0af Merge main into the reader interaction loop branch" a138f692…`, reverted their files out of my tree, applied my own entry by sha `e23b8ff`, and dropped only mine. Their stash is whole. I used no stash afterwards.
