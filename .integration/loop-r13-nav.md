# loop/r13-nav

**Intent:** fix round 13's navigation findings (NAV13-01..08, 10..18; EDGE13-02, 06, 08, 10 nav parts, 12): the header, rail, phone bar, document list, add box, History, Feedback, touch names, focus; land `tooltip.tsx` (long press) and `escape-layers.ts` (focus return, one modal trap) first.

Screenshots: `/home/user/wt/r13-nav/.qa-tmp/fix/<id>-before.png` and `-after*.png`. Scripts: `/home/user/wt/r13-nav/.qa-tmp/nav/` (the audit's, adapted to port 3145, plus `f*.mjs`).

## Findings

| Id | Status | Before | After | Screens |
|---|---|---|---|---|
| NAV13-06 (rule zero: typed link lost) | fixed | a link the server cannot reach: the box offered ✕ and Close; the dialog reopened with an empty field (2 presses + paste; the link was gone) | the box's one action is "Edit the link" ("Edit the queue" for several): the dialog reopens with the same link and the error under it, 1 press; ✕ then + also keeps it; 0 documents made | NAV13-06-before/after*.png |
| NAV13-01 | fixed | folder rows: no keys into a folder; type-to-find searched the top level only | Enter/Space/→ on a folder opens it and focuses its first row; ↓ ↑ move; ← or Escape go back to the folder row; "work" finds Working memory inside a folder | NAV13-01-* |
| NAV13-02 | fixed | a space in type-to-find pressed the row (opened a document) | space joins the search: "attention s" focuses Attention span, nothing opens | NAV13-02-* |
| NAV13-03 | fixed | row ⋮ on a shared document: Delete at +529 ms, then Remove took its place (rows jumped) | rows wait up to 600 ms for the reach; Move/Remove/Delete appear together at +378 ms; the reach is prefetched on hover/focus of ⋮ and kept 20 s | NAV13-03-* |
| NAV13-04 | fixed | This document listed no deletions | This document lists the document's note deletions and detaches ("You removed a note") | NAV13-04-* |
| NAV13-05 | fixed | Restore: tray switched at 660 ms, the note arrived at 3814 ms (an empty tab between) | Restore reads Loading until the refreshed list has the row; tray switch and note in the same frame (2390–4094 ms on a loaded machine) | NAV13-05-* |
| NAV13-07 | card part fixed; page editor naming is the page package's | block card with no stored contents: first heading 150 px down, under 4 rows (ask, button, disclaimer, "Until then…") | headings first (first heading 12 px down); Generate contents one row at the foot, what AI does and the disclaimer in its tooltip; no headings: the ask as before | NAV13-07-before(-measured)/after.png |
| NAV13-08 | fixed | import in Normal view: no Extract at the top; rail Extract › Extract from the article, 2 presses | Extract pill after Collapse in the page editor toolbar on md+ (icon-only at 1000, name in tooltip), 1 press opens the extract page; below md the bar's Extract | NAV13-08-after-1440/1000/press.png |
| NAV13-10 | fixed | Tab left the add dialog, the guide, the Delete project confirm; Escape dropped focus to body in Contents, card ⋯, History, phone guide; Sort by Escape closed two layers | add dialog: Tab ×5 stays in (`add-url inDialog=true`); guide Tab ×6 stays on Close; Delete confirm Tab ×6 stays in; Escape returns focus to Contents, ⋯, History, Guide; Sort by Escape closes the choices only; folder ⋮ Escape → focus on ⋮ | NAV13-10-before/after.png, EDGE13-10-folder-menu-*, NAV13-10-guide-phone-after.png |
| NAV13-11 / EDGE13-06 | fixed (long press); bar labels not added | 12 icon-only controls on a tablet, 5 on the phone bar, no name on touch | a 450 ms long press on any control with a tooltip shows its name for 3 s and does not press it (0 clicks reach the page); a tap still presses (1 click) | NAV13-11-before / after-tablet-longpress.png |
| NAV13-12 | fixed | row ⋮ 24×24, folder ⋮ 24×24, Sort by 27 px, History Restore 61×23, scope pills 25 px | coarse pointer: ⋮ 36×36, Sort by ≥32, Restore 69×35, All 37×37, This document 102×37 (same glyphs, same rows) | NAV13-12-before / after-history.png |
| NAV13-13 | fixed | dashboard Rename: the browser's prompt; Leave: confirm() | Rename turns the card's title into a field in place (Enter keeps, Escape drops, blur keeps); 0 browser dialogs; title saved and shown after reload. Leave: in-app confirm like Delete project | NAV13-13-before/after.png |
| NAV13-14 | fixed | three more-glyphs; the open card menu covered its title; instruments sprang on focus and with the menu open | one MoreIcon ⋯ everywhere; menu under the title (title 396–423, menu from 470); instruments fan on hover only (0 moved with the menu open) | NAV13-14-before/after.png |
| NAV13-15 / EDGE13-12 | fixed | ✕ + Close on a failed add; text Close on Feedback; text Cancel on the repeat ask dialog | the failed add's Close is "Edit the link"; Feedback's ✕ at the top right; the repeat ask dialog's ✕ at the top right labelled Cancel (Escape and outside still Cancel) | NAV13-15-*, EDGE13-12-* |
| NAV13-16 | fixed | guide: a Summary tab that is not there; no Graph, Reader view; History "button at the top"; notes "Press ?" | Summary gone (Layman/Professional summary in the Assistant line), Graph and Reader view lines, History "(More › History on a phone)", a key line for the document list; release notes: "the ? at the top right of the reader, or More › Guide on a phone" | NAV13-16-before/after.png |
| NAV13-17 | fixed | + by mouse: the link field's 3-line tooltip opened over the drop zone every time | + by mouse: focus in the field, no tooltip; Tab to the field still shows it | NAV13-17-before/after.png |
| NAV13-18 | fixed | Remove on the open document: notice at +541 ms, old document shown until +2886 ms | the next document in the list opens at once; pill and notice switch in the same frame (+393 ms), the next document drawn by +1517 ms; the last document goes to the empty project (pill reads Documents) | NAV13-18-before/after.png |
| EDGE13-02 | fixed | 844×390: Feedback covered the rail's Extract; phone notes full page: the pill on Accept | reader: no floating Feedback (0 visible), nothing covered at 844×390 or 1440; Feedback is the Reader view menu's last row (md+) and More's (below md); phone notes/annotations full pages: a 38 px header button | EDGE13-02-before/after.png, EDGE13-02b-after.png |
| EDGE13-08 | fixed | 768–999: Add to notes unfolded the tray, column 720 → 496 px | folded tray stays folded (column 720), Notes button blooms; open tray shows the note as before | EDGE13-08-before / after-first-add / after-second-add.png |
| EDGE13-10 (nav parts) | fixed | folder menu Escape, add dialog focus, History focus | see NAV13-10 | |
| NAV13-09 | not mine | — | page package | |

Rule zero, proven in the database: NAV13-06 made 0 documents (checked in `Document`) and the link stayed in the dialog through Edit the link, and through ✕ then +; NAV13-13 rename read back from `/api/notebooks` and after a reload, Escape wrote nothing; NAV13-18 Remove left the document in its other project (checked in `NotebookDocument`).

## Where things moved

- Feedback (reader): the floating round button at the foot of the rail is gone; it is the last row of the rail's Reader view menu (md+) and of the bar's More menu (below md, as before). Notes and annotations full pages below sm: the header's Feedback button.
- The failed add box's Close: now "Edit the link" / "Edit the queue" (reopens the dialog with the link or queue); ✕ still closes. Close stays for the lost-figure state.
- Repeat ask dialog Cancel: the ✕ at the top right.
- Contents card Generate contents: the row at the card's foot (the ask stays when there are no headings).
- Dashboard Rename: the card's title field (same ⋯ › Rename).

## Files

- `src/components/tooltip.tsx`: long press on a coarse pointer; focus shows the tip only after a navigation key (NAV13-11, NAV13-17); installs the modal trap.
- `src/lib/escape-layers.ts`: `captureOpener`, `returnFocus`, `focusWhenDrawn`, `installModalTrap`, `useModalFocus`; `useEscapeLayer` returns focus to the opener after key input (NAV13-10).
- `src/app/globals.css`: no callout/selection on long press of tooltip controls; instruments fan on hover only (NAV13-14).
- `src/components/reader/upload-assistant.tsx`, `add-document-dialog.tsx`, `document-bar.tsx`: NAV13-06; list keys and type-ahead (NAV13-01/02); reach wait (NAV13-03); leaveDocument (NAV13-18); touch sizes (NAV13-12).
- `src/components/reader/document-folders.tsx`, `document-organize.tsx`, `document-delete.tsx`: folder keys, Escape layers, reach cache, touch sizes.
- `src/lib/history/list.ts`, `src/app/api/notebooks/[notebookId]/history/route.ts`, `src/components/collab/history-control.tsx`: NAV13-04, NAV13-05, NAV13-12.
- `src/components/reader/workspace.tsx`: History layer and focus (NAV13-10); quiet add by tray state (EDGE13-08).
- `src/components/reader/reader-panes.tsx`: Feedback row in the Reader view menu (EDGE13-02).
- `src/components/feedback-button.tsx`: no pill in the reader; hidden below sm on full pages; ✕ (EDGE13-02, NAV13-15).
- `src/components/reader/duplicate-ask.tsx`: ✕ labelled Cancel; modal focus (EDGE13-12).
- `src/components/reader/contents-menu.tsx`: headings first (NAV13-07).
- `src/components/guide-dialog.tsx`, `src/lib/i18n/dict/works.ts`: guide and release words (NAV13-16); modal focus.
- `src/components/works/work-card.tsx`, `works-shelf.tsx`: inline rename, Leave confirm, menu place, MoreIcon (NAV13-13/14).
- `src/lib/i18n/dict/panes.ts`: upload and History words.
- Outside my list (one-line hunks): `src/app/n/[notebookId]/page.tsx` (History reads `{ documentId }`), `src/app/n/[notebookId]/notes/page.tsx` and `annotations/page.tsx` (`<FeedbackHeaderButton />` in the header), `src/components/reader/reader-interactions.tsx` (the page editor's `aiControls` gets `distillButton`, NAV13-08).
- `SPEC.md`: lines on the header/rail (Reader view holds Feedback), Add to notes (a folded tray stays folded), the dashboard card (menu under the title, inline Rename, instruments on hover), Shared with you Leave, History (This document, Restore), the repeat ask (✕ is Cancel), Where Feedback is, the Contents list order, the page editor's Collapse/Extract.

## Decisions

- NAV13-11: no 10 px labels under the phone bar's icons. The long press names every icon on touch (tablet and phone), so the bar keeps its 54 px and its density.
- NAV13-18: the next document is the one after the removed one in the list, else the one before; with none, the empty project.
- EDGE13-08: decided by the tray's state at every width: a reader who folds the tray on a wide screen also keeps it folded on Add to notes.
- NAV13-07: with no headings the ask stays as it was (nothing else to show); `reader.contentsHeadingsNote` is no longer read.
- NAV13-08: the Extract pill in the page editor toolbar shows on md and up only; below md the bar's Extract is one tap.
- Focus return runs only after key input, so a mouse reader's focus is not moved.
- Feedback's ✕ keeps the typed words for the next open.

## Needs (lead, at merge)

- `reader.contentsHeadingsNote` (en+zh) in `src/lib/i18n/dict/reader.ts` (select package's dict) is unused now; remove it when merging, or leave it.
- The page package: the page editor's "Show the outline"/"Outline" should read Contents (`docs/page/outline.tsx`) and close on Escape (NAV13-07's other half); NAV13-09 is theirs.
- The notes package edits the notes and annotations full pages: keep my one `<FeedbackHeaderButton />` line in each header (else Feedback is unreachable there below sm).
- `reader-interactions.tsx`: my hunk is the `aiControls` line only (~line 9947).
- i18n keys added: `panes.uploadEditLink`, `panes.uploadEditQueue`, `works.guidePanelGraphBody`, `works.guidePanelReaderViewBody`, `works.guideKeyList`; changed: `panes.historyScopeDocumentTitle`, `panes.historyDocumentEmpty`, `works.guidePanelAssistantBody`, `works.guidePanelEditsBody`, three `works.release*Body`; removed: `works.guidePanelSummary`, `works.guidePanelSummaryBody`.
- Other packages can use `captureOpener`, `returnFocus`, `focusWhenDrawn`, `useModalFocus` from `src/lib/escape-layers.ts`; every `aria-modal="true"` dialog is trapped by the tooltip-installed trap.
- Pre-existing eslint warning in `document-bar.tsx:487` (closeList dependency), not from this branch.

Data made and removed: projects "Fix r13 nav" and "Fix r13 nav 2", their 16 documents, folder, and notes, deleted through the app's routes at the end (`99-cleanup.mjs`: 0 projects, 0 documents, 0 folders left).
