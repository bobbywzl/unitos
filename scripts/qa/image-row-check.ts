// The image row and the paragraph index (SPEC.md §29, CLAUDE.md rule zero),
// with no editor and no database: an import with a figure object and an
// image derives its Block rows; the figure goes into an image row with the
// image, and the rows are derived again. The figure keeps its block id, its
// words, its page, and its media, every row stays, and the order is the
// page's reading order, the left item first. The save's sanitizer keeps the
// row as it is and leaves a document without one byte-for-byte as it was;
// the figures' check, the block routes, and a row of the wrong size never
// leave a row holding a paragraph or lose an item.
// Run: npx tsx scripts/qa/image-row-check.ts
import { deriveBlocks, type DerivedBlock } from "@/lib/docs/blocks";
import { mergeRichText } from "@/lib/docs/merge";
import { findBlock, insertAfterBlock, paragraphNode, removeBlock } from "@/lib/docs/ops";
import { sanitizeRichText, stableJson, withDocumentFigures, withImageRows, type RichNode } from "@/lib/docs/schema";

let failures = 0;
const check = (ok: boolean, what: string, detail?: unknown) => {
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok && detail !== undefined) console.log(`     ${JSON.stringify(detail)}`);
};

const text = (words: string): RichNode[] => [{ type: "text", text: words }];
const region = JSON.stringify({ kind: "ellipse", cx: 40, cy: 35, rx: 30, ry: 15 });

// An import of a PDF: a page start in its first paragraph, a figure object
// on page 2 with its caption, an image a person added under it, and words.
const figure: RichNode = {
  type: "figure",
  attrs: { blockId: "dFigure0000000000001", mediaId: "m1", caption: "Figure 1. The encoder and the decoder.", page: 2, region, pageStart: null },
};
const image: RichNode = { type: "image", attrs: { blockId: "dImage00000000000001", src: "/api/images/abc", alt: "A sketch", width: 240, height: 160 } };
const second: RichNode = { type: "image", attrs: { blockId: "dImage00000000000002", src: "/api/images/def", alt: "", width: 200, height: 200 } };
const before: RichNode = {
  type: "doc",
  content: [
    { type: "heading", attrs: { blockId: "dHead000000000000001", level: 1 }, content: text("Attention") },
    { type: "paragraph", attrs: { blockId: "dPara000000000000001" }, content: [{ type: "pageStart", attrs: { page: 2 } }, ...text("The model has two halves.")] },
    figure,
    image,
    { type: "paragraph", attrs: { blockId: "dPara000000000000002" }, content: text("Each half stacks six layers.") },
    second,
    { type: "paragraph", attrs: { blockId: "dPara000000000000003" }, content: text("The end.") },
  ],
};
const row = (items: RichNode[], attrs?: Record<string, unknown>): RichNode => ({ type: "imageRow", ...(attrs ? { attrs } : {}), content: items });
const withRow = (items: RichNode[]): RichNode => ({ ...before, content: [...before.content!.slice(0, 2), row(items), ...before.content!.slice(4)] });

const ids = (blocks: DerivedBlock[]) => blocks.map((b) => b.id);
const same = (a: DerivedBlock | undefined, b: DerivedBlock | undefined) => stableJson(a) === stableJson(b);
const blocksBefore = deriveBlocks(before);
const figureBefore = blocksBefore.find((b) => b.id === figure.attrs!.blockId);
check(figureBefore?.type === "FIGURE" && figureBefore.text === figure.attrs!.caption && figureBefore.page === 2, "the fixture's figure object is a FIGURE row with its caption on page 2", figureBefore);

