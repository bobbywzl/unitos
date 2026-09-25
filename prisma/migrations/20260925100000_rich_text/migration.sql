-- A blank document's rich text, its revision, and its page setup (SPEC.md §29).
ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "richText" JSONB;
ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "richTextRev" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "pageSetup" JSONB;
