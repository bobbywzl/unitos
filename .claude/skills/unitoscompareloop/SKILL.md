---
name: unitoscompareloop
description: Parse-QA loop. Subagents imitate a reader — ingest diverse real web content (research papers, news, blogs, docs, PDFs) into a local Unitos, compare the parsed blocks against the original formatting, and report mismatches. The main session is the fixer - it patches the parse pipeline, re-verifies, and iterates until a round comes back clean.
---

# unitoscompareloop

One loop iteration:

1. **Stand up the app.** Local Postgres (`pg_ctlcluster 16 main start`, db `dissect`), migrations applied, `npm run build`, then
   `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/dissect DIRECT_URL=$DATABASE_URL ANTHROPIC_API_KEY=sk-ant-dummy PORT=3111 npm run start`.
   The dummy key skips the AI select/structure passes, so the loop tests the mechanical parser — the layer fixes land in.
2. **Create one corpus** for the run: `POST /api/notebooks {"title":"ParseQA"}` → notebookId.
3. **Fan out collector subagents**, one per content category: research papers, news, blogs/essays, docs and misc formats (Wikipedia, transcripts, PDFs). Each agent:
   - finds 3-5 real, reachable URLs in its category (web search; verify reachability with the parser's own UA `Mozilla/5.0 (compatible; Unitos/1.0)` first),
   - ingests each: `POST /api/documents {"url":"…","notebookId":"…"}` — the response streams NDJSON; the last line is `{id,…}` or `{error}`. PDFs upload as multipart: `curl -F file=@x.pdf -F notebookId=…`.
   - reads the parsed blocks: `SELECT "order", type, length(text), left(text,120) FROM "Block" WHERE "documentId"='…' ORDER BY "order";`
   - fetches the original with the parser's UA and compares structure: paragraph and heading counts, lists, tables, code blocks, walls of text (one block spanning many original paragraphs), missing head/middle/tail content, duplicated or reordered content, chrome ingested as content (egregious only — the AI passes that trim edges are offline here).
   - reports per URL, strictly: `verdict OK | MISMATCH | INGEST_FAIL | UA_BLOCKED`, block census, one-line symptom, evidence (original vs unitos), suspected cause with a source-HTML snippet.
   - Collectors never edit the repo, never commit, never restart the server.
4. **Fix centrally.** The main session aggregates the reports, fixes the general markup pattern in `src/lib/parse/` (never a site-specific hack), bumps `PARSER_VERSION` once per shipped batch, and re-ingests the failing URLs to confirm (delete the Document row first, or the dedupe returns the old parse).
5. **Iterate.** Re-run the failing URLs plus a fresh batch. Stop when a round reports no new mismatch class. Lint, build, ship.

Known torture tests: wallstreetcn articles (SSR only for non-browser UAs; transcript inside `<blockquote>` of `<p>`s), paulgraham.com essays (`<br><br>` paragraphs), Wikipedia (tables, references), arxiv HTML papers (math, figures).
