---
description: Import compare loop — ingest real web pages and PDFs into a local Unitos, screenshot the original and the import in headless Chromium, compare every complex element (tables, math, figures, gifs, videos, embeds, code, lists) with your own vision, fix the general parse pattern, re-verify, repeat until a round is clean.
---
You are the fixer in the import compare loop. The goal: an import in Unitos looks like the original — the same tables, equations, figures, gifs, videos, embeds, code, lists, headings, in the same order, nothing missing, no page chrome — for every future article and PDF, never for one site. Sources for this round: $ARGUMENTS (URLs, PDF paths, or one category word: papers, news, blogs, docs, pdfs, all; empty = all).

Read `scripts/qa/import-compare.mjs` before the first run. It is the capture tool: it ingests each source through the app's own API, screenshots the original page (full page, then one crop per complex element) and the Unitos reader (full page, then one crop per TABLE, EQUATION, FIGURE, CODE, LIST block), counts both sides, pairs them, and writes `report.md` + `manifest.json` per source under `.qa/import-compare/<run>/`. It never judges and never edits code. You judge; you fix.

## 1. Stand up the app

1. Postgres 16 with pgvector on 127.0.0.1:5432, database `dissect` (`pg_ctlcluster 16 main start`; on a laptop `docker compose up -d`).
2. `.env` with `DATABASE_URL` and `DIRECT_URL` pointing at it (`.env.local.example` has the values). Then `npm ci`, `npx prisma migrate deploy`, `npm run build`, `PORT=3111 npm run start` in the background.
3. Leave `ANTHROPIC_API_KEY` unset. Without a key the URL ingest skips the core and structure passes and the PDF judgment falls back to the text-layer yield, so the loop tests the mechanical parser — the layer fixes land in. Set the key only for a round about page chrome, which those passes remove.
4. Create the round's project once: `curl -s -X POST http://127.0.0.1:3111/api/notebooks -H 'Content-Type: application/json' -d '{"title":"ImportCompare"}'` → `id` is the notebookId every capture uses.

## 2. Pick sources

- URLs and PDF paths in the arguments are the round. A category word means: find 3–5 real, reachable pages of that kind (web search; verify with `curl -sS -o /dev/null -w "%{http_code}" -A "Mozilla/5.0 (compatible; Unitos/1.0)" <url>` first, since the parser fetches with that UA and no scripts). `all` = one collector per category.
- Prefer pages with complex elements: research papers (arxiv HTML, journals: equations, figures, tables), news (Datawrapper and Flourish charts in iframes, galleries, videos), blogs and essays (Medium, Substack, personal sites: gifs, YouTube embeds, code, nested lists), docs (Wikipedia tables and math, MDN and developer docs with code), PDFs (arxiv papers, two-column papers, slide decks, scanned notes).
- Known torture tests: wallstreetcn articles (SSR only for non-browser UAs; transcript inside `<blockquote>` of `<p>`s), paulgraham.com essays (`<br><br>` paragraphs), Wikipedia (tables, references, MediaWiki math), arxiv HTML papers (LaTeXML math, figures, `ltx_equation` tables).

## 3. Capture

```
node scripts/qa/import-compare.mjs --notebook <id> --app http://127.0.0.1:3111 [--fresh] <url | file.pdf> ...
```

- `--fresh` deletes the stored document for the source first. Always pass it when re-checking after a fix — dedupe by sourceUrl or fileHash returns the old parse otherwise.
- Behind a proxy (`HTTPS_PROXY` set) the script probes the proxy and relaunches Chromium with `--ssl-version-max=tls1.2` when the proxy resets Chromium's TLS 1.3 hello. It never disables certificate verification.
- The run's `index.md` lists every `report.md`. A source marked INGEST_FAIL or ORIGINAL_BLOCKED (bot wall, 403, sign-in) gets that verdict and no further judgment.
- A broken image in the Unitos capture carries its reason. `ERR_BLOCKED_BY_ORB`, a certificate or proxy error is this browser or sandbox, not the app; an HTTP 4xx/5xx or a URL that never existed is the parser's (wrong src, lazy-load attribute missed).

## 4. Compare with your own vision

The AI computer vision is you: the Read tool renders PNGs, and you compare them. No library, no extra API key. Subagents have the same Read tool, so collectors compare too. Pixel diffing is useless here — fonts, widths, and theme differ on purpose — so the comparison is structural first, then semantic per element:

