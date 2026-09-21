-- The account's active time (lib/active-time.ts) and when the billing ask last
-- opened (SPEC.md §24).
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "activeSeconds" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "billingAskedAt" TIMESTAMP(3);
