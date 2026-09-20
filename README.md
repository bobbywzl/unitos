# Dissect

Notes-centric web app for deep reading. Documents attach to notebooks; every AI feature is one pipeline: anchor → derivation → destination. See SPEC.md for the data model, phases, and quality bars. See CLAUDE.md for conventions.

## Features

- Notebooks with sections (one nesting level, drag-reorder) and markdown notes
- PDF upload and URL ingestion, parsed to blocks (two-column PDFs handled), deduped by file hash. The add dialog queues links and files of every kind together — Enter after a link queues it — and the upload assistant imports each faithfully, whole and as it is
- Stitch, in the graph: one command across the project's documents — the nodes picked in the graph, or every document — gather every passage on a topic into a new page, connect the passages that answer a question, find where the documents contradict each other, write one page that combines them. Links land as recommended links awaiting Accept; a written page is a generated document of the project, listed under Generated content beside the graph, every paragraph linked back to its source. Every document carries a skeleton — a gist, a summary per part, one line per block at a tenth of the length, rebuilt when more than a tenth of the document changes — and Stitch reads skeletons, routes to parts, ranks lines when there are too many, and reads the real text of only the blocks it picked, so a command costs what it needs, not the project
- Contents: the article's parts at the top left of the reader, each a jump to where the part starts; Contents opens the list, Generate contents has AI write the parts once (headings when the document has them, segments by what the text does when it does not) under a disclaimer that a part may be off; the button hides once the reader scrolls
- Image upload (png, jpg, gif, webp, bmp), dropped on the page or picked: the image lands as a one-page handwritten document — the page as it is, Circle & ask, and conversion to text
- Images drop into a note, and into a paragraph while the reader is in edit mode, where they land as a figure. An account whose Premium trial ended drops images up to 5 MB; larger ones need Unitos Premium
- Visualize (Unitos Ultra): the selection as a picture — a directed diagram, a drawing, or a short animation — drawn only when the model is certain the picture carries the passage's core idea, and declined with the reason otherwise. Saved as an annotation on the selection
- Tiers (TIERS.md): every account is Unitos Premium or Unitos Ultra; a new account gets two months of Unitos Premium free. No billing yet — the operator sets the tier on the account
- Video documents: upload an mp4 (up to 200 MB, custom player with Range streaming) or add a YouTube link (plays through the IFrame player behind the same controls); circle a spot and comment on it — annotations carry a time range and replay on an overlay whenever playback crosses it, with a marker per annotation on the scrubber and a Visual strip of frame cards underneath
- Video transcription starts on its own when the video is added. Hour-long uploads transcribe through Gemini's file store (`GEMINI_API_KEY`); without it the cap is 25 MB, or an MP3 of any length. Provider ladder — YouTube: YouTube captions through the player API and the watch page, then the same captions read by a browser when one is configured (`BROWSER_WS_ENDPOINT` or `CHROMIUM_PATH`), then Gemini (`GEMINI_API_KEY`), then the audio stream through the upload ladder; when every rung fails, the transcript pane offers Paste transcript, which reads what YouTube's transcript panel copies; uploads: Groq Whisper (`GROQ_API_KEY`), then OpenAI Whisper (`OPENAI_API_KEY`), then Gemini. A long video splits into windows that transcribe in parallel and stitch back together. The transcript gives read-along highlight and click-to-seek; Find searches it and answers with seekable time ranges; Explain reads the actual frame cropped to the circle plus the transcript (a YouTube frame comes from the storyboard sheets, with Gemini watching the same clip at full resolution as corroboration) and saves the explanation as an annotation at that moment; transcript lines carry the same Comment and Explain tools
- One toolbar per content kind: select text for the Assistant, Simplify, Visualize, Comment, Link, highlight, Add to notes, and Read aloud; select in a table or circle it for Table tools; circle a figure for Figure tools; circle an equation for Equation tools. Each kind offers its own tools and nothing else
- Split view: reader left, notes drawer right; notes reorder by drag in both, and the notes full-page view adds section reorder, renaming, compare, and export. Every note and annotation shows its id, sits collapsed to one summarizing line until Expand all shows every card whole, and jumps back to its exact position in the article; notes keep their shape between the editor and display; the full page compares chosen notes in one screen, side by side or stacked
- Anchoring that survives reload and re-parse: block offsets + quote fallback, orphans render visibly
- Derivations via one pipeline (`/api/derive`): EXPLAIN (Circle & ask on a handwritten page only), SIMPLIFY (inline swap, revert on click), SALIENCE (toggleable overlay), DISTILL (the reader's Extract: one question → the quotes that answer it, on the extract page), COMPARE (two documents → one pending note of agreements, disagreements, and what only one covers, sourced on both; from the document list's menu), ANALYZE (a figure or table read by the vision model into the card beside it, in three sections: Insights, Quantitative with printed values verbatim and estimates marked with ≈, and Linking to context — contradictions in the document and links across the project; saved under Annotations; it leads the figure and table toolbars and never appears on text), ASK (a question about a time range of a video or audio document, answered from the transcript in that range; Add to notes lands it pending with a time source)
- Voice notes: Speak beside "+ note" on every section records up to five minutes, transcribes it through the upload ladder (Groq Whisper, then OpenAI Whisper, then Gemini), cleans it like a transcript, and lands it as a pending note for the reader to accept
- Translation (`DEEPL_API_KEY`): when a document's language is not the reader's, a bar above the article — or above a media document's transcript — offers Translate; DeepL translates every paragraph and transcript line once (cached per block per language, re-translated only when a block is edited), each translation reads under its original, anchors and tools stay on the original text, and the choice is remembered per document
- Pending queue keyboard flow: `j/k` move, `Enter` accept, `Backspace` reject, `e` edit, `g` jump to source
- Context (background, purpose, application) injected into every prompt; edited in Settings, saved globally or as a per-notebook override
- Assistant panel with two scopes — Project (this project whole) and Projects (every project whole) — plus contradiction, gap, and unsourced checks as clickable cards. With Web on (the default), Ask searches the web through Moonshot's web-search tool to verify its answer against outside sources and cites every page it used as a link, ending with a Web sources list; the project stays the first source
- The digest: the assistant's stored context, one row per project per user — every document in full, every note, annotation, distillation, extraction, and summary; stale rows rebuild on read via a content fingerprint
- Glossary extraction on ingest; hover definitions in the reader
- Export notebook to Markdown or .docx with `documentTitle, blockId` footnotes
- Google, Apple, and email sign-in at `/signin` (dual mode: with `SESSION_SECRET` plus any provider's credentials the app is gated; without, it runs as a single local reader). Email sign-in takes a name and an email, creates the account only when the confirmation link is clicked, and lands on `/welcome` to set a password; returning users sign in with email + password, and Forgot password emails a reset link. Projects, context, and digests belong to the signed-in account; the first account to sign in adopts the local reader's data
- English and Chinese, whole-surface: the switcher (Settings, `/signin`) changes every UI string and API error message at once
- Feedback pipeline (`.claude/skills/feedback-pipeline`): a daily Routine reads the feedback inbox, opens one pull request per change that fits the spec for employees to review, and after a merge (Vercel deploys `main`) resolves the feedback and replies to its senders
- Feedback button + admin inbox (`/admin`) with new → seen → resolved triage and Reply, which reaches the account that sent the feedback as a notification on its dashboard; admin digest page (`/admin/digest`) showing the store per account — every project → document → annotations, notes, distillations — with forced rebuilds and the exact text each scope sends; admin accounts page (`/admin/accounts`) listing every account with Block and Unblock, which put the account's email on the block list (a blocked email cannot sign in; an email with no account yet can be blocked too) and take it off, and Reset account, which deletes the account's data and puts it back at onboarding like a new account. The admin gate (`ADMIN_PASSWORD`) is separate from reader sign-in
- AI usage telemetry: every model call records tokens and cost (list prices at call time); the admin usage page (`/admin/usage`) shows totals, daily cost, and cost per function, model, and account
- The AI gateway (`litellm/`): LiteLLM in front of every AI provider, holding the provider keys, the app key's rate limits and budget, the fallbacks, and spend per call; the admin gateway page (`/admin/gateway`) shows readiness, models with limits and prices, fallbacks, the app key's spend and limits, spend by day, model, provider, function, and account, and issues the app key
- Admin notifications (`/admin/notifications`): the admin sends a notification — an update to Unitos, or a change made to an account — to every account or to chosen ones; it shows on each recipient's dashboard until dismissed. The admin picks recipients from names and emails and cannot open or change an account
- Click telemetry: every click on a reader control records its surface (top bar, sidebar, AI toolbar, article menu, reader, notes tray) and control; the admin clicks page (`/admin/clicks`) shows clicks per day by surface, per surface, per control, and per account
- Settings (`/settings`): account + sign out, language, light/dark/system theme, context, service status

## Stack

- Next.js (App Router, TypeScript strict, server components by default)
- PostgreSQL (Supabase) + Prisma
- GLM 5.3 and GLM 5.3 Flash (Z.ai) through the AI gateway for the reader's tools, the assistant, Stitch, and the readings; Kimi K3 (Moonshot AI) for the parse passes — the URL core, structure, and layout passes — for calls that carry an image and the assistant with Web on, and for every GLM call without the gateway; all via the AI SDK, streaming, automatic prompt caching (the parsed document — and the digest at assistant scopes — is the cached prefix); Claude Opus 5 (Anthropic) for Import PDF's judgment, conversion, Visualize, and every reading of an SVG chart
- The bimonthly model update: on the 1st of every second month a cron reads each provider's published model list, moves each model to the newest version of its family after one probe call, and records the outcome on the admin page (`/api/cron/models`, `lib/model-update.ts`)
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

Reading, notes, anchoring, and export work with no API keys. Add `MOONSHOT_API_KEY` to `.env` for the AI features, `ANTHROPIC_API_KEY` for the import's AI passes, and `GROQ_API_KEY`, `OPENAI_API_KEY`, or `GEMINI_API_KEY` for video transcription (YouTube captions need no key).

Or run every AI call through the gateway: `litellm/README.md` has the steps. With `LITELLM_BASE_URL`, `LITELLM_API_KEY`, and `LITELLM_ADMIN_KEY` set, the provider keys live on the gateway host and the app reads none of them.

## Deploy (Vercel)

1. Import this repo on vercel.com.
2. Storage → Create Database → **Neon** (Postgres) → connect it to the project. Vercel adds the database env vars; the build maps them and runs migrations (the first migration creates the `vector` extension).
3. Settings → Environment Variables: `MOONSHOT_API_KEY` (AI features), `ANTHROPIC_API_KEY` (the import's AI passes), `GROQ_API_KEY`, `OPENAI_API_KEY`, or `GEMINI_API_KEY` (video transcription), `BROWSER_WS_ENDPOINT` (a browser service's CDP websocket, for YouTube transcripts when the server's own requests are bot-checked), `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` + `SESSION_SECRET` (Google sign-in; redirect URI `<origin>/api/auth/callback`), `APPLE_CLIENT_ID` + `APPLE_TEAM_ID` + `APPLE_KEY_ID` + `APPLE_PRIVATE_KEY` (Apple sign-in; return URL `<origin>/api/auth/apple/callback` on the Services ID), `RESEND_API_KEY` + `EMAIL_FROM` (email sign-in; sender on a domain verified in Resend), `ADMIN_PASSWORD` (`/admin`), `BETA` (the beta: every account has Unitos Ultra in the app while it is `on`), `CRON_SECRET` (the cleanup and model update crons). All optional to boot; add and redeploy any time.
4. Deployments → Redeploy the latest.

Vercel caps request bodies at about 4.5 MB, so PDF uploads above that fail there. Self-hosted deployments take PDFs up to 50 MB.

Supabase instead of Neon works too: enable the `vector` extension, then set `DATABASE_URL` (pooled, port 6543, `?pgbouncer=true&connection_limit=1`) and `DIRECT_URL` (port 5432) in Environment Variables.

## Setup

1. `npm install`
2. Copy `.env.example` to `.env` and fill in:
   - `DATABASE_URL` — Supabase pooled connection (port 6543, `?pgbouncer=true&connection_limit=1`)
   - `DIRECT_URL` — Supabase direct connection (port 5432), used for migrations
   - `LITELLM_BASE_URL`, `LITELLM_API_KEY`, `LITELLM_ADMIN_KEY` — the AI gateway (`litellm/README.md`). With the first two set, every AI call goes through it and the provider keys below are not read; the third opens the admin gateway page
   - `MOONSHOT_API_KEY` — required for derivations, the assistant, and glossary (`MOONSHOT_BASE_URL` overrides the endpoint)
   - `ANTHROPIC_API_KEY` — required for the import's AI passes — upload review, the URL core and structure passes, Import PDF's judgment, and conversion — and for Visualize (`ANTHROPIC_BASE_URL` overrides the endpoint)
   - `TYPESAFE_API_KEY` — Jev, TypeSafe AI's decision model (`lib/jev.ts`): the lead tool of the selection toolbar, Stitch's route and select passes, the nudges a reader has already earned, the figure audit's caption check, the sheet header check, the URL import's wall check, the digest's ranked cut, the tool checks, the History panel's small edits, and a recording's chapters; unset, all of those run without it. Through OpenRouter: an OpenRouter key here, `TYPESAFE_BASE_URL=https://openrouter.ai/api/v1`, `TYPESAFE_MODEL=typesafe/jev-1.13`
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET` — Google sign-in at `/signin`; unset = single local reader, nothing gated. Redirect URI: `<origin>/api/auth/callback` — the only one to register; Link Google Drive returns through it too
   - `GOOGLE_DRIVE_ACCESS` — what Add from Google Drive asks for: `all` (default) reads every file the account can read (`drive.readonly`: add the scope on the OAuth consent screen's Data access page; Google treats it as restricted, so until the app is verified the consent shows Google's unverified-app warning, and a consent screen in Testing status allows its test users only and expires the grant after 7 days); `picked` reads the files picked in the Google Picker only (`drive.file`, no verification). Either way, list this app's origin under the OAuth client's Authorized JavaScript origins
   - `APPLE_CLIENT_ID` (Services ID), `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY` (.p8 contents) — Sign in with Apple; return URL: `<origin>/api/auth/apple/callback`
   - `RESEND_API_KEY`, `EMAIL_FROM` — email sign-in with a confirmation link; the account is created only when the link is clicked
   - `GROQ_API_KEY` — video transcription for uploads and YouTube audio (Groq Whisper first)
   - `OPENAI_API_KEY` — video transcription for uploads and YouTube audio (OpenAI Whisper second)
   - `GEMINI_API_KEY` — video transcription for YouTube videos without readable captions, and the upload fallback
   - `BROWSER_WS_ENDPOINT` or `CHROMIUM_PATH` — a browser that reads YouTube's transcript panel when the server's own requests are bot-checked: a browser service's CDP websocket on Vercel, a Chromium binary on a self-hosted server (`CHROMIUM_ARGS` adds flags)
   - `ADMIN_PASSWORD` — enables `/admin` (unset = admin off)
   - `BETA` — the beta (TIERS.md): `on` gives every account Unitos Ultra in the app; billing sells the tiers and records purchases, which take effect when it is unset
   - `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` + `STRIPE_PRICE_PREMIUM_MONTHLY` + `STRIPE_PRICE_PREMIUM_YEARLY` + `STRIPE_PRICE_ULTRA_MONTHLY` + `STRIPE_PRICE_ULTRA_YEARLY` — billing (SPEC.md §24): the tiers sold through Stripe under `/billing`, monthly or yearly; off until the admin billing page (`/admin/billing`) turns it on. `scripts/stripe-setup.mjs` configures the Stripe account (the two products, the four prices, the webhook endpoint, the customer portal) and prints the price ids and the webhook secret to set. `STRIPE_TAX=on` adds Stripe Tax at checkout once the account has a head office address and its registrations
   - `CRON_SECRET` — enables `/api/cron/cleanup` (deletes rejected notes older than 7 days; vercel.json schedules it daily) and `/api/cron/models` (the bimonthly model update; vercel.json schedules it on the 1st of every second month)
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
