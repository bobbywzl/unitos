# r4-cover4

**Intent:** Intertwine the graph with notes: coverage from stored rows (VIEW4-01), Add to note from every passage on the graph into one composer (VIEW4-03), notes on a link in the reader (WALK4-05), provenance folded in the Annotations tab and the picker's count (WALK4-03), a follow-up's generated label (WALK4-14).

## Files
- `src/lib/graph/coverage.ts`, `coverage-view.ts`, `src/app/api/notebooks/[notebookId]/graph/coverage/route.ts`: the coverage read (parts noted, notes per document, opened); `COVERAGE_COUNTS_ANNOTATIONS` (off).
- `src/components/graph/coverage.tsx`: provider, CoverageHead, DocumentCoverageLine, PartDot, CoverageRing, useCoverageGaps, NoReplyToggle.
- `src/components/graph/note-gather.tsx`: provider, AddToNote, NoteGatherDock.
- `src/lib/anchors/note-quotes.ts`, `note-quotes-limit.ts`, `src/app/api/notes/route.ts`: `quotes` on POST /api/notes (Zod, ≤ 20, project documents only, the ladder).
- `src/lib/note-drafts.ts`: the gather draft (`unitos-note-gather:<account>:<project>`), swept after 30 days.
- Hook-ins: `graph-overlay.tsx` (2 providers, the dock), `graph-view.tsx` (ring, label), `documents-list.tsx` (head, line, dots, gap filters), `links-list.tsx` (No reply), `graph-find.tsx`, `link-detail.tsx`, `node-card.tsx` (Add to note; node card part dots), `globals.css` (list ends above the dock).
- Reader: `src/lib/graph/reader-link-notes.ts`, `src/components/panels/link-card-extras.tsx`, `annotations-panel.tsx`, `page.tsx` (provenance flag, link notes, tab count), `block-view.tsx` + `reader-interactions.tsx` (chain tip), `document-bar.tsx` (picker count), `src/lib/types.ts` (LinkOut/LinkIn `provenance`, `noteIds`).
- `src/lib/graph/generated-label.ts`, `src/lib/graph/stitch.ts`: `ownCommand`, `COMMAND_CHAIN`.
- `src/lib/i18n/dict/graphCover.ts` (new namespace, en/zh), `dictionaries.ts`, `api.ts` (2 keys).
- `SPEC.md` §12/§13/§22. Checks: `scripts/qa/graph-coverage-check.ts`, `cover4-check.ts`, `ui-graph-cover4.mjs`.

## Decisions
- Coverage is a separate route (`/graph/coverage`), not part of `outline?parts=titles`, so LISTS4's rebuild of the list does not conflict; it calls `projectPartTitles` again (one more read per open).
- Opened = a reading position, or a note by the account in or quoting the document (documents read before reading positions existed would otherwise read Not opened).
- A source before a document's first part counts in the first part.
- Gaps only keeps accepted links with no reply, hides notes rows, keeps the gist.
- "Gaps only" (zh 只看空缺) is the UI word the brief asked for; it is not the gaps check (疏漏).
- Add to note on a part quotes the start block's opening words (a heading: the paragraph under it), ≤ 400 characters; a link end quotes by words only (the graph has no block ids for link ends).
- A note gathered from several documents belongs to the project (documentId null); one document → that document.
- Provenance rows sit under the Generated content label in the Annotations tab; nothing is removed.
