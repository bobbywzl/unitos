// Kept conversations (lib/kept-chat.ts) against a fake /api/assistant/kept
// that answers like the route: GET, PUT with a base (409 when the row
// changed), DELETE. Each "tab" is its own copy of the module with its own
// store; the tabs share one localStorage when they share a browser.
//   npx tsx scripts/qa/kept-chat-check.mts
type Turn = { role: "user" | "assistant"; content: string };
type Row = { turns: Turn[]; updatedAt: string };

const results: string[] = [];
const check = (name: string, ok: boolean, detail = "") =>
  results.push(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const turns = (n: number, tag: string): Turn[] =>
  Array.from({ length: n }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `${tag} ${i}` }));

// ── The fake server ──
const rows = new Map<string, Row>();
let failGets = 0;
let last = 0;
const stamp = () => new Date((last = Math.max(Date.now(), last + 1))).toISOString();
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(String(input), "http://x");
  const method = init?.method ?? "GET";
  if (method === "GET") {
    if (failGets > 0) {
      failGets -= 1;
      throw new TypeError("network down");
    }
    const k = `${url.searchParams.get("notebookId")}|${url.searchParams.get("place")}`;
    const row = rows.get(k);
    return json({ turns: row?.turns ?? [], updatedAt: row?.updatedAt ?? null, account: "acct" });
  }
  const body = JSON.parse(String(init?.body)) as { notebookId: string; place: string; base?: string | null; turns?: Turn[] };
  const k = `${body.notebookId}|${body.place}`;
  if (method === "DELETE") {
    rows.delete(k);
    return json({ ok: true });
  }
  const row = rows.get(k);
  if ((body.base ?? null) !== (row?.updatedAt ?? null)) return json({ error: "changed" }, 409);
  const next = { turns: body.turns ?? [], updatedAt: stamp() };
  rows.set(k, next);
  return json({ ok: true, updatedAt: next.updatedAt });
}) as typeof fetch;

// ── One browser's localStorage, and window ──
function storage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
  };
}
const g = globalThis as unknown as { window: unknown; localStorage: ReturnType<typeof storage> };
g.window = { addEventListener: () => {} };
g.localStorage = storage();

let tabs = 0;
async function tab(place: string, mode: "append" | "replace" = "append") {
  const mod = (await import(`../../src/lib/kept-chat.ts?tab=${++tabs}`)) as typeof import("../../src/lib/kept-chat");
  const store = mod.keptStore("nb", place, mode);
  for (let i = 0; i < 50 && !store.hydrated(); i++) await wait(20);
  return store;
}
const server = (place: string) => rows.get(`nb|${place}`)?.turns ?? [];

// REV5-07: a failed load, then one answer, must not replace the server's turns.
rows.set("nb|a", { turns: turns(40, "old"), updatedAt: stamp() });
failGets = 1;
const a = await tab("a");
a.setTurns((t) => [...t, ...turns(2, "new")]);
await wait(1500);
check("a failed load then an answer keeps the server's 40 turns", server("a").length === 42 && server("a")[0].content === "old 0" && server("a")[41].content === "new 1", `server ${server("a").length}`);
check("the tab shows all 42 after the merge", a.turns().length === 42);

// REV5-08: two tabs each add an exchange; both stay.
rows.set("nb|b", { turns: turns(40, "old"), updatedAt: stamp() });
const b1 = await tab("b");
const b2 = await tab("b");
b1.setTurns((t) => [...t, ...turns(2, "tab1")]);
await wait(800);
b2.setTurns((t) => [...t, ...turns(2, "tab2")]);
await wait(1500);
const sb = server("b").map((t) => t.content);
check("two tabs: both exchanges are kept", sb.length === 44 && sb.includes("tab1 0") && sb.includes("tab2 1"), `server ${sb.length}`);

// Clear in one tab, an answer in another: the clear stands, the new answer stays.
const c1 = await tab("b");
c1.clear();
await wait(800);
b1.setTurns((t) => [...t, ...turns(2, "after")]);
await wait(1500);
const sc = server("b").map((t) => t.content);
check("a clear in one tab stands; the other tab's new turns stay", sc.length === 2 && sc[0] === "after 0", JSON.stringify(sc));

// Replace mode (Ask about a range): the newest exchange wins.
rows.set("nb|ask", { turns: turns(2, "first"), updatedAt: stamp() });
const r1 = await tab("ask", "replace");
rows.set("nb|ask", { turns: turns(2, "elsewhere"), updatedAt: stamp() });
r1.setTurns(() => turns(2, "newest"));
await wait(1500);
check("replace: the newest exchange wins", server("ask")[0]?.content === "newest 0");

// A reload with an unsaved local copy built on an older base merges.
const old = { turns: turns(40, "old"), updatedAt: stamp() };
rows.set("nb|e", { turns: [...old.turns, { role: "user", content: "other device" }], updatedAt: stamp() });
g.localStorage.setItem(
  "unitos-kept-chat:nb|e",
  JSON.stringify({ turns: [...old.turns, ...turns(2, "unsaved")], at: Date.now(), account: "acct", base: old.updatedAt, baseCount: 40 }),
);
const e = await tab("e");
await wait(1500);
const se = server("e").map((t) => t.content);
check("a reload merges an unsaved copy onto a server copy that moved", se.includes("other device") && se.includes("unsaved 1") && se.length === 43, `server ${se.length}`);
check("the reloaded tab shows the merge", e.turns().length === 43);

console.log(results.join("\n"));
process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
