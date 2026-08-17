-- Parser version stamp: documents parsed by an older pipeline re-parse automatically.
ALTER TABLE "Document" ADD COLUMN "parserVersion" INTEGER NOT NULL DEFAULT 0;
