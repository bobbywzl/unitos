-- Block.search: the full-text index of a block's text for Stitch's targeted
-- path (STITCH_INDEX, SPEC.md §22; lib/graph/search.ts). A generated column:
-- Postgres writes it with every insert and update of "text", so it is never
-- stale and no code path has to remember it. Every CJK character is spaced
-- to a token of its own, so a Chinese command finds a block by a phrase of
-- two characters (the ranker's bigram, lib/graph/rank.ts). Additive: no row
-- is changed, dropped, or rewritten in meaning; the table is rewritten once
-- to hold the column, under an AccessExclusiveLock on "Block" for the whole
-- rewrite and the index build: measured 2.3 s at 20,343 blocks and 6.1 s at
-- 53,744 (Postgres 16, a local copy; round 10 REV10-06, COST10-06). Every
-- Block read and write waits for the lock: a reader opening a document and
-- a note being saved wait those seconds; no write is lost (0 of 420 under a
-- concurrent writer). Deploy in a quiet hour.
ALTER TABLE "Block" ADD COLUMN "search" tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', regexp_replace("text", '([぀-ヿ㐀-䶿一-鿿가-힯])', ' \1 ', 'g'))) STORED;
CREATE INDEX "Block_search_idx" ON "Block" USING GIN ("search");
