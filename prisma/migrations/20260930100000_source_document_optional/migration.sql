-- A document that notes quote can be deleted (SPEC.md §5): the notes keep
-- their sources' quotes, orphaned, and the sources lose the document.
ALTER TABLE "Source" ALTER COLUMN "documentId" DROP NOT NULL;
ALTER TABLE "Source" DROP CONSTRAINT IF EXISTS "Source_documentId_fkey";
ALTER TABLE "Source" ADD CONSTRAINT "Source_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;
