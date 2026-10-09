-- The project a link belonged to before that project was deleted (SPEC.md
-- §13). A deleted project's links keep their rows and replies, but their
-- notebookId goes to null (ON DELETE SET NULL), and a null link shows in
-- every project that holds both documents, other accounts' projects too.
-- The trigger copies the project's id into formerNotebookId before the
-- delete, on every path (the project's Delete, an account reset, a script);
-- reads skip a link that has one. Additive: a new nullable column and a
-- trigger; no existing row changes here.
ALTER TABLE "DocLink" ADD COLUMN IF NOT EXISTS "formerNotebookId" TEXT;
CREATE INDEX IF NOT EXISTS "DocLink_formerNotebookId_idx" ON "DocLink"("formerNotebookId");

CREATE OR REPLACE FUNCTION "doclink_keep_former_notebook"() RETURNS trigger AS $$
BEGIN
  UPDATE "DocLink" SET "formerNotebookId" = OLD."id" WHERE "notebookId" = OLD."id";
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "Notebook_keep_former_doclinks" ON "Notebook";
CREATE TRIGGER "Notebook_keep_former_doclinks"
  BEFORE DELETE ON "Notebook"
  FOR EACH ROW EXECUTE FUNCTION "doclink_keep_former_notebook"();
