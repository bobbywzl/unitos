# Dissect

Notes-centric web app for deep reading. Documents attach to notebooks; every AI feature is one pipeline: anchor → derivation → destination. See SPEC.md for the data model, phases, and quality bars. See CLAUDE.md for conventions.

## Stack

- Next.js (App Router, TypeScript strict, server components by default)
- PostgreSQL (Supabase) + Prisma
- Anthropic API via Vercel AI SDK, streaming, prompt caching
- Tailwind

## Setup

1. `npm install`
2. Copy `.env.example` to `.env` and fill in:
   - `DATABASE_URL` — Supabase pooled connection (port 6543, `?pgbouncer=true&connection_limit=1`)
   - `DIRECT_URL` — Supabase direct connection (port 5432), used for migrations
   - `ANTHROPIC_API_KEY` — required for derivations (Phase 4+)
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
