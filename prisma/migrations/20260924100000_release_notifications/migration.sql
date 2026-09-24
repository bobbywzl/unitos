-- Release notifications (SPEC.md §18): one row per release per language,
-- written by the dashboard after a deploy.
ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "releaseKey" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Notification_releaseKey_key" ON "Notification"("releaseKey");
