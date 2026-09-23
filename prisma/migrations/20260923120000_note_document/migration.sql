-- The document a note was written in (SPEC.md §6): the notes tray lists the
-- open document's notes, and the notes full page's By document view puts
-- each note under its document. Null = the note belongs to the project as a
-- whole.
ALTER TABLE "Note" ADD COLUMN IF NOT EXISTS "documentId" TEXT;

CREATE INDEX IF NOT EXISTS "Note_documentId_idx" ON "Note"("documentId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Note_documentId_fkey'
  ) THEN
    ALTER TABLE "Note"
      ADD CONSTRAINT "Note_documentId_fkey"
      FOREIGN KEY ("documentId") REFERENCES "Document"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- A note that already cites a document was written in it: its first source's
-- document. A note citing nothing stays with the project.
UPDATE "Note" AS n
SET "documentId" = s."documentId"
FROM (
  SELECT DISTINCT ON ("noteId") "noteId", "documentId"
  FROM "Source"
  ORDER BY "noteId", "id"
) AS s
WHERE s."noteId" = n."id" AND n."documentId" IS NULL;
