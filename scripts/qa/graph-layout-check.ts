// The graph layout check (SPEC.md §13): lays out real projects with graphLayout and reports what a reader
// would see: the layout's extent, the zoom a 1440×600 canvas fits it at, the closest two nodes, how far
// linked documents sit from each other against unlinked ones, the time, and whether two runs agree.
//   DATABASE_URL=… npx tsx scripts/qa/graph-layout-check.ts <notebookId>…
import fs from "node:fs";
import { PrismaClient } from "@prisma/client";
import {
  SPACE_X,
  SPACE_Y,
  graphLayout,
  type LayoutEdge,
} from "@/components/graph/graph-layout";

const db = new PrismaClient();
async function main() {
  let failed = false;
  for (const notebookId of process.argv.slice(2)) {
    const docs = await db.notebookDocument.findMany({
      where: { notebookId },
      orderBy: { document: { createdAt: "asc" } },
      select: { documentId: true },
    });
    const ids = docs.map((d) => d.documentId);
    const links = await db.docLink.findMany({
      where: { fromDocumentId: { in: ids }, toDocumentId: { in: ids } },
      select: { fromDocumentId: true, toDocumentId: true },
    });
    const edges: LayoutEdge[] = links.map((l) => ({
      a: l.fromDocumentId,
      b: l.toDocumentId,
      weight: 1,
    }));
    const t0 = performance.now();
    const pos = graphLayout(ids, edges);
    const ms = performance.now() - t0;
    const again = graphLayout(ids, edges);
    const stable = ids.every(
      (id) =>
        pos.get(id)!.x === again.get(id)!.x &&
        pos.get(id)!.y === again.get(id)!.y,
    );
    const pts = ids.map((id) => pos.get(id)!);
    const w =
      Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x)) + 160;
    const h =
      Math.max(...pts.map((p) => p.y)) - Math.min(...pts.map((p) => p.y)) + 90;
    const zoom = Math.min(1.1, (1440 - 64) / w, (600 - 64) / h);
    let closest = Infinity;
    for (let i = 0; i < pts.length; i++)
      for (let j = i + 1; j < pts.length; j++)
        closest = Math.min(
          closest,
          Math.sqrt(
            ((pts[i].x - pts[j].x) / SPACE_X) ** 2 +
              ((pts[i].y - pts[j].y) / SPACE_Y) ** 2,
          ),
        );
    const dist = (a: string, b: string) =>
      Math.hypot(pos.get(a)!.x - pos.get(b)!.x, pos.get(a)!.y - pos.get(b)!.y);
    const pairs = edges.filter((e) => e.a !== e.b);
    const linked = pairs.length
      ? pairs.reduce((s, e) => s + dist(e.a, e.b), 0) / pairs.length
      : 0;
    let all = 0;
    let n = 0;
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++) {
        all += dist(ids[i], ids[j]);
        n++;
      }
    const report = {
      notebookId,
      documents: ids.length,
      links: links.length,
      ms: +ms.toFixed(1),
      extent: [Math.round(w), Math.round(h)],
      fitZoom1440x600: +zoom.toFixed(2),
      closestPairInNodeRooms: +closest.toFixed(2),
      meanLinkedDistance: Math.round(linked),
      meanAnyDistance: n ? Math.round(all / n) : 0,
      stable,
    };
    console.log(JSON.stringify(report));
    if (process.env.SVG) {
      // A picture of the layout: dots, label boxes, and a line per link.
      const x0 = Math.min(...pts.map((p) => p.x)) - 120;
      const y0 = Math.min(...pts.map((p) => p.y)) - 80;
      const lines = edges
        .filter((e) => e.a !== e.b)
        .map(
          (e) =>
            `<line x1="${pos.get(e.a)!.x - x0}" y1="${pos.get(e.a)!.y - y0}" x2="${pos.get(e.b)!.x - x0}" y2="${pos.get(e.b)!.y - y0}" stroke="#c96" stroke-width="2"/>`,
        );
      const dots = ids.map((id) => {
        const p = pos.get(id)!;
        return `<circle cx="${p.x - x0}" cy="${p.y - y0}" r="10" fill="#6a8"/><rect x="${p.x - x0 - 72}" y="${p.y - y0 + 14}" width="144" height="34" fill="none" stroke="#aaa"/>`;
      });
      fs.writeFileSync(
        `${process.env.SVG}/layout-${notebookId}.svg`,
        `<svg xmlns="http://www.w3.org/2000/svg" width="${w + 240}" height="${h + 160}" style="background:#fff">${lines.join("")}${dots.join("")}</svg>`,
      );
    }
    if (!stable || closest < 0.99) failed = true;
  }
  await db.$disconnect();
  process.exit(failed ? 1 : 0);
}
void main();