1. Read `report.md`. The census is the first pass: a count that differs (3 tables on the page, 1 TABLE block) is a finding before any picture is opened.
2. Read the two full-page PNGs: overall shape, missing head or tail, page chrome kept, reading order, duplicated content, a wall of text where the original had paragraphs.
3. Read every pair's two PNGs and judge what a reader would notice:
   - table: every row and column present, header row, merged cells (rowspan/colspan) in the right column, numbers aligned, caption
   - math (display): the same formula rendered, no doubled formula, no glyph soup, no raw MathML text; inline math: the text reads with the right symbols
   - figure: the image itself (not a placeholder or a broken image), the caption, the right one (not the hero repeated), an SVG chart rendered with its labels
   - gif: an animated gif still animates (an `<img>` with a .gif src), or a muted looping video where the original used one
   - video and embed: the player is there (YouTube and Vimeo iframes are kept; other iframes are dropped by `lib/parse/sanitize.ts` — a Datawrapper, Flourish, CodePen, Twitter, or Maps embed lost is a finding to report as a design decision, not to hack around)
   - code: indentation and line breaks kept, one block per original block, the language label not left as a stray paragraph
   - list: every item, nesting depth, numbering start, no literal doubled markers
   - heading levels, separators, blockquotes as paragraphs in order
   - layout, relative not pixel (the report's Layout section): the column's width and margins, body text size and line height against the heading sizes, paragraph spacing, each figure's and table's width as a share of the column (a small side figure that became full-width, a wide table squeezed or overflowing, a tiny thumbnail blown up), the table of contents — present in the original, missing or scattered in Unitos. Unitos has one reading column by design; judge whether the proportions a reader relies on survived, not whether the pixels match.
4. The two-sided rule: an element marked `NOT in raw html` never reached the parser (the browser built it with scripts). Report it as client-rendered — the fix is an ingest strategy decision for the user, not a parse fix. Everything else the original shows and Unitos does not is the parser's.
5. A PDF has no pairs: read each original page PNG, then the Unitos blocks from that page. Judge missing or reordered text, columns merged, tables and equations that became prose, a figure shown as the whole page, captions, headers and footers kept as text.

Report per source, strictly this shape:

```
source: <url | path>
verdict: OK | MISMATCH | INGEST_FAIL | ORIGINAL_BLOCKED
census: original {tables 3, math-display 12, figures 4, gifs 1, embeds 1, code 2, lists 5} · unitos {TABLE 3, EQUATION 10, FIGURE 4, CODE 2, LIST 5}
layout: what differs in proportion — figure widths 35% → 100% of the column, toc lost, h2 same size as body — or "kept"
findings:
- kind: table | math | figure | gif | video | embed | svg | code | list | heading | paragraph | order | chrome | layout
  where: original #k (png path) ↔ unitos block order n (png path) | unpaired
  symptom: one line
  evidence: what the original shows vs what unitos shows
  in raw html: yes | no
  cause: the markup pattern, with a ≤10-line snippet from original.raw.html
  general: the rule that fixes every page with this pattern
```

## 5. Fix centrally

- Group findings by cause, not by site. Fix the general markup pattern in `src/lib/parse/` — `url.ts` (the walk, math, media, junk pruning, post-clean), `sanitize.ts` (what html survives to the reader), `pdf.ts` (geometry, tables, figures) — never a hostname check, never a site-specific selector. A rendering fix belongs in `src/components/reader/block-view.tsx` or `src/app/globals.css` when the stored block is right and the reader shows it wrong.
- Never author content (SPEC.md §2): text is the page's text, media URLs are the page's URLs, TeX is the page's TeX. Never reconstruct what the page does not carry.
- Keep the anchoring invariant (SPEC.md §5): a text block's DOM text equals its stored text; table html carries the invisible cell separators; a figure's caption is its only DOM text.
- The derivation pipeline stays one code path (CLAUDE.md). Parse changes are parse changes; no per-feature forks.
- Bump `PARSER_VERSION` in `src/lib/parse/types.ts` once per shipped batch, with one line saying what changed. Stale documents re-parse on open.
- Then `npm run lint`, `npm run build`, restart the server on the new build, and re-run the capture with `--fresh` for every failing source. Confirm by reading the new crops, not by reading the code.

## 6. Iterate and ship

- Re-run the failing sources plus a fresh batch. Stop when a round reports no new mismatch class; leave client-rendered and design-decision findings in the final report for the user.
- Commit on the working branch with one message per fixed pattern. Push to `main` only after the user accepts (CLAUDE.md deploy rule).

## Collectors (subagents)

Fan out one general-purpose subagent per category with this file's sections 2–4 and the notebookId. A collector picks sources, runs the capture, reads the PNGs, and returns the report in the exact shape above. Collectors never edit the repo, never commit, never restart the server. Run at most 4 at once — each launches its own Chromium.
