-- The words an anchor covers after a block edit changed them (SPEC.md §5);
-- quotedText stays the words as quoted.
ALTER TABLE "Source" ADD COLUMN "anchoredText" TEXT;
