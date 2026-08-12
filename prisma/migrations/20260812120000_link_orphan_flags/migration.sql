-- Link ends orphan visibly, like Source anchors (SPEC.md §5).
ALTER TABLE "DocLink" ADD COLUMN "fromOrphaned" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "DocLink" ADD COLUMN "toOrphaned" BOOLEAN NOT NULL DEFAULT false;
