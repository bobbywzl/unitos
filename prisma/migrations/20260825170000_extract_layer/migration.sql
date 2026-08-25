-- EXTRACT layer: origin phrase → the passages that reveal its topic, with
-- labels that jump back to the origin (SPEC.md §4). The enum value exists.
ALTER TABLE "NotebookDocument" ADD COLUMN "extractions" JSONB;
