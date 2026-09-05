# claude/assistant-panel-highlighting-bnlde1

**Intent:** Make the reader's highlights and AI cards responsive: the selection stays tinted under the toolbar (the Assistant and Comment boxes), every AI card grows with its content up to the pane and pushes the cards below it, a deleted note's mark fades at once, links paint as they close and take a description, the split views resize by a bar, and transcript lines get the article's full toolbar.

**Files:**
- `src/components/reader/block-view.tsx` — new highlight kinds `selection` and `pending-link`, a `leaving` flag (mark fades, no clicks), `linkReason` in a link mark's tip, a fresh link sweeps in, and `line` rendering (a transcript line as one inline span with its marks).
- `src/app/globals.css` — `--selection-bg` shared with `::selection`; `.selection-mark` and `.link-pending-mark` (native selection over them paints nothing); `.annotation-mark:hover`; `.mark-out` fade; `[data-side-card]` slides on `top` except while dragged; `.pane-split` eases; `.link-mark` declares `--mark-bg` so it can sweep.
- `src/components/reader/reader-interactions.tsx` — the selection tint under the open toolbar and the Close link chip; the pending link's first end tinted; `removedNotes` (leaving → gone) driven by `dissect:note-removed` / `dissect:note-restored`, every delete optimistic through `deleteNote`; `addLocalAnchor` after an Explain, Simplify, or Assistant persists; `paneHeight` caps every card, cards are flex columns with a scrolling body, the assistant card has no fixed height; `settleSideCards` (a ResizeObserver on the cards pushes lower cards on the same side down, the grown card pinned); connectors re-measure on nested scrolls and every frame of a slide; `localLinks` + `dissect:link-created` paint both ends of a closed link in every pane; `linkReasons` shows a typed description before the refresh; the link card (`LinkCard`) after Close link; the `transcript` prop switches off edit mode, the article menu, and Distill.
- `src/components/reader/reader.tsx` — `TranscriptVariant`, `transcriptParagraphs`, and `TranscriptBody`: the transcript lines as reader blocks in their own scroll box, following playback, with the moment's hover tools; `Reader` renders prelude → lines → epilogue in that mode.
- `src/components/video/video-pane.tsx` — hosts `ReaderInteractions` with the lines as blocks, the player and video tools as the prelude, the article section as the epilogue; `lineTools` and `annotatedLineIds` feed the reader; the pane's own translation bar is gone (the reader's Translate offer covers the lines).
- `src/components/video/transcript.tsx` — reduced to `TranscriptHeader` and `TranscriptEmpty` (the paragraph rendering moved to reader.tsx).
- `src/app/n/[notebookId]/page.tsx` — `textLayer(pane)` builds the text-layer props once for both the article and the video pane; link marks carry `reason`.
- `src/app/api/links/[linkId]/route.ts` — PATCH accepts `reason` (what the link is about) besides `accept`.
- `src/components/panels/annotations-panel.tsx` — deletes dispatch `dissect:note-removed` (restored on failure); `LinkAbout` shows and edits a link's description.
- `src/components/outline/use-outline.ts` — the tray's note delete dispatches the same events.
- `src/components/reader/reader-panes.tsx` — the bar between the two panes drags the split (remembered per view kind, double-click resets, arrow keys nudge); link lines re-measure as panes resize.
- `src/components/video/assistant-card.tsx` — the media assistant's conversation grows to most of the window before scrolling.
- `src/lib/i18n/dict/reader.ts`, `panes.ts`, `panels.ts` — the link card, the pane bar, and the panel's link description strings, en and zh.
- `SPEC.md` — §6 and §11 record the new behavior.

**Decisions:**
- The selection tint is a mark in the highlight layer, not a DOM overlay: it follows the text, uses `::selection`'s color, and hides the native selection over itself so the two never stack. Reading mode only: edit mode's blocks are contentEditable and repainting them would drop the caret and the native selection.
- Cards grow with `height: auto` capped at the pane's height minus 24px; the body scrolls past the cap. The assistant card keeps its native resize handle; a manual resize counts as growth and pushes neighbors.
- Give way pushes down only, never up, and only cards that overlap horizontally (same side). The card whose size changed stays put; the rest settle top to bottom. Nothing pulls a pushed card back up when the card above shrinks.
- A link's description is stored in the existing `DocLink.reason` (the field a recommended link's AI reason already uses) — one field for "why these two passages connect", no migration.
- The transcript hosts the whole `ReaderInteractions` layer rather than a second toolbar implementation: one code path (SPEC.md §1). The lines keep their own 420px scroll box so playback never moves the page; the connector line follows that box's scroll. The article menu and Distill are hidden on a transcript because the video pane has its own assistant and tools.
- Deleting from a card closes the card at once and fades the mark before the server answers; a failure restores the mark with a toast rather than reopening the card.
- The split is stored per view kind (`unitos-pane-split:side`, `unitos-pane-split:stack`), 0.2–0.8.
- A local pgvector-enabled Postgres and a seeded project were used to check every flow in headless Chromium (selection tint under the Assistant box, card growth and push, mark fade on delete, pending and closed link marks, the link card, both split bars, the transcript toolbar and hover tools). AI calls were not exercised (no key).
