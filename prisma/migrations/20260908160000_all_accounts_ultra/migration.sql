-- Every current account is Unitos Ultra (TIERS.md, 2026-09-08): the tier is
-- set and the trial's end cleared, so nothing gates. New accounts still start
-- on the Premium trial; the operator grants them from the admin accounts page.
UPDATE "User" SET "tier" = 'ULTRA', "trialEndsAt" = NULL;
