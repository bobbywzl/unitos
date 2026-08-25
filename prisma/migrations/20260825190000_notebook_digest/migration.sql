-- The digest replaces embedding search: the assistant reads the corpus whole.
ALTER TABLE "Note" DROP COLUMN "embedding";

-- CreateTable
CREATE TABLE "NotebookDigest" (
    "id" TEXT NOT NULL,
    "notebookId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "parts" JSONB NOT NULL,
    "counts" JSONB NOT NULL,
    "chars" INTEGER NOT NULL,
    "builtAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotebookDigest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NotebookDigest_notebookId_key" ON "NotebookDigest"("notebookId");

-- CreateIndex
CREATE INDEX "NotebookDigest_userId_idx" ON "NotebookDigest"("userId");

-- AddForeignKey
ALTER TABLE "NotebookDigest" ADD CONSTRAINT "NotebookDigest_notebookId_fkey" FOREIGN KEY ("notebookId") REFERENCES "Notebook"("id") ON DELETE CASCADE ON UPDATE CASCADE;
