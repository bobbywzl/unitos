# loop/r10-imports

**Intent:** Fix the imports package of the round 10 reader interaction audit (imports.md IM1, IM4, IM5, IM6, IM10, the polish IM11–IM17, IM20, IM22, and the spec question N2) in the page editor, and write what other files need under Needs.

## Findings

Screenshots are under `.qa-tmp/fix/` in the worktree (not committed: `.qa-tmp` is ignored). Every finding ran on this worktree's dev server (port 3126) against test documents "Imports fix 1–9" in "Interaction QA", made for this round and removed at the end. The scripts are the audit's `imports/` scripts (copied to `.qa-tmp/im/`, pointed at 3126) and the probes `.qa-tmp/im/x-im*.mjs`.

- **IM1: fixed.** Before: a pageless import kept a 600 px column on any pane, with no sideways scroll: at 1000 px the line ends ran 28 px under the notes tray, at 820 px 208 px, and on a phone 234 px of every line were hidden. After: a pane too narrow for 600 px takes the column to its 24 px gutters (1000: 24–572; 820: 24–392; 390: 24–366), and a table wider than the column scrolls sideways. In a column under 600 px a page start's label stands at the right end of its line's first row, where it is not cut off. `IM1-before.png`, `IM1-before-390.png`, `IM1-after.png`, `IM1-after-390.png`.
- **IM4: fixed.** Before: the assistant's suggestions landing on an import in Viewing switched it to Editing, stored Editing as the import's mode, and focused the page. After: a landing in Viewing passes into Suggesting mode for this visit; the stored mode stays null (as the reader left it), the page takes no focus, and a reload opens it in Viewing. `IM4-before.png`, `IM4-after.png`.
- **IM5: fixed.** Before: a press in the notes tray (or the app's top bar) faded the header out. After: the tray and the top bar leave it as it is (`w16-header-select` and `x-im5`: opacity 1 at 0.3 s and 1.2 s after a tray press). A press in the other pane or on the Extract page still fades it; the split pane was not run. `IM5-before.png`, `IM5-after.png`.
- **IM6: page side fixed; the toolbar's side is under Needs.** Before: at 1440 a pageless import's column (600 px at least, Medium cap) ran under the toolbar, Define, and the cards. After: below its cap the column leaves the cards their room (`CARD_REACH`, 288 px): 156–880 at 1440, and a suggestion card stands beside the text. The selection toolbar and Define still choose their side by `toolbarLeft` alone in `reader-interactions.tsx`, so they can stand over the words when the page must move left for them; with Needs (b) applied for the run only, they stand beside the text. `IM6-before.png`, `IM6-before-card.png`, `IM6-after.png`, `IM6-after-card.png`, `IM6-after-with-needs.png`, `IM6-after-define-with-needs.png`.
- **IM10: fixed.** Before: a PDF import opened at Fit: 67% beside the tray at 1000 px (9.8 px words), 42% at 390 px (6.1 px words). After: when Fit draws the pages under 75%, a bar over the page in Viewing offers Read pageless or Keep pages. Read pageless wraps the words to the pane (14.7 px at both widths); Editing draws the pages again and Viewing returns to pageless; the choice survives a reload; Show pages goes back. The stored `pageSetup` stays `pageless: false` throughout. `IM10-before.png`, `IM10-before-390.png`, `IM10-after.png` (the offer), `IM10-after-pageless.png`, `IM10-after-390-offer.png`, `IM10-after-390.png`.
- **IM11: fixed.** Before: the folded toolbar showed the Collapse button as its New pill alone. After: the folded button shows its icon with the New glow, no pill. `IM11-before.png`, `IM11-after.png`.
- **IM12: fixed.** Before: "0 figures loaded · every caption has its figure" for a Markdown file, "1 figures" for a web page. After: no figure line on the Markdown file; "1 figure loaded" on the web page. `IM12-before.png`, `IM12-before-web.png`, `IM12-after.png`, `IM12-after-web.png`.
- **IM13: fixed.** Before: the drop zone named "PDF, image, video, audio, or Markdown". After: "PDF, Word, Markdown, text, slides, sheets, image, video, or audio — up to 200 MB" (zh the same), on two lines with "200 MB" kept together. `IM13-before.png`, `IM13-after.png`.
- **IM14: not fixed; under Needs.** The re-parse card's steps come from the caller: `document-bar.tsx` passes the kind "pdf" or "url" to `runIngest`, whose templates start on Uploading. Adding a "reparse" template to `ingest-progress.tsx` alone would be dead code until the caller passes it.
- **IM15: fixed.** Before: after Collapse off every block read whole kept the fold button at 40% until a reload. After: opacity 0 at rest after Collapse off, 1 under the pointer; in a collapsed article it stands faint as before. Same cause fixed in the page editor's collapsed view (`layer/collapse.tsx`). `IM15-before.png`, `IM15-after.png`, `IM15-after-hover.png`.
- **IM16: fixed.** Before: the outline panel listed the seven headings, then Contents with the same seven parts. After: when every part starts at a heading, the panel shows the headings alone; Contents shows when its parts differ. `IM16-before.png`, `IM16-after.png`.
- **IM17: not fixed; the cause is in parsing (under Needs).** `src/lib/parse/pdf/tables.ts` writes the table with no alignment, so `lib/docs/import.ts` has nothing to read into `tableAlign`. `IM17-before.png`.
- **IM20: page editor side fixed; the reader's side is under Needs.** Before: an import reopened at the reading position with no left-off mark. After: `layer/left-off.ts` draws the block reader's ribbon and faint line above the block, as a decoration (never in the rich text), mapped through edits, never printed; `DocsEditor` takes `leftOffBlockId`. `reader-interactions.tsx` sets that id only for block documents, so the mark shows only with Needs (a); applied for the run only, it shows at the reading position. `IM20-before.png`, `IM20-after-with-needs.png`.
- **IM22: fixed.** Before: a highlight across a page start drew its chip twice. After: one chip, at the passage's end; the mark covers both sides. `IM22-before.png`, `IM22-after.png`.
- **N2: decided by the spec.** §29 describes Make a copy of an import (a blank document of the reader's own, with the import's figures, page labels, and references), and the code offers it; §30 still said it was off. §30 now says it is on. No code change. `N2-before.png`, `N2-after.png`.

### Checks

- The imports scripts rerun on the head, one browser at a time: r01 (pdf, md), r02, r03, v01, v02, v03, w00, w01 (pdf, md), w12, w13 (md, pdf), w15, w16, w17, w19, w20, w22 exit 0 with the audit's results, apart from the fixes above. r04 failed on its first run on a chunk load error while the server recompiled (the temporary patch was being taken out); run again it exits 0 and the reading position holds (254 → 254). w22 exits 0 but measures chips in the x range 935–975, where the old 600 px column put them; at 1440 the column now ends at 880 and the chips stand at 888 (w12 shows them there), so its empty lists are the script's window, not a fault. IM15 was checked with `x-im15`. w14 stops before its drag: it needs a note "Researchers…" in the tray that the audit made on its own document; not a fault in this branch.
- The page audit's scripts p01–p20 and q01–q26 (`.qa-tmp/page/`, pointed at 3126; logs in `.qa-tmp/page/out/`), one browser at a time, on a blank document "Imports fix 9" reset with `mkdoc.mjs` before each: every script exits 0 except p01 (the script reads `className.split` on an SVG element, as in the loop/page round) and q17 (stops at `at(p, "new Juliet")`, as the audit's own run did). p07b and q20 timed out on their first run while the machine thrashed (load 47–65); after a restart of the dev server they, q23, q24, q25, and q26 exit 0. q25 shows the header staying at opacity 1 after presses on the top bar and in the notes tray (IM5). q20's import is named "Imports fix 10" so it stays one of this round's test documents.
- Not run: the split pane for IM5; IM20 and IM6's toolbar side only with the Needs patch applied for the run.
- `npx tsc --noEmit`: clean. `npx eslint` on every changed file: clean.

