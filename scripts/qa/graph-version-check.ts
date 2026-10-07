// COST4-07: the graph's version key (lib/graph/version.ts) against the body
// it stands for. For each project: the key is stable when nothing changes;
// after each change below, whenever the body's hash moves the key moves too
// (never a stale 304); and the key's time against graphData's.
// Every change is made on a copy and undone at once. Run on your own copy:
//   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/<copy> npx tsx scripts/qa/graph-version-check.ts [notebookId...]
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { LOCAL_USER } from "@/lib/auth";
import { db } from "@/lib/db";
import { graphData } from "@/lib/graph/data";
import { graphVersionKey } from "@/lib/graph/version";

const sha = (s: string) => createHash("sha1").update(s).digest("base64url");
let pass = 0;
const ok = (cond: boolean, name: string) => {
  assert.ok(cond, name);
  pass++;
  console.log(`PASS ${name}`);
};

async function timed<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const t = performance.now();
  const v = await fn();
  return [v, performance.now() - t];
}

async function main() {
  const ids = process.argv.slice(2);
  const notebooks = ids.length
    ? await db.notebook.findMany({ where: { id: { in: ids } } })
    : await db.notebook.findMany({ where: { docLinks: { some: {} } }, take: 3, orderBy: { createdAt: "asc" } });
  for (const nb of notebooks) {
    // Sign-in off: the local reader, who has no row.
    const row = await db.user.findUnique({ where: { id: nb.userId } });
    const viewer = row ?? LOCAL_USER;
    const state = async () => {
      const text = JSON.stringify(await graphData(nb.id, viewer));
      return { key: await graphVersionKey(nb.id, viewer), body: sha(text), text };
    };
    const base = await state();
    ok((await graphVersionKey(nb.id, viewer)) === base.key, `${nb.title}: the key is stable`);
    ok((await graphVersionKey(nb.id, viewer, { provenance: true })) !== base.key, `${nb.title}: ?provenance has its own key`);
    const keyMs: number[] = [];
    const bodyMs: number[] = [];
    for (let i = 0; i < 5; i++) {
      keyMs.push((await timed(() => graphVersionKey(nb.id, viewer)))[1]);
      bodyMs.push((await timed(async () => JSON.stringify(await graphData(nb.id, viewer))))[1]);
    }
    const med = (a: number[]) => Math.round([...a].sort((x, y) => x - y)[2]);
    console.log(`TIME ${nb.title}: key ${med(keyMs)} ms, graphData + stringify ${med(bodyMs)} ms (median of 5)`);

    const docs = await db.notebookDocument.findMany({ where: { notebookId: nb.id }, select: { documentId: true } });
    const docIds = docs.map((d) => d.documentId);
    const link = await db.docLink.findFirst({
      where: { fromDocumentId: { in: docIds }, toDocumentId: { in: docIds }, OR: [{ notebookId: nb.id }, { notebookId: null, formerNotebookId: null }], hiddenIn: { none: { notebookId: nb.id } } },
    });
    const changes: [string, () => Promise<() => Promise<unknown>>][] = [
      [
        "a document renamed",
        async () => {
          const d = (await db.document.findUnique({ where: { id: docIds[0] } }))!;
          await db.document.update({ where: { id: d.id }, data: { title: `${d.title} (v)` } });
          return () => db.document.update({ where: { id: d.id }, data: { title: d.title } });
        },
      ],
      [
        "a block added",
        async () => {
          const max = await db.block.aggregate({ where: { documentId: docIds[0] }, _max: { order: true } });
          const b = await db.block.create({ data: { documentId: docIds[0], order: (max._max.order ?? 0) + 1, type: "PARAGRAPH", text: "graph-version-check" } });
          return () => db.block.delete({ where: { id: b.id } });
        },
      ],
      [
        "a block's text edited (no graph field)",
        async () => {
          const b = (await db.block.findFirst({ where: { documentId: docIds[0] } }))!;
          await db.block.update({ where: { id: b.id }, data: { text: `${b.text} ` } });
          return () => db.block.update({ where: { id: b.id }, data: { text: b.text } });
        },
      ],
    ];
    if (link) {
      changes.push(
        [
          "a link's reason edited",
          async () => {
            await db.docLink.update({ where: { id: link.id }, data: { reason: `${link.reason ?? ""} (v)` } });
            return () => db.docLink.update({ where: { id: link.id }, data: { reason: link.reason } });
          },
        ],
        [
          "a link accepted or turned recommended",
          async () => {
            await db.docLink.update({ where: { id: link.id }, data: { recommended: !link.recommended } });
            return () => db.docLink.update({ where: { id: link.id }, data: { recommended: link.recommended } });
          },
        ],
        [
          "a reply on a link",
          async () => {
            const r = await db.reply.create({ data: { docLinkId: link.id, userId: viewer.id, content: "graph-version-check" } });
            return () => db.reply.delete({ where: { id: r.id } });
          },
        ],
        [
          "a link hidden in the project",
          async () => {
            await db.docLinkHidden.create({ data: { docLinkId: link.id, notebookId: nb.id, userId: viewer.id } });
            return () => db.docLinkHidden.delete({ where: { docLinkId_notebookId: { docLinkId: link.id, notebookId: nb.id } } });
          },
        ],
      );
    }
    const maker = link?.createdById ? await db.user.findUnique({ where: { id: link.createdById } }) : null;
    if (link && maker) {
      changes.push([
        "the link's maker renamed",
        async () => {
          await db.user.update({ where: { id: maker.id }, data: { name: `${maker.name} (v)` } });
          return () => db.user.update({ where: { id: maker.id }, data: { name: maker.name } });
        },
      ]);
    }
    if (row) {
      changes.push(
        [
          "a Recommend links run",
          async () => {
            const r = await db.linkScanRun.create({ data: { userId: viewer.id, notebookId: nb.id } });
            return () => db.linkScanRun.delete({ where: { id: r.id } });
          },
        ],
      );
    }
    for (const [name, change] of changes) {
      const undo = await change();
      try {
        const after = await state();
        const bodyMoved = after.body !== base.body;
        if (bodyMoved && after.key === base.key) {
          let i = 0;
          while (after.text[i] === base.text[i]) i++;
          console.log(`DIFF at ${i}: ${base.text.slice(i - 120, i + 80)}\n  now: ${after.text.slice(i - 120, i + 80)}`);
        }
        ok(!bodyMoved || after.key !== base.key, `${nb.title}: ${name}: body ${bodyMoved ? "moved" : "same"}, key ${after.key !== base.key ? "moved" : "same"}`);
      } finally {
        await undo();
      }
      ok((await graphVersionKey(nb.id, viewer)) === base.key, `${nb.title}: ${name} undone: the key is back`);
    }
  }
  console.log(`${pass} pass, ALL PASS`);
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
