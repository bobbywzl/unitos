-- CreateTable
CREATE TABLE "EmailConfirmation" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailConfirmation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmailConfirmation_tokenHash_key" ON "EmailConfirmation"("tokenHash");

-- CreateIndex
CREATE INDEX "EmailConfirmation_email_idx" ON "EmailConfirmation"("email");
