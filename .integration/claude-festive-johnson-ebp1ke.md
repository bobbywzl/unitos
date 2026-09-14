# claude/festive-johnson-ebp1ke

**Intent:** Stitch reads a video or audio member as its transcript, tells the reader what it read of every member, and surfaces why a member could not be read (transcript pending, stale, failed with the stored reason, or never run; conversion likewise).

**Files:**
- `src/lib/multi/stitch.ts` — loads each member's transcript and conversion state; reads only content blocks (VIDEO and PAGE blocks are not content); cuts a long member at a block boundary; declares an empty member to the model with the reason; returns one `StitchMember` per member; skips the model call when fewer than two members can be read.
- `src/lib/prompts/stitch.ts` — each member listed with what of it is above; unread members named, never cited, and reported in the reply.
- `src/lib/types.ts` — `StitchMember`; `StitchResult.members`.
- `src/lib/video/types.ts` — `transcriptErrorKey`: the one map from a stored transcription error to its UI string, shared by the transcript pane and the Stitch box.
- `src/components/video/video-pane.tsx` — uses `transcriptErrorKey`.
- `src/components/multi/stitch-box.tsx` — under every reply: "Read N of M members" and one row per member, unread rows in red with the reason; the "did not run" line when fewer than two can be read.
- `src/lib/i18n/dict/multi.ts` — the strings, en and zh.
- `SPEC.md` — §22 describes what Stitch reads and the per-member report.

**Decisions:**
- Fewer than two readable members: no model call and an empty reply, with the per-member rows saying why, rather than a thrown error. A thrown error would hide the per-member list.
- A member with nothing to read still appears in the system message as `(nothing to read: reason)`, so the model knows it exists and does not guess at its text.
- Stitch does not start a transcription itself; the row says to open the document to transcribe it.

---

# Second change: transcription runs every rung, timestamps and speakers from the audio

**Intent:** Transcription reports FAILED only after every rung has actually run, across functions when one is not enough; every attempt runs the whole ladder; timestamps and speakers come from the audio itself through a Deepgram rung, with the Gemini rung and the cleanup pass hardened so a line's words match its moment and its voice.

**Files:**
- `src/lib/video/transcribe.ts` — `skip` (rungs already tried), `LadderOutOfTime` (clock spent, rungs left) and `LadderExhausted` (every rung ran); Deepgram first in the upload ladder; Gemini timestamps asked for as a clock; transcription windows past fifteen minutes; window clock told apart by the earliest timestamp.
- `src/lib/video/deepgram.ts` — the Deepgram Nova-3 rung: one call, utterances with start, end, and speaker.
- `src/lib/video/segments.ts` — `speaker` on a segment; a line never joins two voices.
- `src/lib/video/speakers.ts` — `nameSpeakers` (text only) for diarized lines; the media pass now uses voice, on-camera, and conversation cues.
- `src/lib/video/tidy.ts` — `lineIsSound`: each cleaned line checked on its own, per-line fallback to the rules cleanup.
- `src/lib/video/youtube-audio.ts`, `src/lib/video/innertube.ts` — the default audio track only.
- `src/lib/video/transcription-job.ts` — legs: `transcriptTried` stored between legs, the next leg through the app's own transcribe route on Vercel (CRON_SECRET) or in process elsewhere; the naming path for diarized lines; the links scan on the landing leg.
- `src/app/api/documents/[documentId]/transcribe/route.ts` — the leg branch.
- `src/app/api/uploads/complete/route.ts`, `src/app/api/documents/route.ts`, `src/app/api/drive/import/route.ts` — the links scan waits for a run that continues elsewhere.
- `prisma/schema.prisma`, `prisma/migrations/20260914120000_transcript_tried` — `VideoAsset.transcriptTried`.
- `src/lib/video/types.ts`, `src/app/n/[notebookId]/page.tsx`, `src/components/video/transcript.tsx`, `src/components/video/video-pane.tsx`, `src/lib/i18n/dict/video.ts` — the rungs tried so far shown under Transcribing….
- `.env.example`, `SPEC.md` §11 — the new key, the legs, the ladder order.

**Decisions:**
- Deepgram over AssemblyAI, OpenAI diarize, and ElevenLabs: cheapest with diarization included, one synchronous call, 2 GB, no chunking.
- The next leg is a self-request with CRON_SECRET rather than a cron: a cron cannot fire within seconds. Without the secret or off Vercel the leg runs in process.
- Retry runs the whole ladder again rather than resuming: a later attempt may succeed on a rung that failed on a transient error.
