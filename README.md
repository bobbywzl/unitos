# Unitos

Notes-centric web app for deep reading. Documents attach to projects; every AI feature is one pipeline: anchor → derivation → destination. SPEC.md (headed "Dissect", the working name) is the source of truth for the data model, phases, and quality bars. CLAUDE.md holds the conventions. TIERS.md records every tier decision.

## Priorities

Features are listed below in priority order. The order is the build order in SPEC.md §8 and the product principles in SPEC.md §1. A lower priority never changes a higher one: a new feature is a new prompt template and a destination handler on the same pipeline, never a fork of it.

| Priority | What | Why it comes first |
|---|---|---|
| 1 | The core loop: notes, anchoring, pending → accepted, provenance | Everything else writes into it. If an anchor breaks or AI output lands unasked, nothing else matters |
| 2 | Reading tools on a selection | The reason to open a document here instead of anywhere else |
| 3 | Getting documents in: PDF, URL, images, video, multi upload | Each new source is one more input to the same pipeline, never a new parser |
| 4 | Working together: share, graph, history | Built on top of a working single-reader loop |
| 5 | Account, tiers, billing, offline | Gates around features that already work |
| 6 | Operations: admin, telemetry, the two loops | Keep the product honest once it has readers |

Non-goals for v1 (SPEC.md §9): mobile layout (desktop only, 1024px and up), scanned-PDF OCR, browser extension, spaced repetition and quizzes, claim→evidence and omission-audit tools.

Quality bars that hold across every priority (SPEC.md §10): accept or reject a pending note in one keystroke under 100ms; first streamed token under 2s; anchors resolve 100% on unchanged documents and above 95% after a re-parse, the rest orphaned visibly; no AI output enters accepted notes without the reader's action; every accepted derived note has at least one source.

## Features

### Priority 1 — The core loop

- **Projects, sections, notes.** One nesting level, drag-reorder by hold, markdown notes with a title line and a body. Every note shows its id, sits collapsed to one line (its title, or an AI-written gist) until Expand all, and jumps back to its exact position in the article. Notes merge by dragging one onto another: Join text keeps the text as it is, Merge with AI writes the one note that takes their place. A merge can be undone. Undo and redo on both editing surfaces
- **Anchoring that survives reload and re-parse.** Block offsets plus a quote fallback; orphans render visibly. DOM ranges are never persisted (SPEC.md §5)
- **Pending → accepted.** All AI output that writes into notes lands as pending. Keyboard flow: `j/k` move, `Enter` accept, `Backspace` reject, `e` edit, `g` jump to source. Nothing enters notes silently
- **Provenance.** Every note line clicks back to its source anchor. Export to Markdown or .docx with `documentTitle, blockId` footnotes
- **Context.** One Background field, injected into every prompt, saved globally or as a per-project override
- **One pipeline.** Every derivation goes through `/api/derive` with a prompt template from `src/lib/prompts/` and a destination handler. Prompt caching keeps the parsed document as the cached prefix
- **Split view.** Reader left, notes drawer right. The notes full page adds section reorder, renaming, compare (side by side or stacked), a board of tiles per section, and export
- **The assistant and the digest.** Two scopes, Project and Projects, plus contradiction, gap, and unsourced checks as clickable cards. The digest is the assistant's stored context, one row per project per user, every document, note, annotation, distillation, extraction, and summary; stale rows rebuild on read via a content fingerprint. Fast Thinking or Deep Thinking on every assistant surface. Highlight words of an answer to quote it in a reply, start a side chat, or comment on it. Assistant history lists every conversation of the project. With Web on (the default), Ask verifies its answer against outside sources and cites every page it used; the project stays the first source
- **Asking about a selection.** The selection chat gathers the passages across the document that match the selection (the matches) and answers from them; there is no separate Explain or Match-it tool. A tool's card (Simplify, Analyze, Visualize) continues into a conversation with Continue (Unitos Ultra); hovering its mark shows the condensed log

### Priority 2 — Reading tools

One toolbar per content kind: select text for the Assistant, Simplify, Visualize, Comment, Link, highlight, Add to notes, and Read aloud; select in a table or circle it for Table tools; circle a figure for Figure tools; circle an equation for Equation tools. Each kind offers its own tools and nothing else.

