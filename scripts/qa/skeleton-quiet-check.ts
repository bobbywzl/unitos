// A Stitch command and the skeleton's quiet period (COST5-08, SPEC.md §22). On a COPY of the database, the
// model answered in process (no network):
//   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/<copy> DIRECT_URL=$DATABASE_URL \
//     npx tsx scripts/qa/skeleton-quiet-check.ts
// Checks: a skeleton built under SKELETON_QUIET_MS ago and now stale is read as stored at a command (no model
// call, changed blocks as their first words); past the quiet period a stale skeleton is built at the command; a
// graph open (warmSkeletons) builds nothing under the quiet period and builds past it (COST6-06); a command
// under the quiet period waits for a build already running, here or in another process, at most
// SKELETON_WAIT_MS (REV6-03); under a tenth changed the stored skeleton is read. It makes its own project and document and deletes them at the
// end. Refuses "dissect".
import { PrismaClient, Prisma } from "@prisma/client";
import { SKELETON_QUIET_MS, SKELETON_WAIT_MS } from "../../src/lib/derive/config";
import { buildSkeleton, ensureSkeleton, readSkeleton, refreshSkeleton, skeletonAction, skeletonStale, warmSkeletons, type Skeleton } from "../../src/lib/graph/skeleton";

const url = new URL(process.env.DATABASE_URL ?? "");
const dbName = url.pathname.replace(/^\//, "");
if (!["localhost", "127.0.0.1"].includes(url.hostname) || dbName === "dissect" || !dbName) {
  console.error(`Refusing: ${url.hostname}/${dbName} is not a local database copy.`);
  process.exit(1);
}
process.env.MOONSHOT_API_KEY ??= "mock";
process.env.MOONSHOT_BASE_URL ??= "http://mock.invalid/v1";

// The model, in process: every skeleton window answers a gist naming the build, no lines (each block then
// reads its first words, as the build fills a missing line).
let calls = 0;
let builds = 0;
let slowMs = 0; // the model's delay, for a build a command meets running
const realFetch = globalThis.fetch;
globalThis.fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
  const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!href.includes("/chat/completions")) return realFetch(input, init);
  calls++;
  const content = JSON.stringify({ gist: `build ${builds}`, parts: [], lines: [] });
  if (slowMs) await new Promise((r) => setTimeout(r, slowMs));
  return new Response(
    JSON.stringify({
      id: `q-${calls}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: "mock",
      choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1000, completion_tokens: 50, total_tokens: 1050 },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
};

const db = new PrismaClient();
let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const BLOCKS = 60;
const para = (i: number, edit = 0) => `Paragraph ${i}${edit ? ` edited ${edit}` : ""}. ` + "The will strives without rest, and each satisfaction ends in want. ".repeat(38);

async function main() {
  // A project that reads skeletons: 60 blocks of ~2,500 chars, about 38k estimated tokens.
  const doc = await db.document.create({
    data: { title: "QA COST5 quiet period", blocks: { create: Array.from({ length: BLOCKS }, (_, i) => ({ order: i, type: "PARAGRAPH", text: para(i) })) } },
  });
  const notebook = await db.notebook.create({ data: { title: "QA COST5 quiet period", documents: { create: [{ documentId: doc.id }] } } });
  const load = () =>
    db.document.findUniqueOrThrow({
      where: { id: doc.id },
      select: { id: true, skeleton: true, skeletonStartedAt: true, blocks: { orderBy: { order: "asc" }, select: { id: true, type: true, text: true } } },
    });
  const blockIds = (await load()).blocks.map((b) => b.id);
  let edits = 0;
  // Rewrite a third of the blocks: past the tenth.
  const editThird = async () => {
    edits++;
    for (let i = 0; i < BLOCKS; i += 3) await db.block.update({ where: { id: blockIds[i] }, data: { text: para(i, edits) } });
  };
  const setBuilt = async (agoMs: number) => {
    const d = await load();
    const s = readSkeleton(d.skeleton)!;
    await db.document.update({ where: { id: doc.id }, data: { skeleton: { ...s, built: Date.now() - agoMs } as unknown as Prisma.InputJsonValue } });
  };
  try {
    builds = 1;
    const first = await buildSkeleton(doc.id, null);
    check("the first build stores a skeleton", first !== null && first.gist === "build 1" && typeof first.built === "number");

    // 1. Built two minutes ago, a third rewritten: the command reads the stored skeleton, no model call.
    await setBuilt(2 * 60_000);
    await editThird();
    let d = await load();
    check("a third rewritten is stale", skeletonStale(readSkeleton(d.skeleton), d.blocks));
    check("skeletonAction: defer under the quiet period", skeletonAction(readSkeleton(d.skeleton), d.blocks) === "defer");
    calls = 0;
    const t = Date.now();
    const s1 = await ensureSkeleton(d, null);
    const ms1 = Date.now() - t;
    check("the command makes no model call under the quiet period", calls === 0, `${calls} calls, ${ms1} ms`);
    check("…and reads the stored gist", s1.gist === "build 1");
    const changed = s1.lines.find((l) => l.blockId === blockIds[0]);
    const kept = s1.lines.find((l) => l.blockId === blockIds[1]);
    check("…a changed block reads its own first words", !!changed && changed.text.startsWith(`Paragraph 0 edited ${edits}.`));
    check("…an unchanged block keeps its stored line", !!kept && kept.text === first!.lines.find((l) => l.blockId === blockIds[1])?.text);

    // 2. Built eleven minutes ago and stale: the command builds at once, as before.
    await setBuilt(SKELETON_QUIET_MS + 60_000);
    d = await load();
    check("skeletonAction: build past the quiet period", skeletonAction(readSkeleton(d.skeleton), d.blocks) === "build");
    calls = 0;
    builds = 2;
    const s2 = await ensureSkeleton(d, null);
    check("past the quiet period the command builds", calls > 0 && s2.gist === "build 2", `${calls} calls`);
    d = await load();
    check("…and the stored skeleton is current", !skeletonStale(readSkeleton(d.skeleton), d.blocks));

    // 3. The graph opens under the quiet period (COST6-06): the warm builds nothing; the command reads the
    // stored skeleton. Past the quiet period the warm builds.
    await editThird();
    await setBuilt(2 * 60_000);
    calls = 0;
    builds = 3;
    await warmSkeletons(notebook.id, null);
    d = await load();
    check("a graph open under the quiet period builds nothing", calls === 0 && readSkeleton(d.skeleton)?.gist === "build 2", `${calls} calls`);
    const s3 = await ensureSkeleton(d, null);
    check("…and the command after it reads the stored gist, no call", calls === 0 && s3.gist === "build 2");
    await setBuilt(SKELETON_QUIET_MS + 60_000);
    // One more word, so the warm's same-text skip does not hold it back, and
    // the project's rev moved, as every block edit through the API moves it
    // (bumpDocument, lib/collab.ts): the warm reads the rev first (COST9-07).
    await db.block.update({ where: { id: blockIds[1] }, data: { text: `${para(1)} More.` } });
    await db.notebook.update({ where: { id: notebook.id }, data: { rev: { increment: 1 } } });
    await warmSkeletons(notebook.id, null);
    d = await load();
    check("a graph open past the quiet period builds", calls > 0 && readSkeleton(d.skeleton)?.gist === "build 3", `${calls} calls`);
    check("…and the stored skeleton is current", !skeletonStale(readSkeleton(d.skeleton), d.blocks));

    // 4. A command under the quiet period while a build runs (REV6-03): it waits for the build (at most
    // SKELETON_WAIT_MS) and reads the new skeleton. In this process (the build shared), then across processes
    // (another process's fresh lock, polled).
    await editThird();
    await setBuilt(2 * 60_000);
    builds = 4;
    slowMs = 1_500;
    const warm = refreshSkeleton(doc.id, null, { force: true });
    await sleep(300);
    let t4 = Date.now();
    const s4 = await ensureSkeleton(await load(), null);
    await warm;
    check("a command under the quiet period waits for the running build", s4.gist === "build 4", `read "${s4.gist}" after ${Date.now() - t4} ms`);
    await editThird();
    await setBuilt(2 * 60_000);
    const theirs = new Date();
    await db.document.update({ where: { id: doc.id }, data: { skeletonStartedAt: theirs } });
    const finish = sleep(2_000).then(async () => {
      const cur = readSkeleton((await load()).skeleton) as Skeleton;
      await db.document.update({ where: { id: doc.id }, data: { skeleton: { ...cur, gist: "their build" } as unknown as Prisma.InputJsonValue, skeletonStartedAt: null } });
    });
    t4 = Date.now();
    const s4b = await ensureSkeleton(await load(), null);
    await finish;
    check("…and for another process's build", s4b.gist === "their build", `read "${s4b.gist}" after ${Date.now() - t4} ms`);
    // A build that runs past SKELETON_WAIT_MS: the command reads the stored skeleton after it, no longer.
    await db.document.update({ where: { id: doc.id }, data: { skeletonStartedAt: new Date() } });
    t4 = Date.now();
    const s4c = await ensureSkeleton(await load(), null);
    const waited = Date.now() - t4;
    check("…at most SKELETON_WAIT_MS, then the stored skeleton", s4c.gist === "their build" && waited < SKELETON_WAIT_MS + 1_500, `${waited} ms`);
    await db.document.update({ where: { id: doc.id }, data: { skeletonStartedAt: null } });
    slowMs = 0;

    // 5. Under a tenth changed: read, whatever the age.
    await setBuilt(SKELETON_QUIET_MS + 60_000);
    builds = 5;
    await buildSkeleton(doc.id, null);
    await db.block.update({ where: { id: blockIds[5] }, data: { text: para(5, 99) } });
    d = await load();
    check("skeletonAction: read under a tenth changed", skeletonAction(readSkeleton(d.skeleton), d.blocks) === "read");
    // A skeleton that does not say when it was built builds, as before.
    const old = { ...(readSkeleton(d.skeleton) as Skeleton) };
    delete old.built;
    await editThird();
    d = await load();
    check("skeletonAction: build when the stored skeleton has no build time", skeletonAction(old, d.blocks) === "build");
    check("skeletonAction: build when there is no skeleton", skeletonAction(null, d.blocks) === "build");
  } finally {
    await db.notebookDocument.deleteMany({ where: { notebookId: notebook.id } });
    await db.notebook.delete({ where: { id: notebook.id } });
    await db.document.delete({ where: { id: doc.id } });
    await db.$disconnect();
  }
  console.log(failed === 0 ? "ALL PASS" : `${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
