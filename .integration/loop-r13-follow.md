# loop/r13-follow: round 13 follow-up (cross-package leftovers)

**Intent:** fix the nine leftovers in `.qa-tmp/audit/r13/FOLLOWUP.md` that the five round 13 packages could not reach, plus the lead's items 10 and 11 (Escape in the toolbox's Comment box; the ✕ on a comment on an answer). Each fix takes away, merges, or makes something reachable, and adds no visible control.

Before numbers come from the base code (5f08d23); after numbers come from this branch. Both were measured on :3146 against my own project "Fix r13 follow". The scripts are in `.qa-tmp/follow/` (`s1`..`s11`) and the screenshots are in `.qa-tmp/fix/`.

## Findings

| # | Id | Result | Before → after | Screenshots |
|---|---|---|---|---|
| 1 | SEL13-06 (page editor comment card) | fixed | Head: ✓, ⋮ → ✓, trash, ⋮. Delete took 2 presses and now takes 1. The ⋮ menu went from Edit, Delete, Get link to Edit, Get link. A click on the comment's words edits them, as in the block reader. Head icons are 28 px, and 36 px on a coarse pointer (`s1-comment.mjs after-touch touch`). The trash deletes in one press: the card's line is gone after a reload, the row is gone from the database, and the other comment is kept (`s1-delete.mjs`). | `SEL13-06-page-before/after.png`, `-after-touch-tap.png` |
| 2 | SEL13-06 / NOTE13-12 (Annotations tab, full page) | fixed | Open row controls: 5 → 3 (the Jump pill and the red Delete are gone, and both stay in ⋯). Card height: 139 → 114 px, in the tab and on the full page. A figure's label stays as a plain chip. A press on a collapsed row still opens it and jumps. | `SEL13-06-annotations-before/after.png`, `SEL13-06-annotations-full-before/after.png` |
| 3 | NOTE13-13 ("Output was not valid JSON") | fixed | The command failed with "Voice command failed. The command could not be read. Output was not valid JSON." It now ends "… The answer came back in a form Unitos could not read. Try again." (zh: "Unitos 无法读取回答的格式。请重试。"). The server log keeps `[derive] VOICE unreadable answer: Output was not valid JSON.` The model's retry message is unchanged. | `NOTE13-13-before/after.png`, `.qa-tmp/follow/item3-*.txt` |
| 4 | TOOL13-10 (Send) | fixed | Panel Send: 64x32, 14 px → 49x29, 11 px. Note assistant Send: violet → clay, 49x29. Both now use the card's tooltip "Send the message (Enter)". The panel's Send was clay already, not violet; only its size differed. | `TOOL13-10-panel-*`, `TOOL13-10-note-*` |
| 5 | TOOL13-05 (image bar, coarse) | fixed | On a 390 phone: chips 21 → 29, Accept/Reject 22 → 30, Send 29 → 33, expand 21 → 21 drawn with a 33 px touch band (`TOUCH_HIT`), so the row does not wrap. At 1440 with a mouse every size is unchanged. | `TOOL13-05-bar-*`, `TOOL13-05-suggestion-*` |
| 6 | EDGE13-14 (article band) | fixed (coarse pointer) | Gap between the band's buttons and the first visible text, on phone and tablet: at the top -2 → 8 px; opened at a reading position -2..2 → 8..12 px. The band is `pointer-coarse:h-[58px]` and takes 10 px of room. A line can still be cut at the band's edge mid-scroll, which is how sticky bands work; it no longer touches the buttons. | `EDGE13-14-{phone,tablet}-{top,reopened}-{before,after}.png` |
| 7 | NAV13-09 (pane select tooltip) | fixed | Tooltip: "Choose the document this pane shows" → the same, then "Text file" (or "Imported from site", or "PDF · 30 pages") on the next line. The Normal view's import line still reads "Text file". | `NAV13-09-pane-tip-before/after.png` |
| 8 | EDGE13-04 (page editor status) | fixed | (a) With the note PATCH answering 500, the status read "Couldn't save your changes" about the document. The next unrelated write cleared it within 1 s while the database still lacked the note's words. Now it reads **Not saved**, and its popup says the document is saved and a note or an annotation is not. It stays until the note's retry lands: it cleared at +15 s after the server came back, with the words in the database. (b) With the document PUT answering 500, the status read "Trying to connect…". Now it reads "Couldn't save your changes" and stays through further typing and every retry. It cleared 7 s after the server came back, the words were in the database, and they were on the page after a reload. | `EDGE13-04-page-a-failing-*`, `EDGE13-04-page-b-failing-*` |
| 9 | NOTE13-06 (board focus trap) | holds, no change | Notes full page, Enter on a section's title: focus moves into the board, and 0 of 12 Tabs and 0 of 3 Shift+Tabs leave it. Escape closes the board and returns focus to the section's title (`s9-board.mjs`). | `NOTE13-06-check-board-tab.png` |
| 10 | Lead: Escape in the toolbox's Comment box | fixed | Block reader before: focus went to the body and the selection was gone. Page editor before: the editor took focus but the selection collapsed. After, Escape 1 closes the box only: the toolbox stays, the selection is kept or selected again, and Tab goes to the toolbox's first row. Escape 2 closes the toolbox. The Assistant box in the toolbox had the same cause and got the same fix. | `TOOLBOX-comment-escape-{block,blank}-{before,after}.png` |
| 11 | Lead: ✕ on a comment on an answer | fixed | 9x17 → 24x24 at 1440 and 36x36 on a phone. The glyph is at the same point at 1440. The row is 17 → 16 px tall (the badge's height). | `ANSWER-comment-x-*` |

Checks: `npx tsc --noEmit` is clean (dev server stopped). `npx eslint` on every changed file is clean.

## Files

- `src/components/docs/layer/comment-card.tsx`, `src/components/docs/css/layer.css`: the trash in the head, 36 px icons on a coarse pointer, a click on the words edits (item 1).
- `src/components/panels/annotation-card.tsx`, `annotations-panel.tsx`, `annotations-full-page.tsx`: `AnnotationActions` loses Jump and Delete, and its `notebookId`, `documentId`, `onDelete` props (item 2).
- `src/lib/i18n/dict/panels.ts`: removed `panels.jump` (en, zh), which is now unused (item 2).
- `src/lib/derive/json-call.ts`, `src/lib/i18n/dict/api.ts` (`answerUnreadable`, en+zh): the plain failure sentence; the detail goes to the log (item 3).
- `src/components/assistant/assistant-panel.tsx`, `src/components/outline/note-assistant.tsx`, `src/lib/i18n/dict/assistant.ts` (removed the unused `noteAssistantSend`, en+zh): one Send (item 4).
- `src/components/reader/reader-interactions.tsx`: the image bar's chips and Send at coarse sizes (item 5); the article band's coarse height (item 6); `focusSelectionAfterField` for Escape in the toolbox's Comment and Assistant boxes (item 10). Three small hunks.
- `src/components/assistant/suggestion-row.tsx`: Accept and Reject at coarse sizes, and the expand icon's touch band (item 5).
- `src/components/assistant/answer-tools.tsx`: the comment ✕ target (item 11).
- `src/components/docs/import-line.ts` (new), `src/components/docs/docs-editor.tsx`, `src/components/reader/reader-panes.tsx`, `src/app/n/[notebookId]/page.tsx`: the import line's words in one function, used by the title row and the pane select's tooltip (item 7).
- `src/lib/save-state.ts` (`readUnconfirmed`, `endWrite(ok, path)`), `src/lib/api.ts`, `src/components/docs/docs-editor.tsx` (`SaveStatus`), `src/components/docs/page/status-popup.tsx`, `src/components/docs/use-docs-save.ts`, `src/lib/i18n/dict/docsPage.ts` (`statusAppFailed` added, `statusFailed` reworded, en+zh): item 8.
- `SPEC.md`: the comment card (§29), the Annotations tab's open card, the article band (§6), the import line (§29), the page status (§29), and Escape in the toolbox boxes (§6).

## Decisions

- Item 1: Edit stays in ⋮ as well as on a click on the words, so the keyboard keeps a way to edit. The select package's notes wanted ⋮ to keep only Get link.
- Item 3: the plain sentence replaces only the final failure. The model's retry still gets the parser's words, so the pipeline's behavior is unchanged.
- Item 6: the change is for a coarse pointer only. At 1440 with a mouse the buttons also end 2 px below the band, but the audit named phone and tablet, and changing it would move every desktop article down 10 px. A cut line at the band's edge mid-scroll remains. Fading the band's edge would dim the first line at the top, so I did not add a fade.
- Item 8: "Not saved" survives only a failed PATCH to `/api/notes/<id>`, the save the notes package retries. It clears with the next write that lands on that note path. Every other failed write keeps the old rule (the next landed write clears it), so a failed AI call or a refused delete never leaves "Not saved" up. The header's save indicator is unchanged. A document save the server answers with 5xx now reads "Couldn't save your changes" rather than "Trying to connect…", because the server answered. A save that never reached the server still reads "Trying to connect…". A failed document save also retries when the tab is shown again.
- Item 10: the same fix went into the toolbox's Assistant box, which had the same cause.
- Item 11: the lead named `reader-interactions.tsx`, but the ✕ is in `components/assistant/answer-tools.tsx` (`CommentList`), shared by the answer card and the assistant panel.

## Needs

- None in other packages' files beyond the lists above. Every file I touched was merged on the loop branch before this branch started.
- i18n: added `api.answerUnreadable` and `docsPage.statusAppFailed`; changed `docsPage.statusFailed`; removed `panels.jump` and `assistant.noteAssistantSend`. All in en and zh.
- I did not touch `overflow.tsx` (the lead's note).

## Data

Everything I made is in my own project "Fix r13 follow" (`cmuz7sygx00097d4kqyg2glsg`), created through the app on :3146:
- Documents:
  - "Follow blank" `cmuz7szlk000b7d4keqqy4kvs` (blank)
  - "Follow figure" `cmuz8rcyx00037del7ijun7ng` (blank with an uploaded image)
  - two Markdown imports, `cmuz7ta6800127d4kal8dgh5u` and `cmuz7tc5h00177d4kvelqllg2`
  - "Follow block" `cmuz7uoi900007dfl2em59po7`, a block copy by `copydoc.mjs` of the notes package's document
  - "Follow block copy" `cmuz7tcqz00007dbxbmsqq8lz`, an empty copy of a document that no longer existed
- Contents: comments, highlights, notes, a second section, an assistant conversation, and one reply.

The project is kept so the lead can run the scripts again. `DELETE /api/notebooks/cmuz7sygx00097d4kqyg2glsg` removes it. I touched no other data. My dev server (:3146) is stopped.

Existing data: none touched.
