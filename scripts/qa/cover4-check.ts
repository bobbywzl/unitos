// Round 4 COVER4 logic: ownCommand (WALK4-14), resolveNoteQuotes (Add to note,
// VIEW4-03), readerLinkNotes (WALK4-05). Read only.
// Run: DATABASE_URL=postgresql://postgres:postgres@localhost:5432/<db> npx tsx scripts/qa/cover4-check.ts
import assert from "node:assert/strict";
import { db } from "@/lib/db";
import { ownCommand } from "@/lib/graph/generated-label";
import { resolveNoteQuotes } from "@/lib/anchors/note-quotes";
import { readerLinkNotes } from "@/lib/graph/reader-link-notes";
import type { LinkOut, NoteView, SectionView } from "@/lib/types";

let pass = 0;
const ok = (cond: boolean, label: string) => {
  assert.ok(cond, label);
  pass++;
  console.log(`ok  ${label}`);
};

const VIEW = "cmuxjmvh7006t7d0bk8xjqaja";

async function main() {
  ok(ownCommand("Find where these documents contradict each other → What do they say together?") === "What do they say together?", "a follow-up's label takes its own command");
  ok(ownCommand("Write one page") === "Write one page", "a first command stays whole");

  const blocks = await db.block.findMany({
    where: { document: { notebooks: { some: { notebookId: VIEW } } }, type: { not: "HEADING" } },
    select: { id: true, documentId: true, text: true },
    orderBy: { order: "asc" },
    take: 400,
  });
  const [a, b] = [blocks.find((x) => x.text.length > 80)!, blocks.find((x) => x.text.length > 80 && x.documentId !== blocks.find((y) => y.text.length > 80)!.documentId)!];
  const quoteA = a.text.slice(10, 60);
  const quoteB = b.text.slice(0, 40);
  const res = await resolveNoteQuotes(VIEW, [
    { documentId: a.documentId, blockId: a.id, quotedText: quoteA },
    { documentId: b.documentId, quotedText: quoteB }, // no block: found across the document
    { documentId: a.documentId, blockId: a.id }, // no words: the block's opening words
    { documentId: a.documentId, blockId: a.id, quotedText: quoteA }, // the same words twice: one source
  ]);
  ok("sources" in res, "the quotes resolve");
  if ("sources" in res) {
    ok(res.sources.length === 3, "a repeated quote is one source");
    ok(res.sources[0].quotedText === quoteA && res.sources[0].startOffset === 10, "a quote re-finds its words in its block");
    ok(res.sources[1].blockId === b.id || res.sources[1].quotedText === quoteB, "a quote with no block is found in its document");
    ok(res.sources[2].startOffset === 0 && res.sources[2].quotedText.length <= 400, "a whole-block quote is the block's opening words, 400 characters at most");
  }
  const lost = await resolveNoteQuotes(VIEW, [
    { documentId: a.documentId, blockId: a.id, quotedText: quoteA },
    { documentId: a.documentId, quotedText: "words that are in no block of this document 9f8e7d" },
  ]);
  ok("unresolved" in lost && lost.unresolved === 1, "a quote that resolves nowhere names its index");
  const other = await db.notebookDocument.findFirst({ where: { notebookId: { not: VIEW }, document: { notebooks: { none: { notebookId: VIEW } } } }, select: { documentId: true } });
  if (other) {
    const outside = await resolveNoteQuotes(VIEW, [{ documentId: other.documentId, quotedText: "the" }]);
    ok("notInProject" in outside, "a document of another project is refused");
  }

  // readerLinkNotes: a note quoting both ends lists on the link; one quoting one end does not.
  const note = (id: string, sources: [string, string][]): NoteView => ({
    id, content: id, gist: null, status: "ACCEPTED", derivationType: null, pinned: false, order: 0, createdById: "u",
    updatedAt: "2026-01-01T00:00:00Z", documentId: null,
    sources: sources.map(([d, q], i) => ({ id: `${id}${i}`, documentId: d, documentTitle: d, quotedText: q, orphaned: false })),
    replies: [],
  });
  const sections: SectionView[] = [{ id: "s", title: "s", order: 0, parentId: null, children: [], notes: [note("both", [["A", "alpha words"], ["B", "beta words"]]), note("one", [["A", "alpha words"]])] }];
  const out: LinkOut = { id: "L", toDocumentId: "B", toTitle: "B", quotedText: "alpha words", targetQuotedText: "beta words", orphaned: false, targetOrphaned: false, detached: false, recommended: false, reason: null, createdById: null, replies: [] };
  const prov: LinkOut = { ...out, id: "P", provenance: true };
  const m = readerLinkNotes(sections, "A", ["A", "B"], [out, prov], []);
  ok(JSON.stringify(m.get("L")) === JSON.stringify(["both"]), "the link lists the note quoting both ends");
  ok(!m.has("P"), "a provenance link lists no notes");
  console.log(`\n${pass} pass`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
