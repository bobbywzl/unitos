-- AlterTable
ALTER TABLE "Reply" ADD COLUMN     "resolvedById" TEXT;

-- CreateTable
CREATE TABLE "NotebookEvent" (
    "id" TEXT NOT NULL,
    "notebookId" TEXT NOT NULL,
    "userId" TEXT,
    "kind" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotebookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NotebookEvent_notebookId_createdAt_idx" ON "NotebookEvent"("notebookId", "createdAt");

-- AddForeignKey
ALTER TABLE "NotebookEvent" ADD CONSTRAINT "NotebookEvent_notebookId_fkey" FOREIGN KEY ("notebookId") REFERENCES "Notebook"("id") ON DELETE CASCADE ON UPDATE CASCADE;

