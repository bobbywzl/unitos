-- COST5-03: the reasoning tokens of a model call and the pass it is, both
-- nullable: existing rows keep every value and read null in the new columns.
ALTER TABLE "UsageEvent" ADD COLUMN "reasoningTokens" INTEGER;
ALTER TABLE "UsageEvent" ADD COLUMN "pass" TEXT;
