-- A link removed from one project while its row stays (SPEC.md §13): a
-- Remove or Dismiss on a link that holds another account's reply, or that
-- another account's project shows, hides it in the remover's projects
-- instead of deleting the row, so no reply is deleted and no other project
-- loses the link. Additive: a new table; no existing row changes here. The
-- cascade runs from a deleted link to its hide rows only, never onto user
-- content.
CREATE TABLE IF NOT EXISTS "DocLinkHidden" (
    "docLinkId" TEXT NOT NULL,
    "notebookId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DocLinkHidden_pkey" PRIMARY KEY ("docLinkId","notebookId")
);
CREATE INDEX IF NOT EXISTS "DocLinkHidden_notebookId_idx" ON "DocLinkHidden"("notebookId");
DO $$ BEGIN
  ALTER TABLE "DocLinkHidden" ADD CONSTRAINT "DocLinkHidden_docLinkId_fkey"
    FOREIGN KEY ("docLinkId") REFERENCES "DocLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
