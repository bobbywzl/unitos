# r10-cost10

**Intent:** Cut what the graph fetches per open and per change: the coverage answer carries counts in the part titles' order and no block ids (COST10-03), a rev move another account made while the graph is open fetches the notes alone in place of the page's RSC refresh, which waits until the graph closes (COST10-04), and a replayed comment whose words are gone stores a block of its own document (REV10-09).

**Files:**
- `src/lib/graph/coverage-view.ts` — `DocumentCoverageWire`/`ProjectCoverageWire` (the compact form), `partIdsHash`, `compactCoverage`, `expandCoverage`. Pure; the browser imports it.
- `src/lib/graph/coverage.ts` — `buildCoverage` returns the coverage and each document's title ids; `projectCoverage` keeps its shape; `projectCoverageWire` is the compact form.
- `src/app/api/notebooks/[notebookId]/graph/coverage/route.ts` — `?parts=counts` answers the compact form; without it today's shape (a tab from before the deploy).
- `src/components/graph/coverage.tsx` — the provider fetches `?parts=counts`, pairs the counts with the known part ids (`usePartIds`), builds today's `PartCoverage[]` once, and reads one full answer for a compact one whose ids did not pair. `useDocumentCoverage` and every consumer line read as before.
- `src/components/graph/part-ids.ts` — new: the part ids per project and document, put there by the titles answer and the node card's outline; `usePartIds`.
- `src/components/graph/documents-list.tsx`, `src/components/graph/node-card.tsx` — one import and one call line each (`rememberPartTitles`, `rememberPartIds`) where their fetch lands.
- `src/components/collab/use-sync.ts` — `deferWhile`: a rev move reads `GET …/notes-view` once per rev (its ETag; a 304 keeps the sections) and the refresh stays due; returns `{ people, live }`. The poll runs at once when `deferWhile` changes, so the refresh that waited runs when the graph closes.
- `src/lib/notes-view.ts` — new: `sectionsInclude` (the page's sections query), `noteView`, `sectionView`, `sectionTree`, `notesView`: one mapping for the page and the route.
- `src/app/api/notebooks/[notebookId]/notes-view/route.ts` — new: the sections and notes in the page's shape, viewer, with the body's ETag.
- `src/app/n/[notebookId]/page.tsx` — the sections include and the note mapping come from `lib/notes-view.ts` (two small hunks; the page's `toReplyViews` stays for links and edits).
- `src/components/reader/workspace.tsx` — `graphOpen` declared above the sync; the sync takes `deferWhile: graphOpen` and returns `live`; `liveNotebook` (the poll's sections when newer than the page's) feeds `useOutline` and the graph's notes; the loader's `rev` is the poll's while the refresh waits.
- `src/app/api/annotations/route.ts` — `createOrphanedComment` checks the block is the document's, else stores the document's first block; takes `t`.
- `scripts/qa/graph-coverage-check.ts` — the compact form built back equals today's shape on every project; no-ids and mismatch cases; bytes; `PROJECTS` by title.
- `scripts/qa/ui-graph-deferred-refresh.mjs` — new: sign-in on, two accounts: the notes view within the poll, no RSC refresh while the graph is open, one on close, typed words kept while their save fails.
- `SPEC.md` — §12 Live sync: the refresh while the graph is open; §13 Coverage: the compact form.

**Decisions:**
- The compact form is behind `?parts=counts`, not the default: a tab from before the deploy reads `parts` and would throw on an answer without it.
- The part ids come from the lists that already read them (the titles answer, the node card's outline), never from a fetch of the coverage provider's own: a titles fetch on every graph open would cost 131 KB at 200 documents before the Documents list opens. Until a document's ids are known its counts carry `blockId: ""` (the head, the row and the ring draw; the dots wait for the list that draws them).
- A mismatch (the titles older or newer than the coverage) reads one full answer per compact answer, not the titles again: exact, bounded, and the titles come back with the next rev move anyway.
- The notes view answers the page's whole `SectionView[]` (content, gist, sources, replies), not a graph-only cut: one shape, one mapping, and the tray under the graph shows the same notes; 7 to 23 KB raw against the page's 57 to 70 KB, 1.7 to 2.5 KB gzip.
- The notes view is read under the same `refreshSafe()` gate as a refresh: while a box on the graph has focus, nothing moves under the reader's typing.
- The deferred refresh follows the same rule as today's: `refreshDue` stays set, `knownRev` stays at the page's rev, and the first poll after the graph closes runs it once when it is safe.
- The 304 of the coverage still builds the body (item 4 not built): at 200 documents the 304 costs 99 to 102 ms against 109 to 119 ms for a 200; no cheap exact key exists, as SPEC §13 records from COST7-05 (block order, heading text and sources are inputs).
