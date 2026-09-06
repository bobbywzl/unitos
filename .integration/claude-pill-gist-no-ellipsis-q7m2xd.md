# claude/pill-gist-no-ellipsis-q7m2xd

**Intent:** No pill, tab, select, or collapsed row cuts its text with an ellipsis: the Add-document tabs get labels that fit, document titles are cut at a word boundary with the full title on hover, and every collapsed note and annotation shows a gist — a short phrase AI writes to fit the row.

**Files:**
- `prisma/schema.prisma`, `prisma/migrations/20260906130000_note_gist/migration.sql` — `Note.gist String?`: null until written, cleared when the content changes.
- `src/lib/prompts/gist.ts` — the prompt: one phrase per listed note, at most 5 words and 30 characters (14 in Chinese), in the note's language, its point not its topic, no quotes, no trailing period; JSON keyed by note id. `GIST_MAX_CHARS`.
- `src/lib/notes/gist.ts` — `writeGists(noteIds, userId)`: loads the notes still without a gist, one `callForJson` per 25 notes on `GIST_MODEL` at `GIST_EFFORT` ("low"), Simplify markers stripped, each phrase clipped to the cap and written only when the note is unchanged since it was read (`updatedAt` in the where).
- `src/app/api/notes/gist/route.ts` — `POST /api/notes/gist` `{noteIds}` → `{gists}`; access checked per notebook (viewer); ids the reader cannot read are dropped.
- `src/app/api/notes/[noteId]/route.ts` — a content edit sets `gist: null`.
- `src/lib/derive/config.ts` — `GIST_MODEL`, `GIST_EFFORT`. `src/lib/usage.ts` — the `gist` feature.
- `src/lib/gist-client.ts` — `useGist(noteId, stored, plainText, wanted)`: the stored gist, else one fetched this session for the same text, else the first words; a collapsed row without a gist queues an ask, and the asks of one frame go out as one request.
- `src/lib/markdown-preview.ts` — `clipWords(text, max)`: cut at a word boundary, no marker.
- `src/components/outline/note-card.tsx`, `src/components/panels/annotations-panel.tsx` — the collapsed row shows the gist; `truncate` (which ellipsizes) replaced by `overflow-hidden whitespace-nowrap`; the floating placeholder shows the same line.
- `src/lib/types.ts`, `src/app/n/[notebookId]/page.tsx`, `src/app/n/[notebookId]/notes/page.tsx` — `gist` on `NoteView` and `AnnotationItem`.
- `src/components/reader/document-bar.tsx` — the document pill grows to `min(50vw, 32rem)` and shows the title cut at a word boundary (56 characters); the list rows likewise (44); the full title stays in the tooltip.
- `src/components/reader/reader-panes.tsx` — the pane's document select cuts at a word boundary (48) instead of `…`.
- `src/components/reader/add-document-dialog.tsx`, `src/lib/i18n/dict/panes.ts`, `src/lib/i18n/dict/api.ts` — the tabs read PDF or image · Video or audio · Google Drive (`tabDrive`; the Drive tab's own button keeps Add from Google Drive) · URL · Library, en and zh; the tab row scrolls sideways instead of truncating; the two messages that pointed at the "Add from Google Drive tab" say "the Google Drive tab".
- `scripts/qa/mock-kimi.mjs` — the gist mock: the first five words of each listed note, so `ui-note-effects` still finds "alpha" in the collapsed line.
- `CLAUDE.md`, `src/lib/i18n/dict/common.ts` — gist (要旨) in the vocabulary. `SPEC.md` §3, §6.

**Decisions:**
- Gists are written lazily and in batches, not at save time: the editor auto-saves on every pause, and a note being edited is expanded anyway. The first collapsed render after an edit asks for a new gist.
- A gist is a label, not note content, so it is not a pending derivation: SPEC.md §1 covers AI output that enters notes; nothing enters the note here.
- Written in the note's own language, not the UI language: it stands in for the note's first words, which are in the note's language.
- The row clips without a marker as a last resort (`overflow-hidden whitespace-nowrap`); the cap (5 words, 30 characters) is what makes the phrase fit, and the fallback first words are cut to the same cap.
- Document titles are cut at a word boundary rather than given a gist of their own: a title's first words name the document. An AI short title for documents is a possible follow-up.
- Verified: `eslint`, `next build`. Not verified in a browser: no pgvector Postgres in this environment and no MOONSHOT key, so the live gist call was not exercised; the QA mock's gist branch was written for the loop that can.