// 1. The figure joins the image in an image row, the figure on the left.
const after = withRow([figure, image]);
const blocksAfter = deriveBlocks(after);
const figureAfter = blocksAfter.find((b) => b.id === figure.attrs!.blockId);
check(same(figureAfter, figureBefore), "in an image row the figure keeps its block id, its words, its page, its region, and its media", { figureBefore, figureAfter });
check(stableJson(ids(blocksAfter)) === stableJson(ids(blocksBefore)), "no block is dropped and none is added: the same ids in the same order", { before: ids(blocksBefore), after: ids(blocksAfter) });
check(blocksBefore.every((b, i) => same(b, blocksAfter[i])), "every row derives exactly as before");

// 2. The image on the left: the reading order is the row's, left item first.
const leftImage = deriveBlocks(withRow([image, figure]));
const at = (id: unknown) => ids(leftImage).indexOf(String(id));
check(at(image.attrs!.blockId) >= 0 && at(image.attrs!.blockId) + 1 === at(figure.attrs!.blockId), "the left item reads first: the image, then the figure", ids(leftImage));
check(same(leftImage.find((b) => b.id === figure.attrs!.blockId), figureBefore), "on the right the figure still keeps its row as it was");
check(leftImage.length === blocksBefore.length, "no block is dropped with the image on the left");

// 3. The save keeps the row, and a document without one as it was.
const saved = sanitizeRichText(after);
check(saved !== null && stableJson(saved) === stableJson(after), "the save's sanitizer keeps the image row as it is", saved);
check(saved !== null && stableJson(ids(deriveBlocks(saved))) === stableJson(ids(blocksBefore)), "after the save the rows are the same");
const savedBefore = sanitizeRichText(before);
check(savedBefore !== null && stableJson(savedBefore) === stableJson(before), "a document without an image row saves byte-for-byte as it was");
check(withImageRows(before.content!) === before.content, "a document without an image row passes the row check untouched (the same array)");

// 4. The figures' check: a figure whose media is not the document's goes;
// its row is left with the image alone, which is the image again.
const media = new Map([["m1", { caption: figure.attrs!.caption as string, page: 2, region: JSON.parse(region) as unknown }]]);
const checked = withDocumentFigures(after, media);
check(stableJson(checked) === stableJson(after), "the document's own figure keeps its image row through the figures' check");
const stranger = withDocumentFigures(after, new Map());
const top = stranger.content!.map((n) => n.type);
check(
  stableJson(top) === stableJson(["heading", "paragraph", "image", "paragraph", "image", "paragraph"]) && stranger.content![2].attrs?.blockId === image.attrs!.blockId,
  "a figure not the document's goes, and its image row of one is the image again, its id kept",
  top,
);
const lone = withDocumentFigures(withRow([figure, { ...figure, attrs: { ...figure.attrs, blockId: "dFigure0000000000002" } }]), new Map());
check(!stableJson(lone).includes("imageRow") && lone.content!.every((n) => n.type !== "imageRow"), "an image row whose figures all go goes too, never holding a paragraph", lone.content!.map((n) => n.type));

// 5. A row of the wrong size, or holding anything else, stands as its items.
const p = paragraphNode("Inside", "dPara000000000000009");
const cases: [string, RichNode, string[]][] = [
  ["one item", row([image]), ["image"]],
  ["no item", row([]), []],
  ["five items", row([image, second, figure, { ...image, attrs: { ...image.attrs, blockId: "dImage00000000000003" } }, { ...image, attrs: { ...image.attrs, blockId: "dImage00000000000004" } }]), ["image", "image", "figure", "image", "image"]],
  ["a paragraph inside", row([image, p]), ["image", "paragraph"]],
];
for (const [what, node, want] of cases) {
  const out = withImageRows([node]);
  check(stableJson(out.map((n) => n.type)) === stableJson(want), `an image row with ${what} stands as its items`, out.map((n) => n.type));
}
const marked = withImageRows([{ ...row([image]), marks: [{ type: "insertion", attrs: { id: "u1.1700000000000" } }] }]);
check(marked[0]?.marks?.[0]?.type === "insertion", "an image row added as a suggestion hands its mark to the item it leaves", marked);
const crafted = sanitizeRichText({ type: "doc", content: [row([image, p]), row([])] });
check(
  crafted !== null && stableJson(crafted.content!.map((n) => n.type)) === stableJson(["image", "paragraph"]),
  "the sanitizer unwraps a crafted image row and keeps everything it held",
  crafted?.content?.map((n) => n.type),
);

