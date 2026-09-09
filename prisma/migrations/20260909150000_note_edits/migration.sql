-- CreateTable
CREATE TABLE "NoteEdit" (
    "id" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "userId" TEXT,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NoteEdit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NoteEdit_noteId_createdAt_idx" ON "NoteEdit"("noteId", "createdAt");

-- AddForeignKey
ALTER TABLE "NoteEdit" ADD CONSTRAINT "NoteEdit_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "Note"("id") ON DELETE CASCADE ON UPDATE CASCADE;
