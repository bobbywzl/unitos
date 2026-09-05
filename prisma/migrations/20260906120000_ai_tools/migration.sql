-- AlterEnum
ALTER TYPE "DerivationType" ADD VALUE 'ASK';
ALTER TYPE "DerivationType" ADD VALUE 'COMPARE';
ALTER TYPE "DerivationType" ADD VALUE 'ANALYZE';
ALTER TYPE "DerivationType" ADD VALUE 'VOICE';

-- CreateTable
CREATE TABLE "BlockTranslation" (
    "id" TEXT NOT NULL,
    "blockId" TEXT NOT NULL,
    "lang" TEXT NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BlockTranslation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BlockTranslation_blockId_lang_key" ON "BlockTranslation"("blockId", "lang");
