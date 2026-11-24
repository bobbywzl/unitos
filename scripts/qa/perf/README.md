# The perf loop

One round: measure, fix the largest cost, measure again, keep the change
when it improves and nothing regresses. The tools here measure a production
build on port 3400 against a local Postgres behind a delay proxy, so every
database round trip costs what it costs in production (about 10ms).

Setup, once per session:

```bash
docker compose up -d db            # or a local Postgres on :5432 with the vector extension
npx prisma migrate deploy && node scripts/qa/seed.mjs
node scripts/qa/perf/delay-proxy.mjs 5433 5432 5 &      # +5ms each way
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/dissect npm run build
scripts/qa/perf/serve.sh                                # the build on :3400 through the proxy
```

Pick the seeded project and document for the browser flow:

```bash
export NB=<notebookId> DOC=<documentId>     # from scripts/qa/seed.mjs's output
```

One round:

```bash
scripts/qa/perf/round.sh      # server timings, queries per render, the browser flow
```

The pieces, each on its own:

- `bench.sh`: the server time of each page (median of seven requests).
- `qcount.sh`: SQL statements per page render, read from the Postgres log
  (`log_min_duration_statement = 0`, `PGLOG` names the log file).
- `perf.mjs`: the browser flow in headless Chromium: dashboard, New project,
  a project card, the reader, a note accepted, the notes full page. The
  navigation timings come from inside the page (when the frame, the
  sidebar, and the first block enter the DOM), not from the driver's polling.
- `waterfall.mjs <path>`: every resource a page loads, with sizes.
- `nav-inpage.mjs`: a project card's press timed inside the page, three runs.
- `derive-time.sh`: an AI tool's time to first byte and queries before the
  model answers, against `scripts/qa/mock-kimi.mjs` (start it on :3399 and
  serve with `MOONSHOT_API_KEY=mock MOONSHOT_BASE_URL=http://localhost:3399/v1`).
- `zh-check.mjs`: a page in Chinese renders Chinese from the first paint, with
  no error, and a page in English never downloads the Chinese chunk.

What the rounds of November 2026 found and fixed is in the commit history
(`git log --grep="side by side"`, `--grep="Dictionary"`, and so on).
