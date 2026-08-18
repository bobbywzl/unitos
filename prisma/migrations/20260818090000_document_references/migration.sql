-- References: the article's reference list, extracted at ingest ([{id, label, text, url}]).
ALTER TABLE "Document" ADD COLUMN "references" JSONB;
-- Citations: in-text citation spans per block ([{start, end, refId, quotedText}]).
ALTER TABLE "Block" ADD COLUMN "citations" JSONB;
