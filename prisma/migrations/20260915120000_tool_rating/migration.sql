-- Tool ratings (SPEC.md §25): the reader's thumb on an AI tool's output,
-- with the input and the output, for the tool quality loop.
CREATE TABLE IF NOT EXISTS "ToolRating" (
  "id" TEXT NOT NULL,
  "userId" TEXT,
  "notebookId" TEXT,
  "documentId" TEXT,
  "noteId" TEXT,
  "tool" TEXT NOT NULL,
  "rating" TEXT NOT NULL,
  "lang" TEXT NOT NULL,
  "input" TEXT NOT NULL,
  "output" TEXT NOT NULL,
  "comment" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ToolRating_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ToolRating_tool_rating_createdAt_idx" ON "ToolRating"("tool", "rating", "createdAt");
CREATE INDEX IF NOT EXISTS "ToolRating_createdAt_idx" ON "ToolRating"("createdAt");
