-- DISTILL derivation: question → the quotes that answer it, with captions,
-- stored on the attachment (SPEC.md §4). EXTRACT stays in the enum for legacy notes.
ALTER TYPE "DerivationType" ADD VALUE 'DISTILL';

-- AlterTable
ALTER TABLE "NotebookDocument" ADD COLUMN "distillations" JSONB;
