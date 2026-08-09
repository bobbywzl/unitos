# Dissect

Notes-centric web app for deep reading. Documents attach to notebooks; every AI feature is one pipeline: anchor → derivation → destination. See SPEC.md for the data model, phases, and quality bars. See CLAUDE.md for conventions.

## Features

- Notebooks with sections (one nesting level, drag-reorder) and markdown notes
- PDF upload and URL ingestion, parsed to blocks (two-column PDFs handled), deduped by file hash
- Split view: reader left, notes drawer right; notes full-page view for reorganizing and export
- Anchoring that survives reload and re-parse: block offsets + quote fallback, orphans render visibly
- Derivations via one pipeline (`/api/derive`): EXPLAIN (annotation rail), SIMPLIFY (inline swap, revert on click), SALIENCE (toggleable overlay), EXTRACT (pending note with sources)
- Pending queue keyboard flow: `j/k` move, `Enter` accept, `Backspace` reject, `e` edit, `g` jump to source
- Reader profile (background, purpose, application) injected into every prompt; per-notebook override
- Assistant panel with scopes: selection, document, notebook, corpus; contradiction, gap, and unsourced checks as clickable cards
- Voyage embeddings + pgvector for corpus search across all notebooks
- Glossary extraction on ingest; hover definitions in the reader
- Export notebook to Markdown or .docx with `documentTitle, blockId` footnotes
- Feedback button + admin inbox (`/admin`) with new → seen → resolved triage

## Stack

- Next.js (App Router, TypeScript strict, server components by default)
- PostgreSQL (Supabase) + Prisma, pgvector
- Anthropic API via the AI SDK, streaming, prompt caching (the parsed document is the cached prefix)
- Voyage AI embeddings
- Tailwind

## Setup

1. `npm install`
2. Copy `.env.example` to `.env` and fill in:
   - `DATABASE_URL` — Supabase pooled connection (port 6543, `?pgbouncer=true&connection_limit=1`)
   - `DIRECT_URL` — Supabase direct connection (port 5432), used for migrations
   - `ANTHROPIC_API_KEY` — required for derivations, the assistant, and glossary
   - `VOYAGE_API_KEY` — required for corpus search embeddings
   - `ADMIN_PASSWORD` — enables `/admin` (unset = admin off)
   - `CRON_SECRET` — enables `/api/cron/cleanup` (deletes rejected notes older than 7 days; vercel.json schedules it daily)
3. In Supabase, enable the `vector` extension: Database → Extensions → vector.
4. `npx prisma migrate deploy`
5. `npm run dev`

## Local dev without Supabase

Any Postgres 16+ with the pgvector extension works. Point both `DATABASE_URL` and `DIRECT_URL` at it:

```
DATABASE_URL="postgresql://postgres@localhost:5432/dissect"
DIRECT_URL="postgresql://postgres@localhost:5432/dissect"
```

Then `npx prisma migrate dev`.
