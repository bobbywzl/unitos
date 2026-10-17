// notesOnGraph (lib/graph/notes.ts): counts per document, pairs per note,
// the section filter, and old data (a note with no documentId still counts
// through its sources). Run: npx tsx scripts/qa/graph-notes-check.ts
import assert from "node:assert/strict";
import { notesOnGraph, notesOnLink, pairKey } from "@/lib/graph/notes";
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
// The notes on a link (WALK3-03): a source at each end, by quote or by block.
const quoted = (id: string, quotes: [string, string][]): NoteView => ({
  ...note(id, null, []),
  sources: quotes.map(([d, q], i) => ({ id: `${id}-s${i}`, documentId: d, documentTitle: d, quotedText: q, orphaned: false })),
});
const linkSections = [
  section("links", [
    quoted("both", [["A", "the flute"], ["B", "pessimism  is"]]), // Note on this link: the ends' own quotes
    quoted("wider", [["A", "he played the flute every evening"], ["B", "pessimism"]]), // holds the from end's quote
    quoted("block", [["A", "every evening"], ["B", "a mood"]]), // both in the ends' blocks
    quoted("one", [["A", "the flute"]]), // one end only
    quoted("elsewhere", [["A", "the flute"], ["B", "an unrelated chapter"]]),
  ]),
];
const linkView = notesOnGraph(linkSections, ["A", "B"]);
const pairNotes = linkView.byPair.get(pairKey("A", "B")) ?? [];
const link = {
  fromDocumentId: "A",
  toDocumentId: "B",
  quotedText: "the flute",
  toQuotedText: "pessimism is",
  fromBlockText: "Each night he played the flute every evening, alone.",
  toBlockText: "For him pessimism is a mood, not a doctrine.",
};
assert.deepEqual(
  notesOnLink(pairNotes, link).map((g) => g.note.id).sort(),
  ["block", "both", "wider"],
  "a note quoting both passages is on the link; one end or another passage is not",
);
assert.deepEqual(
  notesOnLink(pairNotes, { ...link, toQuotedText: null, toBlockText: null }).map((g) => g.note.id).sort(),
  ["block", "both", "elsewhere", "wider"],
  "a document-level end takes any quote of its document",
);
console.log("graph-notes-check: all pass");
