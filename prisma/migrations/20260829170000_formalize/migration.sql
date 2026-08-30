-- FORMALIZE derivation: a video or audio transcript rewritten as a formal
-- article (stored on the attachment) or as bullet-point notes (PENDING notes).
ALTER TYPE "DerivationType" ADD VALUE 'FORMALIZE';

-- AlterTable
ALTER TABLE "NotebookDocument" ADD COLUMN "formalized" JSONB;
