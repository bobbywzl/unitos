-- Kept conversations (SPEC.md §21): one row per account per project per
-- place for the assistant surfaces that keep no note of their own. A new
-- table: no existing row is read, changed, or removed.
CREATE TABLE IF NOT EXISTS "KeptChat" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "notebookId" TEXT NOT NULL,
    "place" TEXT NOT NULL,
    "turns" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KeptChat_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "KeptChat_userId_notebookId_place_key" ON "KeptChat"("userId", "notebookId", "place");
CREATE INDEX IF NOT EXISTS "KeptChat_notebookId_idx" ON "KeptChat"("notebookId");
