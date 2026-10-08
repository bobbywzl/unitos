# r7-lists7

**Intent:** Give the graph's side lists and sheets a clearer structure (WALK7-01/02/03/04/05/07/08, VIEW7-09): each list names itself, Scan for links moves to the Recommended head's end, lists fit what they hold, Waiting on you keeps only real questions, a one-link curve opens its link, typing after Add to note reaches the words, the Find list's ✕ clears the find, and the phone sheets stop above the Stitch pill.

**Files:**
- src/components/graph/list-name.tsx (new): `ListName`, the head row's name.
- src/components/graph/graph-overlay.tsx: Recommended list name + Scan as a `(main) => node` render prop (head pill, or the empty list's action); its frame; fit inset for the raised sheet; Find list ✕ and Escape clear the find.
- src/components/graph/links-list.tsx, graph-notes-list.tsx, generated-list.tsx: name in the head row; frame sized to content. Generated's switch moves under the head row.
- src/components/graph/graph-find.tsx, link-panel.tsx: frame sized to content.
- src/components/graph/node-card.tsx, documents-list.tsx: phone sheet `inset-x-3 bottom-16 max-h-[60%] rounded-[20px]`, `data-graph-sheet`; Documents' wide frame sized to content.
- src/app/globals.css: the new note's dock caps a list's max-height (was: set bottom); a phone sheet stands on the note.
- src/components/graph/graph-view.tsx: `oneLink`, `pinEdge` and `onEdgeClick` open a one-link curve's panel; `expandLink` closes the curve's list.
- src/components/graph/note-gather.tsx: `AddToNote` onKeyDown forwards a typed character to the words box.
- src/lib/graph/coverage-view.ts, components/graph/coverage.tsx: `waitsForReply` = `waitingReply !== null`; the head drops the count at 0.
- src/lib/i18n/dict/graphCover.ts, panes.ts: question counts, filter tooltip, Recommended empty lines (en, zh).
- SPEC.md §13: the above.
- scripts/qa/layer5-check.ts, panel6-check.ts, ui-graph-cover4.mjs, ui-graph-documents.mjs, ui-graph-interact.mjs, ui-graph-view.mjs: expectations for the new behaviour.

**Decisions:**
- The name shows on every width, not only below 768px: one head shape everywhere, 0 px (it sits in a row that was there).
- Documents and Find get no name: their head lines start with their counts ("7 documents · …", "Found in …"), which name them.
- Generated content's switch takes a line under the head row (its label does not fit beside the name at 400 px).
- The Documents head drops "waiting on you" at 0 instead of saying "No link is waiting on you" (fewer words; the filter's empty line still says it).
- Enter on a curve still pins its list (keyboard path unchanged); only a click or tap on a one-link curve skips the list.
- The Find list's ✕ and Escape clear the find (one way to close and clear) rather than adding a key row for the counts.
- No change to how controls look (STYLE7): the Scan pill keeps its class, only its label shortens; ListName's class is a placeholder STYLE7 may restyle.
