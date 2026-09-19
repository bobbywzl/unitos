-- The Distill tool (KEYPOINTS: the article as bullet points) is removed.
-- Notes added from its points stay, as manually written notes; the stored
-- points and the tool's ratings go.
UPDATE "Note" SET "derivationType" = NULL WHERE "derivationType" = 'KEYPOINTS';
DELETE FROM "ToolRating" WHERE "tool" = 'keypoints';
ALTER TABLE "NotebookDocument" DROP COLUMN "keypoints";

-- Postgres drops no single value from an enum: the enum is rebuilt without it.
CREATE TYPE "DerivationType_new" AS ENUM ('EXPLAIN', 'SIMPLIFY', 'SALIENCE', 'EXTRACT', 'SUMMARIZE', 'SYNTHESIS', 'FIND', 'DISTILL', 'FORMALIZE', 'ASK', 'COMPARE', 'ANALYZE', 'VOICE', 'VISUALIZE');
ALTER TABLE "Note" ALTER COLUMN "derivationType" TYPE "DerivationType_new" USING ("derivationType"::text::"DerivationType_new");
ALTER TYPE "DerivationType" RENAME TO "DerivationType_old";
ALTER TYPE "DerivationType_new" RENAME TO "DerivationType";
DROP TYPE "DerivationType_old";
