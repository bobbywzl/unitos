-- The skeleton (SPEC.md §22): the document collapsed for Stitch.
ALTER TABLE "Document" ADD COLUMN "skeleton" JSONB;
ALTER TABLE "Document" ADD COLUMN "skeletonStartedAt" TIMESTAMP(3);
