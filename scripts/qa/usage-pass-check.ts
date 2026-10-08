// The usage record of a Stitch command (COST5-03, SPEC.md §2): each model call's row names its pass (route,
// expand, select, answer) and keeps the reasoning tokens the provider reports. On a COPY of the database, the
// model answered in process (no network), on a project past STITCH_GROUPED_MAX of skeleton (the route pass
// runs) — the seeded "(i)" project of scripts/qa/stitch-context-check.ts:
//   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/<copy> DIRECT_URL=$DATABASE_URL \
//     npx tsx scripts/qa/usage-pass-check.ts "QA Stitch Cost (i) 200 docs 10M"
// Also: sdkTokens reads the reasoning tokens, addTokens sums them, a row written without them reads null.
// COST8-02: the route, select and answer passes answer with cached prompt tokens (cost.md's three calls), and
// each row stores the uncached input and the cost the provider bills, each token priced once.
// It deletes the usage rows it wrote. Refuses "dissect".
import { PrismaClient } from "@prisma/client";
import { addTokens, computeCostUsd, priceFor, recordUsage, sdkTokens } from "../../src/lib/usage";

const url = new URL(process.env.DATABASE_URL ?? "");
const dbName = url.pathname.replace(/^\//, "");
if (!["localhost", "127.0.0.1"].includes(url.hostname) || dbName === "dissect" || !dbName) {
  console.error(`Refusing: ${url.hostname}/${dbName} is not a local database copy.`);
  process.exit(1);
}
process.env.MOONSHOT_API_KEY ??= "mock";
process.env.MOONSHOT_BASE_URL ??= "http://mock.invalid/v1";
const TITLE = process.argv[2] ?? "QA Stitch Cost (i) 200 docs 10M";
const REASONING = 20;
// Per pass: prompt tokens, of them cached, and output (the reasoning included). cost.md COST8-02's calls:
// the select pass at Linda's 7 documents, the answer pass with its rules cached, the route pass at 200 documents.
const USAGE: Record<string, { prompt: number; cached: number; out: number }> = {
  route: { prompt: 161_800, cached: 161_700, out: 150 },
  select: { prompt: 18_600, cached: 18_000, out: 30 },
  answer: { prompt: 6_500, cached: 2_470, out: 170 },
  other: { prompt: 2000, cached: 0, out: 400 + REASONING },
};

// The model, in process: each pass's JSON, and a usage block with reasoning tokens.
const realFetch = globalThis.fetch;
globalThis.fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
  const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!href.includes("/chat/completions")) return realFetch(input, init);
  const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}") as { messages: { role: string; content: unknown }[] };
  const text = body.messages.map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content))).join("\n");
  const last = String(body.messages[body.messages.length - 1]?.content ?? "");
  let content = "{}";
  const pass = last.includes('Return ONLY JSON: {"parts": ["A1"')
    ? "route"
    : last.includes('Return ONLY JSON: {"blockIds"')
      ? "select"
      : last.includes('Return ONLY JSON: {"reply"')
        ? "answer"
        : "other";
  const u = USAGE[pass];
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
      usage: {
        prompt_tokens: u.prompt,
        completion_tokens: u.out,
        total_tokens: u.prompt + u.out,
        prompt_tokens_details: { cached_tokens: u.cached },
        completion_tokens_details: { reasoning_tokens: REASONING },
      },
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
  // COST8-02: the SDK's inputTokens holds the cached tokens too; the row keeps the uncached ones.
  const cachedSdk = sdkTokens({ inputTokens: 18_600, outputTokens: 30, inputTokenDetails: { noCacheTokens: 600, cacheReadTokens: 18_000 } });
  check("sdkTokens keeps the provider's uncached count", cachedSdk.inputTokens === 600 && cachedSdk.cacheReadTokens === 18_000);
  const noDetail = sdkTokens({ inputTokens: 1_000, outputTokens: 1, inputTokenDetails: { cacheReadTokens: 700, cacheWriteTokens: 200 } });
  check("…else the total less the cache read and write", noDetail.inputTokens === 100 && noDetail.cacheWriteTokens === 200);
  check("…and a total with no cache stays whole", sdkTokens({ inputTokens: 500, outputTokens: 1 }).inputTokens === 500);
  const flash = computeCostUsd("glm-5.3-flash", cachedSdk);
  check("a cached select pass costs $0.00064, not $0.00334 (cost.md)", Math.abs(flash - 0.000645) < 1e-9, `$${flash.toFixed(6)}`);

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
    const u = USAGE[p] ?? USAGE.other;
    check(`…with the reasoning tokens`, rs.length > 0 && rs.every((r) => r.reasoningTokens === REASONING && r.outputTokens === u.out));
    // What the provider bills: the uncached input at the input price, the cached at the cache price, once each.
    const billed = (model: string) => {
      const pr = priceFor(model);
      return ((u.prompt - u.cached) * pr.input + u.cached * pr.cacheRead + u.out * pr.output) / 1_000_000;
    };
    check(
      `…with the uncached input and the billed cost (COST8-02)`,
      rs.length > 0 && rs.every((r) => r.inputTokens === u.prompt - u.cached && r.cacheReadTokens === u.cached && Math.abs(r.costUsd - billed(r.model)) < 1e-9),
      rs.map((r) => `${r.model} in ${r.inputTokens} cached ${r.cacheReadTokens} $${r.costUsd.toFixed(5)} (billed $${billed(r.model).toFixed(5)}, was $${computeCostUsd(r.model, { inputTokens: u.prompt, outputTokens: u.out, cacheReadTokens: u.cached }).toFixed(5)})`).join("; "),
    );
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
