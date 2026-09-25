-- Version history of a blank document (SPEC.md §29): when the rich text was
-- last saved and by whom, and the versions a new sitting of edits keeps.
ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "richTextSavedAt" TIMESTAMP(3);
ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "richTextSavedBy" TEXT;

CREATE TABLE IF NOT EXISTS "DocumentVersion" (
  "id" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "rev" INTEGER NOT NULL,
  "richText" JSONB NOT NULL,
  "userId" TEXT,
  "name" TEXT,
  "savedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DocumentVersion_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "DocumentVersion_documentId_rev_key" ON "DocumentVersion"("documentId", "rev");
ALTER TABLE "DocumentVersion" DROP CONSTRAINT IF EXISTS "DocumentVersion_documentId_fkey";
ALTER TABLE "DocumentVersion" ADD CONSTRAINT "DocumentVersion_documentId_fkey"
  FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
