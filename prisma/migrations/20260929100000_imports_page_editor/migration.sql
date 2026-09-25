-- Imports in the page editor (SPEC.md §29): an import's figure media, kept
-- once per document; the FIGURE row's media and a table cell's place in the
-- paragraph index; the revision an import stored and a PDF's page labels.
-- fileHash stops being unique: an edited import is never handed to another
-- add, so the same file can be imported again beside it.
DROP INDEX IF EXISTS "Document_fileHash_key";
CREATE INDEX IF NOT EXISTS "Document_fileHash_idx" ON "Document"("fileHash");

ALTER TABLE "Block" ADD COLUMN IF NOT EXISTS "mediaId" TEXT;
ALTER TABLE "Block" ADD COLUMN IF NOT EXISTS "cell" JSONB;

ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "importRev" INTEGER;
ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "pageLabels" JSONB;

CREATE TABLE IF NOT EXISTS "FigureMedia" (
  "id" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "html" TEXT,
  "caption" TEXT NOT NULL,
  "page" INTEGER,
  "region" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FigureMedia_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "FigureMedia_documentId_idx" ON "FigureMedia"("documentId");
ALTER TABLE "FigureMedia" DROP CONSTRAINT IF EXISTS "FigureMedia_documentId_fkey";
ALTER TABLE "FigureMedia" ADD CONSTRAINT "FigureMedia_documentId_fkey"
  FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
