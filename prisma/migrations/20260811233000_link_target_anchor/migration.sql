-- AlterTable
ALTER TABLE "DocLink" ADD COLUMN     "toBlockId" TEXT;
ALTER TABLE "DocLink" ADD COLUMN     "toStartOffset" INTEGER;
ALTER TABLE "DocLink" ADD COLUMN     "toEndOffset" INTEGER;
ALTER TABLE "DocLink" ADD COLUMN     "toQuotedText" TEXT;
ALTER TABLE "DocLink" ADD COLUMN     "toPrefix" TEXT;
ALTER TABLE "DocLink" ADD COLUMN     "toSuffix" TEXT;
