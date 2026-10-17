-- The project a link belongs to (SPEC.md §13). Null = a link made before
-- this column: it keeps showing in every project that holds both documents.
-- A deleted project sets its links' column back to null; it never deletes a
-- link or its replies. Additive: no existing row changes here; the backfill
-- script (scripts/backfill-doclink-notebook.mjs) fills the column on request.
ALTER TABLE "DocLink" ADD COLUMN IF NOT EXISTS "notebookId" TEXT;
CREATE INDEX IF NOT EXISTS "DocLink_notebookId_idx" ON "DocLink"("notebookId");
DO $$ BEGIN
  ALTER TABLE "DocLink" ADD CONSTRAINT "DocLink_notebookId_fkey"
    FOREIGN KEY ("notebookId") REFERENCES "Notebook"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
