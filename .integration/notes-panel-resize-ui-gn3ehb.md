# notes-panel-resize-ui-gn3ehb

**Intent:** Resizable notes tray with a clamped drag bar; in a narrow reader, AI annotations rest as tool icons next to their text; notes get the full text-editing toolbar plus text colors; Add to notes is a bubble above the toolbox; notes added from a highlight land as boxed quotes linked both ways to their source; the Ask/Auto toggle is removed.

**Files:**

- `src/components/reader/workspace.tsx` — drag bar between the reader and the tray: clamped width (280–640, reader keeps 420), arrow keys nudge, double-click resets, width remembered in localStorage.
- `src/components/reader/reader-interactions.tsx` — narrow detection (gutter < 140 collapses stored cards to icons, docks open cards below the highlight); Add-to-notes bubble above the toolbox (replaces the "Add to ▾" row); addToSection stores the highlight as blockquote lines; Ask/Auto toggle and autoRun removed (plans always wait for approval); style types extended for text colors.
- `src/components/reader/reader.tsx` — four text color dots in the edit toolbar; color spans painted in decoratedHtml; one color per span (a new color replaces the old); style syncs serialized so rapid toggles cannot clobber each other.
- `src/components/reader/block-view.tsx` — text color painting in read mode; tool icons (explain/simplify/assistant) after highlighted spans in a narrow reader; a regular note's mark and figure label click-jump to the note in the tray.
- `src/app/n/[notebookId]/page.tsx` — anchorHighlights carry noteId; style healing accepts the color kinds.
- `src/app/api/blocks/[blockId]/style/route.ts` — style enum gains color-clay/sage/gold/plum; a new color replaces another color on the same range.
- `src/components/outline/note-editor.tsx` (new) — the note editor: same functions as the document text toolbar, applied as markdown (headings, lists, bold, italic, underline, text colors, indent).
- `src/components/outline/note-card.tsx` — uses NoteEditor; double-click jumps to the note's source; opening the editor on a quote note starts the caret underneath the quote.
- `src/components/markdown.tsx` — renders `<u>` and `<clay>/<sage>/<gold>/<plum>` note style tags (converted to styled spans); markdownPreview strips them and quote markers.
- `src/app/api/notebooks/[notebookId]/export/route.ts` — docx export strips quote markers and note style tags.
- `src/app/globals.css` — text-color-* classes (ink-mixed for both themes); `.prose blockquote` as a boxed quotation.
- `src/components/panels/edits-panel.tsx`, `src/lib/i18n/dict/*` — labels and keys for the new controls; ask/auto keys removed.

**Decisions:**

- Narrow threshold is a 140px gutter beside the article: side cards are 260–320 wide, so under 140 they cover the text. On typical wide screens nothing changes.
- Text colors are the four existing hues (clay/sage/gold/plum), stored as style kinds `color-*` in the same styles layer as bold/italic/underline — no new table or route.
- Note colors and underline are stored as inline tags (`<u>`, `<clay>`…) and rendered by the one Markdown component via a link-trick (react-markdown drops raw HTML; rehype-raw would add a dependency and an XSS surface). Exports strip the tags for docx and keep them in markdown.
- Notes added from a highlight store `> ` blockquote lines; a quote-only note opens the editor with a blank line appended so additions land underneath.
- Removing Ask/Auto keeps the "ask" behavior: every plan waits for approval, and approved add_note actions land accepted (pending: false), matching SPEC.md §1.
- The mark→note jump uses the existing `dissect:show-note` event; the note→mark jump pushes the source chip URL and also fires `dissect:flash-source` for the same-document case.
- Streaming or unsaved cards do not collapse to icons when the reader turns narrow — only cards whose annotation is stored.
