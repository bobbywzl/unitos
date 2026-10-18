-- The document an account last had open in a project (SPEC.md §6): a bare
-- project address opens it. A new table, one row per account per project,
-- with no foreign keys. Additive: no existing row changes; a project with no
-- row opens its first document, as before.
CREATE TABLE IF NOT EXISTS "LastDocument" (
    "userId" TEXT NOT NULL,
    "notebookId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LastDocument_pkey" PRIMARY KEY ("userId","notebookId")
);
