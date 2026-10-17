-- Every add is its own document (SPEC.md §11, §15): the same YouTube video
-- added twice makes two documents, so VideoAsset.youtubeId is indexed, not
-- unique. Additive: only the unique index goes and a plain index takes its
-- place; no column or row changes.
DROP INDEX IF EXISTS "VideoAsset_youtubeId_key";
CREATE INDEX IF NOT EXISTS "VideoAsset_youtubeId_idx" ON "VideoAsset"("youtubeId");
