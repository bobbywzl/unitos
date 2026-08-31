-- Note.pinned: the ticker's pin action. Pinning also moves the note to the
-- top of its section; the flag renders the pin marker.
ALTER TABLE "Note" ADD COLUMN "pinned" BOOLEAN NOT NULL DEFAULT false;