- **Simplify.** Inline swap, revert on click
- **Salience.** Toggleable overlay of what matters in the passage
- **Distill** (code `KEYPOINTS`). The whole article as bullet points, each anchored to its passage, on the distilled page
- **Extract** (code `DISTILL`). One question → the quotes that answer it, on the extract page. A second scope asks the whole project one question
- **Compare.** Two documents → one pending note of agreements, disagreements, and what only one covers, sourced on both
- **Analyze.** A figure or table read by the vision model: Insights, Quantitative with printed values verbatim and estimates marked ≈, and Linking to context. Leads the figure and table toolbars, never appears on text
- **Summarize.** A document-level summary, one per depth
- **Visualize** (Unitos Ultra). The selection as a directed diagram, a drawing, or a short animation, drawn only when the model is certain the picture carries the passage's core idea, declined with the reason otherwise. Saved as an annotation on the selection
- **Glossary.** Built on first open of the glossary, one call over the whole document; hover definitions in the reader, in the reader's language
- **Translation** (`DEEPL_API_KEY`). When a document's language is not the reader's, a bar offers Translate; each paragraph and transcript line reads under its original, anchors and tools stay on the original text, cached per block per language
- **Every tool's output carries a rating** (👍 / 👎). The thumbs down feed the tool quality loop (priority 6)

### Priority 3 — Getting documents in

- **PDF and URL.** Parsed to blocks (two-column PDFs handled), deduped by file hash. PDFs up to 50 MB self-hosted; Vercel caps a request body at about 4.5 MB, so the client splits bigger files into chunks. URL import keeps the page's layout: headings, figures with their words and captions, contents lists, bold and italic runs, the page's font. The add dialog queues links and files of every kind together, and the upload assistant imports each faithfully, whole and as it is
- **Multi upload and Stitch.** Two or more documents added together onto one page: two read side by side, three or more as a graph (default) or a list. Stitch takes any command across the members: gather every passage on a topic into a new page, connect the passages that answer a question, find where the documents contradict each other, write one page that combines them. Links land as recommended links awaiting Accept; a written page is a generated document of the project, every paragraph linked back to its source
- **Images and handwritten pages.** An image (png, jpg, gif, webp, bmp) dropped on the page lands as a one-page handwritten document: the page as it is, Circle & ask (code `EXPLAIN`), and conversion to text. A PDF with no usable text layer is judged handwritten from sample pages and kept as pages. Images drop into a note or a paragraph as a figure; past the Premium trial the cap is 5 MB
- **Video and audio.** Upload an mp4 (up to 200 MB, Range streaming) or add a YouTube link. Circle a spot and comment on it; annotations carry a time range and replay on an overlay, with a marker per annotation on the scrubber. Transcription starts on its own: YouTube captions first, then a browser reading the transcript panel (`BROWSER_WS_ENDPOINT` or `CHROMIUM_PATH`), then Gemini, then the audio through the upload ladder (Groq Whisper, OpenAI Whisper, Gemini); when every rung fails, Paste transcript. Long videos transcribe in parallel windows. The transcript gives read-along highlight and click-to-seek; Find answers with seekable time ranges; Ask answers a question about a time range from its transcript; Formalize rewrites the transcript as an article or bullet notes; Explain reads the actual frame cropped to the circle
- **Voice notes.** Speak beside "+ note" on every section records up to five minutes, transcribes it, cleans it, and lands it as a pending note
- **Google Drive.** Add from Google Drive beside the drop zone: Docs, Sheets, and Slides export to PDF, a PDF or video downloads, then each ingests exactly like a local upload. `GOOGLE_DRIVE_ACCESS` picks the scope (SPEC.md §14)

### Priority 4 — Working together

- **Share.** The owner adds collaborators by email with a role (owner, editor, viewer); an invite works before the account exists. Everything in the project is the shared surface. Each person shows as a badge: name, symbol, color, picture
- **Graph and recommended links.** The project's documents drawn as nodes and curves, thicker with more links. Recommend links runs the project-wide scan (a few runs a calendar month; it never starts on its own); every recommended link waits for Accept and paints nowhere until then
- **Replies and history.** A reply thread under every note, edit, and link, with resolve. History records every edit and deletion of the project
- **Notifications.** The admin sends a notification, an update to Unitos or a change to an account, to every account or chosen ones; it shows on the dashboard until dismissed. The admin's reply to feedback arrives the same way
- **Companions.** Under Projects on the dashboard, web apps for the steps around a document Unitos does not do, before the reading and after it

