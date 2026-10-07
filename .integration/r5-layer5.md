# r5-layer5

**Intent:** Put the reader's own layer on the graph (comments, whole-document coverage, gap reasons, links waiting on your reply, the reader's documents first at scale, note replies in the Notes list, Find agreeing with its list) without adding controls a reader would not miss.

**Files:**
- `src/lib/graph/coverage-view.ts`: `COVERAGE_COUNTS_COMMENTS` (on, pending Linda), `GraphComment`, `PartCoverage.whole`, pure rules `openComments`, `commentAsks`, `waitsForReply`, `gapReasons`.
- `src/lib/graph/coverage.ts`: one more query for the comments; a document with no parts is one whole-document part; comments count as noted behind the constant.
- `src/components/graph/coverage.tsx`: Gaps only = not opened or a part with no note (links hide); `GapReasons`; `useWaitsForReply`; ring sized from `--graph-zoom`; `NodeComments` (small mark), `NodeCommentsLine` (one card line that expands), `DocumentComments`; the row line's open-comment count expands the row. `hasNoReply` removed (no other caller).
- `src/components/graph/documents-list.tsx`: keepRow by id; gap reason in the row; open comments in the head line and as an expander in the row line; filter matches comment words; past 20 rows the reader's documents first; head line says the order.
- `src/components/graph/graph-view.tsx` ([layer5] blocks): comment mark next to the notes chip; Find leaves generated nodes dark while provenance is off; kept far-zoom labels sort by the reader's words first; `nodeRoom` gets the mark's width; one key row.
- `src/components/graph/node-card.tsx` (3 lines): `NodeCommentsLine` under the facts line.
- `src/components/graph/links-list.tsx`: No reply uses `waitsForReply`.
- `src/components/graph/link-replies.tsx`: last-look store (`unitos-link-seen:<account>:<project>`), `useNewReplies`, `useAnyNewReplies`, "N new" in `LinkReplyCount`; `LinkReplies` marks the link seen.
- `src/components/graph/graph-notes.tsx`: dot on the curve's replies mark for a new reply.
- `src/components/graph/graph-notes-list.tsx`: `ReplyThread` in the expanded note.
- `src/components/graph/graph-find.tsx`: generated documents unlisted while provenance is off, one line with Turn it on; "No passage" only when nothing was found.
- `src/lib/graph/curve-place.ts`: `nodeRoom(..., chipW)`.
- `src/app/globals.css`: the ring's radius/stroke from `--graph-zoom`; comment mark hides at far zoom.
- `src/lib/i18n/dict/graphCover.ts`, `src/lib/i18n/dict/panes.ts` (en + zh): new keys; `graphDocumentsHead` gains `{comments}` and `{order}`.
- `SPEC.md` §13: Coverage, Comments on the graph, New replies on a link, node card, far-zoom labels, Find, Notes list.
- `scripts/qa/layer5-check.ts` (new); `scripts/qa/ui-graph-cover4.mjs`: Gaps only now lists no links and every kept row says why.

**Decisions:**
- No "Question" word: a "?" folded into the count; no Questions or Open comments switch (Linda's 20:34 direction). The Documents filter matches comment words instead (type "?" to find the ones that ask).
- No reply = waiting for *your* reply (no reply at all, or the last open reply is another person's); a thread with only resolved replies is closed. Same label, new tooltip.
- Gaps only keeps "Not opened" as a reason beside parts with no note; it is not narrowed to the reader's documents at 200 documents — the reader's documents sort first instead.
- "New" reply state lives in the browser per account (convenience only); sign-in off shows nothing new.
- Comments of every collaborator count (as notes do), not only the viewer's.
- Part titles "Blocks 26–27" (WALK5-06 item 4) not changed: they are stored in skeletons by `skeleton.ts` (ENGINE5's file).
