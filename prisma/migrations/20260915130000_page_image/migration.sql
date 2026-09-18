-- Page images (SPEC.md §16): a handwritten document's pages rendered once and
-- kept, so the page image route serves stored bytes.
CREATE TABLE IF NOT EXISTS "PageImage" (
  "blockId" TEXT NOT NULL,
  "width" INTEGER NOT NULL,
  "height" INTEGER NOT NULL,
  "data" BYTEA,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PageImage_pkey" PRIMARY KEY ("blockId")
);
ALTER TABLE "PageImage" ADD CONSTRAINT "PageImage_blockId_fkey" FOREIGN KEY ("blockId") REFERENCES "Block"("id") ON DELETE CASCADE ON UPDATE CASCADE;
