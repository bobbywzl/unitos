---
name: parseloop
description: The parse loop (SPEC.md §31, the parse benchmark). One round: run the web benchmark and the PDF benchmark against their baselines, read the weakest documents, fix the general pattern in the parser, run again, keep the change when the score rises and no document drops. Run it with /parseloop; the main session is the fixer. A routine runs rounds on its own branch and opens a draft pull request per round.
---

# parseloop

What the loop improves: the parse of a web page (`src/lib/parse/url.ts`, `figures.ts`), a PDF (`src/lib/parse/pdf/`), and a Word file (`docx.ts`), each read by a deterministic pass. The model passes the parse already has (the vision check of a URL import, `lib/parse/vision-check.ts`) stay as they are; the loop's AI is the session itself, reading the weakest documents and judging what the page shows against what the parse kept.

Rule zero (CLAUDE.md) holds in every round: the parse runs only when a reader adds a document or asks for a re-parse. Never bump `PARSER_VERSION` in a loop round (it offers every stored document a re-parse); never touch stored documents, blocks, anchors, or notes. Every commit says what user data it touches: none.

The sets:

- **Web** (`scripts/parse-bench/web.mts`): 181 news and blog pages with each article's body marked (Zyte's article extraction benchmark). Word 4-gram F1, precision, recall. `--others` prints Readability, Trafilatura, and 30 other extractors scored the same way, for standing.
- **Web, held out** (`scripts/parse-bench/web-snippets.mts`): 990 pages in many languages, each marked with passages the parse must keep and passages it must drop (Trafilatura's evaluation set). Never tune a rule on this set; run it after a rule passes on the first set, to see the rule hold on pages it was not made from.
- **PDF and Word** (`scripts/parse-bench/run.mts`, SPEC.md §31): synthetic documents with exact references, arXiv papers, public PDFs, and sweeps of whole documents (math-heavy books among them: `mml-book-ch2`, `thinkdsp-ch6`).

The pages and PDFs are other people's documents: they live in `.bench/` (gitignored), and only numbers are committed (`web-baseline.json`, `web-snippets-baseline.json`, `baseline.json`).

Setup, once per container:

1. `npm ci`, and `python3 -m pip install pymupdf` for `look.py`.
2. `npx tsx scripts/parse-bench/fetch.mts` downloads the corpus PDFs the network reaches (a host it refuses is listed and skipped). The web sets clone themselves from GitHub on their first run.
3. `npx tsx scripts/parse-bench/synthetic/gen.mts --only <ids>` builds the synthetic PDFs. The HTML renderings need only Chromium; the TeX ones need `pdflatex`, the Word ones a LibreOffice that converts. Restore `scripts/parse-bench/refs/` afterwards (`git checkout scripts/parse-bench/refs/`): a reference regenerated on another machine's fonts is not the committed one.

One round:

1. **Baseline.** `npx tsx scripts/parse-bench/web.mts --baseline --worst 25` and `npx tsx scripts/parse-bench/run.mts --baseline` (with `--only` naming the documents on disk). Both exit 1 when a document dropped against the committed baseline; a drop before any change is the environment (fonts, a tool), so note it and compare against a run made here.
2. **Read the weakest documents whole.** For the web: `web.mts --detail <id>` lists the blocks the article does not have and the article's paragraphs the parse lost; `web.mts --extras` lists the foreign blocks by how many pages hold them; `web-blocks.mts <id>` prints every block. For a PDF: `run.mts --detail <id>` and `pair.mts` (the page beside its import). Look at the page itself (its HTML, or the PDF page drawn with `pdftoppm`) before deciding what is wrong.
3. **Fix the pattern, not the page.** A rule names the class of fault ("a candidate with under half the page's prose is not the article's root"), never a site or a file. Add the finding to the rule's comment ("web benchmark finding: …"), as the import compare loop does.
4. **Run again.** Keep the change when the set's F1 rises and no document drops by more than 0.01 without a stated reason (a marked body that counts a rail as the article is a reason). Then run the held-out set: a rule that helps the first set and hurts the held-out one is fitted to the first set; narrow it or drop it.
5. **Commit one rule per commit**, the scores before and after in the message, and the line on user data. Save the baseline (`--save-baseline`) in the same commit.
6. **Iterate** until a rule no longer moves the score. Then `npx eslint` on the changed files and `npx tsc --noEmit`, push the round's branch, and open a draft pull request with the scores. Never merge: the owner reviews and merges.

Where the sets stand is in the latest draft pull request of the loop and in the baselines' `total`.
