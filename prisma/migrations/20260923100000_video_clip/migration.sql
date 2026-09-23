-- The part of a recording that is imported (SPEC.md §15): the range the
-- reader picked in the upload box, seconds. Null = the whole recording.
ALTER TABLE "VideoAsset" ADD COLUMN IF NOT EXISTS "clipStart" DOUBLE PRECISION;
ALTER TABLE "VideoAsset" ADD COLUMN IF NOT EXISTS "clipEnd" DOUBLE PRECISION;
