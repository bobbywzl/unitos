-- The onboarding funnel: one row per step a visitor reaches on the way from
-- the sign-in page to a subscription (lib/funnel.ts).
CREATE TABLE IF NOT EXISTS "FunnelEvent" (
  "id" TEXT NOT NULL,
  "visitorId" TEXT,
  "userId" TEXT,
  "step" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FunnelEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "FunnelEvent_createdAt_idx" ON "FunnelEvent"("createdAt");
CREATE INDEX IF NOT EXISTS "FunnelEvent_visitorId_createdAt_idx" ON "FunnelEvent"("visitorId", "createdAt");
CREATE INDEX IF NOT EXISTS "FunnelEvent_userId_createdAt_idx" ON "FunnelEvent"("userId", "createdAt");