### Priority 5 — Account, tiers, billing, offline

- **Sign-in** at `/signin`: Google, Apple, and email with a confirmation link and a password set on `/welcome`. With `SESSION_SECRET` plus any provider's credentials the app is gated; without, it runs as a single local reader. The first account to sign in adopts the local reader's data
- **Tiers** (TIERS.md). Every account is Unitos Premium or Unitos Ultra; a new account gets two months of Unitos Premium free. The operator sets the tier on the admin accounts page. The tier mark beside a person's badge says the tier
- **Billing** (SPEC.md §24). Both tiers sold through Stripe as subscriptions, monthly or yearly, on `/billing`: plan page, order page, Stripe Checkout, confirmation, receipts. Built and switched off: the admin billing page turns it on once sign-in and the Stripe variables are set; off, the pages answer 404 and the app shows no link to them
- **Offline** (Unitos Premium). The open tab keeps working; non-AI writes queue in IndexedDB and sync in order when the browser is back online. AI features need the server
- **English and Chinese**, whole-surface: the switcher changes every UI string and API error message at once
- **Settings** (`/settings`): account and sign out, language, light/dark/system theme, context, plan, service status

### Priority 6 — Operations

- **Admin** (`/admin`, `ADMIN_PASSWORD`, separate from reader sign-in; opens no account and changes nothing on one except the tier and block list): feedback inbox with new → seen → resolved triage and Reply; digest page showing the store per account with forced rebuilds; accounts page with Tier, Block and Unblock by email, and Reset account; usage page with tokens and cost per function, model, and account; clicks page with every reader control's clicks per day, surface, control, and account; notifications; billing switch
- **Feedback pipeline** (`.claude/skills/feedback-pipeline`): a daily Routine reads the inbox, opens one pull request per change that fits the spec, and after a merge resolves the feedback and replies to its senders
- **Tool quality loop** (SPEC.md §25, `npm run eval`): every AI tool's template runs on a fixed set of documents and reader contexts, is judged against the tool's rubric, and the weakest template is the one changed. Readers' thumbs down become new cases
- **Model update**: on the 1st of every second month a cron reads each provider's model list and moves each model to the newest version of its family after one probe call (`/api/cron/models`)

## Stack

