-- The as-is PDF import format (SPEC.md §16): upload instructions can import a
-- PDF as handwritten pages and keep conversion off. OFF marks that choice, so
-- the strip offers Convert to text instead of auto-starting a run.
ALTER TYPE "ConversionStatus" ADD VALUE 'OFF';

-- Linked Google Drive (SPEC.md §14): the refresh token from the drive.file
-- code flow. '' = not linked.
ALTER TABLE "User" ADD COLUMN "driveRefreshToken" TEXT NOT NULL DEFAULT '';
