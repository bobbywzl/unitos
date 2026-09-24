-- The layer an anchor points into (SPEC.md §28): null for the block's text,
-- "core" for the block's core in the collapsed view. A core anchor's offsets
-- and quote are the core's words.
ALTER TABLE "Source" ADD COLUMN "layer" TEXT;
