-- Slides and sheets (SPEC.md §27): one SLIDE block per slide, SHEET blocks
-- of rows per sheet, and the stored file's format on the document.
ALTER TYPE "BlockType" ADD VALUE IF NOT EXISTS 'SLIDE';
ALTER TYPE "BlockType" ADD VALUE IF NOT EXISTS 'SHEET';
ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "format" TEXT;
