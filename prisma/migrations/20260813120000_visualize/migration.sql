-- VISUALIZE derivation: SVG visualization of a selection, stored on the note.
ALTER TYPE "DerivationType" ADD VALUE 'VISUALIZE';
ALTER TABLE "Note" ADD COLUMN "svg" TEXT;
