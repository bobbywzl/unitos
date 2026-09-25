-- The reading position (SPEC.md §6): where one account left off in one
-- document — the block at the reading line, the offset from the line to the
-- block's top, the block's height then, and when the reader was there. One
-- row per account per document; deleting the document deletes its rows.
CREATE TABLE IF NOT EXISTS "ReadingPosition" (
  "userId" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "blockId" TEXT NOT NULL,
  "offset" DOUBLE PRECISION NOT NULL,
  "height" DOUBLE PRECISION NOT NULL,
  "at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ReadingPosition_pkey" PRIMARY KEY ("userId", "documentId")
);
CREATE INDEX IF NOT EXISTS "ReadingPosition_documentId_idx" ON "ReadingPosition"("documentId");
ALTER TABLE "ReadingPosition" DROP CONSTRAINT IF EXISTS "ReadingPosition_documentId_fkey";
ALTER TABLE "ReadingPosition" ADD CONSTRAINT "ReadingPosition_documentId_fkey"
  FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
