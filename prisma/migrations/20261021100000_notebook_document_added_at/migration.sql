-- When a document was added to a project (SPEC.md §6, Sort by Added). A new
-- nullable column: rows that exist keep NULL, since the time they were added
-- was never kept, and read as before (the document's own creation time). The
-- default is set after the column is added, so it fills only rows inserted
-- from now on, and no existing row is given a made-up time.
ALTER TABLE "NotebookDocument" ADD COLUMN IF NOT EXISTS "addedAt" TIMESTAMP(3);
ALTER TABLE "NotebookDocument" ALTER COLUMN "addedAt" SET DEFAULT CURRENT_TIMESTAMP;
