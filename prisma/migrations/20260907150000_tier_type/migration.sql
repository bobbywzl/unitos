-- The Tier type (TIERS.md): Unitos Premium or Unitos Ultra. A preview build
-- of an earlier tiers branch may have created a "Tier" type on the
-- production database already (see 20260906140000_restore_premium), so the
-- type is created only when missing and the two labels are added only when
-- missing. Labels added to an enum cannot be used in the same transaction,
-- so the columns come in the next migration.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'Tier') THEN
    CREATE TYPE "Tier" AS ENUM ('PREMIUM', 'ULTRA');
  END IF;
END $$;
ALTER TYPE "Tier" ADD VALUE IF NOT EXISTS 'PREMIUM';
ALTER TYPE "Tier" ADD VALUE IF NOT EXISTS 'ULTRA';
