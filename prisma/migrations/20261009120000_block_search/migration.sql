-- Block.search: the full-text index of a block's text for Stitch's targeted
-- path (STITCH_INDEX, SPEC.md §22; lib/graph/search.ts). A generated column:
-- Postgres writes it with every insert and update of "text", so it is never
-- stale and no code path has to remember it. Every CJK character is spaced
-- to a token of its own, so a Chinese command finds a block by a phrase of
-- two characters (the ranker's bigram, lib/graph/rank.ts). Additive: no row
-- is changed, dropped, or rewritten in meaning; the table is rewritten once
-- to hold the column (about 1 s per 50,000 blocks).
ALTER TABLE "Block" ADD COLUMN "search" tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', regexp_replace("text", '([぀-ヿ㐀-䶿一-鿿가-힯])', ' \1 ', 'g'))) STORED;
CREATE INDEX "Block_search_idx" ON "Block" USING GIN ("search");
