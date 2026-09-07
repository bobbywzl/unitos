-- Indexes on the read path. Postgres indexes primary and unique keys only, so
-- every lookup by these foreign keys was a table scan: the open document's
-- blocks, the sources anchored in it, the notes of a section, the sections of
-- a project, the projects a document is attached to.
CREATE INDEX IF NOT EXISTS "Block_documentId_order_idx" ON "Block"("documentId", "order");
CREATE INDEX IF NOT EXISTS "Source_documentId_idx" ON "Source"("documentId");
CREATE INDEX IF NOT EXISTS "Source_noteId_idx" ON "Source"("noteId");
CREATE INDEX IF NOT EXISTS "Note_sectionId_idx" ON "Note"("sectionId");
CREATE INDEX IF NOT EXISTS "Section_notebookId_idx" ON "Section"("notebookId");
CREATE INDEX IF NOT EXISTS "NotebookDocument_documentId_idx" ON "NotebookDocument"("documentId");

-- One re-parse of a document at a time: the route stamps the start and
-- clears it when the run ends; a start older than the route's time budget is
-- a dead run.
ALTER TABLE "Document" ADD COLUMN "reparseStartedAt" TIMESTAMP(3);
