# loop/nav

**Intent:** Fix the navigation audit's findings N1, N2, N6–N11, N14, N16–N18, N22, N23 and the edge audit's E-15–E-19 in the files the navigation package owns, and write what the rest needs.

## Findings

Screenshots are in `.qa-tmp/fix/` (the worktree, not committed). The before screenshots are the audit's, copied. After checks: `.qa-tmp/nav/fix-all.mjs`, `fix-n9b.mjs`, `fix-last.mjs`; logs `.qa-tmp/fix/all*.log`, `n9b.log`, `last.log`.

| Id | Status | What the after check saw | Screenshots |
|---|---|---|---|
| N1 | fixed | ⋯ has Remove from this project, enabled when another project holds the document, disabled with the reason when not; the confirm names "QA Student"; Remove took the throwaway out of QA Analyst only; a remove from its only project got 409; Delete of the throwaway removed its `Document` row (0 rows after); 0 native dialogs | `N1-before.png`, `N1-after.png`, `N1-after-menu.png`, `N1-after-removed.png` |
| N17 | fixed | the in-app confirm replaces the browser's; counts are plural-aware ("1 annotation on it is deleted with it") | `N17-before.png`, `N17-after.png` |
| N2 | fixed | Escape in the Stitch box: graph still open, focus left the box; second Escape: graph closed; reopened: draft "QA stitch draft" and 1 pick kept | `N2-before.png`, `N2-after.png`, `N2-after-picked.png` |
| N6 | not fixed: Needs | code is in reader-interactions.tsx | — |
| N7 | fixed | the guide's Collapse words name the button to the right of the block | `N7-before.png`, `N7-after.png` |
| N14 | fixed | the guide's Keys card lists Esc, ⌘/Ctrl+Z, ⇧+⌘/Ctrl+Z, ⌘/Ctrl+C, Enter, ⌘/Ctrl+Enter, Tab · ⇧+Tab, ⇧+click, Space · K, ← · →, F | `N14-before.png`, `N14-after.png` |
| N8 | fixed | a pointer crossing the pill to + at hand speed: list never opened; resting 700ms: opened; press opens, second press closes | `N8-before.png`, `N8-after.png` |
| N9 | fixed | into a folder: row left the root list 142 ms after the drop; out: back 141 ms after; rows did not move when the drag started or while "Move to the project" showed (it draws over the Sort by row, 66–106 in a 64–108 header) | `N9-before.png`, `N9-after.png`, `N9-after-scrolled.png` |
| N10 | jump not fixed: Needs | reader-interactions.tsx | — |
| E-18 | Part 1 fixed; jump in Needs | contents lists Part 1 … Part 10 for the long document | `E-18-before.png`, `E-18-after.png` |
| N11 | fixed (jump); Restore in Needs | 86 rows, 0 with raw markdown; a row press opened `/n/…?doc=…&block=…` | `N11-before.png`, `N11-after.png` |
| N16 | fixed | a queued link survives Escape and reopen; the item's ✕ still removes it | `N16-before.png`, `N16-after.png` |
| N18 | fixed | legend at the canvas's top left (12,71), clear of the Stitch box (380,624); while node 1 is hovered, the picked node stays at opacity 1, others 0.15 | `N18-before.png`, `N18-after.png` |
| N22 | fixed | Save for offline reads "Saving pages… Counting…" until the total is known | `N22-before.png`, `N22-after.png` |
| N23 | fixed | a folder's list ends with "New document here" | `N23-before.png`, `N23-after.png` |
| E-15 | fixed | zh graph header: 扫描推荐链接 · 推荐链接 · 生成文档 | `E-15-before.png`, `E-15-after.png` |
| E-16 | 生成文档 and the description fixed; NOTES in Needs | the Stitch description is whole, two lines, not cut | `E-15-after.png` |
| E-17 | fixed | light: no label under 4.5:1 outside the article (Accept was 4.21:1, now 4.5:1) | `E-17-before.png`, `E-17-after.png` |
| E-19 | not fixed: Needs | reader-interactions.tsx | — |

