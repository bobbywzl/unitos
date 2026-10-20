-- When an admin last reset the account (lib/account-reset.ts). A reset used to
-- stamp createdAt anew so the account read as new; it now stamps resetAt and
-- createdAt keeps the sign-up date. A new nullable column: every existing row
-- reads NULL (never reset since this column existed) and behaves as before.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "resetAt" TIMESTAMP(3);
