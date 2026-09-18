-- AlterTable
ALTER TABLE "Note" ADD COLUMN     "sideChatOfId" TEXT,
ADD COLUMN     "sideChatQuote" TEXT;

-- CreateIndex
CREATE INDEX "Note_sideChatOfId_idx" ON "Note"("sideChatOfId");

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_sideChatOfId_fkey" FOREIGN KEY ("sideChatOfId") REFERENCES "Note"("id") ON DELETE CASCADE ON UPDATE CASCADE;
