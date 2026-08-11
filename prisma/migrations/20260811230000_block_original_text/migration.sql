-- AlterTable
ALTER TABLE "Block" ADD COLUMN     "originalText" TEXT;

-- Backfill: blocks already edited get their original from the earliest TEXT_EDIT.
UPDATE "Block" b
SET "originalText" = e."before"
FROM (
  SELECT DISTINCT ON ("blockId") "blockId", "before"
  FROM "BlockEdit"
  WHERE "kind" = 'TEXT_EDIT' AND "blockId" IS NOT NULL AND "before" IS NOT NULL
  ORDER BY "blockId", "createdAt" ASC
) e
WHERE b."id" = e."blockId";
