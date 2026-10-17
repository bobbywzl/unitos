// Kept conversations (lib/kept-chat.ts) against a fake /api/assistant/kept
// that answers like the route: GET, PUT with a base (409 when the row
// changed), DELETE. Each "tab" is its own copy of the module with its own
// store; the tabs share one localStorage when they share a browser.
//   npx tsx scripts/qa/kept-chat-check.mts
// KEPT_CHAT=<path of another copy of kept-chat.ts> runs the checks on it.
import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import path from "node:path";
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

// The tab a call comes from: each tab's module runs in its own context, so
// a closed tab's timers and requests can be told apart.
const als = new AsyncLocalStorage<string>();
const closed = new Set<string>();
let failPuts = false;
type Posted = { message: string; undo: () => void; commit?: () => void };
let pillShows = false;
let posted: Posted | null = null;
// Read through a call: the pill posts from inside the store, out of TS's sight.
const pill = (): Posted | null => posted;
let account = "acct";
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(String(input), "http://x");
  const method = init?.method ?? "GET";
  // A closed tab sends nothing more.
  if (closed.has(als.getStore() ?? "")) return new Promise<Response>(() => {});
  if (method !== "GET" && failPuts) return json({ error: "down" }, 503);
  if (method === "GET") {
    if (failGets > 0) {
      failGets -= 1;
      throw new TypeError("network down");
    }
    const k = `${url.searchParams.get("notebookId")}|${url.searchParams.get("place")}`;
    const row = rows.get(k);
    return json({ turns: row?.turns ?? [], updatedAt: row?.updatedAt ?? null, account });
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
// A change in one tab's storage reaches the other tabs as a storage event.
const listeners: { tab: string | undefined; type: string; fn: (e: unknown) => void }[] = [];
function storage() {
  const m = new Map<string, string>();
  const tell = (key: string) => {
    const from = als.getStore();
    for (const l of listeners) if (l.type === "storage" && l.tab !== from && !closed.has(l.tab ?? "")) setTimeout(() => l.fn({ key }), 0);
  };
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => {
      m.set(k, v);
      tell(k);
    },
    removeItem: (k: string) => {
      if (m.delete(k)) tell(k);
    },
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  };
}
const g = globalThis as unknown as { window: unknown; document: unknown; localStorage: ReturnType<typeof storage> };
g.window = {
  addEventListener: (type: string, fn: (e: unknown) => void) => listeners.push({ tab: als.getStore(), type, fn }),
  // With no Undo pill on the page a Clear commits at once; with one, the
  // pill takes the post (Undo, or commit when it goes).
  dispatchEvent: (event: { detail?: unknown }) => {
    if (!pillShows) return true;
    posted = event.detail as Posted;
    return false;
  },
};
g.document = {
  get cookie() {
    return `dissect-account=${account}`;
  },
  addEventListener: () => {},
  visibilityState: "visible",
};
g.localStorage = storage();

// Each tab loads its own copy of the module file (an import with another
// query string is the same module), inside the repository so its "@/"
// imports resolve; the copies go at the end.
const SOURCE = path.resolve(process.env.KEPT_CHAT ?? new URL("../../src/lib/kept-chat.ts", import.meta.url).pathname);
const TABS_DIR = new URL("../../.qa-tmp/kept-chat-tabs/", import.meta.url).pathname;
fs.mkdirSync(TABS_DIR, { recursive: true });
let tabs = 0;
type Module = typeof import("../../src/lib/kept-chat");
type Store = ReturnType<Module["keptStore"]>;
async function load(): Promise<Module> {
  const file = path.join(TABS_DIR, `kept-chat-${process.pid}-${++tabs}.ts`);
  fs.copyFileSync(SOURCE, file);
  return (await import(file)) as Module;
}
async function tab(place: string, mode: "append" | "replace" = "append", name?: string): Promise<Store> {
  const run = async () => {
    const mod = await load();
    return { mod, store: mod.keptStore("nb", place, mode) };
  };
  const { store } = name ? await als.run(name, run) : await run();
  for (let i = 0; i < 50 && !store.hydrated(); i++) await wait(20);
  return store;
}
const inTab = <T,>(name: string, fn: () => T): T => als.run(name, fn);
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

// EDGE16-01: two tabs on one place while every save fails; tab B closes;
// the server comes back. B's exchange must not be lost.
{
  failPuts = true;
  const A = await tab("tf", "append", "A");
  const B = await tab("tf", "append", "B");
  inTab("B", () => B.setTurns((t) => [...t, { role: "user", content: "B asks" }, { role: "assistant", content: "B answer" }]));
  await wait(600);
  inTab("A", () => A.setTurns((t) => [...t, { role: "user", content: "A asks" }, { role: "assistant", content: "A answer" }]));
  await wait(600);
  closed.add("B");
  failPuts = false;
  await wait(9000);
  const live = server("tf").map((t) => t.content);
  const C = await tab("tf", "append", "C");
  await wait(1500);
  const after = server("tf").map((t) => t.content);
  check(
    "EDGE16-01 two tabs, failing saves, B closes: B's exchange is kept",
    after.includes("B asks") && after.includes("B answer") && after.includes("A asks") && after.length === 4,
    `server while A lives ${JSON.stringify(live)}, after a new page ${JSON.stringify(after)}, the new page shows ${C.turns().length}`,
  );
  closed.add("A");
  closed.add("C");
}

