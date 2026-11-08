// QA seed for Highlight & ask (SPEC.md §16): one handwritten document with one
// page — a drawn page image, its PAGE block, and the stored render — in the
// QA Analyst project seed.mjs makes. Run after seed.mjs:
//   DATABASE_URL=... node scripts/qa/seed-page.mjs
import { createCanvas } from "@napi-rs/canvas";
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
const W = 1000, H = 1300;
const canvas = createCanvas(W, H);
const ctx = canvas.getContext("2d");
ctx.fillStyle = "#fbf8f1"; ctx.fillRect(0, 0, W, H);
ctx.strokeStyle = "#d8d2c4"; ctx.lineWidth = 1;
for (let y = 120; y < H; y += 48) { ctx.beginPath(); ctx.moveTo(60, y); ctx.lineTo(W - 60, y); ctx.stroke(); }
ctx.fillStyle = "#2a2622"; ctx.font = "italic 30px serif";
const lines = ["Lecture 4 - defaults and habit", "Google pays ~$42B a year for the default slot.", "Alice study: Microsoft would need 122% of Bing revenue.", "Firefox 2014: share fell 80% -> 65%, then recovered.", "Q: is the floor earned or bought?", "A: floor earned; top 10-20 points bought.", "E = mc^2  (margin note: check units)", "Default -> habit -> query volume -> quality"];
lines.forEach((l, i) => ctx.fillText(l, 80, 160 + i * 96));
const jpeg = canvas.toBuffer("image/jpeg", 85);
const nb = process.env.QA_NOTEBOOK ?? (await db.notebook.findFirst({ where: { title: "QA Analyst" } }))?.id;
if (!nb) throw new Error("run scripts/qa/seed.mjs first");
const src = await db.document.findFirst({ where: { title: { contains: "Search Market Primer" } } });
if (!src) throw new Error("run scripts/qa/seed.mjs first");
const id = "qa-handwritten-doc";
await db.block.deleteMany({ where: { documentId: id } });
await db.notebookDocument.deleteMany({ where: { documentId: id } });
await db.document.deleteMany({ where: { id } });
const doc = await db.document.create({ data: { id, title: "Handwritten notes (QA)", handwritten: true, sourceType: src.sourceType, status: src.status } });
const block = await db.block.create({ data: { id: "qa-page-1", documentId: doc.id, order: 0, type: "PAGE", text: "Page 1", originalText: "", page: 1 } });
await db.pageImage.create({ data: { blockId: block.id, width: W, height: H, data: jpeg, renderRev: 2 } });
await db.notebookDocument.create({ data: { notebookId: nb, documentId: doc.id } });
console.log("seeded", doc.id, block.id, jpeg.length);
await db.$disconnect();
