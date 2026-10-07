// notesOnGraph (lib/graph/notes.ts): counts per document, pairs per note,
// the section filter, and old data (a note with no documentId still counts
// through its sources). Run: npx tsx scripts/qa/graph-notes-check.ts
import assert from "node:assert/strict";
import { notesOnGraph, pairKey } from "@/lib/graph/notes";
import type { NoteView, SectionView } from "@/lib/types";

const note = (id: string, documentId: string | null, sources: string[], status: "ACCEPTED" | "PENDING" = "ACCEPTED", updatedAt = "2026-01-01T00:00:00Z"): NoteView => ({
  id,
  content: `note ${id}`,
  gist: null,
  status,
  derivationType: null,
  pinned: false,
  order: 0,
  createdById: "u",
  updatedAt,
  documentId,
  sources: sources.map((d, i) => ({ id: `${id}-s${i}`, documentId: d, documentTitle: d, quotedText: "q", orphaned: false })),
  replies: [],
});
const section = (id: string, notes: NoteView[], children: SectionView[] = []): SectionView => ({
  id,
  title: id,
  order: 0,
  parentId: null,
  notes,
  children,
});

const sections = [
  section("claims", [
    note("cop", "A", ["A", "B"], "ACCEPTED", "2026-01-03T00:00:00Z"),
    note("savings", "C", ["C", "C", "E"]),
    note("training", "E", ["E", "D"], "PENDING"),
  ]),
  section("open", [note("installer", "D", ["D", "A"]), note("project", null, [])], [
    section("sub", [note("legacy", null, ["B", "C"])]),
  ]),
];
const all = notesOnGraph(sections, ["A", "B", "C", "D", "E"]);
assert.equal(all.byDocument.get("A")?.accepted, 2);
assert.equal(all.byDocument.get("E")?.accepted, 1);
assert.equal(all.byDocument.get("E")?.pending, 1);
assert.equal(all.notes.length, 5, "the project note with no document is not on the graph");
assert.equal(all.notes[0].note.id, "cop", "newest edit first");
assert.deepEqual(all.byPair.get(pairKey("C", "E"))?.map((g) => g.note.id), ["savings"]);
assert.deepEqual(all.byPair.get(pairKey("B", "C"))?.map((g) => g.note.id), ["legacy"], "a note with documentId null joins by its sources");
assert.equal(all.byPair.has(pairKey("C", "C")), false, "two sources in one document make no pair");
assert.equal(all.notes.find((g) => g.note.id === "legacy")?.sectionTitle, "open / sub");

const open = notesOnGraph(sections, ["A", "B", "C", "D", "E"], "open");
assert.deepEqual(open.notes.map((g) => g.note.id).sort(), ["installer", "legacy"], "a section's subsections are in its filter");
assert.equal(open.byDocument.get("A")?.accepted, 1);
assert.equal(open.byDocument.has("E"), false);

const cut = notesOnGraph(sections, ["A", "C"]);
assert.equal(cut.byPair.size, 0, "a document off the graph joins nothing");
console.log("graph-notes-check: all pass");
