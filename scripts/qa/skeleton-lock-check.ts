// The skeleton build lock (REV4-03, SPEC.md §22). On a COPY of the database, with a mock model that answers
// slowly (scripts/qa/mock-kimi.mjs with MOCK_KIMI_DELAY_MS=25000 on its own port):
//   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/<copy> DIRECT_URL=$DATABASE_URL \
//   MOONSHOT_API_KEY=mock MOONSHOT_BASE_URL=http://localhost:3189/v1 \
//     npx tsx scripts/qa/skeleton-lock-check.ts <documentId>
// Checks: a young lock left by a dead run holds a command at most a few seconds, and the command reads without
// the skeleton; a lock not refreshed for SKELETON_STALE_MS is taken over and the skeleton built; a build
// refreshes its lock while it runs; Stop on the only command waiting stops the build and frees the lock.
// It sets the document's skeleton to null and puts the original back at the end. Refuses "dissect".
import { PrismaClient, Prisma } from "@prisma/client";
import { SKELETON_HEARTBEAT_MS, SKELETON_STALE_MS, SKELETON_WAIT_MS } from "../../src/lib/derive/config";
import { ensureSkeleton, refreshSkeleton } from "../../src/lib/graph/skeleton";

const url = new URL(process.env.DATABASE_URL ?? "");
const dbName = url.pathname.replace(/^\//, "");
if (!["localhost", "127.0.0.1"].includes(url.hostname) || dbName === "dissect" || !dbName) {
  console.error(`Refusing: ${url.hostname}/${dbName} is not a local database copy.`);
  process.exit(1);
}
const D = process.argv[2];
if (!D) {
  console.error("Name a document id.");
  process.exit(1);
}
const db = new PrismaClient();
let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const row = () => db.document.findUniqueOrThrow({ where: { id: D }, select: { skeleton: true, skeletonStartedAt: true } });
const docOf = async () => {
  const d = await db.document.findUniqueOrThrow({
    where: { id: D },
    select: { id: true, skeleton: true, blocks: { orderBy: { order: "asc" }, select: { id: true, type: true, text: true } } },
  });
  return d;
};
const reset = (startedAt: Date | null) =>
  db.document.update({ where: { id: D }, data: { skeleton: Prisma.DbNull, skeletonStartedAt: startedAt } });

async function main() {
  const original = await row();
  try {
    // 1. A young lock a dead run left: the command waits SKELETON_WAIT_MS at most and reads first words.
    await reset(new Date());
    let t = Date.now();
    const s1 = await ensureSkeleton(await docOf(), null);
    const waited = Date.now() - t;
    check(`a young dead lock holds a command ${SKELETON_WAIT_MS / 1000} s at most`, waited < SKELETON_WAIT_MS + 2_000, `${waited} ms`);
    check("…and the command reads first words (no gist)", s1.gist === "" && s1.lines.length > 0);

    // 2. A lock not refreshed for SKELETON_STALE_MS: taken over, built, cleared.
    await reset(new Date(Date.now() - SKELETON_STALE_MS - 5_000));
    t = Date.now();
    const s2 = await ensureSkeleton(await docOf(), null);
    const after2 = await row();
    check("a dead lock is taken over and the skeleton built", s2.gist !== "" && after2.skeleton !== null, `${Date.now() - t} ms`);
    check("…and the lock is cleared", after2.skeletonStartedAt === null);

    // 3. A build refreshes its lock while it runs (the warm: no signal).
    await reset(null);
    const warm = refreshSkeleton(D, null, { force: true });
    await sleep(1_500);
    const firstStamp = (await row()).skeletonStartedAt;
    await sleep(SKELETON_HEARTBEAT_MS + 2_000);
    const laterStamp = (await row()).skeletonStartedAt;
    check(
      "a running build refreshes its lock",
      firstStamp !== null && laterStamp !== null && laterStamp.getTime() > firstStamp.getTime(),
      `${firstStamp?.toISOString()} → ${laterStamp?.toISOString()}`,
    );
    // A command meanwhile, in this process, joins the build and waits for it.
    t = Date.now();
    const joined = await ensureSkeleton(await docOf(), null);
    check("a command in the same process joins the running build", joined.gist !== "", `${Date.now() - t} ms`);
    await warm;
    check("the warm's build cleared its lock", (await row()).skeletonStartedAt === null);

    // 4. Stop: the only waiter aborts, the build's model calls stop, the lock is freed.
    await reset(null);
    const stop = new AbortController();
    t = Date.now();
    const cmd = ensureSkeleton(await docOf(), null, stop.signal).then(
      () => "answered",
      () => "aborted",
    );
    await sleep(2_000);
    stop.abort();
    check("Stop ends the command", (await cmd) === "aborted");
    let freed = false;
    for (let i = 0; i < 20 && !freed; i++) {
      await sleep(250);
      freed = (await row()).skeletonStartedAt === null;
    }
    check("Stop stops the build and frees its lock at once (no 25 s model call left running)", freed, `${Date.now() - t} ms`);
    check("…and stores no skeleton", (await row()).skeleton === null);
  } finally {
    await db.document.update({
      where: { id: D },
      data: { skeleton: (original.skeleton ?? Prisma.DbNull) as Prisma.InputJsonValue, skeletonStartedAt: null },
    });
    await db.$disconnect();
  }
  console.log(failed === 0 ? "\nall checks pass" : `\n${failed} check(s) failed`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
