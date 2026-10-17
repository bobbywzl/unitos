# loop/r13-page

**Intent:** fix package 5 "page" of round 13 — the page editor findings PAGE13-01, 02, 04, 05, 06, 07, 08, 11, with TOOL13-05 and EDGE13-01 (the image toolbar on a phone), EDGE13-07, EDGE13-11, EDGE13-14 and NAV13-09 (`.qa-tmp/audit/r13/`) — by folding, merging and moving controls, never adding one, and without changing a reader's stored data; PAGE13-01 first, under rule zero.

## Findings

Screenshots are under `.qa-tmp/fix/` in this worktree (git-excluded): `<ID>-before*.png` (the audit's own shot, copied) and `<ID>-after*.png` (my run). The scripts are the audit's, copied to `.qa-tmp/page/` and pointed at :3144 and my own documents, plus mine: `p01-proof.mjs` (PAGE13-01's four save checks), `reload-choice.mjs`, `p04-imgbar.mjs`, `k04b-review.mjs`, `k07-wordcount.mjs`, `n09-chrome.mjs`. `.qa-tmp/run.sh` retries a script while the machine's memory kills Chromium or the server (no retry is counted as a failed fix).

### PAGE13-01. A phone in Editing drew pages at 42% — fixed (rule zero proven in the database)

The page store's one `setup` is split into the saved setup and the drawn view: `setup` is only ever the saved setup, and a new `reflowed` flag says the pages are drawn pageless in this browser. `drawnSetup()` / `useDrawnSetup()` / `drawnPageless()` give what draws its setup. Under 600 px every mode now reads a paged document pageless; Show pages (Search the menus > View) goes back, and that choice now holds after a reload (it was lost on a phone: the pane's width is measured after the first draw, after the choice was read).

| 390×844 touch | before | after |
| --- | --- | --- |
| blank document, Editing: zoom, line, caret | 0.419, 12 px, 7 px | **1, 35.3 px, 16 px** |
| PDF import, Viewing → Editing → Suggesting | 30 → 12 → 12 px | **30 → 30 → 30 px** |
| Page setup in Editing opens on | Pages (the drawn setup would have opened Pageless) | **Pages** (the saved setup) |
| Show pages, then reload | pageless again | **pages kept** |

Rule zero, the four checks the audit asked for (`p01-proof.mjs`, PATCH bodies captured, then the row read with psql, then a reload):

| check | PATCH sent | stored `pageSetup` after |
| --- | --- | --- |
| (a) phone, Editing, Page setup, OK with no change (and Text width: Wide) | **none** | **NULL, unchanged** (`.qa-tmp/fix/PAGE13-01-db-before.txt`: NULL before) |
| (b) phone, Editing, Show pages, Insert › Page numbers › Apply | 1, `pageless: false`, the footer number | `pageless: false` + the footer, as asked |
| (c) 1440, a header typed, the window narrowed to 390 before the save | 1, `pageless: false`, the header | `pageless: false` + "Header kept" |
| (d) phone, Format › Switch to Pageless format | 1, `pageless: true` | `pageless: true`, as asked |

The PDF import's stored setup read the same JSON before and after every phone run in Editing and Suggesting. Screenshots: `PAGE13-01-before-blank-editing.png`, `-after-blank-editing.png`, `-before-pdf-editing.png`, `-after-pdf-editing.png`, `-after-proof-a..d.png`.

### PAGE13-02. The phone's toolbar row kept room empty — fixed

After the greedy fold, a folded group that fits in the room left comes back, the most used first; Viewing's one group is four that fold by use (Zoom 10, Print 20, Add comment 70, Search the menus 100).

| | before | after |
| --- | --- | --- |
| 390 Editing: on the row / in More / widest gap | 7 / 29 / 65 px (Undo behind More) | **9 / 27 / 13 px** (Search the menus, **Undo, Redo**) |
| 390 Viewing: on the row / in More / gap | 6 / 4 / 102 px (no Search the menus) | **9 / 1 (Zoom) / 13 px** (Search the menus, Print, Add comment) |
| Undo on a phone | 2 taps | **1** |
| Search the menus on a phone, Viewing | 2 taps | **1** |
| 1440 tray folded; 1440 tray open; 1000 | 34+0; 27+8; 27+8 | unchanged |

Screenshots: `PAGE13-02-before-390-{editing,viewing}-more.png`, `-after-…`.

### PAGE13-04 (with TOOL13-05's toolbar part and EDGE13-01). The image toolbar ran off a phone — fixed

Under a 620 px window the image toolbar folds: the five layouts become one Text wrapping menu whose face is the current layout (the five modes are its rows, checked), the Assistant keeps only its symbol, and Replace image and Reset image go to the top of its More. Crop, Mask, the border trio and More stay on the row, so Border weight and dash are reachable on a phone.

| 390 | before | after |
| --- | --- | --- |
| controls on the row | 14 | **8** |
| width | 593 px | **345 px** |
| off screen | 6 (border ×3, Replace, Reset, More) | **0** |
| 820 | 593 px, fits | unchanged |

Screenshots: `PAGE13-04-before-390-image-toolbar.png`, `PAGE13-04-after-390-toolbar.png`, `-wrap-menu.png`, `-more.png`.

### PAGE13-05. Shift+F10 dropped the spelling suggestions — fixed

The key path asks `misspellingAt` for the word at the caret, as the pointer path does; the menu opens again when the suggestions arrive, so the first suggestion takes the highlight.

| | before | after |
| --- | --- | --- |
| Shift+F10 on "recieve": rows | Cut, Copy, Paste… | **receive, relieve, Add to dictionary, Ignore all**, Cut, Copy |
| highlighted | (Paste) | **receive** |
| fix the word by keys | no way | **2 keys** (Shift+F10, Enter) |

Screenshots: `PAGE13-05-before-shiftf10.png`, `-after-shiftf10.png`.

### PAGE13-06. One suggestion could not be accepted without a pointer — fixed

Review suggested edits (Ctrl+Alt+O U) now puts the focus on Accept in the card of the suggestion at the caret (else the first). Tab → Reject, Enter presses, the next suggestion's Accept takes the focus (the page when none is left), Escape goes back to the caret. Measured (`k04b-review.mjs`): focus after the chord `Accept suggestion` (was the text); Tab `Reject suggestion`; Escape → the page; Enter accepted "Twosug" (marks: plain) and moved to the next card's Accept; Tab, Enter rejected "Keysug"; the last leaves the focus in the page. Tab in Suggesting still types a tab (Docs' way, unchanged). Screenshots: `PAGE13-06-before-review-focus.png`, `-after-review-focus.png`, `-after-settled.png`.

### PAGE13-07. Word count: Enter did nothing — fixed

A toolbar dialog with no form and nothing to type in (a checkbox at most: Word count, Details, Line numbers, Preferences) opens with the focus on its last footer button. Word count: focus `OK` (was the checkbox), Enter closes it, Tab reaches the checkbox. Dialogs with a field keep the focus on their first field. Screenshots: `PAGE13-07-before-word-count-focus.png`, `-after-…`.

### PAGE13-08. Three focus looks on one row — fixed

Every control of the toolbar row shows a 2 px clay ring on `:focus-visible` (`--docs-blue`, which is clay), offset 2 px, 6 px on a New glow. Tab 1–4 from the title (Search the menus, the status, the clock, Collapse): before fill / ring / ring / nothing; after **ring ×4** (`solid 2px rgb(174, 99, 50)` each). Screenshots: `PAGE13-08-before-ring-1..4.png`, `-after-ring-1..4.png`.

### PAGE13-11. The grammar card spent a row on Ignore — fixed

Ignore stands at the end of the replacement's row; the reason under it. Card **244×120 → 244×75**. Screenshots: `PAGE13-11-before-grammar-card.png`, `-after-…`.

### EDGE13-07. Phone landscape pinned 43% of the height — fixed

The title row also starts hidden when the pane is under 500 px tall. 844×390, Markdown import: pinned chrome **166 → 130 px** (the app header 68 + the page editor's header 62). Screenshots: `EDGE13-07-before-landscape.png`, `-after-landscape.png`.

### NAV13-09. A split pane named its document again in the title row — fixed (the page editor's part)

The page editor starts with its title row hidden in a pane of a split view, found from the DOM (the pane header stands just before the reader's root), so no prop crosses package files. Side by side at 1440: title rows **2 → 0**, the first line **y 302 → 244**. Screenshots: `NAV13-09-before-split.png`, `-after-split.png`. Not done (nav's files): the import line in the pane select's tooltip.

### EDGE13-11. Two "More" buttons on one phone screen — fixed

The toolbar's ⋮ is named **More tools** (zh 更多工具, new key `docs.moreTools`); the reader's bar keeps More. The image toolbar's own ⋮ keeps `docs.more` (it is only on screen with an image selected).

### TOOL13-05 — the toolbar part fixed (above); the bar part is not mine

The image bar's coarse sizes (chips, Send, Reject, Accept at `pointer-coarse:py-1.5`) are in `reader-interactions.tsx` (package 2).

### EDGE13-14. The block reader's floating band — not fixed, not the page editor's

The band is `[data-article-band]` in `reader-interactions.tsx`, the block reader's; left for the lead (see Needs).

### EDGE13-05 in my files

None of the controls EDGE13-05 lists are in this package's files. The only hover-only control left in `components/docs/**` is a pageless heading's fold arrow (`css/page.css` `.docs-fold`), a rare Docs control; I left it.

## Round 12's page measures re-run (`fx.mjs`, `.qa-tmp/fx.out`)

All 18 hold on this branch (several runs crashed on the shared machine's memory and were run again; `.qa-tmp/fx.out`):

| id | now | result |
| --- | --- | --- |
| PAGE12-01 | 1440 34+0 (gap 32); tray open 27+8; 1000 27+8; 390 **9+27** (Undo, Redo on the row) | holds; 390 better (PAGE13-02) |
| PAGE12-02 | PDF 390 Viewing zoom 1, 30 px, no bar; blank 390 Editing **zoom 1, 35.3 px** | holds; Editing now too (PAGE13-01) |
| PAGE12-03 | 6 menus; Right 11; Left 6; "bold" 1 | holds |
| PAGE12-05 | 3 presses, no ask; restored (`v05.mjs`: the version view closes, the typed word gone) | holds |
| PAGE12-06 | 1 press listens; a second stops and closes the box | holds |
| PAGE12-07 | outline open: text right edge 982, tray 1036 | holds |
| PAGE12-08 | 1000: 624×44, 2.8 lines; 390: 342×44, **2.8 lines** (was 6.3) | holds; 390 better (PAGE13-01) |
| PAGE12-09 | "He has", Ignore; card 244×75 | holds (PAGE13-11) |
| PAGE12-10 | 0 buttons; header 114 → 78 px; found by "title row" and "hide the menus" | holds |
| PAGE12-11 | one Extract | holds |
| PAGE12-12 | 1 icon at rest (Collapse heading), 1 under the pointer | holds |
| PAGE12-13 | Viewing rulers 0, header 98; 390 header 62, no title row | holds |
| PAGE12-14 | one status; Saving… → All changes saved in Unitos | holds |
| PAGE12-15 | footer closings only | holds |
| PAGE12-16 | oldest marks 0 | holds |
| SEL12-06 | Text color, Text background | holds |
| EDGE12-01 | 390 pinned header 62 px; Viewing row Search the menus, Print, Add comment, More tools | holds |
| EDGE12-13 | the outline button in the toolbar's row at every scroll | holds |

`npx tsc --noEmit` exits 0 (run with my dev server stopped); `npx eslint` on every changed file is clean.

## Files

- `src/components/docs/page/store.ts` — `reflowed` on the page state; `drawnSetup`, `drawnPageless`, `useDrawnSetup`; the header comment says `setup` is only the saved setup (PAGE13-01).
- `src/components/docs/docs-editor.tsx` — a narrow pane reflows in every mode; the areas get the saved `pageSetup` and `reflowed`; a layout effect puts `reflowed` in the store; the store is made from the saved setup; the title row hides in a short pane and in a split view (PAGE13-01, EDGE13-07, NAV13-09).
- `src/components/docs/areas/types.ts`, `areas/insert.tsx`, `insert/context.ts` — `reflowed` on the area props; `drawnPageless` on the insert context (PAGE13-01).
- `src/components/docs/areas/page.tsx` — the canvas draws the drawn setup; a header edit waits for a drawn page (PAGE13-01).
- `src/components/docs/page/commands.ts` — saved checks (Switch to Pageless/Pages format) and drawn checks (Header, Footer, Page numbers and its presets, Watermark, Line numbers, Show print layout, Text width) (PAGE13-01).
- `src/components/docs/page/header-footer.tsx`, `page/ruler.tsx`, `page/outline.tsx`, `versions/version-view.tsx` — what draws reads the drawn setup; what saves keeps the saved one (PAGE13-01).
- `src/components/docs/insert/image-controls.tsx`, `insert/image.ts`, `insert/toc.ts`, `insert/at-menu.tsx`, `word-count.tsx` — drawn readers take `drawnPageless` (PAGE13-01); the image toolbar folds under 620 px (PAGE13-04).
- `src/components/docs/page/reflow.tsx` — the stored choice is read once the pane is known to be narrow; comment (PAGE13-01).
- `src/components/docs/toolbar/overflow.tsx` — a folded group that fits comes back (PAGE13-02).
- `src/components/docs/toolbar.tsx` — Viewing's groups with fold ranks; the ⋮ named More tools (PAGE13-02, EDGE13-11).
- `src/components/docs/insert/context-menu.tsx` — the key path fills the spelling suggestions (PAGE13-05).
- `src/components/docs/suggest/card.tsx`, `suggest/layer.tsx` — `focusSuggestionCard`; Review suggested edits gives the keys to a card; Escape and the next card from the keys (PAGE13-06).
- `src/components/docs/toolbar/dialog.tsx` — the footer button takes the focus in a dialog with nothing to type (PAGE13-07).
- `src/components/docs/css/toolbar.css` — one focus ring on the row (PAGE13-08).
- `src/components/proofing/proofing-card.tsx` — Ignore on the replacement's row (PAGE13-11).
- `src/lib/i18n/dict/docs.ts` — `moreTools`, en and zh (EDGE13-11).
- `SPEC.md` — §29 the toolbar fold (Undo back, Viewing's ranks, More tools), the row's focus ring, the title row's start, Images (the folded toolbar), the right-click menu (Shift+F10), Review suggested edits (the keys), Word count (OK has the focus), Grammar suggestions (Ignore's row); §30 Reading and editing (a phone reads pageless in every mode, the saved/drawn split).

## Decisions

- PAGE13-01: the flag is named `reflowed` (the word `page/reflow.tsx` and docs-editor already use) rather than the audit's `drawnPageless`; the insert context's derived boolean is `drawnPageless`. The header and footer layer keeps the saved setup and reads only the drawn flag, so its Options can never spread a drawn setup into a save.
- PAGE13-01: on a phone the image wrap modes other than In line are off while the page is drawn pageless (as on a pageless document), and Header, Footer, Page numbers, Watermark and Line numbers wait for Show pages. Insert page break (and Ctrl+Enter) stays on: the document is paged.
- PAGE13-01: printing on a phone prints what is drawn (as Viewing did before); a download uses the saved setup.
- PAGE13-02: the put-back allows the 2 px the fold keeps for rounding (Undo and Redo need 64 px where 65 stood empty). Viewing's row keeps its order (Search, Print, Add comment, Zoom).
- PAGE13-04: folded by window width (620 px, the full row is ~600 px), not measured, since the toolbar is a floating box; a merged Text wrapping menu over EDGE13-01's Border ▾ (the border trio stays on the row: three dropdowns cannot nest in one menu).
- PAGE13-06: after a key settles a card, the next suggestion's Accept takes the focus (wrapping to the first), so a keyboard reader walks the list; a pointer click keeps today's behavior.
- PAGE13-07: limited to dialogs with no form and no field to type in, so Page setup, Translate, Compare keep the focus on their first field.
- NAV13-09: the split is read from the DOM (the pane header sits before `[data-reader-root]`) to stay out of nav's files.

## Needs (files I do not own)

- `src/components/docs/insert/image-controls.tsx`: package 2 owns the figure Assistant pill (PAGE13-10). I changed one line of it: under 620 px the pill shows its symbol without the word (`{!compact && <span>…}`). Merge with package 2's pill change by keeping both.
- `src/components/reader/reader-interactions.tsx`: TOOL13-05's bar part (coarse sizes for the image bar's chips, Send, Reject, Accept) — package 2. EDGE13-14 (`[data-article-band]` takes its own 44 px row at the top of the article and floats only after a scroll) — the block reader's, not the page editor's; no package owns it this round.
- `src/components/reader/reader-panes.tsx`: NAV13-09's rest — the import line ("Text file") in the pane select's tooltip (package 4).
- No migration, no `prisma generate`, no schema change.

## Data

Project "Fix r13 page" `cmuz2v08d00007dfqad3vovfv` (POST /api/notebooks) with my own documents: "Page r13 fix" `cmuz2v88800027dfqjf3jtjm3`, "Page r13 setup proof" `cmuz3a0e8000m7duadfuz0frr`, "Page r13 proof b" `cmuz3gky7003l7duaepq82r7p`, "Page r13 proof c" `cmuz3gliz005g7dual66f72h9`, "Figure r13 fix" `cmuz46bv500007dd4m3hqz8cn` (blank documents), "Imports audit 3" `cmuz2y9wt00227dfqg00gcjb0` (PDF) and "R13 import md" `cmuz2yqpr002f7dfq2g51rp1h` (Markdown), added through Add a document. I kept the project and its documents so the lead can run the scripts again (the ids are in `.qa-tmp/page/lib13.mjs`); every one of them is mine and only in this project, and DELETE /api/notebooks/cmuz2v08d00007dfqad3vovfv removes them. The shared QA projects were only read.
