-- Repair: a preview build of the tiers-and-billing branch ran that branch's
-- migration (20260906140000_tiers_billing) against the production database
-- and dropped User.premium, which the code on main reads on every request.
-- Put the column back, carrying an account's tier over where the branch's
-- migration set one. Sorted before 20260906140000_tiers_billing, so a fresh
-- database applies this as a no-op first and the branch's own migration
-- still drops the column after it.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "premium" BOOLEAN NOT NULL DEFAULT false;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'User' AND column_name = 'tier'
  ) THEN
    UPDATE "User" SET "premium" = true WHERE "tier"::text <> 'FREE';
  END IF;
END $$;
