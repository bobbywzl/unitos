# claude/user-feedback-fixes-ufe1cr

**Intent:** Fix four pieces of user feedback: a table function in notes, auto-save for a new note while it is typed, a bigger "+ note" control, and a quick upload review instead of a long article review.

**Files:**
- `src/lib/note-markup.ts` — a `table` line kind (a line opening with `|`), painted as a monospace `note-table` line; `insertTable`, `stepTableCell`, `tableTemplate`, `emptyTableRow`, `tableCells`, `lineBounds`.
- `src/lib/note-editable.ts` — Enter on a table row adds an empty row under it, Enter on an empty row ends the table; `newlineFor` returns `{insert, from, to?, caret?, table?}`; Backspace at the start of a table row stays the browser's.
- `src/components/outline/note-editor.tsx` — the bar's table button (`⊞`, `note-format:table`); Tab in a table row steps cells instead of indenting.
- `src/lib/markdown-preview.ts` — the gist preview drops the separator row and reads pipes as spaces.
- `src/app/globals.css` — `.note-doc .note-table`.
- `src/lib/i18n/dict/panes.ts`, `src/lib/i18n/dict/common.ts` — `insertTable` tooltip; "table 表格" in the zh glossary.
- `src/components/outline/note-composer.tsx` — new: the "+ note" composer with auto-save (create on first typing, debounced PATCH, keepalive flush on close), Save, Cancel/Esc.
- `src/components/outline/notes-tray.tsx`, `src/components/outline/section-item.tsx` — use the composer; hide the note the composer owns; "+ note" and "Speak" always visible, bold, padded; collapsing a tray section closes the composer.
- `src/lib/derive/config.ts` — `CLAUDE_HAIKU_4_5`, `UPLOAD_REVIEW_MODEL`.
- `src/lib/upload-assistant.ts` — the review calls `UPLOAD_REVIEW_MODEL` with no provider options (Haiku 4.5 takes no effort or fallback) and 8192 output tokens; the instruction check is unchanged.
- `src/lib/prompts/upload-review.ts` — summary one sentence, advice at most 3 lines, "be quick and short".
- `SPEC.md` — §2 model note, §6 composer auto-save and table, §15 review.

**Decisions:**
- Tables in the editor show as their markdown rows in a monospace line, not as a live `<table>`. The editor's caret model is one line per newline; a live table with cells would need a new offset model for cells and was judged too large for this round. The rendered note draws a real table already (remark-gfm).
- The table template is 2 columns, a header row, 2 body rows, all cells empty. GFM accepts an empty header row (checked with remark-gfm), and a table directly under a text line still parses.
- A new note is created on the server after the first typing (900 ms debounce), the same timing as an open note's auto-save. Cancel and Esc delete that note, matching "Cancel and Esc restore the content from before this edit" for a note that did not exist before. Before this change Esc silently discarded the draft.
- The "Speak" control gets the same style as "+ note" so the row keeps parallel structure.
- "Haiku level" was read as both the model and the length: Claude Haiku 4.5 for the review call, and a one-sentence summary with at most 3 advice lines. The instruction check stays on the parse model because its output steers the parser.
- Verified: eslint clean; tsc clean except a pre-existing `LayoutProps` error in `src/app/layout.tsx` that is also on a clean checkout (Next's generated types); node tests of the pure table and newline functions; a jsdom round trip of table rows through `serializeNoteDoc`; remark-gfm parsing of the template with the note renderer's hard breaks. Not verified in the running app: no Postgres or Docker daemon in this environment.
