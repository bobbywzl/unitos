-- Feedback carries photos and links (SPEC.md §18): ImageAsset ids and URLs.
ALTER TABLE "Feedback" ADD COLUMN IF NOT EXISTS "images" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Feedback" ADD COLUMN IF NOT EXISTS "links" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
