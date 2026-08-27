-- AlterTable
ALTER TABLE "User" ADD COLUMN "passwordHash" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "EmailConfirmation" ADD COLUMN "purpose" TEXT NOT NULL DEFAULT 'signup';