- Next.js (App Router, TypeScript strict, server components by default)
- PostgreSQL (Supabase or Neon) + Prisma, pgvector
- Kimi K3 (Moonshot AI) via the AI SDK, streaming, automatic prompt caching (the parsed document, and the digest at assistant scopes, is the cached prefix); Claude Fable 5.1 (Anthropic) at its highest reasoning effort for the import (upload review, the URL core and structure passes, Import PDF's judgment, conversion) and for Visualize
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

Reading, notes, anchoring, and export work with no API keys. Add `MOONSHOT_API_KEY` to `.env` for the AI features, `ANTHROPIC_API_KEY` for the import's AI passes and Visualize, and `GROQ_API_KEY`, `OPENAI_API_KEY`, or `GEMINI_API_KEY` for video transcription (YouTube captions need no key).

## Deploy (Vercel)

1. Import this repo on vercel.com.
2. Storage → Create Database → **Neon** (Postgres) → connect it to the project. Vercel adds the database env vars; the build maps them and runs migrations (the first migration creates the `vector` extension).
3. Settings → Environment Variables: `MOONSHOT_API_KEY` (AI features), `ANTHROPIC_API_KEY` (the import's AI passes and Visualize), `GROQ_API_KEY`, `OPENAI_API_KEY`, or `GEMINI_API_KEY` (video transcription), `BROWSER_WS_ENDPOINT` (a browser service's CDP websocket, for YouTube transcripts when the server's own requests are bot-checked), `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` + `SESSION_SECRET` (Google sign-in; redirect URI `<origin>/api/auth/callback`), `APPLE_CLIENT_ID` + `APPLE_TEAM_ID` + `APPLE_KEY_ID` + `APPLE_PRIVATE_KEY` (Apple sign-in; return URL `<origin>/api/auth/apple/callback` on the Services ID), `RESEND_API_KEY` + `EMAIL_FROM` (email sign-in; sender on a domain verified in Resend), `ADMIN_PASSWORD` (`/admin`), `CRON_SECRET` (the cleanup and model update crons), the `STRIPE_*` variables (billing). All optional to boot; add and redeploy any time.
4. Deployments → Redeploy the latest.

Vercel caps request bodies at about 4.5 MB, so the client splits bigger PDF uploads into chunks. Self-hosted deployments take PDFs up to 50 MB in one request.

Supabase instead of Neon works too: enable the `vector` extension, then set `DATABASE_URL` (pooled, port 6543, `?pgbouncer=true&connection_limit=1`) and `DIRECT_URL` (port 5432) in Environment Variables.

## Environment variables

Copy `.env.example` to `.env` and fill in what you use. Every key is optional; a missing key turns its feature off.

- `DATABASE_URL` — Supabase pooled connection (port 6543, `?pgbouncer=true&connection_limit=1`)
- `DIRECT_URL` — Supabase direct connection (port 5432), used for migrations
- `MOONSHOT_API_KEY` — derivations, the assistant, and glossary (`MOONSHOT_BASE_URL` overrides the endpoint)
- `ANTHROPIC_API_KEY` — the import's AI passes (upload review, the URL core and structure passes, Import PDF's judgment, conversion) and Visualize (`ANTHROPIC_BASE_URL` overrides the endpoint)
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET` — Google sign-in at `/signin`; unset = single local reader, nothing gated. Redirect URI: `<origin>/api/auth/callback`, the only one to register; Link Google Drive returns through it too
- `GOOGLE_DRIVE_ACCESS` — what Add from Google Drive asks for: `all` (default) reads every file the account can read (`drive.readonly`, a restricted scope: add it on the OAuth consent screen's Data access page; until Google verifies the app the consent shows the unverified-app warning, and a consent screen in Testing status allows its test users only and expires the grant after 7 days); `picked` reads the files picked in the Google Picker only (`drive.file`, no verification). Either way, list this app's origin under the OAuth client's Authorized JavaScript origins
- `APPLE_CLIENT_ID` (Services ID), `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY` (.p8 contents) — Sign in with Apple; return URL: `<origin>/api/auth/apple/callback`
- `RESEND_API_KEY`, `EMAIL_FROM` — email sign-in with a confirmation link; the account is created only when the link is clicked
- `DEEPL_API_KEY` — translation
- `GROQ_API_KEY` — video transcription for uploads and YouTube audio (Groq Whisper first)
- `OPENAI_API_KEY` — video transcription for uploads and YouTube audio (OpenAI Whisper second)
- `GEMINI_API_KEY` — video transcription for YouTube videos without readable captions, hour-long uploads through Gemini's file store, and the upload fallback; without it the upload cap is 25 MB, or an MP3 of any length
- `BROWSER_WS_ENDPOINT` or `CHROMIUM_PATH` — a browser that reads YouTube's transcript panel when the server's own requests are bot-checked: a browser service's CDP websocket on Vercel, a Chromium binary on a self-hosted server (`CHROMIUM_ARGS` adds flags)
- `ADMIN_PASSWORD` — enables `/admin` (unset = admin off)
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PREMIUM_MONTHLY`, `STRIPE_PRICE_PREMIUM_YEARLY`, `STRIPE_PRICE_ULTRA_MONTHLY`, `STRIPE_PRICE_ULTRA_YEARLY` — billing (SPEC.md §24); the webhook is `/api/stripe/webhook`; off until the admin billing page (`/admin/billing`) turns it on
- `CRON_SECRET` — enables `/api/cron/cleanup` (deletes rejected notes older than 7 days; vercel.json schedules it daily) and `/api/cron/models` (the bimonthly model update; vercel.json schedules it on the 1st of every second month)

Then, on Supabase, enable the `vector` extension (Database → Extensions → vector), run `npx prisma migrate deploy`, and `npm run dev`.

## Local dev without Supabase

Any Postgres 16+ with the pgvector extension works. Point both `DATABASE_URL` and `DIRECT_URL` at it:

```
DATABASE_URL="postgresql://postgres@localhost:5432/dissect"
DIRECT_URL="postgresql://postgres@localhost:5432/dissect"
```

Then `npx prisma migrate dev`.
