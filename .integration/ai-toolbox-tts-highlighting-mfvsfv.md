# ai-toolbox-tts-highlighting-mfvsfv

**Intent:** Read aloud gets a free human-sounding voice API in place of the screeching browser default, and the highlight colors move out of the AI toolbox into a separate bubble right above it.

**Files:**

- `src/lib/voice/edge.ts` — new: Microsoft Edge's free read-aloud service (neural voices, no key) over its edge/v1 websocket via undici. Sec-MS-GEC token, message framing, headers, and control-character sanitizing matched byte-for-byte against edge-tts 7.2.8; text splits into ≤4096-byte escaped chunks that synthesize concurrently and concatenate in order; EnvHttpProxyAgent when HTTPS_PROXY is set (same policy as outbound-fetch).
- `src/app/api/speech/route.ts` — the Edge voice reads first; OpenAI TTS (gpt-4o-mini-tts, alloy) only as the fallback when the Edge voice fails and OPENAI_API_KEY is set; 503 for the browser voice when both are out. Usage recorded per engine.
- `src/lib/usage.ts` — model `edge-tts` priced at $0, provider `microsoft`.
- `src/components/reader/reader-interactions.tsx` — the color-dot row leaves the popover column for a bubble floating right above the toolbox (`bottom-full`; drops below beside the voice bubble when the selection is within 54px of the container top). Same annotate call, labels, and busy state; dots read HUE_DOT. `pickBrowserVoice` ranks installed speechSynthesis voices (Natural/online, then Google, then premium/enhanced) so the last-resort browser voice is the least robotic one; `speakSelection` warms the voice list before the fetch.
- `src/lib/i18n/dict/api.ts` — `speechNeedsKey` now says voice failed and the key is not set (en + zh), since 503 means the free engine failed too.
- `SPEC.md` — §6 voice paragraph rewritten for the engine order; new line for the highlight-colors bubble.
- `.env.example` — OPENAI_API_KEY is now only the TTS fallback.

**Decisions:**

- Engine choice: Microsoft Edge's read-aloud websocket — the only no-key neural-voice service — over paid/keyed APIs (ElevenLabs, Groq, Gemini TTS). It is unofficial; the mitigation is byte-parity with the maintained edge-tts reference and a fallback chain that degrades to exactly the old behavior on any failure.
- The Edge voice leads even when OPENAI_API_KEY is set: the ask was a free API, and it cuts cost; OpenAI stays as the fallback rather than being removed.
- Voices: zh-CN-XiaoxiaoNeural for Chinese, en-US-AvaMultilingualNeural otherwise (long-form names, as the Edge browser sends). One regex (`/[一-鿿]/`) decides, same as the browser-voice path.
- Chunks synthesize concurrently (sequential timed out at 30s for a 3900-char Chinese text; parallel takes 21s) with one 40s budget, leaving maxDuration room for the OpenAI fallback.
- The bubble drops below the toolbox (beside the voice bubble, left-offset) when the selection is near the container top, instead of clamping — `bottom-full` there would land above the scrollable area, out of reach.
- The annotation card's recolor dots stay inline in that card; only the selection toolbox row moved, since the ask was about the AI toolbox.
- Verified live end to end (route returns playable MP3 for English, Chinese, markup-heavy, and 3900-char texts; Playwright confirms the bubble geometry and that highlighting still paints). Note for the orchestrator: the sandbox proxy README claims websocket upgrades are unsupported, but they worked here; if a rerun ever hits that, the route's fallback path is the behavior under test.
