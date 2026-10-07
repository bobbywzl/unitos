# r3-docs3

**Intent:** Add the graph's Documents list (VIEW3-06) and make the graph's data lighter: provenance links on request, link passages on link open, and an ETag so an unchanged refetch is a 304 (COST3-03, COST3-04, REV3-08), with the offline copy and sw.js keeping all of it.

**Files:**
- `src/lib/graph/view.ts`: `documentsGraph` no longer reads block texts; new `linkPassages` (one link or every link of the project).
- `src/lib/graph/data.ts`: wire shape (`GraphWireEdge`, `GraphWireLink`): no link titles, no block texts, provenance links only with `{ provenance: true }`; `provenance` flag on `GraphData`.
- `src/lib/types.ts`: `fromBlockText`/`toBlockText` optional on `GraphEdgeLink` and `RecommendedLinkView`.
- `src/app/api/notebooks/[notebookId]/graph/route.ts`: `?provenance=1`; ETag (sha1 of the body), 304 on If-None-Match, `Cache-Control: private, no-cache`.
- `src/app/api/notebooks/[notebookId]/graph/passages/route.ts` (new): viewer; `?linkId=` one link (404 outside the project), none = every link.
- `src/app/api/notebooks/[notebookId]/outline/route.ts` + `src/lib/graph/outline-titles.ts` (new): `?parts=titles`, every document's part titles in three queries.
- `src/components/graph/graph-data.tsx`: If-None-Match, keeps last answer on 304; fills link titles from the nodes; asks `?provenance=1` when wanted; clears the kept passages on a new answer.
- `src/components/graph/provenance-want.ts` (new): tiny store; the switch (graph-view) and a node card with provenance edges (node-card) ask for provenance links.
- `src/components/graph/link-passages.ts` (new) + `link-detail.tsx`: passages fetched when a link opens, kept per tab.
- `src/components/graph/graph-view.tsx`: one line (`useWantProvenance(showProvenance, "switch")`) + import.
- `src/components/graph/node-card.tsx`: one hook line + import; `linkGroups` skips an edge with no listed links (a provenance-only edge before its links load).
- `src/components/graph/documents-list.tsx` (new): the list.
- `src/components/graph/graph-overlay.tsx`: `"documents"` side list; header counts span became a button; `linkFrom` replaces `linkFromList` (Back to Links or to Documents); the list's mount; card sheet/beside rules include "documents".
- `src/components/graph/link-panel.tsx`: optional `backLabel`.
- `src/components/graph/graph-layout.ts`: new export `layoutOrder` (appended).
- `src/lib/i18n/dict/panes.ts`: `graphDocuments*` en and zh.
- `src/lib/offline/saved.ts`, `public/sw.js`: the copy keeps `/graph?provenance=1`, `/graph/passages`, `/outline?parts=titles`; sw answers a query URL of the graph data from the bare one when the exact one is missing.
- `SPEC.md` §13, §17.
- `scripts/qa/ui-graph-documents.mjs` (new), `scripts/qa/ui-graph-offline.mjs` (passages and Documents list offline, TAG, dev-shm flag).

**Decisions:**
- The ETag hashes the response body (never misses a field) instead of an aggregate version query: it saves bytes, not server work.
- The node card of a document with provenance links fetches them (keeps today's card exactly); the alternative was dropping provenance groups from the card, a product call.
- Link titles are dropped from the wire too (COST3-03 step 3, optional): the client fills them from the nodes.
- The Documents list lists recommended links too (dashed, marked), since the layout groups documents by accepted and recommended links; the head counts accepted links, as the header does.
- On a phone the list is a sheet at the foot (the node card's rule); from 640 px the canvas fits beside it.
- Back from a document keeps the list and its scroll (module memory, per tab).
