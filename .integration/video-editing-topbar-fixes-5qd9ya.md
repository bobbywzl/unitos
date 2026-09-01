# video-editing-topbar-fixes-5qd9ya

**Intent:** Every committed action — edits, annotations, AI results — reaches all shared users' open workspaces live, through the existing rev poll.

**Files:**

- `src/lib/glossary.ts` — buildGlossary bumps the document's corpora when the glossary lands; the after()-ingest run wrote it with no bump, so key terms appeared only after an unrelated write.
- `src/lib/video/transcription-job.ts` — runTranscription bumps on PENDING, READY, and FAILED; the auto-start run after ingest wrote the transcript with no bump, so other users never saw it land.

**Decisions:**

- The bumps live in the two lib jobs, not their callers: the after()-scheduled runs outlive the request, and one bump site covers every caller (ingest, uploads complete, media URL, the manual routes).
- Audited every mutation route for the "every write bumps" contract (collab.ts §Live sync): blocks, annotations, notes, sections, links, replies, documents, derive (every DerivationType at persist), assistant act, and buildConnections already bump. Auth, profile, search, speech, upload staging, and video metadata writes stay bump-free — they are not corpus content.
- Video metadata PATCH (duration/width/height) deliberately does not bump: every viewer's browser sends it when the player loads, and a bump there would refresh everyone for nothing.
