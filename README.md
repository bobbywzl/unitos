# Dissect

Notes-centric web app for deep reading. Documents attach to notebooks; every AI feature is one pipeline: anchor → derivation → destination. See SPEC.md for the data model, phases, and quality bars. See CLAUDE.md for conventions.

## Features

- Notebooks with sections (one nesting level, drag-reorder) and markdown notes
- PDF upload and URL ingestion, parsed to blocks (two-column PDFs handled), deduped by file hash
- Video documents: upload an mp4 (up to 200 MB, custom player with Range streaming) or add a YouTube link (plays through the IFrame player behind the same controls); circle a spot and comment on it — annotations carry a time range and replay on an overlay whenever playback crosses it, with a marker per annotation on the scrubber and a Visual strip of frame cards underneath
- Video transcription starts on its own when the video is added. Provider ladder — YouTube: YouTube captions through the player API and the watch page, then the same captions read by a browser when one is configured (`BROWSER_WS_ENDPOINT` or `CHROMIUM_PATH`), then Gemini (`GEMINI_API_KEY`), then the audio stream through the upload ladder; when every rung fails, the transcript pane offers Paste transcript, which reads what YouTube's transcript panel copies; uploads: Groq Whisper (`GROQ_API_KEY`), then OpenAI Whisper (`OPENAI_API_KEY`), then Gemini. A long video splits into windows that transcribe in parallel and stitch back together. The transcript gives read-along highlight and click-to-seek; Find searches it and answers with seekable time ranges; Explain reads the actual frame cropped to the circle plus the transcript (a YouTube frame comes from the storyboard sheets, with Gemini watching the same clip at full resolution as corroboration) and saves the explanation as an annotation at that moment; transcript lines carry the same Comment and Explain tools
- Split view: reader left, notes drawer right; notes full-page view for reorganizing and export. Every note and annotation shows its id, sits collapsed to one summarizing line until Expand all shows every card whole, and jumps back to its exact position in the article; notes keep their shape between the editor and display; the full page compares chosen notes in one screen, side by side or stacked
- Anchoring that survives reload and re-parse: block offsets + quote fallback, orphans render visibly
- Derivations via one pipeline (`/api/derive`): EXPLAIN (annotation rail), SIMPLIFY (inline swap, revert on click), SALIENCE (toggleable overlay), EXTRACT (pending note with sources)
- Pending queue keyboard flow: `j/k` move, `Enter` accept, `Backspace` reject, `e` edit, `g` jump to source
- Context (background, purpose, application) injected into every prompt; edited from the Context tab in the header, saved globally or as a per-notebook override
- Assistant panel with two scopes — Project (this project whole) and Projects (every project whole) — plus contradiction, gap, and unsourced checks as clickable cards
- The digest: the assistant's stored context, one row per project per user — every document in full, every note, annotation, distillation, extraction, and summary; stale rows rebuild on read via a content fingerprint
- Glossary extraction on ingest; hover definitions in the reader
- Export notebook to Markdown or .docx with `documentTitle, blockId` footnotes
- Google, Apple, and email sign-in at `/signin` (dual mode: with `SESSION_SECRET` plus any provider's credentials the app is gated; without, it runs as a single local reader). Email sign-in takes a name and an email, creates the account only when the confirmation link is clicked, and lands on `/welcome` to set a password; returning users sign in with email + password, and Forgot password emails a reset link. Projects, context, and digests belong to the signed-in account; the first account to sign in adopts the local reader's data
- English and Chinese, whole-surface: the switcher (Settings, `/signin`) changes every UI string and API error message at once
- Feedback button + admin inbox (`/admin`) with new → seen → resolved triage and Reply, which reaches the account that sent the feedback as a notification on its dashboard; admin digest page (`/admin/digest`) showing the store per account — every project → document → annotations, notes, distillations — with forced rebuilds and the exact text each scope sends; admin accounts page (`/admin/accounts`) listing every account with Reset account, which deletes the account's data and puts it back at onboarding like a new account. The admin gate (`ADMIN_PASSWORD`) is separate from reader sign-in
- AI usage telemetry: every model call records tokens and cost (list prices at call time); the admin usage page (`/admin/usage`) shows totals, daily cost, and cost per function, model, and account
- Admin notifications (`/admin/notifications`): the admin sends a notification — an update to Unitos, or a change made to an account — to every account or to chosen ones; it shows on each recipient's dashboard until dismissed. The admin picks recipients from names and emails and cannot open or change an account
- Click telemetry: every click on a reader control records its surface (top bar, sidebar, AI toolbar, article menu, reader, notes tray) and control; the admin clicks page (`/admin/clicks`) shows clicks per day by surface, per surface, per control, and per account
- Settings (`/settings`): account + sign out, language, light/dark/system theme, context, service status

## Stack

- Next.js (App Router, TypeScript strict, server components by default)
- PostgreSQL (Supabase) + Prisma
- Anthropic API via the AI SDK, streaming, prompt caching (the parsed document — and the digest at assistant scopes — is the cached prefix)
- Tailwind

## Run it locally

Needs Node 20+ and Docker.

```sh
git clone https://github.com/bobbywzl/unitos && cd unitos
npm install
docker compose up -d          # Postgres 16 + pgvector on :5432
cp .env.local.example .env
npx prisma migrate deploy
npm run dev                   # → http://localhost:3000
```

Reading, notes, anchoring, and export work with no API keys. Add `ANTHROPIC_API_KEY` to `.env` for the AI features, and `GROQ_API_KEY`, `OPENAI_API_KEY`, or `GEMINI_API_KEY` for video transcription (YouTube captions need no key).

## Deploy (Vercel)

1. Import this repo on vercel.com.
2. Storage → Create Database → **Neon** (Postgres) → connect it to the project. Vercel adds the database env vars; the build maps them and runs migrations (the first migration creates the `vector` extension).
3. Settings → Environment Variables: `ANTHROPIC_API_KEY` (AI features), `GROQ_API_KEY`, `OPENAI_API_KEY`, or `GEMINI_API_KEY` (video transcription), `BROWSER_WS_ENDPOINT` (a browser service's CDP websocket, for YouTube transcripts when the server's own requests are bot-checked), `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` + `SESSION_SECRET` (Google sign-in; redirect URI `<origin>/api/auth/callback`), `APPLE_CLIENT_ID` + `APPLE_TEAM_ID` + `APPLE_KEY_ID` + `APPLE_PRIVATE_KEY` (Apple sign-in; return URL `<origin>/api/auth/apple/callback` on the Services ID), `RESEND_API_KEY` + `EMAIL_FROM` (email sign-in; sender on a domain verified in Resend), `ADMIN_PASSWORD` (`/admin`), `CRON_SECRET` (cleanup cron). All optional to boot; add and redeploy any time.
4. Deployments → Redeploy the latest.

Vercel caps request bodies at about 4.5 MB, so PDF uploads above that fail there. Self-hosted deployments take PDFs up to 50 MB.

Supabase instead of Neon works too: enable the `vector` extension, then set `DATABASE_URL` (pooled, port 6543, `?pgbouncer=true&connection_limit=1`) and `DIRECT_URL` (port 5432) in Environment Variables.

## Setup

1. `npm install`
2. Copy `.env.example` to `.env` and fill in:
   - `DATABASE_URL` — Supabase pooled connection (port 6543, `?pgbouncer=true&connection_limit=1`)
   - `DIRECT_URL` — Supabase direct connection (port 5432), used for migrations
   - `ANTHROPIC_API_KEY` — required for derivations, the assistant, and glossary
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET` — Google sign-in at `/signin`; unset = single local reader, nothing gated. Redirect URI: `<origin>/api/auth/callback`
   - `APPLE_CLIENT_ID` (Services ID), `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY` (.p8 contents) — Sign in with Apple; return URL: `<origin>/api/auth/apple/callback`
   - `RESEND_API_KEY`, `EMAIL_FROM` — email sign-in with a confirmation link; the account is created only when the link is clicked
   - `GROQ_API_KEY` — video transcription for uploads and YouTube audio (Groq Whisper first)
   - `OPENAI_API_KEY` — video transcription for uploads and YouTube audio (OpenAI Whisper second)
   - `GEMINI_API_KEY` — video transcription for YouTube videos without readable captions, and the upload fallback
   - `BROWSER_WS_ENDPOINT` or `CHROMIUM_PATH` — a browser that reads YouTube's transcript panel when the server's own requests are bot-checked: a browser service's CDP websocket on Vercel, a Chromium binary on a self-hosted server (`CHROMIUM_ARGS` adds flags)
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
