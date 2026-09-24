-- Folders (SPEC.md §6): a named group of a project's documents. A folder can
-- hold folders. Each attachment names the folder it sits in; null = the
-- project itself. Deleting a folder moves what it holds up one level (the
-- route does it); the database's own fallback clears the attachment's folder.
CREATE TABLE IF NOT EXISTS "DocumentFolder" (
  "id" TEXT NOT NULL,
  "notebookId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "parentId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DocumentFolder_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "DocumentFolder_notebookId_idx" ON "DocumentFolder"("notebookId");
CREATE INDEX IF NOT EXISTS "DocumentFolder_parentId_idx" ON "DocumentFolder"("parentId");
ALTER TABLE "DocumentFolder" DROP CONSTRAINT IF EXISTS "DocumentFolder_notebookId_fkey";
ALTER TABLE "DocumentFolder" ADD CONSTRAINT "DocumentFolder_notebookId_fkey"
  FOREIGN KEY ("notebookId") REFERENCES "Notebook"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DocumentFolder" DROP CONSTRAINT IF EXISTS "DocumentFolder_parentId_fkey";
ALTER TABLE "DocumentFolder" ADD CONSTRAINT "DocumentFolder_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "DocumentFolder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NotebookDocument" ADD COLUMN IF NOT EXISTS "folderId" TEXT;
CREATE INDEX IF NOT EXISTS "NotebookDocument_folderId_idx" ON "NotebookDocument"("folderId");
ALTER TABLE "NotebookDocument" DROP CONSTRAINT IF EXISTS "NotebookDocument_folderId_fkey";
ALTER TABLE "NotebookDocument" ADD CONSTRAINT "NotebookDocument_folderId_fkey"
  FOREIGN KEY ("folderId") REFERENCES "DocumentFolder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
