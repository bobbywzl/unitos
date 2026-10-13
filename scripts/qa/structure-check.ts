// Structure (SPEC.md §32): the structure library and the assistant's
// proposal resolution. tidy drops every dangling reference and keeps a
// block's first place; placeNewBuckets lays new top buckets in columns
// under the ones placed; resolveProposal turns the model's numbered answer
// into a real structure — new ids, block ids, labels kept, reader-drawn
// connections kept, positions kept for the buckets that stay.
// Run: npx tsx scripts/qa/structure-check.ts
import { resolveProposal } from "@/lib/structure-assist";
import { emptyStructure, pieceHash, placeNewBuckets, readStructure, tidy, type Structure } from "@/lib/structure";

let failed = 0;
const check = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `\n     got  ${JSON.stringify(got)}\n     want ${JSON.stringify(want)}`}`);
};

const bucket = (id: string, parentId: string | null = null, x = 0, y = 0) => ({
  id,
  title: id,
  description: "",
  parentId,
  x,
  y,
  color: null,
  order: 0,
});
const piece = (blockId: string, bucketId: string, label = "") => ({ blockId, hash: "h", preview: blockId, bucketId, order: 0, label });

// ── tidy ──────────────────────────────────────────────────────────────────
{
  const out = tidy({
    buckets: [bucket("a"), bucket("b", "gone"), bucket("c", "c"), bucket("a")],
    pieces: [piece("x", "a"), piece("x", "b"), piece("y", "nowhere")],
    connections: [
      { id: "c1", from: { kind: "bucket", id: "a" }, to: { kind: "piece", id: "x" }, label: "", comment: "", byAssistant: false },
      { id: "c2", from: { kind: "bucket", id: "a" }, to: { kind: "piece", id: "y" }, label: "", comment: "", byAssistant: false },
      { id: "c3", from: { kind: "bucket", id: "a" }, to: { kind: "bucket", id: "a" }, label: "", comment: "", byAssistant: false },
    ],
  });
  check("tidy: a bucket whose parent is gone goes to the canvas", out.buckets.find((b) => b.id === "b")?.parentId, null);
  check("tidy: a bucket inside itself goes to the canvas", out.buckets.find((b) => b.id === "c")?.parentId, null);
  check("tidy: a bucket listed twice is one", out.buckets.filter((b) => b.id === "a").length, 1);
  check("tidy: a block placed twice keeps its first place", out.pieces.map((p) => `${p.blockId}@${p.bucketId}`), ["x@a"]);
  check("tidy: a connection to a gone end drops, a loop drops", out.connections.map((c) => c.id), ["c1"]);
}
{
  const out = tidy({ buckets: [bucket("a", "b"), bucket("b", "a")], pieces: [], connections: [] });
  check("tidy: a cycle of parents breaks", out.buckets.some((b) => b.parentId === null), true);
}

// ── readStructure ─────────────────────────────────────────────────────────
check("readStructure: null is an empty structure", readStructure(null), emptyStructure());
check("readStructure: another version is an empty structure", readStructure({ v: 9, buckets: [bucket("a")] }).buckets, []);
check(
  "readStructure: a row keeps its rev",
  readStructure({ v: 1, rev: 7, buckets: [bucket("a")], pieces: [], connections: [] }).rev,
  7,
);

// ── placeNewBuckets ───────────────────────────────────────────────────────
{
  const out = placeNewBuckets(
    { buckets: [bucket("old", null, 0, 0), bucket("n1"), bucket("n2"), bucket("n3"), bucket("n4"), bucket("sub", "n1")], pieces: [], connections: [] },
    new Set(["old"]),
  );
  const at = (id: string) => out.buckets.find((b) => b.id === id)!;
  check("placeNewBuckets: the placed bucket stays", [at("old").x, at("old").y], [0, 0]);
  check("placeNewBuckets: new buckets go under it", at("n1").y > 0, true);
  check("placeNewBuckets: three columns", [at("n1").x, at("n2").x > at("n1").x, at("n3").x > at("n2").x], [0, true, true]);
  // n1 holds a bucket, so its column is the tallest: the fourth goes to the shortest, n2's.
  check("placeNewBuckets: the next bucket goes to the shortest column", at("n4").x, at("n2").x);
  check("placeNewBuckets: a bucket inside another is not placed", [at("sub").x, at("sub").y], [0, 0]);
}

// ── resolveProposal ───────────────────────────────────────────────────────
const blocks = new Map([
  [1, { id: "b1", type: "HEADING", text: "Title" }],
  [2, { id: "b2", type: "PARAGRAPH", text: "First paragraph of the document." }],
  [3, { id: "b3", type: "PARAGRAPH", text: "Second paragraph." }],
  [4, { id: "b4", type: "PARAGRAPH", text: "Third paragraph." }],
]);
const current: Structure = {
  v: 1,
  rev: 3,
  buckets: [{ ...bucket("keep", null, 500, 120), title: "Kept bucket", color: "sage" }],
  pieces: [{ blockId: "b2", hash: pieceHash("First paragraph of the document."), preview: "First…", bucketId: "keep", order: 0, label: "The reader's label" }],
  connections: [
    { id: "mine", from: { kind: "bucket", id: "keep" }, to: { kind: "piece", id: "b2" }, label: "mine", comment: "", byAssistant: false },
    { id: "old", from: { kind: "bucket", id: "keep" }, to: { kind: "piece", id: "b2" }, label: "old", comment: "", byAssistant: true },
  ],
};
{
  const { structure, summary } = resolveProposal(
    {
      reply: "done",
      structure: {
        buckets: [
          { id: "keep", title: "Kept bucket", description: "", parentId: null },
          { id: "new1", title: "Findings", description: "What was found.", parentId: null },
          { id: "new2", title: "Evidence", description: "", parentId: "new1" },
        ],
        pieces: [
          { n: 2, bucketId: "keep" },
          { n: 3, bucketId: "new1", label: "Second" },
          { n: 4, bucketId: "new2", label: "Third" },
          { n: 9, bucketId: "new1", label: "No such block" },
          { n: 3, bucketId: "new2", label: "Twice" },
        ],
        connections: [
          { from: { kind: "bucket", id: "new1" }, to: { kind: "piece", id: "4" }, label: "holds", comment: "c" },
          { id: "old", from: { kind: "bucket", id: "keep" }, to: { kind: "piece", id: "3" }, label: "moved", comment: "" },
          { from: { kind: "bucket", id: "nope" }, to: { kind: "piece", id: "2" }, label: "dangling", comment: "" },
        ],
        removeConnectionIds: [],
      },
    },
    current,
    blocks,
  );
  const byTitle = (title: string) => structure.buckets.find((b) => b.title === title)!;
  check("resolveProposal: the kept bucket keeps its id, position, and color", [byTitle("Kept bucket").id, byTitle("Kept bucket").x, byTitle("Kept bucket").color], ["keep", 500, "sage"]);
  check("resolveProposal: new buckets get real ids", structure.buckets.filter((b) => b.id.startsWith("new")).length, 0);
  check("resolveProposal: a bucket inside a new bucket follows it", byTitle("Evidence").parentId, byTitle("Findings").id);
  check("resolveProposal: the new top bucket is placed", byTitle("Findings").y > 0 || byTitle("Findings").x > 0, true);
  check(
    "resolveProposal: block numbers become ids, a number with no block drops, a block twice keeps its first place",
    structure.pieces.map((p) => p.blockId).sort(),
    ["b2", "b3", "b4"],
  );
  check("resolveProposal: a label the model left out is kept from the piece", structure.pieces.find((p) => p.blockId === "b2")?.label, "The reader's label");
  check("resolveProposal: a new piece carries the hash of its block", structure.pieces.find((p) => p.blockId === "b3")?.hash, pieceHash("Second paragraph."));
  check("resolveProposal: the reader's connection stays", structure.connections.some((c) => c.id === "mine"), true);
  check("resolveProposal: a connection changed by id moves", structure.connections.find((c) => c.id === "old")?.to, { kind: "piece", id: "b3" });
  check("resolveProposal: a new connection is the assistant's", structure.connections.find((c) => c.label === "holds")?.byAssistant, true);
  check("resolveProposal: a dangling connection drops", structure.connections.some((c) => c.label === "dangling"), false);
  check("resolveProposal: the summary counts", summary, { bucketsAdded: 2, bucketsRemoved: 0, piecesMoved: 2, connectionsAdded: 1, connectionsRemoved: 0 });
}
{
  const { structure, summary } = resolveProposal(
    { reply: "", structure: { buckets: [], pieces: [], connections: [], removeConnectionIds: ["mine"] } },
    current,
    blocks,
  );
  check("resolveProposal: a bucket left out is removed and its block unsorted", [structure.buckets.length, structure.pieces.length], [0, 0]);
  check("resolveProposal: removeConnectionIds drops the reader's connection only when named", structure.connections.length, 0);
  check("resolveProposal: the summary says so", summary, { bucketsAdded: 0, bucketsRemoved: 1, piecesMoved: 1, connectionsAdded: 0, connectionsRemoved: 2 });
}

if (failed > 0) {
  console.log(`${failed} failed`);
  process.exit(1);
}
console.log("all ok");
