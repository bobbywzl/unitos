-- A resolved comment (SPEC.md §29): the account that resolved it; null =
-- open. It paints no mark and lists under Resolved in the Annotations tab.
ALTER TABLE "Note" ADD COLUMN IF NOT EXISTS "resolvedById" TEXT;
