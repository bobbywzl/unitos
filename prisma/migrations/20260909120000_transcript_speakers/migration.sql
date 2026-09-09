-- Speakers on a transcript (SPEC.md §11): which voice says each line, and the
-- roster of voices with the names the introductions gave them.
ALTER TABLE "Block" ADD COLUMN IF NOT EXISTS "speaker" TEXT;
ALTER TABLE "VideoAsset" ADD COLUMN IF NOT EXISTS "speakers" JSONB;
