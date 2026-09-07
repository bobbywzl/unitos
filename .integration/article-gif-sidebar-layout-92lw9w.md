**Intent:** A slow finishing step (the glossary above all) no longer holds a readable article: past 20 s the article opens and the rest loads on behind a spinning pill in the document bar; the import box shows the add's elapsed time.

**Files:**
- `src/components/reader/upload-assistant.tsx`: the add's start time; after the save, when the add has run 20 s (or when the mark passes while the finishing step runs) and the save stage's figure check shows at least 90% of the captions with their figure, the first document opens through `onOpenEarly` and the finishing step runs on. Pending until the first document either opens early or finishes in time, so a later document of a batch never opens in its place. The progress card gets the start time.
- `src/components/reader/document-bar.tsx`: `onOpenEarly` opens the document, hides the box, and remembers it; the running pill reads "Finishing {title}…" with its own tip; the close that ends the add refreshes the open document instead of opening it again.
- `src/components/reader/ingest-progress.tsx`: the elapsed time (m:ss) beside the step count, ticking once a second while the work runs, standing once it is done; `startedAt` for the box's card, the mount for the bar's floating card.
- `src/lib/i18n/dict/panes.ts`, `SPEC.md` §15.

**Decisions:**
- The mark counts from the add's start, not from the save: the reader has been waiting since Add, and a 20 s add whose glossary takes another minute is the case in question.
- "Reads well" is the existing figure check (figures loaded against captions left without one), not a new model judgment: deterministic, already on the save stage, and the box keeps its lost-figure behavior (it comes back to be read) when the check fails.
- The glossary call itself is unchanged: one model call over the whole document is what it costs; the change is that the reader no longer waits on it.
- `next build`, `tsc`, and `eslint` pass.
