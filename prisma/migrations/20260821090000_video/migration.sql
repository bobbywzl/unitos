-- Video documents (SPEC.md §11): a video is a document, its transcript is
-- blocks with times, a video anchor is a time range plus an optional drawn region.
ALTER TYPE "BlockType" ADD VALUE 'VIDEO';
ALTER TYPE "BlockType" ADD VALUE 'TRANSCRIPT';

ALTER TYPE "DerivationType" ADD VALUE 'FIND';

CREATE TYPE "TranscriptStatus" AS ENUM ('NONE', 'PENDING', 'READY', 'FAILED');

ALTER TABLE "Block" ADD COLUMN "startTime" DOUBLE PRECISION,
ADD COLUMN "endTime" DOUBLE PRECISION;

ALTER TABLE "Source" ADD COLUMN "startTime" DOUBLE PRECISION,
ADD COLUMN "endTime" DOUBLE PRECISION,
ADD COLUMN "region" JSONB;

CREATE TABLE "VideoAsset" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "chunkSize" INTEGER NOT NULL,
    "duration" DOUBLE PRECISION,
    "width" INTEGER,
    "height" INTEGER,
    "transcriptStatus" "TranscriptStatus" NOT NULL DEFAULT 'NONE',
    "transcriptError" TEXT,
    "transcriptStartedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VideoAsset_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VideoChunk" (
    "id" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,

    CONSTRAINT "VideoChunk_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VideoAsset_documentId_key" ON "VideoAsset"("documentId");

CREATE UNIQUE INDEX "VideoChunk_videoId_index_key" ON "VideoChunk"("videoId", "index");

ALTER TABLE "VideoAsset" ADD CONSTRAINT "VideoAsset_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VideoChunk" ADD CONSTRAINT "VideoChunk_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "VideoAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
