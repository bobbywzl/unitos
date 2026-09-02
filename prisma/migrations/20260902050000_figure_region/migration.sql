-- A PDF figure's region on its page (SPEC.md §16): the figure image route
-- crops the page render to it. Null = the whole page, as before.
ALTER TABLE "Block" ADD COLUMN "region" JSONB;
