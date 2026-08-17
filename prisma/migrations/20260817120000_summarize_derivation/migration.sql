-- SUMMARIZE derivation: document-level summary, one per depth (SPEC.md §4).
ALTER TYPE "DerivationType" ADD VALUE 'SUMMARIZE';

-- AlterTable
ALTER TABLE "NotebookDocument" ADD COLUMN "summaries" JSONB;
