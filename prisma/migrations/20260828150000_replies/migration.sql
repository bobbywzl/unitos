-- CreateTable
CREATE TABLE "Reply" (
    "id" TEXT NOT NULL,
    "noteId" TEXT,
    "blockEditId" TEXT,
    "userId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Reply_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Reply_noteId_idx" ON "Reply"("noteId");

-- CreateIndex
CREATE INDEX "Reply_blockEditId_idx" ON "Reply"("blockEditId");

-- AddForeignKey
ALTER TABLE "Reply" ADD CONSTRAINT "Reply_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "Note"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reply" ADD CONSTRAINT "Reply_blockEditId_fkey" FOREIGN KEY ("blockEditId") REFERENCES "BlockEdit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

