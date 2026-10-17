# loop/r11-grammar

**Intent:** give the page editor and the note editor Google Docs' red spelling squiggle across the whole document and a blue grammar squiggle with Accept and Ignore, with their switches (the owner's request: "the reader does not have grammar and writing correction settings like the red squiggly line in Google Docs").

## Findings

This is a feature, not an audit finding. Screenshots are under `.qa-tmp/fix/` in this worktree (git-excluded); scripts under `.qa-tmp/gram/`, run against :3136 with a worker's own mock on :3436 (`MOCK_PORT=3436 node scripts/qa/mock-kimi.mjs`), in my own project "Grammar check test (r11-grammar)" (deleted at the end through the app).

- **GRAM-01 red squiggles across the document: done.** A 126-paragraph blank document, untouched: 22 red squiggles, the last two ("mispeled", "documnet") at the end of the document, far from the caret. The Chinese and the French paragraphs have none and keep the browser's own check (`spellcheck="true"` on them; the page has it off). Shots: `GRAM-01-before.png` (none), `GRAM-01-after.png`.
- **GRAM-02 blue squiggles after a pause: done.** Typed " He have a apple." at the end of the document: no blue at 1.0 s; "He have" turns blue 2.0–2.3 s after the last key (three runs). The open pass drew the blue squiggles of the whole 126-paragraph document in about 13 s, the paragraphs on screen first. Shots: `GRAM-02-before.png`, `GRAM-02-after.png`.
- **GRAM-03 Accept in Editing: done.** "the the" → card ("the", struck "the the", "Repeated word", Accept, Ignore) → Accept: the text reads "go to the meeting". Shots: `GRAM-03-card.png`, `GRAM-03-after.png` (before: `GRAM-02-before.png`, nothing to click).
- **GRAM-04 Accept in Suggesting: done.** In Suggesting mode, Accept on "a apple" makes the reader's own suggestion: deletion "a apple", insertion "an apple", the card "You · Replace". Shot: `GRAM-04-after.png`.
- **GRAM-09 Ignore: done.** Ignore on "Their is" hides it; after a reload it stays hidden while the other blue squiggles come back from the cache without a request. Shot: `GRAM-09-after.png`.
- **GRAM-13 a click on a red word: done.** "comittee" → card with "committee", Add to dictionary, Ignore all; the click puts "committee" in place. Shot: `GRAM-13-after.png`.
- **GRAM-10 Viewing shows none: done.** Ctrl+Alt+Shift+C: 0 red, 0 blue. Shot: `GRAM-10-after.png`.
- **GRAM-05 / GRAM-08 / GRAM-12 the switches: done.** Search the menus lists Show spelling suggestions (Ctrl+Alt+X) and Show grammar suggestions under Tools; Preferences has both switches. Both off, then a reload: still off (stored `[false, false]`), no squiggle. Both on again: the squiggles return. Shots: `GRAM-05-before.png`, `GRAM-05-after.png`, `GRAM-08-before.png`, `GRAM-08-after.png`, `GRAM-12-after.png`.
- **GRAM-06 the import: done.** A Markdown import, switched to Editing: red "importd", blue "He have", "would of", "less errors". In Viewing (how an import opens) none. Shots: `GRAM-06-before.png`, `GRAM-06-after.png`.
- **GRAM-07 the note editor: done.** On the notes full page: red "comittee", blue "She go", "the the", "a apple"; the Chinese line has none. Accept on "the the" and the spelling suggestion "committee" each edit the note, and one Ctrl+Z takes the last one back; Ignore hides "a apple". Shots: `GRAM-07-before.png`, `GRAM-07-after.png`, `GRAM-07-card.png`, `GRAM-07-after-accept.png`.
- **GRAM-14 Chinese UI:** the card reads 接受 / 忽略, and Search the menus lists 显示拼写建议 and 显示语法建议. Shots: `GRAM-14-zh-card.png`, `GRAM-14-zh-search.png`.

**Typing stays smooth** (`perf.mjs`, 800-paragraph document, 80 keys typed into paragraph 400 while the open pass runs, keydown to the frame after the next paint): before median 21.9 / 20.9 ms, p95 39.5 / 31.8 ms; after median 21.4 / 21.8 / 21.9 ms, p95 40.5 / 30.1 / 32.6 ms (480 red and 30–54 blue squiggles drawn). Long tasks in the 12 s after the editor is ready (`longtask.mjs`): 0 with the squiggles off; with them on, 2 (50 and 107 ms) before batching the decoration updates, 0 after (two runs).

**Without a worker** (`noworker.mjs`, `window.Worker` removed): the check falls back to nspell on the page and draws the same 22 red squiggles.

## Regression run

`scripts/qa/ui-docs-parity.mjs SPELLING` against :3136: 11 passed, 0 failed (the right-click menu's spelling suggestions, Add to dictionary, Ignore all, the next misspelling, the personal dictionary dialog, a reload). From the round 11 page set (`.qa-tmp/audit/r11/page/`, pointed at :3136 and my project): d01, d03, d05, s01, s02, r04, m01, f01 read as in the audit (d03's assistant draft is the known PAGE11-02, another package). z01 needs a PDF import, which this project does not have.

## Files

