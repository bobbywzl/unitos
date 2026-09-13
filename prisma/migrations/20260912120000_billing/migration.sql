-- Billing (SPEC.md §24): the account's Stripe customer and subscription, one
-- Purchase per paid invoice, and the operator settings table whose "billing"
-- row is the switch. No row = billing off: nothing is on after this migration.
--
-- A preview build of an earlier billing branch (2026-09-06) added
-- User.stripeCustomerId to the production database already, and the first
-- run of this migration stopped there, so every statement is guarded: each
-- object is created only when missing, and the migration applies over
-- whatever a partial run left behind.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PurchaseStatus') THEN
    CREATE TYPE "PurchaseStatus" AS ENUM ('PAID', 'REFUNDED');
  END IF;
END $$;

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "stripeCustomerId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "subscriptionId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "subscriptionTier" "Tier";
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "subscriptionEndsAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "Purchase" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tier" "Tier" NOT NULL,
    "stripeInvoiceId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL DEFAULT '',
    "number" TEXT NOT NULL DEFAULT '',
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "status" "PurchaseStatus" NOT NULL DEFAULT 'PAID',
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "hostedInvoiceUrl" TEXT NOT NULL DEFAULT '',
    "invoicePdfUrl" TEXT NOT NULL DEFAULT '',
    "paidAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Purchase_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Purchase_stripeInvoiceId_key" ON "Purchase"("stripeInvoiceId");
CREATE INDEX IF NOT EXISTS "Purchase_userId_paidAt_idx" ON "Purchase"("userId", "paidAt");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Purchase_userId_fkey') THEN
    ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "AppSetting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);
