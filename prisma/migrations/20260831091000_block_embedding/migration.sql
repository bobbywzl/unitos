-- Block.embedding: the semantic search vector (text-embedding-3-small at
-- 1024 dims). Null = not embedded yet; the search route backfills lazily
-- and a text edit clears it.
ALTER TABLE "Block" ADD COLUMN "embedding" vector(1024);
