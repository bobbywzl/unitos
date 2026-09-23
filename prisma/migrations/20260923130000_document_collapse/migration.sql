-- Collapse (SPEC.md §28): every block's core, keyed by the hash of the block
-- text it was written from.
ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "collapse" JSONB;