// EDGE16-05: another account's unsaved copy, and a load that fails: never shown, never saved as this account's.
{
  rows.set("nb|fx", { turns: turns(2, "mine"), updatedAt: stamp() });
  const foreign = { turns: [{ role: "user", content: "OTHER private question" }], at: Date.now(), account: "other", base: null, baseCount: 0 };
  g.localStorage.setItem("unitos-kept-chat:nb|fx", JSON.stringify(foreign));
  g.localStorage.setItem("unitos-kept-chat:nb|fx|zzother", JSON.stringify(foreign));
  failGets = 1;
  const F = await tab("fx", "append", "F");
  const shown = F.turns().map((t) => t.content);
  inTab("F", () => F.setTurns((t) => [...t, { role: "user", content: "acct asks" }]));
  await wait(3500);
  const sf = server("fx").map((t) => t.content);
  const kept = g.localStorage.getItem("unitos-kept-chat:nb|fx|zzother") ?? g.localStorage.getItem("unitos-kept-chat:other|nb|fx");
  check(
    "EDGE16-05 a failed load shows no other account's copy and never saves it",
    !shown.includes("OTHER private question") && !sf.includes("OTHER private question") && sf.includes("acct asks") && sf.includes("mine 0") && !!kept,
    `shown ${JSON.stringify(shown)}, server ${JSON.stringify(sf)}, other's copy kept ${!!kept}`,
  );
  closed.add("F");
}

// EDGE16-05: the words in a box name their account.
{
  const mod = await load();
  account = "owner";
  mod.writeChatDraft("media:nb:doc", "OWNER UNSENT words");
  account = "editor";
  const seen = mod.readChatDraft("media:nb:doc");
  mod.writeChatDraft("media:nb:doc", "editor words");
  account = "owner";
  const back = mod.readChatDraft("media:nb:doc");
  check("EDGE16-05 the box words stay the account's own", seen === "" && back === "OWNER UNSENT words", `editor saw ${JSON.stringify(seen)}, owner reads ${JSON.stringify(back)}`);
  account = "acct";
}

// EDGE16-12: tab A sees tab B's turn without a reload.
{
  const A = await tab("see", "append", "A2");
  const B = await tab("see", "append", "B2");
  // A surface shows each (the old store has no open: it never follows).
  (A as Store & { open?: () => void }).open?.();
  (B as Store & { open?: () => void }).open?.();
  inTab("A2", () => A.setTurns((t) => [...t, { role: "user", content: "A2 asks" }]));
  await wait(1500);
  inTab("B2", () => B.setTurns((t) => [...t, { role: "user", content: "B2 asks" }]));
  await wait(2500);
  const a = A.turns().map((t) => t.content);
  check("EDGE16-12 tab A shows tab B's turn", a.includes("B2 asks") && a.includes("A2 asks") && a.length === 2, JSON.stringify(a));
  closed.add("A2");
  closed.add("B2");
}

// EDGE16-08: Clear asks nothing: the turns leave at once, Undo puts them
// back, the row goes only when the pill goes.
{
  rows.set("nb|cl", { turns: turns(4, "kept"), updatedAt: stamp() });
  pillShows = true;
  const K = await tab("cl", "append", "K");
  K.clear();
  await wait(800);
  const gone = K.turns().length === 0 && server("cl").length === 4 && pill()?.message === "Conversation cleared";
  pill()?.undo();
  await wait(800);
  const back = K.turns().length === 4 && server("cl").length === 4;
  posted = null;
  K.clear();
  await wait(300);
  pill()?.commit?.();
  await wait(800);
  const committed = K.turns().length === 0 && !rows.has("nb|cl");
  rows.set("nb|cl2", { turns: turns(4, "kept"), updatedAt: stamp() });
  const K2 = await tab("cl2", "append", "K2");
  posted = null;
  K2.clear();
  await wait(300);
  inTab("K2", () => K2.setTurns((t) => [...t, { role: "user", content: "new after clear" }]));
  await wait(800);
  const during = server("cl2").map((t) => t.content);
  pill()?.undo();
  await wait(800);
  const undone = server("cl2").map((t) => t.content);
  check(
    "EDGE16-08 Clear: gone at once, Undo puts the turns back, the row goes at the commit",
    gone && back && committed && during.join() === "new after clear" && undone.length === 5 && undone[4] === "new after clear",
    `gone ${gone} back ${back} committed ${committed} during ${JSON.stringify(during)} undone ${JSON.stringify(undone)}`,
  );
  pillShows = false;
  closed.add("K");
  closed.add("K2");
}

for (const file of fs.readdirSync(TABS_DIR)) if (file.startsWith(`kept-chat-${process.pid}-`)) fs.rmSync(path.join(TABS_DIR, file));
console.log(results.join("\n"));
process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
