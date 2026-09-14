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
