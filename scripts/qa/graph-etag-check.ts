// The coverage and part-titles routes answer 304 when nothing changed (COST5-09, SPEC.md §13), and Find on
// Chinese text returns the same rows by LIKE (COST5-02). Against a dev server with sign-in off, on a COPY of
// the database:
//   BASE=http://localhost:3164 DATABASE_URL=postgresql://postgres:postgres@localhost:5432/<copy> \
//     npx tsx scripts/qa/graph-etag-check.ts "<project title>" ["<project title>" …]
// Per project: the first GET is a 200 with an ETag; the same GET with If-None-Match is a 304 with no body;
// a ReadingPosition row this check adds for one document (the coverage's "opened") changes the coverage's
// ETag and answers 200, and the part titles stay a 304; the row is deleted at the end. Find: the route's
// documents and counts for a Chinese query equal the ILIKE query's in SQL. Refuses "dissect".
import { PrismaClient } from "@prisma/client";

const BASE = process.env.BASE ?? "http://localhost:3164";
const url = new URL(process.env.DATABASE_URL ?? "");
const dbName = url.pathname.replace(/^\//, "");
if (!["localhost", "127.0.0.1"].includes(url.hostname) || dbName === "dissect" || !dbName) {
  console.error(`Refusing: ${url.hostname}/${dbName} is not a local database copy.`);
  process.exit(1);
}
const titles = process.argv.slice(2);
async function main() {
const db = new PrismaClient();
const client = {
  query: async <T,>(sql: string, params: unknown[] = []) => ({ rows: await db.$queryRawUnsafe<T[]>(sql, ...params) }),
  end: () => db.$disconnect(),
};
let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}
async function get(path: string, etag?: string | null) {
  const t = performance.now();
  const res = await fetch(`${BASE}${path}`, { headers: etag ? { "If-None-Match": etag } : {} });
  const body = await res.text();
  return { status: res.status, etag: res.headers.get("etag"), bytes: body.length, ms: Math.round(performance.now() - t), body };
}

for (const title of titles) {
  const { rows } = await client.query<{ id: string }>(`SELECT id FROM "Notebook" WHERE title = $1`, [title]);
  if (rows.length === 0) {
    check(`project "${title}" exists`, false);
    continue;
  }
  const id = rows[0].id;
  console.log(`\n== ${title}`);
  for (const path of [`/api/notebooks/${id}/graph/coverage`, `/api/notebooks/${id}/outline?parts=titles`]) {
    await get(path); // compile and warm
    const a = await get(path);
    check(`${path.split("/").slice(4).join("/")}: 200 with an ETag`, a.status === 200 && !!a.etag, `${a.bytes} bytes, ${a.ms} ms`);
    const b = await get(path, a.etag);
    check("…the same GET with If-None-Match is a 304 with no body", b.status === 304 && b.bytes === 0, `${b.ms} ms`);
    const w = await get(path, `W/${a.etag}`);
    check("…a weak If-None-Match is a 304 too", w.status === 304);
  }
  // A change the coverage reads: this account opened one more document.
  const cov = await get(`/api/notebooks/${id}/graph/coverage`);
  const titlesA = await get(`/api/notebooks/${id}/outline?parts=titles`);
  const unopened = Object.entries((JSON.parse(cov.body) as { documents: Record<string, { opened: boolean }> }).documents)
    .filter(([, c]) => !c.opened)
    .map(([d]) => ({ d }))
    .slice(0, 1);
  if (unopened.length > 0) {
    const doc = unopened[0].d;
    const { rows: blk } = await client.query<{ id: string }>(`SELECT id FROM "Block" WHERE "documentId" = $1 ORDER BY "order" LIMIT 1`, [doc]);
    await client.query(`INSERT INTO "ReadingPosition" ("userId", "documentId", "blockId", "offset", "height", "at") VALUES ('user-1', $1, $2, 0, 0, now()) RETURNING 1`, [doc, blk[0].id]);
    try {
      const after = await get(`/api/notebooks/${id}/graph/coverage`, cov.etag);
      check("coverage: a document opened since answers 200 with a new ETag", after.status === 200 && after.etag !== cov.etag);
      const t2 = await get(`/api/notebooks/${id}/outline?parts=titles`, titlesA.etag);
      check("…and the part titles, which do not read it, stay a 304", t2.status === 304);
    } finally {
      await client.query(`DELETE FROM "ReadingPosition" WHERE "userId" = 'user-1' AND "documentId" = $1 RETURNING 1`, [doc]);
    }
  }
  // Find on Chinese text: the route's documents and counts against the ILIKE rows in SQL.
  for (const q of ["意志", "同情", "叔本华"]) {
    const f = await get(`/api/notebooks/${id}/find?q=${encodeURIComponent(q)}`);
    const found = new Map((JSON.parse(f.body) as { documents: { id: string; count: number }[] }).documents.map((d) => [d.id, d.count]));
    const { rows: ref } = await client.query<{ d: string; n: number }>(
      `SELECT b."documentId" AS d, count(*)::int AS n FROM "Block" b JOIN "NotebookDocument" nd ON nd."documentId" = b."documentId"
       WHERE nd."notebookId" = $1 AND b.text ILIKE $2 GROUP BY 1`,
      [id, `%${q}%`],
    );
    const same = ref.length === found.size && ref.every((r) => found.get(r.d) === r.n);
    const times: number[] = [];
    for (let i = 0; i < 5; i++) times.push((await get(`/api/notebooks/${id}/find?q=${encodeURIComponent(q)}`)).ms);
    times.sort((x, y) => x - y);
    check(`find "${q}": the same documents and counts as ILIKE`, same, `${found.size} documents, ${ref.reduce((n, r) => n + r.n, 0)} passages, median ${times[2]} ms`);
  }
}
await client.end();
console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
}
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
