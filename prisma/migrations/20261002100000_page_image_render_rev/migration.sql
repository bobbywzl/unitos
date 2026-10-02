-- The page renderer that drew a stored page image (SPEC.md §16). Null =
-- the renderer before 2026-10-02, which drew a scan's JBIG2, CCITT, and
-- JPEG 2000 images white: the page image route draws such a page again on
-- its next request and keeps the stored image until the new one is in.
-- Additive: every row keeps its bytes.
ALTER TABLE "PageImage" ADD COLUMN IF NOT EXISTS "renderRev" INTEGER;
