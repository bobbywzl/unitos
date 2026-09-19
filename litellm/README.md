# The AI gateway

LiteLLM in front of every AI provider the app calls (SPEC.md §2). The app
reaches it with one key. The provider keys live here. The gateway applies
the app key's rate limits and budget, records spend per call, and runs the
fallbacks in `config.yaml`. The admin console's Gateway page reads all of it.

What goes through it: GLM 5.3 and GLM 5.3 Flash (the reader's tools, the
assistant, Stitch, the readings), Kimi (the parse passes, calls that carry
an image, the assistant with Web on), Claude (the handwritten passes and
Visualize), Gemini (video), Groq and OpenAI Whisper (transcription), OpenAI
TTS (voice), DeepL (translation), Moonshot's web search, and the model lists
the bimonthly model update reads. `src/lib/gateway.ts` names the route each
client takes. GLM has no direct client: without the gateway, Kimi K3 takes
its calls.

What does not: Deepgram, the first transcription rung. Its request body is
the media bytes, which the gateway's pass-through re-encodes as JSON, and
the gateway's own Deepgram route answers without the speakers. The app
calls Deepgram directly, so `DEEPGRAM_API_KEY` stays on the app's host.
Without it, transcription starts at Groq Whisper and the speakers come from
the Gemini pass.

## Deploy on Railway

1. New project → Deploy from GitHub repo → this repository. In the
   service's settings set **Root Directory** to `litellm`. Railway builds
   the Dockerfile there.
2. Add a **Postgres** to the project. On the gateway service, add the
   variable `DATABASE_URL` with the value `${{Postgres.DATABASE_URL}}`.
3. Add the rest of the variables from `.env.example`: `LITELLM_MASTER_KEY`,
   `LITELLM_SALT_KEY`, and the provider keys (every one but Deepgram's).
   Generate the two keys with `openssl rand -hex 32`.
4. Settings → Networking → Generate Domain. The gateway answers at
   `https://<domain>/health/readiness` with no key.

Fly and Render take the same Dockerfile and the same variables.

## Connect the app

1. On the app's host (Vercel: Settings → Environment Variables), set
   `LITELLM_BASE_URL` to the gateway's URL and `LITELLM_ADMIN_KEY` to the
   master key. Redeploy.
2. Open `/admin/gateway`. Set the app key's limits and click **Create app
   key**. The key is shown once.
3. Set it as `LITELLM_API_KEY` on the app's host. Redeploy. Every AI call
   now goes through the gateway.
4. Delete the provider keys from the app's host: `MOONSHOT_API_KEY`,
   `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`, `OPENAI_API_KEY`,
   `DEEPL_API_KEY`. With the gateway set, the app never reads them. Keep
   `DEEPGRAM_API_KEY` there: Deepgram is the one direct call.

## Run it locally

```bash
cp litellm/.env.example litellm/.env   # fill in the provider keys
docker compose up -d litellm
```

The gateway listens on `http://localhost:4000`. In the app's `.env`, set
`LITELLM_BASE_URL=http://localhost:4000`, `LITELLM_ADMIN_KEY` to the master
key, and `LITELLM_API_KEY` to a key made on `/admin/gateway` (the master key
works too for a local run).

## Change a model, a limit, a fallback

`config.yaml` is the whole configuration. A model, a fallback, or a
per-provider rate limit is a commit and a redeploy of the gateway. The app
key's own limits and budget are set from the Gateway page and live in the
gateway's database.

Sizing: one small instance carries the app; no media passes through it.
Two instances behind Railway's load balancer keep the AI features up while
one restarts.