## Files

- `src/components/docs/page/geometry.ts`: `pagelessWidth` takes the room the cards need and lets a narrow pane take the column under 600 px to 24 px gutters (IM1, IM6).
- `src/components/docs/layer/margin.ts`: `CARD_REACH`, the room a card needs right of the text (IM6).
- `src/components/docs/areas/page.tsx`: passes that room to `pagelessWidth`; marks a pageless column under 600 px `data-narrow`; the fit-once effect waits for pages (IM1, IM6, IM10).
- `src/components/docs/css/insert.css`: a table scrolls sideways in a narrow column (IM1).
- `src/components/docs/css/import.css`: a page start's label at the line's end in a narrow column (IM1, IM10).
- `src/components/docs/typing/events.ts`, `suggest/assistant.ts`, `toolbar.tsx`, `docs-editor.tsx`: a passing mode request; a landing in Viewing passes into Suggesting without storing the mode or focusing the page (IM4).
- `src/components/docs/docs-editor.tsx`, `css/layer.css`: the header ignores presses outside every pane (the notes tray, the top bar) (IM5); `leftOffBlockId` and the left-off mark's styles (IM20); Read pageless: `shownSetup` drawn in place of the page setup while reflowed, the bar, `data-reflow` (IM10).
- `src/components/docs/layer/left-off.ts` (new): the left-off mark in the page editor (IM20).
- `src/components/docs/page/reflow.tsx` (new), `page/store.ts`, `page/commands.ts`, `src/lib/i18n/dict/docsPage.ts`: Read pageless: the choice per document in the browser, the bar, the Search the menus commands, the words (IM10).
- `src/components/docs/css/toolbar.css`: the folded Collapse button drops its New pill (IM11).
- `src/components/reader/upload-assistant.tsx`, `src/lib/i18n/dict/panes.ts`: the figure line only when there are figures or captions, "1 figure"; the drop zone's hint (IM12, IM13).
- `src/components/reader/core-block.tsx`, `reader.tsx`, `src/components/docs/layer/collapse.tsx`: the fold button quiet after Collapse off (IM15); `reader.tsx` passes `leftOffBlockId` to the page editor (IM20).
- `src/components/docs/page/outline.tsx`: Contents hidden when its parts are the headings (IM16).
- `src/components/docs/annotation-marks.tsx`: a passage's chips once, at its end (IM22).
- `SPEC.md`: §6 left-off mark in the page editor; §15 the figure check line; §28 the fold button; §29 Pageless, the header, the outline panel, the assistant's suggestions; §30 page starts in a narrow column, Read pageless, Make a copy (N2), a passage's chips.

