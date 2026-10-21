-- A provider's balance as read at one moment (SPEC.md §7, lib/provider-bills.ts):
-- Moonshot has no spend API, so the admin usage page reads its spend as the
-- balance's falls between snapshots. A new table, no foreign keys. Additive:
-- no existing row changes.
CREATE TABLE IF NOT EXISTS "ProviderBalance" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "availableUsd" DOUBLE PRECISION NOT NULL,
    "voucherUsd" DOUBLE PRECISION NOT NULL,
    "cashUsd" DOUBLE PRECISION NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderBalance_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ProviderBalance_provider_at_idx" ON "ProviderBalance"("provider", "at");
