-- CreateEnum
CREATE TYPE "CollabRole" AS ENUM ('EDITOR', 'VIEWER');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "color" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "symbol" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "Notebook" ADD COLUMN     "rev" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Note" ADD COLUMN     "createdById" TEXT;

-- AlterTable
ALTER TABLE "BlockEdit" ADD COLUMN     "userId" TEXT;

-- CreateTable
CREATE TABLE "NotebookCollaborator" (
    "id" TEXT NOT NULL,
    "notebookId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "CollabRole" NOT NULL DEFAULT 'EDITOR',
    "addedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotebookCollaborator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotebookPresence" (
    "id" TEXT NOT NULL,
    "notebookId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "documentId" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotebookPresence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NotebookCollaborator_email_idx" ON "NotebookCollaborator"("email");

-- CreateIndex
CREATE UNIQUE INDEX "NotebookCollaborator_notebookId_email_key" ON "NotebookCollaborator"("notebookId", "email");

-- CreateIndex
CREATE INDEX "NotebookPresence_lastSeenAt_idx" ON "NotebookPresence"("lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "NotebookPresence_notebookId_userId_key" ON "NotebookPresence"("notebookId", "userId");

-- AddForeignKey
ALTER TABLE "NotebookCollaborator" ADD CONSTRAINT "NotebookCollaborator_notebookId_fkey" FOREIGN KEY ("notebookId") REFERENCES "Notebook"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotebookPresence" ADD CONSTRAINT "NotebookPresence_notebookId_fkey" FOREIGN KEY ("notebookId") REFERENCES "Notebook"("id") ON DELETE CASCADE ON UPDATE CASCADE;

