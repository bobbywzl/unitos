-- AlterTable
ALTER TABLE "VideoAsset" ADD COLUMN "geminiFileUri" TEXT,
                         ADD COLUMN "geminiFileExpiresAt" TIMESTAMP(3);
