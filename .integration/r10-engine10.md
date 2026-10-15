# r10-engine10

**Intent:** Fix the round 10 Stitch engine findings (ENGINE.md): the notes section names other accounts' lines and reads comments, the notes words, the holistic words and the back read's rules, with the holistic gate judged on the 54k shape.

**Files:**
- `src/lib/graph/stitch.ts` — `notesSection(notebookId, query, readerId)`: comments (the Annotations section's notes with no kind and no color) with their replies, `by <name>` on another account's note, reply or comment, 1,000 rows; `overEvery` true for holistic words; `backSelection`: null for a notes follow-up, the why-question budget 10,000 (`BACK_BUDGET_WHY`), a page command skips the expansion's title words, `NUMBER_WORD` dropped before the title check; `stitch()` reads the notes when `asksAboutNotes || ownNotesQuestion` and passes `input.userId`.
- `src/lib/graph/intent.ts` — `holisticWords` (HOLISTIC, THEMES without a topic), `commandIntent` uses it; META drops "the replies" alone.
- `src/lib/prompts/stitch.ts` — `asksAboutNotes` (my replies, my comments, 我的回复, 我的评论; no "the replies", no bare 回复), `refersBack` (a page of it, turn it into a table, 这个回答, 上面的回答, 把刚才的回答), `whyAboutAnswer`, `asksMore` uses it, `NOTES_HEADING`, `NOTES_BY_OTHER`, `notesLines` (the marked sentence), the rules sentence on notes, replies and comments.
- `src/lib/derive/config.ts` — the comment beside `STITCH_HOLISTIC_WHOLE_THRESHOLD` (stays 60,000) with the dollars and the four judged pairs.
- `scripts/qa/stitch-budget-check.ts` — five round 9 checks follow the new sentences; the round 10 cases under `// [engine10]` at the end (452 checks pass).
- `SPEC.md` §22 — who is read when the command is about notes, comments read, the holistic words, the back read's rules, the gate's judgement.

**Decisions:**
- The reader of the notes section is `input.userId`, else the project's owner; another account's line is marked by the person's name, else the email's local part, else "a former collaborator". A member's own lines carry no mark, so a single-account project reads as before.
- Comments are read only when the command is about the notes (the same `asksAboutNotes` gate), capped with the notes at `STITCH_NOTES_BUDGET`; the Annotations section's rule (`derivationType IS NULL AND color IS NULL`) is `lib/graph/coverage.ts`'s.
- "The replies" and bare 回复 no longer count as the reader's: "the replies of Nietzsche's critics" is a text's; "what did I reply" and 我的回复 do.
- `holisticWords` is one rule shared by `commandIntent` and `overEvery`: "the main themes of pessimism" stays a fact question (a topic follows), "the main threads of these documents" is holistic.
- The back read's title check skips the expansion's words for a page command only (their "BOOK TWO" is the last answer's context), and drops cardinal number words ("two editions"); ordinals stay ("First Part" names a document). A why-question reads up to 10,000 tokens; the links listed as already in the project are still not part of the cited set (R10-33 reads the reply's ten blocks, not B33).
- The holistic gate stays at 60,000: on the 54k shape the whole read was more right than select + answer on all four pairs (RESULT.md); the dollars are in config.ts's comment.
- Expected conflicts with RETRIEVAL10: the import lines at the top of `stitch.ts`, the `overEvery` call near `pickBlocks`, the end of `stitch-budget-check.ts` (one appended block each), and the one long line of SPEC.md §22.
