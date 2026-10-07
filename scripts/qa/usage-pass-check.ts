// The usage record of a Stitch command (COST5-03, SPEC.md §2): each model call's row names its pass (route,
// expand, select, answer) and keeps the reasoning tokens the provider reports. On a COPY of the database, the
// model answered in process (no network), on a project past STITCH_GROUPED_MAX of skeleton (the route pass
// runs) — the seeded "(i)" project of scripts/qa/stitch-context-check.ts:
//   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/<copy> DIRECT_URL=$DATABASE_URL \
//     npx tsx scripts/qa/usage-pass-check.ts "QA Stitch Cost (i) 200 docs 10M"
// Also: sdkTokens reads the reasoning tokens, addTokens sums them, a row written without them reads null.
// It deletes the usage rows it wrote. Refuses "dissect".
import { PrismaClient } from "@prisma/client";
import { addTokens, recordUsage, sdkTokens } from "../../src/lib/usage";

const url = new URL(process.env.DATABASE_URL ?? "");
const dbName = url.pathname.replace(/^\//, "");
if (!["localhost", "127.0.0.1"].includes(url.hostname) || dbName === "dissect" || !dbName) {
  console.error(`Refusing: ${url.hostname}/${dbName} is not a local database copy.`);
  process.exit(1);
}
process.env.MOONSHOT_API_KEY ??= "mock";
process.env.MOONSHOT_BASE_URL ??= "http://mock.invalid/v1";
const TITLE = process.argv[2] ?? "QA Stitch Cost (i) 200 docs 10M";
const REASONING = 321;

// The model, in process: each pass's JSON, and a usage block with reasoning tokens.
const realFetch = globalThis.fetch;
globalThis.fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
  const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!href.includes("/chat/completions")) return realFetch(input, init);
  const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}") as { messages: { role: string; content: unknown }[] };
  const text = body.messages.map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content))).join("\n");
  const last = String(body.messages[body.messages.length - 1]?.content ?? "");
  let content = "{}";
  if (last.includes('Return ONLY JSON: {"parts": ["A1"')) content = JSON.stringify({ parts: [/\[part at ([A-Z]+\d+)\]/.exec(text)?.[1] ?? "A1"] });
  else if (last.includes('Return ONLY JSON: {"words"')) content = JSON.stringify({ words: ["vanity", "existence"] });
  else if (last.includes('Return ONLY JSON: {"blockIds"')) content = JSON.stringify({ blockIds: [...text.matchAll(/^\[block ([A-Z]+\d+)\]/gm)].slice(0, 3).map((m) => m[1]) });
  else if (last.includes('Return ONLY JSON: {"reply"')) {
    const alias = /\[block ([A-Z]+\d+)\] \(/.exec(text)?.[1] ?? "A1";
    content = JSON.stringify({ reply: `The blocks read say little on it [block ${alias}].`, links: [], document: null });
  } else if (last.includes("Write the document's skeleton")) content = JSON.stringify({ gist: "", parts: [], lines: [] });
  return new Response(
    JSON.stringify({
      id: "u",
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: "mock",
      choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
      usage: { prompt_tokens: 2000, completion_tokens: 400 + REASONING, total_tokens: 2400 + REASONING, completion_tokens_details: { reasoning_tokens: REASONING } },
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

async function main() {
  const t = sdkTokens({ inputTokens: 10, outputTokens: 30, inputTokenDetails: {}, outputTokenDetails: { reasoningTokens: 20 } });
  check("sdkTokens reads the reasoning tokens", t.reasoningTokens === 20 && t.outputTokens === 30);
  check("sdkTokens leaves them out when the provider says nothing", sdkTokens({ inputTokens: 1, outputTokens: 2 }).reasoningTokens === undefined);
  check("addTokens sums them", addTokens(t, t).reasoningTokens === 40 && addTokens({ outputTokens: 1 }, { outputTokens: 1 }).reasoningTokens === undefined);

  const notebook = await db.notebook.findFirst({ where: { title: TITLE }, select: { id: true } });
  if (!notebook) throw new Error(`no project "${TITLE}": seed it with scripts/qa/stitch-context-check.ts`);
  const since = new Date();
  const marker = `usage-pass-check-${since.getTime()}`;
  recordUsage({ userId: marker, feature: "stitch", model: "glm-5.3" }, { inputTokens: 5, outputTokens: 5 });
  const { stitch } = await import("../../src/lib/graph/stitch");
  await stitch({
    notebookId: notebook.id,
    documentIds: null,
    userId: null,
    lang: "en",
    command: "What does Schopenhauer say about the vanity of existence?",
    history: [],
    onFailure: (r: string) => new Error(r),
  });
  await sleep(1_500); // the usage writes are fire-and-forget
  const rows = await db.usageEvent.findMany({ where: { createdAt: { gte: since }, OR: [{ feature: "stitch" }, { userId: marker }] } });
  const passes = new Map<string, typeof rows>();
  for (const r of rows) passes.set(r.pass ?? "null", [...(passes.get(r.pass ?? "null") ?? []), r]);
  console.log(`  rows: ${[...passes].map(([p, rs]) => `${p} ${rs.length}`).join(", ")}`);
  for (const p of ["route", "expand", "select", "answer"]) {
    const rs = passes.get(p) ?? [];
    check(`the ${p} pass logs its pass`, rs.length > 0, `${rs.length} rows`);
    check(`…with the reasoning tokens`, rs.length > 0 && rs.every((r) => r.reasoningTokens === REASONING && r.outputTokens === 400 + REASONING));
  }
  const plain = rows.find((r) => r.userId === marker);
  check("a row written without a pass or reasoning reads null in both", !!plain && plain.pass === null && plain.reasoningTokens === null);
  const ids = rows.map((r) => r.id);
  await db.usageEvent.deleteMany({ where: { id: { in: ids } } });
  console.log(`  deleted the ${ids.length} usage rows this check wrote`);
  await db.$disconnect();
  console.log(failed === 0 ? "ALL PASS" : `${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
