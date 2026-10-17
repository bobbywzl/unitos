-- A document kept for an account after the project that held it was
-- deleted (SPEC.md §6): one row per account per document, written by the
-- project delete for its owner. Additive: a new table only; no existing
-- column or row changes. Deleting the document deletes its rows.
CREATE TABLE IF NOT EXISTS "KeptDocument" (
  "userId" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "keptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "KeptDocument_pkey" PRIMARY KEY ("userId", "documentId")
);
CREATE INDEX IF NOT EXISTS "KeptDocument_documentId_idx" ON "KeptDocument"("documentId");
ALTER TABLE "KeptDocument" DROP CONSTRAINT IF EXISTS "KeptDocument_documentId_fkey";
ALTER TABLE "KeptDocument" ADD CONSTRAINT "KeptDocument_documentId_fkey"
  FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
