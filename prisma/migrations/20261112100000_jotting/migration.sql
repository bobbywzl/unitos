-- Jottings (SPEC.md §33): handwriting drawn with a pen over a document in the
-- reader, one row per stroke. A new table: no existing table, column, or row
-- changes. No foreign key and no cascade: a jotting is the account's own
-- writing and nothing else's removal reaches it. Erasing a stroke sets
-- "erasedAt"; no code path deletes a row.
CREATE TABLE IF NOT EXISTS "Jotting" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "notebookId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "blockId" TEXT NOT NULL,
    "blockOrder" INTEGER NOT NULL,
    "layer" TEXT,
    "color" TEXT NOT NULL,
    "width" DOUBLE PRECISION NOT NULL,
    "aspect" DOUBLE PRECISION NOT NULL,
    "points" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "erasedAt" TIMESTAMP(3),

    CONSTRAINT "Jotting_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Jotting_notebookId_documentId_idx" ON "Jotting"("notebookId", "documentId");