// 6. The block routes: a block after an item goes after the row; an item
// removed leaves its partner standing alone.
check(findBlock(after, String(figure.attrs!.blockId)) !== null, "a figure in an image row is found by its block id");
const inserted = insertAfterBlock(after, String(figure.attrs!.blockId), paragraphNode("New words.", "dPara000000000000010"));
const rowNode = inserted?.content?.find((n) => n.type === "imageRow");
check(
  rowNode !== undefined && rowNode.content!.length === 2 && rowNode.content!.every((n) => n.type !== "paragraph") && inserted!.content!.indexOf(rowNode) + 1 === inserted!.content!.findIndex((n) => n.attrs?.blockId === "dPara000000000000010"),
  "a paragraph inserted after a figure in an image row goes right after the row",
  inserted?.content?.map((n) => n.type),
);
const removed = removeBlock(after, String(image.attrs!.blockId));
check(
  removed !== null && !removed.content!.some((n) => n.type === "imageRow") && removed.content![2]?.attrs?.blockId === figure.attrs!.blockId,
  "removing the image leaves the figure as a block where the row stood, its id kept",
  removed?.content?.map((n) => n.type),
);

// 7. Two copies met (lib/docs/merge.ts): one tab made the row while another
// changed an item, in either order; every block stays, once.
const resized = { ...image, attrs: { ...image.attrs, width: 120, height: 80 } };
const flat = (doc: RichNode) => ids(deriveBlocks(doc));
const once = (doc: RichNode) => new Set(flat(doc)).size === flat(doc).length;
const editorRowed = mergeRichText(before, after, { ...before, content: before.content!.map((n) => (n === image ? resized : n)) });
check(
  stableJson(flat(editorRowed)) === stableJson(ids(blocksBefore)) && once(editorRowed) && stableJson(editorRowed).includes('"width":120'),
  "the editor made the row while the stored copy resized the image: the row stands with the resized image",
  flat(editorRowed),
);
const storedRowed = mergeRichText(before, { ...before, content: before.content!.map((n) => (n === image ? resized : n)) }, after);
check(
  stableJson(flat(storedRowed)) === stableJson(ids(blocksBefore)) && once(storedRowed) && storedRowed.content!.some((n) => n.type === "imageRow"),
  "the stored copy made the row while the editor resized the image: the row stands, no item lost",
  flat(storedRowed),
);
const third: RichNode = { ...second };
const rowedApart = mergeRichText(
  before,
  withRow([figure, image]),
  { ...before, content: [...before.content!.slice(0, 2), row([figure, second]), image, before.content![4], before.content![6]] },
);
check(
  new Set(flat(rowedApart)).size === new Set(ids(blocksBefore)).size && once(rowedApart),
  "two tabs put the figure in two different rows: every block stays, once",
  { got: flat(rowedApart), third: third.attrs?.blockId },
);
const listed = mergeRichText(
  { type: "doc", content: [paragraphNode("One", "dL1"), paragraphNode("Two", "dL2")] },
  { type: "doc", content: [paragraphNode("One, changed", "dL1"), paragraphNode("Two", "dL2")] },
  { type: "doc", content: [{ type: "bulletList", content: [{ type: "listItem", content: [paragraphNode("One", "dL1")] }, { type: "listItem", content: [paragraphNode("Two", "dL2")] }] }] },
);
check(stableJson(flat(listed).sort()) === stableJson(["dL1", "dL2"]), "a line the other copy put in a list stays too", flat(listed));

if (failures > 0) {
  console.log(`image-row-check: ${failures} failed`);
  process.exit(1);
}
console.log("image-row-check: all passed");
