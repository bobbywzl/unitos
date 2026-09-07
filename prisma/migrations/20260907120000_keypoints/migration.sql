-- KEYPOINTS derivation — the reader's Distill: the article's most important
-- points as bullets, each anchored to the span it comes from, stored on the
-- attachment (SPEC.md §4). Distill again overwrites.
ALTER TYPE "DerivationType" ADD VALUE 'KEYPOINTS';

-- AlterTable
ALTER TABLE "NotebookDocument" ADD COLUMN "keypoints" JSONB;
