-- AlterTable
ALTER TABLE "Document" ADD COLUMN "generatedFromId" TEXT,
ADD COLUMN "generatedCommand" TEXT;

-- CreateTable
CREATE TABLE "MultiUpload" (
    "id" TEXT NOT NULL,
    "notebookId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MultiUpload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MultiUploadMember" (
    "multiUploadId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,

    CONSTRAINT "MultiUploadMember_pkey" PRIMARY KEY ("multiUploadId","documentId")
);

-- CreateIndex
CREATE INDEX "Document_generatedFromId_idx" ON "Document"("generatedFromId");

-- CreateIndex
CREATE INDEX "MultiUpload_notebookId_idx" ON "MultiUpload"("notebookId");

-- CreateIndex
CREATE INDEX "MultiUploadMember_documentId_idx" ON "MultiUploadMember"("documentId");

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_generatedFromId_fkey" FOREIGN KEY ("generatedFromId") REFERENCES "MultiUpload"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MultiUpload" ADD CONSTRAINT "MultiUpload_notebookId_fkey" FOREIGN KEY ("notebookId") REFERENCES "Notebook"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MultiUploadMember" ADD CONSTRAINT "MultiUploadMember_multiUploadId_fkey" FOREIGN KEY ("multiUploadId") REFERENCES "MultiUpload"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MultiUploadMember" ADD CONSTRAINT "MultiUploadMember_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
