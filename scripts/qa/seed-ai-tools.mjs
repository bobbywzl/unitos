// QA seed for the AI tools round (SPEC.md §4, §11, §19): adds to one notebook
// (NB) what the tools need — a TABLE and a FIGURE block on the first attached
// document, a transcribed audio document for Ask about a range, and a Chinese
// document for Translate. Prints the ids the UI test reads. Safe to run twice:
// documents are keyed by title.
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const NB = process.env.NB;
if (!NB) throw new Error("NB is required");

// A 2×2 PNG so the figure carries an image the model could read.
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8//8/AwMDEwMDAwMDAwAUEwMBv/6oWQAAAABJRU5ErkJggg==";

async function ensureDocument(title, blocks, extra = {}) {
  const existing = await db.document.findFirst({ where: { title }, include: { blocks: true } });
  if (existing) return existing;
  return db.document.create({
    data: {
      title,
      ...extra,
      blocks: { create: blocks.map((b, i) => ({ order: i, ...b })) },
    },
    include: { blocks: { orderBy: { order: "asc" } } },
  });
}

async function attach(documentId) {
  await db.notebookDocument.upsert({
    where: { notebookId_documentId: { notebookId: NB, documentId } },
    create: { notebookId: NB, documentId },
    update: {},
  });
}

async function main() {
  const attached = await db.notebookDocument.findMany({
    where: { notebookId: NB },
    include: { document: { include: { blocks: { orderBy: { order: "asc" } } } } },
    orderBy: { documentId: "asc" },
  });
  const first = attached.map((a) => a.document).find((d) => d.blocks.some((b) => b.type === "PARAGRAPH"));
  if (!first) throw new Error("the notebook has no text document");
  let table = first.blocks.find((b) => b.type === "TABLE");
  if (!table) {
    table = await db.block.create({
      data: {
        documentId: first.id,
        order: first.blocks.length,
        type: "TABLE",
        text: "Item\tCount\nPages\t2\nNotes\t42",
        html: "<table><tr><th>Item</th><th>Count</th></tr><tr><td>Pages</td><td>2</td></tr><tr><td>Notes</td><td>42</td></tr></table>",
      },
    });
  }
  let figure = first.blocks.find((b) => b.type === "FIGURE");
  if (!figure) {
    figure = await db.block.create({
      data: {
        documentId: first.id,
        order: first.blocks.length + 1,
        type: "FIGURE",
        text: "Figure 1. Share of queries by engine, 2014 to 2017 (QA)",
        html: `<figure><img src="${PNG}" alt="Share of queries"><figcaption>Figure 1. Share of queries by engine, 2014 to 2017 (QA)</figcaption></figure>`,
      },
    });
  }

  const audio = await ensureDocument(
    "Defaults podcast episode (QA audio)",
    [
      { type: "VIDEO", text: "" },
      { type: "TRANSCRIPT", text: "Welcome back. Today we ask whether Google's dominance is bought or earned.", startTime: 0, endTime: 6 },
      { type: "TRANSCRIPT", text: "Google pays about forty two billion dollars a year to be the default search engine.", startTime: 6, endTime: 12 },
      { type: "TRANSCRIPT", text: "The Alice study found Microsoft would have to pay more than all of Bing's revenue to match that.", startTime: 12, endTime: 19 },
      { type: "TRANSCRIPT", text: "When Firefox switched to Yahoo, two thirds of the volume went back to Google anyway.", startTime: 19, endTime: 25 },
      { type: "TRANSCRIPT", text: "So the floor is earned and the top ten to twenty points are bought.", startTime: 25, endTime: 31 },
    ],
  );
  if (!(await db.videoAsset.findUnique({ where: { documentId: audio.id } }))) {
    await db.videoAsset.create({
      data: {
        documentId: audio.id,
        kind: "UPLOAD",
        mimeType: "audio/mpeg",
        size: 0,
        chunkSize: 1,
        duration: 31,
        transcriptStatus: "READY",
      },
    });
  }
  await attach(audio.id);

  const chinese = await ensureDocument("搜索市场入门（QA 中文）", [
    { type: "HEADING", html: "<h1>", text: "搜索市场入门" },
    { type: "PARAGRAPH", text: "通用搜索是双重规模经济：质量随查询量增长，变现随广告主密度增长。新进入者同时面对这两道鸿沟，因此 2010 年以后没有任何通用搜索引擎在主要市场跨过百分之五的份额。" },
    { type: "PARAGRAPH", text: "分发是第三道护城河。浏览器和手机上的默认设置决定第一次查询，习惯决定其余的查询。默认付费的经济账只对已经接近前沿变现水平的竞标者成立。" },
    { type: "LIST", text: "- 默认付费：每年约 420 亿美元\n- 单次查询变现差距：约三倍" },
  ]);
  await attach(chinese.id);

  console.log(
    JSON.stringify({
      DOC: first.id,
      TABLE: table.id,
      FIGURE: figure.id,
      FIGURE_TEXT: figure.text,
      AUDIO: audio.id,
      ZH: chinese.id,
    }),
  );
}

main().finally(() => db.$disconnect());
