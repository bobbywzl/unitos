-- AlterTable
ALTER TABLE "Note" ADD COLUMN     "color" TEXT;

-- CreateTable
CREATE TABLE "BlockEdit" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "blockId" TEXT,
    "kind" TEXT NOT NULL,
    "before" TEXT,
    "after" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BlockEdit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocLink" (
    "id" TEXT NOT NULL,
    "fromDocumentId" TEXT NOT NULL,
    "fromBlockId" TEXT NOT NULL,
    "startOffset" INTEGER NOT NULL,
    "endOffset" INTEGER NOT NULL,
    "quotedText" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "suffix" TEXT NOT NULL,
    "toDocumentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BlockEdit_documentId_createdAt_idx" ON "BlockEdit"("documentId", "createdAt");

-- CreateIndex
CREATE INDEX "DocLink_fromDocumentId_idx" ON "DocLink"("fromDocumentId");

-- CreateIndex
CREATE INDEX "DocLink_toDocumentId_idx" ON "DocLink"("toDocumentId");

-- AddForeignKey
ALTER TABLE "BlockEdit" ADD CONSTRAINT "BlockEdit_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocLink" ADD CONSTRAINT "DocLink_fromDocumentId_fkey" FOREIGN KEY ("fromDocumentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocLink" ADD CONSTRAINT "DocLink_toDocumentId_fkey" FOREIGN KEY ("toDocumentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
