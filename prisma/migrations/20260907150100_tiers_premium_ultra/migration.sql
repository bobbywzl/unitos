-- Two tiers (TIERS.md): every account is Unitos Premium or Unitos Ultra.
-- A new account gets Premium free for two months (User.trialEndsAt); the
-- operator grants a tier for good by clearing trialEndsAt or setting ULTRA.
-- Carries the old flag over: premium = true was a grant (no end date);
-- premium = false is a trial that started when the account did.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "tier" "Tier" NOT NULL DEFAULT 'PREMIUM';
ALTER TABLE "User" ALTER COLUMN "tier" SET DEFAULT 'PREMIUM';
UPDATE "User" SET "tier" = 'PREMIUM' WHERE "tier"::text NOT IN ('PREMIUM', 'ULTRA');
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "trialEndsAt" TIMESTAMP(3);
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'User' AND column_name = 'premium'
  ) THEN
    UPDATE "User"
    SET "trialEndsAt" = CASE
      WHEN "premium" OR "tier" = 'ULTRA' THEN NULL
      ELSE "createdAt" + INTERVAL '2 months'
    END;
    ALTER TABLE "User" DROP COLUMN "premium";
  END IF;
END $$;
