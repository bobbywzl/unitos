-- Linked Google Drive (SPEC.md §14): the scope Google granted with the stored
-- refresh token. Every grant made before this column asked for drive.file
-- (picked files only); a link made after it asks for what GOOGLE_DRIVE_ACCESS
-- says, and Settings offers Link again for all files while the stored grant
-- reaches picked files only.
ALTER TABLE "User" ADD COLUMN "driveScope" TEXT NOT NULL DEFAULT '';
UPDATE "User" SET "driveScope" = 'https://www.googleapis.com/auth/drive.file' WHERE "driveRefreshToken" <> '';
