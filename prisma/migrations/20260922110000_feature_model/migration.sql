-- The model per feature (lib/feature-models.ts): the id the admin set for
-- one feature on the admin page. No row = the constant in lib/derive/config.ts.
CREATE TABLE "FeatureModel" (
    "feature" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeatureModel_pkey" PRIMARY KEY ("feature")
);
