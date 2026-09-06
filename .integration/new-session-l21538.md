**Intent:** Restore `User.premium` on the production database, which a preview build of `claude/unitos-premium-stripe-setup-ka04xi` dropped, and stop preview builds from running migrations.

**Files:**
- `prisma/migrations/20260906140000_restore_premium/migration.sql`: adds `premium` back if missing, and sets it from `tier` where the branch's migration created that column. Named to sort before `20260906140000_tiers_billing`, so a fresh database applies it as a no-op and the branch's migration still drops the column after it.
- `scripts/deploy-build.mjs`: `prisma migrate deploy` runs only when `VERCEL_ENV` is `production` or unset. Preview builds share the production database variables, so a migration on a work branch was reaching the production database.

**Decisions:**
- The repair is a migration on main rather than a hand-run SQL fix, so every deploy path and every fresh database stay consistent.
- Preview builds skip migrations instead of using a separate database, because the project has one database and no per-branch database setup.
- When the tiers branch merges, its `_prisma_migrations` row already exists on production, so its migration will not run again there and `premium` will linger as an unused column. That branch should add a migration that copies `premium` into `tier` once more and drops the column with `IF EXISTS`.