- `src/lib/grammar.ts` (new): the issue and request schemas, `keptIssues` (drops an issue whose words are not in the text exactly), `textKey`, the limits and the 2 s pause.
- `src/lib/prompts/grammar.ts` (new): the GRAMMAR prompt template, `grammarPrompt(ctx) => string`.
- `src/lib/grammar-check.ts` (new): the model call, Zod-checked by `callForJson`.
- `src/app/api/grammar/route.ts` (new): POST, signed in, Unitos Premium or Ultra (`premiumActive`), 503 with no model, 422 on a failed call.
- `src/lib/derive/config.ts`, `src/lib/feature-models.ts`, `src/app/admin/gateway/page.tsx`, `src/lib/i18n/dict/admin.ts`: the feature `grammar` (GLM 5.3 Flash, low effort) and its row in Model per function.
- `src/lib/i18n/dict/api.ts`: the route's three messages (en, zh).
- `src/lib/spell-words.ts` (new): the words the spelling check reads in plain text (moved out of spelling.ts unchanged), `readsAsEnglish`, `rankedSuggestions` (moved unchanged).
- `src/components/proofing/spell.worker.ts`, `spell-service.ts` (new): nspell in a worker, with a fallback on the page.
- `src/components/proofing/grammar-queue.ts` (new): the request queue, the answers kept by paragraph text in the browser (`unitos-grammar-v1`, Zod-checked on read), Ignore.
- `src/components/proofing/proofing-card.tsx` (new): the card both editors open.
- `src/components/docs/typing/proofing.ts` (new): the ProseMirror plugins (state, decorations, the driver that schedules the work).
- `src/components/docs/typing/proofing-layer.tsx` (new): opens the card on a click and runs Accept, Ignore, Add to dictionary, Ignore all.
- `src/components/docs/typing/spelling.ts`: `wordsOf` exported and skips words a suggestion removes; the right-click menu's spelling suggestions come from the worker and follow Show spelling suggestions instead of the page's spellcheck attribute.
- `src/components/docs/typing/prefs.ts`: `showSpelling`, `showGrammar` (default on; a stored value without them reads them as on).
- `src/components/docs/typing/preferences-dialog.tsx`, `shortcuts-dialog.tsx`, `events.ts`, `src/components/docs/areas/typing.tsx`, `src/components/docs/toolbar.tsx`: the two switches (Ctrl+Alt+X / F7 for spelling, a Tools command for grammar, Preferences), the toasts, and the squiggles on in Editing and Suggesting only.
- `src/components/docs/ext/typing.ts`: registers the plugins.
- `src/components/docs/docs-editor.tsx`: one line, the page's `spellcheck` attribute is now "false" (Unitos draws; non-English paragraphs turn the browser's check back on).
- `src/components/docs/css/typing.css`: the two squiggles, light and dark, none in print, the card hidden in print.
- `src/lib/i18n/dict/docsTyping.ts`, `docs.ts`, `common.ts`: the strings (en, zh); `docs.spellcheck` ("Spelling and grammar check") gives way to `docsTyping.showSpelling`; the zh glossary gains "grammar suggestion 语法建议".
- `src/components/proofing/note-proofing.tsx`, `proofing.css` (new), `src/components/outline/note-editor.tsx` (two lines, in their own commit 728ae29): the note editor's squiggles.
- `scripts/qa/mock-kimi.mjs`: answers the grammar prompt with plausible issues; `MOCK_PORT`.
- `SPEC.md`: §2 (the grammar feature), §6 (the note editor), §29 (Spelling suggestions, Grammar suggestions, the switches, the right-click menu, Preferences, the toolbar).

## Decisions

- The grammar check is not a DerivationType (nothing lands in a note), so it has its own route and its own prompt file, like the gist and the assistant's check; no enum or migration.
- Requests carry up to six paragraphs (6,000 characters), one request at a time, at least 0.8 s apart. "Paragraph by paragraph" is kept in the prompt: each paragraph is checked on its own and answered by its id. The paragraphs the reader just wrote go before those waiting from the open pass.
- The answers are kept in the browser (localStorage, newest 3,000 paragraph texts), not on the server: no new table, and a per-viewer convenience. Another browser asks again.
- Ignore is keyed by the paragraph's text, as asked: an edit anywhere in that paragraph asks again, and an ignored issue can come back. A per-document ignore list would hold across edits.
- Gating: Unitos Premium and Ultra (an expired trial gets no blue squiggle, the route answers 403). The red squiggle is for everyone, as the spelling check was. No in-app rate limit: none of the similar background calls has one (the gateway limits); the client throttles.
- "English" is judged per paragraph from the dictionary: CJK text is not; four Latin words or more need at least half known. A non-English Latin paragraph keeps the browser's check in the reader's languages, so French still gets the browser's underline; an English paragraph loses the browser's underline in other languages.
- Shift+right-click's browser menu now offers the browser's spelling suggestions only in non-English paragraphs, since the browser's check is off where Unitos draws.
- The label "Spelling and grammar check" became "Show spelling suggestions" (Google's own name for the switch), and grammar got "Show grammar suggestions", so neither switch claims the other's job. The toolbar button and Ctrl+Alt+X / F7 are unchanged and the choice now survives a reload.
- The next and previous misspelling (Ctrl+' and Ctrl+;) still load nspell on the page on first use, as before; the squiggles and the right-click menu use the worker.
- The note editor repaints its DOM after every edit, so decorations in the text were not clean; it uses the CSS Custom Highlight API instead (Chrome, Edge, Safari 17.2+, Firefox 140+). Without it the note editor keeps the browser's spellcheck and draws nothing. Ignore all in notes keeps the word under the key "notes".
- The word the caret is ending gets no red squiggle until the caret leaves it (Google Docs does the same).

## Needs

- CLAUDE.md's vocabulary could gain "grammar suggestion (a change the grammar check offers under a blue squiggle; never a bare "suggestion", which is Suggesting mode's)". I did not edit CLAUDE.md.
- TIERS.md could list Grammar suggestions under Unitos Premium.
- The worker is loaded with `new Worker(new URL("./spell.worker.ts", import.meta.url))`. It works under webpack here; the Vercel (Turbopack) build was not run in this worktree (Turbopack refuses the linked node_modules). If the worker cannot start, the page falls back to nspell on the page thread (tested), so the feature still works.
