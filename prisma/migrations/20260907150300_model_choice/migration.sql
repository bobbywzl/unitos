-- The model per role (lib/models.ts): the newest version of each model
-- family, written by the bimonthly model update (/api/cron/models).
CREATE TABLE "ModelChoice" (
    "role" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "previousModelId" TEXT NOT NULL DEFAULT '',
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changedAt" TIMESTAMP(3),
    "note" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "ModelChoice_pkey" PRIMARY KEY ("role")
);
