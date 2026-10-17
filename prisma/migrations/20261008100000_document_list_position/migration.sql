-- A row's place in its list under Sort by Custom order (SPEC.md §6): a
-- document's in its folder (NotebookDocument), a folder's in its parent
-- (DocumentFolder). Null = never placed by a drag, which every existing row
-- is: it lists as before. Additive: no row changes.
ALTER TABLE "NotebookDocument" ADD COLUMN IF NOT EXISTS "position" INTEGER;
ALTER TABLE "DocumentFolder" ADD COLUMN IF NOT EXISTS "position" INTEGER;
