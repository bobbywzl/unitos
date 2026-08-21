-- YouTube videos as video documents (SPEC.md §11): kind YOUTUBE plays through
-- the YouTube IFrame player and stores no bytes, so the byte columns go nullable.
CREATE TYPE "VideoKind" AS ENUM ('UPLOAD', 'YOUTUBE');

ALTER TABLE "VideoAsset" ADD COLUMN "kind" "VideoKind" NOT NULL DEFAULT 'UPLOAD',
ADD COLUMN "youtubeId" TEXT,
ALTER COLUMN "mimeType" DROP NOT NULL,
ALTER COLUMN "size" DROP NOT NULL,
ALTER COLUMN "chunkSize" DROP NOT NULL;

CREATE UNIQUE INDEX "VideoAsset_youtubeId_key" ON "VideoAsset"("youtubeId");
