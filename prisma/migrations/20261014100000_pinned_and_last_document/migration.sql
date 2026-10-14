-- Pinned documents (SPEC.md §6): when a document was pinned to the top of
-- the document list in a project. Null = not pinned, which every existing
-- row is: the list shows as before. Additive: no row changes.
ALTER TABLE "NotebookDocument" ADD COLUMN IF NOT EXISTS "pinnedAt" TIMESTAMP(3);

-- The last-open document (SPEC.md §6): the document an account last had
-- open in a project, so the project reopens there. A new table: no
-- existing row is read, changed, or removed.
CREATE TABLE IF NOT EXISTS "LastDocument" (
    "userId" TEXT NOT NULL,
    "notebookId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LastDocument_pkey" PRIMARY KEY ("userId", "notebookId")
);
