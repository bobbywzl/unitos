# r4-engine4

**Intent:** Fix Stitch's answers from the round 4 audits (ANS4-01 to ANS4-10, COST4-01): no duplicate links, page sources and quotes, turn records for follow-ups, title words, gists, a rule on what Stitch cannot read, and the history-first layout judged.

**Files:**
- `src/lib/graph/stitch.ts`: `duplicateLink` and the existing-links list before the answer pass (ANS4-01); `linksExisting` and the reply note; `recordText`/`loadRecords` in `stitchHistory` (ANS4-02); `assignSources` and `checkReplyQuotes` on text parts in `materializeGenerated` (ANS4-03/04); `sentenceWindow` in `resolveQuote` (ANS4-05); `nameHits` takes titles (ANS4-06); gists in `Reading`, `selectedSections`, `wholeSection` (ANS4-07); `pageCommand` (ANS4-10); `answerMessages` takes `links` and `historyFirstMin` (COST4-01); `stitch()` takes `historyFirstMin` (checks only) and returns `record`.
- `src/lib/prompts/stitch.ts`: `asksWhere`; the existing-links line; the rules: one paragraph or list per text part, the link count, a question first in a links command, what Stitch cannot read (ANS4-08).
- `src/lib/derive/config.ts`: `STITCH_READ_HISTORY = 6` (ANS4-09); `STITCH_HISTORY_FIRST` became `STITCH_HISTORY_FIRST_MIN = Infinity` (off).
- `src/lib/types.ts`: `StitchResult.linksExisting`, `StitchResult.record`, `StitchRecord`.
- `src/app/api/notebooks/[notebookId]/stitch/route.ts`: the history turn's optional `record`, Zod-validated; a turn with a record and no text is kept.
- `src/lib/i18n/dict/stitch.ts`: `stitchLinksExisting1/N`, en and zh.
- `scripts/qa/stitch-budget-check.ts`: round 4 cases; one round 3 case now asks "Which documents mention Darwin?".
- `SPEC.md` §22.

**Decisions:**
- The "already in the graph" count goes in the reply (server-side sentence in the reply language), not in `ResultLine`: stitch-box.tsx belongs to PR #23. `linksExisting` is on the result for the box if it wants a line later.
- The record is read again by id inside the project (links by `projectLinks`, the page only when attached and generated); the client's titles are used only for a link that is gone.
- `pageCommand` needs two of the page's blocks cited by an earlier answer (one when the page rests on one), not one, so a fresh "Gather …" at turn 5 records itself.
- Title words drop from the rare names: "Schopenhauer" and "Hale" drop too when a title holds them.
- History-first stays off: blind on 4 turns it lost 3 and was terser (round 3 saw the same), and Linda-shaped 10-turn conversations hold ~2.2k tokens of history, under the 3k line.
- `checkReplyQuotes`, `firstsFirst`, `commandKind` are untouched (SAFE4's).
