-- Recommend links on demand (SPEC.md §13): the scan no longer runs when a
-- document joins a project. One row per press, so an account's runs in a
-- calendar month can be counted against the quota.
CREATE TABLE IF NOT EXISTS "LinkScanRun" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "notebookId" TEXT NOT NULL,
  "linkCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LinkScanRun_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "LinkScanRun_userId_createdAt_idx" ON "LinkScanRun"("userId", "createdAt");
ALTER TABLE "LinkScanRun" DROP CONSTRAINT IF EXISTS "LinkScanRun_userId_fkey";
ALTER TABLE "LinkScanRun" ADD CONSTRAINT "LinkScanRun_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LinkScanRun" DROP CONSTRAINT IF EXISTS "LinkScanRun_notebookId_fkey";
ALTER TABLE "LinkScanRun" ADD CONSTRAINT "LinkScanRun_notebookId_fkey"
  FOREIGN KEY ("notebookId") REFERENCES "Notebook"("id") ON DELETE CASCADE ON UPDATE CASCADE;