Checks: `npx tsc --noEmit` clean; eslint clean on every changed file except one warning that predates this branch (document-bar.tsx `react-hooks/exhaustive-deps` on the list's outside-click effect).

Test data: the throwaway document (`cmut44g4k00087dsoyl6ilmf3`, made by this worker) was attached to QA Analyst and QA Student, removed from one, then deleted; it is gone. TikTok's Revenue Dynamics (QA) was moved into "QA folder" and back; it is at the project's root as before.

## Files

- `src/app/api/documents/[documentId]/route.ts`: `DELETE ?scope=project&notebookId=…` is Remove from this project: this project's `NotebookDocument` row only, a `DOCUMENT_DETACH` history event, and a 409 when no other project holds the document (removed, it would be out of reach). Delete itself removes exactly what it removed before.
- `src/app/api/documents/[documentId]/footprint/route.ts`: the answer adds `projects` (the reader's own projects that hold the document, by name) and `otherProjects` (how many other accounts' projects hold it).
- `src/components/reader/document-delete.tsx` (new): `useDocumentReach` (the footprint read), `DocumentDeleteConfirm` (the in-app confirm under the row: where the document is, what goes, what stays; Delete document, Remove from this project, Cancel), plural-aware lines.
- `src/components/reader/document-bar.tsx`: the ⋯ menu gains Remove from this project (disabled with the reason when no other project holds the document); Delete document opens the in-app confirm instead of the browser's `confirm`; the document list opens on a press, a second press closes it, and a hover opens it only after 300ms; the Sort by row is passed to the tree as its sticky header.
- `src/components/reader/add-document-dialog.tsx`: the library's ✕ opens the same confirm (naming the projects it leaves); the queue and the URL box are kept across a close and reopen.
- `src/components/reader/document-folders.tsx`: a dragged document or folder moves at once in local state and goes back with the error when the route refuses; the root drop zone draws over the sticky Sort by row instead of pushing the rows down; New file here → New document here (`NewDocumentRow`); the Sort by row sticks at the list's very top.
- `src/components/graph/graph-overlay.tsx`: Escape takes one layer at a time (a text box first, then an open list, then the graph), IME Escape ignored; the pick is kept per project for the tab; plural counts.
- `src/components/graph/stitch-box.tsx`: the typed command is kept per project for the tab (session storage, memory fallback); `readStitchPick`/`writeStitchPick`; the Stitch description shows whole until the first command instead of one cut line; "1 document picked".
- `src/components/graph/graph-view.tsx`: the legend moves to the canvas's top left; a picked node stays lit in the spotlight.
- `src/components/collab/history-control.tsx`: snippets through `markdownPreview`; an edit's row is a button that opens its document at the block.
- `src/lib/types.ts`, `src/app/n/[notebookId]/page.tsx`: `HistoryEntry.documentId` and `blockId` (optional, additive) for the history jump.
- `src/components/guide-dialog.tsx`: a Keys card listing every key handler the reader answers to.
- `src/components/progress-bar.tsx`: "Counting…" in place of "0/0" until the total is known.
- `src/lib/contents.ts`: a first heading at the level of the other headings is a part, not the title block; `html` is read for the levels.
- `src/app/globals.css`: `--sand-500`, `--sand-600`, `--clay`, `--clay-600` (light), `--sand-500` (dark) `--sage-600` (light) raised to the lightest shade that reads 4.5:1; the New pill on `--sage-700`.
- `src/lib/i18n/dict/panes.ts`, `api.ts`, `works.ts`, `stitch.ts`: the new strings, the plural forms (`stitchScopePickedOne`), 扫描推荐链接, 生成文档, New document here; the old one-line confirm strings removed.
- `SPEC.md`: §5/§6 the document menu (Remove from this project, the in-app confirm), the document list's press and hover, folder moves; the add dialog's kept queue; §12 History rows; §22 the graph's Escape, legend, kept draft and pick; §26 the title block rule.

## Decisions

- **Remove from this project is refused for a document's last project** (409, `api.documentOnlyProject`; the menu row is disabled with the reason). Removed from its only project, a document is in no project and out of the reader's reach; Delete is the action for that.
- **Remove from this project deletes one `NotebookDocument` row** and keeps every annotation, note, quote and block: they belong to the document, which stays in the other project. A `DOCUMENT_DETACH` history event records it (the existing kind; its English line now reads "removed a document from this project").
- **Delete removes what it removed before.** Only its confirm changed: it names the other projects it leaves (the reader's own by name, other accounts' as a count) and counts the annotations and notes that go.
- **An in-app confirm, not a shared dialog.** The app had no confirm component; `DocumentDeleteConfirm` opens under the row, in the list, and is used by the document bar and the add dialog's library. It scrolls itself into view.
- **The list opens on a press, or on a pointer that rests on the pill** (`LIST_HOVER_MS` 300, the timer starting over while the pointer moves), so a pointer passing over on its way to + opens nothing; a second press closes it. A press within 600 ms of a hover opening it does not close it (the reader meant to open).
- **The Stitch draft and pick are kept per project in session storage** (a memory map when storage throws): they survive closing and reopening the graph and a reload of the tab, and do not follow the reader into another tab or account.
- **The add dialog keeps its queue and URL box across a close**; only the item's ✕ and a finished add clear an item. Nothing is written until Add.
- **Contrast tokens raised globally** (`--sand-500`, `--sand-600`, `--clay`, `--clay-600`, `--sage-600` light; `--sand-500` dark), each to the lightest shade that reads 4.5:1 on paper and card; the hue is kept. Faint text across the app gets darker by the same step.
- **English "Generated content" kept**; only zh moved to the glossary's 生成文档. The English label names the list, and renaming it is outside these findings.
- **Contents title rule:** the first heading is the title block (not a part) only when it repeats the document's title, or when it is the first block and every other heading is deeper. Otherwise it is Part 1.
- **History rows jump, not restore.** A row of an edit opens its document at the block; a removed note's row has no Restore (that needs the notes routes, below).
- **Commit order:** `0269517` alone does not type-check (the `header` prop of `DocumentTree` lands in `a2ed5c4`); the branch head does.
- **Before screenshots are the audit's** (`navigation-NN-*.png`, the edge pngs), copied to `.qa-tmp/fix/<id>-before.png`; they show the same states the after scripts reproduce.

## Needs (files I do not own)

- **N6** (`reader-interactions.tsx` 3850–3870, `reader.tsx`, the page loader): a remembered Collapse is applied after mount from a fetch of the cores. Fix: read the stored cores on the server with the page (or an inline script like the reading position's) and render collapsed on the first paint.
- **N10 / E-18 jump** (`reader-interactions.tsx` ~4263, `onFlashBlock`): a part is scrolled with `block: "center"`. Fix: land the part's heading at the reading line (80px under the pane's top edge, `lib/reading-position.ts`) instead of the center. (Part 1 missing from the contents is fixed here, in `lib/contents.ts`.)
- **E-19** (`reader-interactions.tsx` ~8023–8031): the one-time touch hint is `absolute top-16 right-5` over the title. Fix: draw it as a bar at the bottom of the pane, or in the empty space under the header pills.
- **E-16 default section NOTES** (`outline/**`, the notes tray): the default section's stored title "Notes" shows as NOTES in zh. Fix: show the default section's title in the UI language when it is the stored default; no data change.
- **N11 Restore of a removed note** (`api/notes/**`, `panels/**`): History rows now jump to an edit; restoring a removed note from its row needs a notes route.
