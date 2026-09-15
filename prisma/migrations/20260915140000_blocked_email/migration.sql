-- The block list (SPEC.md §2): one row per blocked email. A blocked email
-- cannot sign in; blocking deletes the account's sessions.
CREATE TABLE IF NOT EXISTS "BlockedEmail" (
  "email" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BlockedEmail_pkey" PRIMARY KEY ("email")
);
