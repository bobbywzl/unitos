-- AlterTable
ALTER TABLE "Document" ADD COLUMN "columnWidth" INTEGER;

-- AlterTable
ALTER TABLE "ImageAsset" ADD COLUMN "documentId" TEXT;

-- CreateIndex
CREATE INDEX "ImageAsset_documentId_idx" ON "ImageAsset"("documentId");

-- AddForeignKey
ALTER TABLE "ImageAsset" ADD CONSTRAINT "ImageAsset_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
