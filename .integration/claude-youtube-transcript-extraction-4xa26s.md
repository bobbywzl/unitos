# claude/youtube-transcript-extraction-4xa26s

**Intent:** Make a YouTube transcript land under any circumstances: fix the caption rungs that fail from datacenter IPs, add a browser rung, an audio rung, and a time budget, and end the ladder with a paste rung the reader can always use.

**Files:**
- `src/lib/video/innertube.ts` — ANDROID first (ANDROID_VR now gets the bot check on datacenter IPs); a generator over every client that answers; per-element validation of caption tracks and adaptive formats.
- `src/lib/video/captions.ts` — new: the caption rung. Track choice mirrors YouTube's panel default; cues fetch as json3 with the track URL's own `fmt` replaced (the bug: ANDROID track URLs carry `fmt=srv3`, a second `fmt` appended is ignored, and the XML failed the JSON parse), srv3 XML second; up to three tracks per client; the watch page last, naming a captcha or the bot-check reason a 200 page carries instead of calling the video caption-less.
- `src/lib/video/browser-transcript.ts` — new: the browser rung (playwright-core over `BROWSER_WS_ENDPOINT` or `CHROMIUM_PATH`; the page's own caption track, then the Show transcript panel).
- `src/lib/video/youtube-audio.ts` — new: the audio rung (the best audio-only stream under the upload cap, then the upload ladder).
- `src/lib/video/paste.ts` — new: the pasted transcript parser (panel copy, inline times, SRT, WebVTT).
- `src/lib/video/segments.ts` — new: `TranscriptSegment`, `normalizeSegments`, `groupSegments`, moved out of transcribe.ts so the new modules share them without import cycles.
- `src/lib/video/transcribe.ts` — the YouTube ladder in the new order; `runLadder` with a deadline; the upload rungs reused by the audio rung; the caption code moved out.
- `src/lib/video/transcription-job.ts` — the ladder deadline (240 s); `storeTranscript` factored out; `storePastedTranscript`.
- `src/app/api/documents/[documentId]/transcript/route.ts` — new: `POST {text}` stores a pasted transcript.
- `src/components/video/transcript.tsx`, `src/components/video/video-pane.tsx` — Paste transcript beside Retry in the failed state.
- `src/lib/i18n/dict/video.ts`, `api.ts`, `legal.ts` — the strings, en and zh; Groq and linked-video audio named on the privacy page.
- `next.config.ts`, `package.json`, `package-lock.json` — playwright-core is a runtime dependency, external to the bundle.
- `scripts/qa/youtube-transcript.mts` — new: pure checks plus the live ladder from the running network (`npx tsx scripts/qa/youtube-transcript.mts`).
- `SPEC.md`, `README.md`, `.env.example`, `.env.local.example` — the ladder as it now is.

**Decisions:**
- Captions go before Gemini; the SPEC had Gemini first. Captions are the transcript YouTube shows, exact, free, and seconds to fetch, and a failed captions attempt costs seconds, so Gemini loses nothing by going second.
- Track choice follows YouTube's own default, then the spoken language (human, then auto-generated), then a translation. The old rule preferred English.
- The browser rung is configured, never installed by default: YouTube gives a browser on a datacenter IP the same captcha as a plain fetch (verified from this sandbox), so on Vercel it needs a browser service, and bundling Chromium into the function would not help.
- The audio rung stays under the upload caps rather than chunking m4a; a video whose smallest stream is over the cap reports it. The download could not be verified from this sandbox: its proxy shows YouTube and googlevideo different IPs, so the stream URL's IP binding answers 403. The code runs up to that point.
- The paste rung is manual by design. It is the only path that never depends on the server's network, and this sandbox's IP was bot-checked on every client after a burst of requests; a Vercel IP can meet the same wall.
