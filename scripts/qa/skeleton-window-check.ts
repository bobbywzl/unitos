// COST4-08: the skeleton's compact answer and its window bounds, on the
// 1.21M-char Moby-Dick import (or any document named by DOC_TITLE). The
// responder writes the same line for each block in either form (the
// context check's rule: about a tenth of each block, a heading whole), so
// the stored skeletons must be equal line for line; it counts output
// tokens (chars / 4) and the windows in flight. Restores the stored
// skeleton at the end. Run on your own DB copy:
//   DATABASE_URL=... npx tsx scripts/qa/skeleton-window-check.ts
import assert from "node:assert/strict";
process.env.MOONSHOT_API_KEY ??= "mock";
process.env.MOONSHOT_BASE_URL ??= "http://localhost:3999/v1";

const est = (s: string) => Math.round(s.length / 4);
const BLOCK_RX = /^\[block ([^\]]+)\] \(([^)]*)\)\n([\s\S]*?)(?=\n\n\[block |\n\n\(|\n\n\[document |$)/gm;
let form: "list" | "keyed" = "keyed";
let inFlight = 0;
let maxInFlight = 0;
let calls = 0;
let outTokens = 0;
let lineTokens = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!url.includes("/chat/completions")) return realFetch(input, init);
  inFlight++;
  maxInFlight = Math.max(maxInFlight, inFlight);
  calls++;
  try {
    await new Promise((r) => setTimeout(r, 40));
    const body = JSON.parse(String(init?.body ?? "{}")) as { model: string; messages: { content: unknown }[] };
    const msgs = body.messages.map((m) => (typeof m.content === "string" ? m.content : (m.content as { text?: string }[]).map((p) => p.text ?? "").join("")));
    const system = msgs[0];
    const user = msgs[msgs.length - 1];
    const blocks = [...system.matchAll(BLOCK_RX)].map((m) => ({ id: m[1], type: m[2].split(",")[0], text: m[3].trim() }));
    const lines = blocks.map((b) => {
      if (b.type === "HEADING") return { blockId: b.id, text: b.text.slice(0, 300) };
      const w = b.text.split(/\s+/);
      return { blockId: b.id, text: w.slice(0, Math.min(40, Math.max(4, Math.ceil(w.length * 0.12)))).join(" ") };
    });
    const parts = [...user.matchAll(/\[part ([^\]]+)\] "([^"]*)"/g)].map((m) => ({ blockId: m[1], summary: `This part treats ${m[2]}.` }));
    const gist = user.includes("3. gist: one sentence") ? "A whaling voyage and what it means." : "";
    const content =
      form === "list"
        ? JSON.stringify({ gist, parts, lines })
        : JSON.stringify({ gist, parts: Object.fromEntries(parts.map((p) => [p.blockId, p.summary])), lines: Object.fromEntries(lines.map((l) => [l.blockId, l.text])) });
    outTokens += est(content);
    lineTokens += lines.reduce((n, l) => n + est(l.text), 0);
    return new Response(
      JSON.stringify({ id: "x", object: "chat.completion", created: 0, model: body.model, choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } finally {
    inFlight--;
  }
};

async function main() {
  const { db } = await import("@/lib/db");
  const sk = await import("@/lib/graph/skeleton");
  const { skeletonPrompt } = await import("@/lib/prompts/skeleton");
  const { SKELETON_WINDOW_CONCURRENCY, SKELETON_WINDOWS_IN_FLIGHT } = await import("@/lib/derive/config");
  let pass = 0;
  const ok = (cond: boolean, name: string) => {
    assert.ok(cond, name);
    pass++;
    console.log(`PASS ${name}`);
  };
  // The parser: both forms, the same lines.
  const list = sk.windowSchema.parse({ gist: "g", parts: [{ blockId: "1", summary: "s" }], lines: [{ blockId: 1, text: " a " }, { blockId: "2", text: "b" }] });
  const keyed = sk.windowSchema.parse({ gist: "g", parts: { "1": "s" }, lines: { "1": " a ", "2": "b" } });
  ok(JSON.stringify(list) === JSON.stringify(keyed), "parser: the keyed form reads as the list form");
  ok(sk.windowSchema.safeParse({ gist: "", parts: {}, lines: { "1": 5 } }).success === false, "parser: a line that is not text fails the window, as before");
  ok(skeletonPrompt({ parts: [], window: 1, windows: 1, blockCount: 2 }).includes('"lines": {"1": "…", "2": "…"}'), "prompt: asks for the keyed form");

  const title = process.env.DOC_TITLE ?? "Moby-Dick (whole)";
  const doc = (await db.document.findFirst({ where: { title }, select: { id: true, skeleton: true } }))!;
  const run = async (f: typeof form) => {
    form = f;
    calls = outTokens = lineTokens = maxInFlight = 0;
    const t = performance.now();
    const s = (await sk.buildSkeleton(doc.id, null))!;
    return { s, calls, outTokens, lineTokens, maxInFlight, ms: Math.round(performance.now() - t) };
  };
  const a = await run("list");
  const b = await run("keyed");
  const strip = (s: typeof a.s) => JSON.stringify({ gist: s.gist, parts: s.parts, lines: s.lines, chars: s.chars });
  ok(strip(a.s) === strip(b.s), `the same skeleton both ways: ${b.s.lines.length} lines, ${b.s.parts.length} parts, gist kept`);
  const fallback = b.s.lines.filter((l, i) => l.text !== a.s.lines[i].text).length;
  ok(fallback === 0, "no line fell back to first words in the keyed form");
  const usd = (t: number) => (t * 0.5) / 1e6;
  console.log(`OUT list: ${a.outTokens} tok ($${usd(a.outTokens).toFixed(4)}), keys ${a.outTokens - a.lineTokens} tok; keyed: ${b.outTokens} tok ($${usd(b.outTokens).toFixed(4)}), keys ${b.outTokens - b.lineTokens} tok; saved ${a.outTokens - b.outTokens} tok (${Math.round((100 * (a.outTokens - b.outTokens)) / a.outTokens)}%), $${usd(a.outTokens - b.outTokens).toFixed(4)} per build`);
  ok(b.maxInFlight <= SKELETON_WINDOW_CONCURRENCY, `one document: ${b.calls} windows, at most ${b.maxInFlight} in flight (limit ${SKELETON_WINDOW_CONCURRENCY}), ${b.ms} ms at 40 ms a call`);
  // Four builds at once: the process-wide bound.
  calls = maxInFlight = 0;
  await Promise.all([0, 1, 2, 3].map(() => sk.buildSkeleton(doc.id, null)));
  ok(maxInFlight <= SKELETON_WINDOWS_IN_FLIGHT, `four builds at once: ${calls} windows, at most ${maxInFlight} in flight (limit ${SKELETON_WINDOWS_IN_FLIGHT})`);
  await db.document.update({ where: { id: doc.id }, data: { skeleton: doc.skeleton as object } });
  console.log(`${pass} pass, ALL PASS`);
  await db.$disconnect();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
