-- AlterTable
ALTER TABLE "Reply" ADD COLUMN     "docLinkId" TEXT;

-- AlterTable
ALTER TABLE "DocLink" ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "reason" TEXT,
ADD COLUMN     "recommended" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Reply_docLinkId_idx" ON "Reply"("docLinkId");

-- AddForeignKey
ALTER TABLE "Reply" ADD CONSTRAINT "Reply_docLinkId_fkey" FOREIGN KEY ("docLinkId") REFERENCES "DocLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;

