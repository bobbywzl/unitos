# r4-lists4

**Intent:** Fix the graph's side lists, header, and keyboard from round 4's walk and view audits (VIEW4-04, VIEW4-07, WALK4-02, -06, -07, -08, -09, -11, -12, -16..19).

**Files:**
- `src/components/graph/documents-list.tsx`: a filter; rows past 20 are one line and open on a click; parts capped at 8 and links at 3 with "N more"; generated documents listed (marked) while the provenance switch is on, else a line with Turn it on; `ul`/`li`/`h3`, one Tab stop per row, arrows inside (`useRowTabStops`, `onRowKeys`). The row is its own component, `DocumentRow`, with `lines` and `counts` arrays to extend.
- `src/components/graph/graph-overlay.tsx`: Esc leaves a text box to its side list or the graph's title (never body); a link opened from a list goes back to the list on the first Esc (`backFromLink`, shared with the panel's Back); Skip to Stitch puts the caret at the end; short pill names below 1400px.
- `src/components/graph/stitch-box.tsx`: Esc focuses the box's title; the contradictions chip fills the box (no run). Nothing about conversation storage or drafts.
- `src/components/graph/link-note-composer.tsx`: Esc folds it, words kept, focus to its button; opening it scrolls Save into view.
- `src/components/graph/link-replies.tsx`: Esc in a reply box focuses its panel.
- `src/components/graph/graph-find.tsx`: the summary is `role=status`; the find list is focusable; "this one" wording.
- `src/components/collab/reply-thread.tsx`: 40px Resolve, Delete, Reply, Send under a coarse pointer.
- `src/components/feedback-button.tsx`, `src/app/globals.css`: Feedback hides while the graph is open.
- `src/components/outline/note-card.tsx`, `src/components/reader/workspace.tsx`, `src/components/graph/graph-keep.ts`: `graphFrom=notes`; closing that graph goes back to the notes full page.
- `src/lib/i18n/dict/{panes,graphView,stitch,api}.ts`: new keys (en, zh); "Recommend links" is "Scan for links" in en.
- `SPEC.md` §13, §22, the Show on graph paragraph.
- `scripts/qa/ui-graph-lists4.mjs`: the checks.

**Decisions:**
- Renamed the action to "Scan for links" (zh already 扫描推荐链接) instead of moving it; data-track names unchanged.
- Compact rows depend on the filtered count (> 20), so a narrow filter shows full rows.
- In a compact row the title opens the row; "Show this document's card" is the row's first control.
- Generated documents follow the provenance switch (as asked), with a line and a Turn it on button when off.
- Esc in Note on this link folds the composer (words kept in state and in the browser draft) rather than only leaving the box.
- Feedback hidden by CSS (`body:has(.graph-overlay)`), not by state.
- Closing a graph from the notes full page uses history.back() (the notes page is the entry before), only when the page arrived with graphFrom=notes.