## Decisions

- IM1/IM6: the column leaves the cards their room only while it keeps 600 px; under that the cards go over the page as before (the page moves left for a card, as The margin says). Full text width is left alone.
- IM4: Suggesting mode, not Editing, for a landing in Viewing, since Suggesting is the mode that shows suggestions without inviting the reader to type; the switch is for the visit only and not remembered.
- IM5: only presses inside a pane count; the notes tray and the top bar act on the open document, so they no longer count as away.
- IM10: an offer (a bar), not an automatic switch, so a PDF import still opens as the reader left it; the choice is a browser view (localStorage), never the document's page setup, and Editing always shows the pages, so the page starts and page edges are there whenever the reader writes.
- IM10/IM1: in a narrow pageless column the page start's label floats at the right end of its line rather than being cut off in a 24 px gutter.
- IM14: not fixed in `ingest-progress.tsx` alone (dead code without the caller).
- IM15: quiet only for blocks read whole (the words branch); a block showing its core keeps its button.
- IM16: Contents hides only when every part starts at a heading's position; any part elsewhere shows the whole list.
- N2: the spec's §30 line was changed, not the code, because §29 describes the copy of an import in detail and the code follows it.

## Needs

- **`src/components/reader/reader-interactions.tsx`** (owner of IM2/IM7/IM9). The diff tried for the run is at `.qa-tmp/needs-reader-interactions.diff`:
  - (a) IM20: in `hold()`, after `placed = true;` for a page editor document, set the left-off block as the block reader does: `if (!isTranscript && "blockId" in position) { const top = readingPositionScroll(container, position, resume); if (top !== null && top >= container.clientHeight * LEFT_OFF_MIN_SHARE) setLeftOffBlockId(position.blockId); }`.
  - (b) IM6: the selection toolbar's side on a page: `toolbarLeft(pageGeo, shift, 176) === null && toolbarShift(pageGeo, shift, 176) === null ? "below" : "right"`, so it stands right of the text when the page can move left for it, rather than below over the words.
  - Observation: the reading line (80 px under the pane's top) falls under the page editor's header, so the left-off mark (and the block the reading position names) sits under the header at open. The reading line for a page editor document could be measured from the header's bottom.
- **`src/components/reader/document-bar.tsx` and `ingest-progress.tsx`** (IM14): a "reparse" template (parse, save) in `ingest-progress.tsx`, and the re-parse caller (`document-bar.tsx` near line 523) passing it, so a re-parse starts at Parsing.
- **`src/lib/parse/pdf/tables.ts`** (IM17): mark a table the PDF centers (e.g. `data-align="center"` or the margin), so `lib/docs/import.ts` sets `tableAlign: "center"`.
- Observation (IM6): the outline button can stand over the first letters of a pageless column moved left to the canvas's gutter.
