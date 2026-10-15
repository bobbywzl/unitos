// Breakwork (SPEC.md §32): the structure library and the assistant's
// proposal resolution. tidy drops every dangling reference and keeps a
// block's first place; placeNewBuckets lays new top buckets in columns
// under the ones placed; resolveProposal turns the model's numbered answer
// into a real structure — new ids, block ids, labels kept, reader-drawn
// connections kept, positions kept for the buckets that stay.
// Run: npx tsx scripts/qa/structure-check.ts
import { resolveProposal, structureAnswerSchema } from "@/lib/structure-assist";
import { emptyStructure, joinsOwnBucket, pieceHash, placeNewBuckets, readStructure, tidy, type Structure } from "@/lib/structure";

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
  const out = tidy({
    buckets: [bucket("p"), bucket("q", "p"), bucket("r")],
    pieces: [piece("x", "q"), piece("y", "r")],
    connections: [
      { id: "own", from: { kind: "piece", id: "x" }, to: { kind: "bucket", id: "q" }, label: "", comment: "", byAssistant: true },
      { id: "outer", from: { kind: "bucket", id: "p" }, to: { kind: "piece", id: "x" }, label: "", comment: "", byAssistant: true },
      { id: "other", from: { kind: "piece", id: "x" }, to: { kind: "bucket", id: "r" }, label: "", comment: "", byAssistant: true },
    ],
  });
  check(
    "joinsOwnBucket: a block to its bucket or a bucket around it, not to another",
    out.connections.map((c) => joinsOwnBucket(out, c)),
    [true, true, false],
  );
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
const answer = (structure: unknown) => structureAnswerSchema.parse({ reply: "done", structure });
{
  const { structure, summary } = resolveProposal(
    answer({
      buckets: [
        { id: "keep", title: "Kept bucket", description: "", parent: null, blocks: "2" },
        { id: "new1", title: "Findings", description: "What was found.", parent: null, blocks: "3, 9" },
        { id: "new2", title: "Evidence", description: "", parent: "new1", blocks: [4, "3"] },
      ],
      labels: { "3": "Second" },
      connections: [
        { from: "bucket new1", to: "block 4", label: "inside", comment: "c" },
        { from: "block 4", to: "bucket keep", label: "holds", comment: "c" },
        { id: "old", from: "bucket keep", to: "block 3", label: "moved", comment: "" },
        { from: "bucket nope", to: "block 2", label: "dangling", comment: "" },
      ],
    }),
    current,
    blocks,
  );
  const byTitle = (title: string) => structure.buckets.find((b) => b.title === title)!;
  check("resolveProposal: the kept bucket keeps its id, position, and color", [byTitle("Kept bucket").id, byTitle("Kept bucket").x, byTitle("Kept bucket").color], ["keep", 500, "sage"]);
  check("resolveProposal: new buckets get real ids", structure.buckets.filter((b) => b.id.startsWith("new")).length, 0);
  check("resolveProposal: a bucket inside a new bucket follows it", byTitle("Evidence").parentId, byTitle("Findings").id);
  check("resolveProposal: the new top bucket is placed", byTitle("Findings").y > 0 || byTitle("Findings").x > 0, true);
  check(
    "resolveProposal: ranges become ids, a number with no block drops, a block twice keeps its first place",
    structure.pieces.map((p) => `${p.blockId}@${structure.buckets.find((b) => b.id === p.bucketId)!.title}`).sort(),
    ["b2@Kept bucket", "b3@Findings", "b4@Evidence"],
  );
  check("resolveProposal: a label the model left out is kept from the piece", structure.pieces.find((p) => p.blockId === "b2")?.label, "The reader's label");
  check("resolveProposal: a label asked for lands", structure.pieces.find((p) => p.blockId === "b3")?.label, "Second");
  check("resolveProposal: a new piece carries the hash of its block", structure.pieces.find((p) => p.blockId === "b3")?.hash, pieceHash("Second paragraph."));
  check("resolveProposal: the reader's connection stays", structure.connections.some((c) => c.id === "mine"), true);
  check("resolveProposal: a connection changed by id moves", structure.connections.find((c) => c.id === "old")?.to, { kind: "piece", id: "b3" });
  check("resolveProposal: a new connection is the assistant's", structure.connections.find((c) => c.label === "holds")?.byAssistant, true);
  check("resolveProposal: a dangling connection drops", structure.connections.some((c) => c.label === "dangling"), false);
  check("resolveProposal: a new connection from a block to a bucket around it drops", structure.connections.some((c) => c.label === "inside"), false);
  check("resolveProposal: the summary counts", summary, { bucketsAdded: 2, bucketsRemoved: 0, piecesMoved: 2, connectionsAdded: 1, connectionsRemoved: 0 });
}
{
  const { structure, summary } = resolveProposal(answer({ buckets: [], removeConnections: ["mine"] }), current, blocks);
  check("resolveProposal: a bucket left out is removed and its block unsorted", [structure.buckets.length, structure.pieces.length], [0, 0]);
  check("resolveProposal: removeConnections drops the reader's connection only when named", structure.connections.length, 0);
  check("resolveProposal: the summary says so", summary, { bucketsAdded: 0, bucketsRemoved: 1, piecesMoved: 1, connectionsAdded: 0, connectionsRemoved: 2 });
}
{
  const parsed = structureAnswerSchema.safeParse({ reply: 5, structure: { buckets: [{ id: 1, title: null, blocks: null }] } });
  check("structureAnswerSchema: a near miss still reads", parsed.success, true);
  const talk = structureAnswerSchema.parse({ reply: "Sort by parts or by themes." });
  check("structureAnswerSchema: a talking turn has no structure", talk.structure, null);
}

if (failed > 0) {
  console.log(`${failed} failed`);
  process.exit(1);
}
console.log("all ok");
