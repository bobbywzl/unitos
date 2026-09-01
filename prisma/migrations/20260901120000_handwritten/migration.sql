-- Handwritten documents (SPEC.md §14): Import PDF classifies each PDF — a
-- computer-text article parses to text blocks as before; rough handwritten
-- notes and drawings become a handwritten document whose PAGE blocks render
-- the PDF pages. Conversion turns the pages into text blocks.
ALTER TYPE "BlockType" ADD VALUE 'PAGE';

CREATE TYPE "ConversionStatus" AS ENUM ('NONE', 'PENDING', 'READY', 'FAILED');

ALTER TABLE "Document" ADD COLUMN "handwritten" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "conversionStatus" "ConversionStatus" NOT NULL DEFAULT 'NONE',
ADD COLUMN "conversionError" TEXT,
ADD COLUMN "conversionStartedAt" TIMESTAMP(3);
