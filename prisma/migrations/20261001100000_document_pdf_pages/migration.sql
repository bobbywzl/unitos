-- The pages of a PDF the reader chose at the add (SPEC.md §15, §30):
-- {ranges, count}, the chosen ranges and the PDF's page count. Null = every
-- page, so every document already stored keeps all its pages.
ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "pdfPages" JSONB;
