-- The contents (SPEC.md §26): the document's parts, each with the block it
-- starts at. Built when the reader first opens Contents.
ALTER TABLE "Document" ADD COLUMN "contents" JSONB;

-- Multi upload is gone (SPEC.md §22): every document of a project is its own
-- page, and Stitch runs over the project's documents from the graph. A
-- generated document keeps its command and stays in the project it is
-- attached to; it loses only the multi upload it was written from.
ALTER TABLE "Document" DROP CONSTRAINT "Document_generatedFromId_fkey";
DROP INDEX "Document_generatedFromId_idx";
ALTER TABLE "Document" DROP COLUMN "generatedFromId";

DROP TABLE "MultiUploadMember";
DROP TABLE "MultiUpload";
