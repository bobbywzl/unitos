-- Structure (SPEC.md §32): the document's blocks sorted into buckets on a
-- canvas, one structure per document per project, stored on the attachment.
-- Null = no structure yet, which every existing row is: every block unsorted,
-- nothing shown differently. Additive: no row changes.
ALTER TABLE "NotebookDocument" ADD COLUMN IF NOT EXISTS "structure" JSONB;
