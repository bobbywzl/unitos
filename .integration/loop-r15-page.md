# loop/r15-page

**Intent:** fix package 5 "page" of round 15: PAGE15-01 and 02 (blocking), then PAGE15-03 to 15, SEL15-09 and EDGE15-06 (the Tab decision), and EDGE15-12 (the long import's freeze), from `.qa-tmp/audit/r15/page.md` and `edge.md`. Fixes take away, fold, or speed up. They add no visible control.

## Findings

The screenshots are in `.qa-tmp/fix/<ID>-before.png` and `<ID>-after.png` in this worktree, and are copied to `/mnt/project-files/interaction-loop/round-15/img/` under the same names. The scripts are the audit's, copied to `.qa-tmp/audit/r15/page/` and `.qa-tmp/audit/r15/edge/` and pointed at :3144 and my own project "Fix r15 page" (`cmv00cxhm00007d0w7xpm3w93`). I added `fx01-reply.mjs`, `fx02-note-thread.mjs`, `fx08-resolve.mjs`, `c11-hold.mjs`, `ph11-after.mjs` and `e02-image.mjs`. Where my own before run crashed (the machine was out of memory many times), the before shot is the audit's.

### PAGE15-01. A reply's × deleted it for good on one press (blocking): fixed
`s31-reply-delete.mjs` (before), `fx01-reply.mjs` (comment card), `fx02-note-thread.mjs` (a reply under a note).

| | before | after |
| --- | --- | --- |
| × press area | 7x20 | 28x28 (36x36 on touch), through an `::after`, so the row does not grow |
| one press on × | the row is gone at once; no pill | the reply leaves the thread; the pill "Reply deleted · Undo" shows; the database keeps the row while the pill shows |
| Ctrl+Z or Undo | nothing | the reply is back in the card and in the database |
| after the pill (12 s) | n/a | `DELETE /api/replies/:id` lands; the row is gone |
| × then a reload while the pill shows | n/a | the delete goes out with keepalive at pagehide; after the reload the row is gone (the reader's expectation: gone) |
| History events | 0 | 0 (see Needs) |

The same thread draws the replies under a note, an edit, and a link, so all three get it (`fx02` proves the note's). A failed delete brings the reply back and says "Not saved. Try again.". Offline, the delete falls back to `api()`, which queues it.

On `origin/main` the same loss happens: `reply-thread.tsx:82` calls `DELETE /api/replies/:id` at once and the route runs `db.reply.delete` with no event.

Shots: `PAGE15-01-before.png`, `PAGE15-01-after.png`.

### PAGE15-02. A typed reply that was not sent was lost (blocking): fixed
`s30-comments.mjs 1440` (with `DOC`), `fx02-note-thread.mjs`.

| | before | after |
| --- | --- | --- |
| type "unsent reply words", click in the text, open the card again | no reply box; Reply opens an empty one | the reply box is open with the words |
| the same after a reload | lost | the words are there (`localStorage["unitos-card-drafts"]`, key `reply:note:<id>`) |
| under a note, after a reload | lost | kept |

The draft goes with the card drafts (`writeCardDrafts`), keyed `reply:note:<id>`, `reply:edit:<id>`, or `reply:link:<id>`. It is written on every key and cleared only after `POST /api/replies` answers. A kept draft opens the box without taking the focus.

On `origin/main` the same loss happens: the draft is `useState("")` (`reply-thread.tsx:46`).

Shots: `PAGE15-02-before.png` (the audit's), `PAGE15-02-after.png`.

### PAGE15-03. Restoring a version hid every mark and comment until a reload: fixed
`s21-restore-marks.mjs`, `s20-versions.mjs 1440`. After a transaction that replaces the whole document (Restore, and its Ctrl+Z), the editor repaints the marks from the highlights it holds.

| | before (audit) | after |
| --- | --- | --- |
| marks / cards after Restore | 2 → 0 / 3 → 0 | 1 → 1 / 1 → 1 |
| after Ctrl+Z | 0 marks for 4 s | marks there at once ("mark back after ms 0") |

My project's document had one comment, so the after counts are 1, not 2 or 3. The fix is in `docs-editor.tsx` (a transaction listener), not in `annotation-marks.tsx`, which is the select package's. Shots: `PAGE15-03-before.png`, `PAGE15-03-after.png`.

### PAGE15-04. On a phone the conversations' chooser covers the suggestion's ✓: not fixed
The cause is `tapMark` in `src/components/docs/annotation-marks.tsx`, a select package file. See Needs.

### PAGE15-05. Review suggested edits ignored Escape: fixed
`s13-review-escape.mjs`. The panel uses `useEscapeLayer(true, onClose)`.

| | before | after |
| --- | --- | --- |
| Escape with the focus from the chord | stays open | closes (review 0) |
| Escape after a click in the text | stays open | closes |

Shots: `PAGE15-05-before.png`, `PAGE15-05-after.png`.

### PAGE15-06. Search the menus ran an insertion for a word meant as a view: fixed
`k13-search-review.mjs`, `k14-search-rows.mjs`. On a tie, a row that writes into the document (Insert and Format menus, and actions marked `writes`) ranks below one that opens a panel or a mode.

| query | before | after |
| --- | --- | --- |
| "review" | Review tracker first; Enter put a 3-row table in (blocks 30 → 33) | Review suggested edits first; Enter opens it (blocks 29 → 29, table 0, review box 1) |
| "contents" | Table of contents first | Show the contents first |
| "replace" | Replace image first | Replace image first (not a tie: "replace" starts its name; with no image selected the row does nothing) |

Shots: `PAGE15-06-before.png`, `PAGE15-06-after.png`.

### PAGE15-07, SEL15-09, EDGE15-06. Tab over words inside a line replaced them: fixed
`k10-tab-words.mjs`. Per the lead's Tab decision: Tab with words selected inside one line goes into the toolbox, with the words kept, in Editing, Suggesting and Viewing. Tab with a caret, over whole lines, list items or cells stays the text's. `tabOpensToolbox(state)` in `docs/layer/anchor.ts` decides; `keys.ts` swallows the Tab and `reader-interactions.tsx`'s `onTab` opens the toolbox.

| | before | after |
| --- | --- | --- |
| Editing, "eading closely " selected, Tab | "R⇥is slow work"; toolbox closes | words kept; focus on the toolbox's first button |
| Suggesting | a suggested deletion and a tab | words kept; toolbox |
| Viewing | toolbox | toolbox |

Alt+F10 is named once: in the shortcuts dialog's Tools rows ("Go to the AI toolbar from selected words": Tab, Alt+F10), and as `aria-keyshortcuts="Alt+F10"` on the toolbox. No existing tooltip on the toolbox names a key, and adding one is the select package's call. Ctrl+A is the select package's. Shots: `PAGE15-07-before.png`, `PAGE15-07-after.png`.

### PAGE15-08. Resolve took a comment off the page with no word: fixed
`s31-reply-delete.mjs` (before), `fx08-resolve.mjs` (after). Resolve shows the pill "Comment resolved · Undo" at the press; Undo reopens the comment once the resolve has landed, and the card line and mark come back.

| | before | after |
| --- | --- | --- |
| pill | none | "Comment resolved · Undo ✕" |
| DB after Resolve | resolvedById set | resolvedById set |
| Undo | n/a (Annotations tab → Resolved → Reopen) | resolved:false, card line 1, and the same after a reload |

Ctrl+Z presses Undo only when the focus is outside the text. Resolve gives the focus back to the page, so in the page editor Ctrl+Z is the text's undo there, the same as for the comment's trash. The pill's Undo button is the way in. Shots: `PAGE15-08-before.png`, `PAGE15-08-after.png`.

### PAGE15-09. A blank document forgot Suggesting on a reload: fixed
`m01-mode-reload.mjs`. A blank document now stores the mode per document, the way an import does. A new blank document still opens in Editing.

| | before | after |
| --- | --- | --- |
| blank document, Suggesting, reload | Editing | Suggesting |
| import | Suggesting | Suggesting |

Shots: `PAGE15-09-before.png` (the audit's), `PAGE15-09-after.png`.

### PAGE15-10. A blank document's load drew the wrong part, then jumped: partly fixed
The toolbar's right end no longer slides. Its caption transitions run only after the toolbar settles (`data-settled`, 1 s after mount), so the mode pill has its resting width at the first paint. The jump to the reading position is not fixed. It comes from the reader's hold in `reader-interactions.tsx`, which applies the position after the page editor first paints. Making the editor wait one more frame for it is a change in a shared file, and the PAGE15-10 measurement scripts (`t20`, `t22`) did not run on the loaded machine, so I left it. No shot.

### PAGE15-11. On a phone the contents panel squeezed the text: fixed
`ph11-after.mjs 390x844` (ph10's steps, measuring whichever layer opens). Under 600 px wide the panel lies over the page, with a shadow, and closes after a jump.

| 390x844 | before | after |
| --- | --- | --- |
| text column while the panel is open | about 100 px ("hippocampu s") | 342 px (the panel lies over it) |
| after a tap on a part | the panel stays | the panel closes (open 0) |

Shots: `PAGE15-11-before.png`, `PAGE15-11-after.png`.

### PAGE15-12. On a phone Find and replace covered the match it found: fixed
`ph11-after.mjs 390x844`. Under 600 px wide Find and replace opens as the find bar docked under the toolbar, edge to edge. Its ⋯ (More options) shows or hides Replace with, the three boxes, Replace and Replace all under the field; Find and replace opens with them shown. While the docked bar is open, the page under the sticky header moves down by the bar's height, so no result lies under it.

| 390x844, "sleep" | before | after |
| --- | --- | --- |
| layer | dialog 358x440 at y 202–642 | bar 374x244 at y 134 (374x56 with ⋯ closed) |
| matches in view under the layer | 3 of 4 | 0 of 1 (rows open), 0 of 4 (rows closed) |
| the current result under the layer | yes | no |
| taps to open | 2 | 2 |

Ctrl+F's bar on a phone is the same bar. Shots: `PAGE15-12-before.png`, `PAGE15-12-after.png`.

### PAGE15-13. Raw failure words for a pasted image: fixed
`e02-image.mjs image` (e01 with a longer wait and the reader's toast in the selector). `uploadImage` gives the server's words only for a status under 500 that carries an error. Otherwise it says "Not saved. Try again." in the page's language, and the status goes to the console.

| | before | after |
| --- | --- | --- |
| `/api/images` 502 | "Request failed (502)" | "Not saved. Try again." |
| offline | "Failed to fetch" | "Not saved. Try again." |

The empty paragraph left after the failed paste stays (it is the paste's own paragraph, and removing it could remove a line the reader typed into). Shots: `PAGE15-13-before.png`, `PAGE15-13-after.png`.

### PAGE15-14. The comment card's grip beside a head row that did not lift: fixed
`c11-hold.mjs` (c10 with its own comment on a document with no others). The grip is gone, and the head row carries `data-hold-head`.

| | before | after |
| --- | --- | --- |
| grip | 18x18 (36x36 on touch) | none; card buttons Resolve, Delete, More options |
| hold of 600 ms on the head row, then a drag | no ghost | ghost 1 |
| a quick move on the head row | n/a | ghost 0 |

Shots: `PAGE15-14-before.png`, `PAGE15-14-after.png`.

### PAGE15-15. Viewing: a second drag over kept words did nothing: fixed
`k12-viewing-redrag.mjs`. In Viewing a press on words already selected collapses the selection at the press point, so the press starts a new selection and never drags the words.

| Viewing, same words dragged again | before | after |
| --- | --- | --- |
| toolbox / dragstart | 0 / fires | 1 / 0 |
| Editing (unchanged) | 1 / 2 | 1 / 2 |

Shots: `PAGE15-15-before.png`, `PAGE15-15-after.png`.

### EDGE15-12. The long import froze on load; find ran 11 long tasks: find fixed, load not proven shorter
`.qa-tmp/audit/r15/edge/l02-big.mjs long` on "Edge r15 long.md" imported into my project (`cmv06n614000s7dlnw5by5guu`, 1,001 paragraphs).

- The toolbar fit no longer measures on every render. It runs when the groups change and from a ResizeObserver on the bar, its right end and each group.
- Find waits for a 180 ms pause in typing on a document of 100,000 positions or more. Enter searches at once.
- My first runs found a real bug: after a reload, the reader's reading-position hold put the pane back whenever the page changed for 8 s. The only result for "Sentence 3925" stayed 9,600 px below the pane (`find … -1` after 15 s). A key press now ends the hold, as the page editor's own hold (`keep-place.ts`) does.

| | before (audit, :3111) | after (:3144, this machine) |
| --- | --- | --- |
| find "Sentence 3925" typed + Enter → in view | 1,813 ms, 11 long tasks, longest 561 | 396 ms, 0 long tasks |
| load: longest task | 748–1,234 ms | 819, 1,263, 1,337, 1,645 ms (four runs, the dev server under memory pressure and restarting) |
| contents → Chapter 40 | n/a | 899–964 ms, longest 69–129 |
| scroll frames p95 | n/a | 20–23 ms, 0 over 50 |

I could not take a same-machine before. Putting the base files back in the worktree for a run was refused by the session's permission check, and the five other workers kept the machine near its memory limit. The load's longest task is not shown to be shorter. A chunked first render was not attempted.

## Files

- `src/components/collab/reply-thread.tsx`: the × with the Undo pill and the bigger press area; the reply draft with the card drafts.
- `src/lib/annotations/resolve.ts` (outside my package, see Needs): `resolveCommentWithUndo`.
- `src/components/docs/layer/comment-card.tsx`: Resolve with the pill; the grip prop removed; `data-hold-head` on the head row.
- `src/components/reader/reader-interactions.tsx` (shared, small in-place hunks): the grip removed; `resolveCommentCard` uses `resolveCommentWithUndo`; `onTab` lets Tab over words in one line reach the toolbox in the page editor; `aria-keyshortcuts="Alt+F10"` on the toolbox; a key ends the reading-position hold.
- `src/components/docs/layer/anchor.ts`: `tabOpensToolbox`.
- `src/components/docs/typing/keys.ts`: Tab over words in one line does not replace them.
- `src/components/docs/typing/shortcuts-dialog.tsx`: the Tab and Alt+F10 row.
- `src/components/docs/suggest/review.tsx`: an Escape layer.
- `src/components/docs/toolbar/search-menus.tsx`, `src/components/docs/toolbar.tsx`: the tie rule (`writes`).
- `src/components/docs/docs-editor.tsx`: marks repaint after a whole-document replace; a blank document stores its mode.
- `src/components/docs/ext/typing.ts`: Viewing's press on selected words.
- `src/components/docs/areas/page.tsx`, `src/components/docs/page/outline.tsx`, `src/components/docs/css/page.css`: the contents panel over the page under 600 px; `outlineRoom` set in a layout effect (the lead's ask).
- `src/components/docs/typing/find-ui.tsx`, `find.ts`, `src/components/docs/areas/typing.tsx`, `src/components/docs/css/typing.css`: the docked bar on a phone, its replace rows, the page moving down under it, and the search pause on a long document.
- `src/components/docs/toolbar/overflow.tsx`, `src/components/docs/css/toolbar.css`: the toolbar fits on size changes only; caption transitions after it settles.
- `src/lib/images.ts` (outside my package): the failure line.
- `src/lib/i18n/dict/common.ts` (`replyDeleted`), `docsLayer.ts` (`commentResolved`), `docsTyping.ts` (`scAiToolbar`): en and zh together.
- `SPEC.md`: the lines listed under Needs.

## Decisions

- Reply × keeps no History row. No existing `NotebookEvent` kind carries a reply, and the decision forbids a new enum value, so the pill alone is the fix this round, as the decision allows.
- A reply deleted and then a reload during the pill: the delete lands (keepalive at pagehide), the same as a note's delete.
- Resolve's pill shows at the press; Undo waits for the resolve's request before it reopens. On a loaded server the request took over 5 s, and a pill that waited for it came too late to be useful.
- The docked find bar moves the page down rather than covering it: a result near the document's top could not scroll below a 244 px bar.
- Search the menus breaks ties only. "replace" still lists Replace image first because its score is higher, not tied.
- PAGE15-03's fix is in `docs-editor.tsx` (a repaint after a whole-document replace), so `annotation-marks.tsx` stays untouched.
- The reading-position hold ends on any key, not only on scrolling keys. Typing in the document or in a box means the reader is acting.
- PAGE15-16 (the assistant's two shapes) is the tools package's.

## Needs (for the lead at merge)

- **PAGE15-04** (select package, `annotation-marks.tsx` `tapMark`): in Editing and Suggesting, a first tap inside `[data-suggestion]` should set `tappedMark` and return false, so the suggestion's card opens alone and a second tap opens the chooser.
- **Reply History**: a reply delete writes no event. If History should restore replies, the notes package's `lib/history` needs a kind (a later round, with the owner's approval for the enum).
- **Shared file** `reader-interactions.tsx`: my hunks are the grip removal (the `AnnotationGrip` import, `annotationGrip`, the `grip=` prop), `resolveCommentCard`, the `tabOpensToolbox` import and `onTab` guard, `aria-keyshortcuts` on `[data-layer-toolbar]`, and the `keydown` release in the reading-position hold (3 lines).
- **Outside my package**: `src/lib/annotations/resolve.ts` (new `resolveCommentWithUndo`; `setCommentResolved` unchanged), `src/lib/images.ts` (failure line), `src/lib/i18n/dict/common.ts` (`replyDeleted` only; the edge package owns its failure keys).
- **nav's overlap**: nav edited `docs-editor.tsx` and `frame.tsx` for the split title-row slot. My `docs-editor.tsx` hunks are the marks repaint listener, `storedMode` and `setMode`; I did not touch the title row or `frame.tsx`.
- **SPEC.md lines**: 343 (a key ends the hold), 382 (Tab), 385 (no grip), 708 (reply × and drafts), 837 (image failure line), 1109–1110 (contents over the page under 600 px), 1125 (Search the menus' tie rule), 1161 (the phone's docked find, the page moving under it, the long document's pause), 1182 (Viewing's press on selected words), 1184 (Resolve's pill at the press), 1186 (Review as an Escape layer), 1217 (a blank document's mode).
- **i18n keys**: `common.replyDeleted`, `docsLayer.commentResolved`, `docsTyping.scAiToolbar` (en and zh).
- Not verified this round on the loaded machine: the toolbar's fold and unfold across widths after the ResizeObserver change. The screenshots at 1440 and 390 show a correctly fitted bar, but no resize script (`c02-touch-rows`, `f01-image`) was rerun. Please rerun one at merge.
- SPEC line numbers are as of this branch.
