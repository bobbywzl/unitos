-- Billing (SPEC.md §24): the account's Stripe customer and subscription, one
-- Purchase per paid invoice, and the operator settings table whose "billing"
-- row is the switch. No row = billing off: nothing is on after this migration.
CREATE TYPE "PurchaseStatus" AS ENUM ('PAID', 'REFUNDED');

ALTER TABLE "User" ADD COLUMN "stripeCustomerId" TEXT NOT NULL DEFAULT '',
ADD COLUMN "subscriptionId" TEXT NOT NULL DEFAULT '',
ADD COLUMN "subscriptionTier" "Tier",
ADD COLUMN "subscriptionEndsAt" TIMESTAMP(3);

CREATE TABLE "Purchase" (
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

CREATE UNIQUE INDEX "Purchase_stripeInvoiceId_key" ON "Purchase"("stripeInvoiceId");
CREATE INDEX "Purchase_userId_paidAt_idx" ON "Purchase"("userId", "paidAt");

ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);
