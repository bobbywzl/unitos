-- Transcription legs (SPEC.md §11): the rungs the running attempt has tried
-- so far, so a run that reaches the function's clock continues on a fresh
-- one with the rungs left, and FAILED is written only after every rung ran.
ALTER TABLE "VideoAsset" ADD COLUMN IF NOT EXISTS "transcriptTried" JSONB;
