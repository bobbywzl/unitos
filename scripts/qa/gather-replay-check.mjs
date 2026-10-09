// A gathered note saved offline keeps the reader's words when a quote no
// longer resolves on replay (REV5-06). Runs on a COPY of the database seeded
// with the review seeds (see link-remove-check.ts): C (rev3-sc) edits P
// (rev3-p), section rev5-s-p, documents rev4-d3/rev4-d4. A sign-in-on dev
// server must run on the same copy.
//
// 1. API: the online POST still answers 400 for a quote that does not
//    resolve; the replayed POST (the queue's x-unitos-replay header, the
//    time the record was queued) answers 201, keeps the quote's words as
//    text with no source, and says how many, at any whole-number time
//    (REV7-02); a header that is not a number answers 400 as online, and
//    a second replay of the same record answers with the saved note and saves no second one (REV6-06).
// 2. Browser: the gather dock opens on a draft, Save note runs offline and
//    queues, a collaborator's edit removes the quoted words, the browser
//    comes back online, the queue replays: the note lands with the words,
//    and the offline status says a quote was kept as text.
//
//   DB=dissect_r5safe5 BASE=http://localhost:3161 OUT=<dir> node scripts/qa/gather-replay-check.mjs
// It refuses the shared database "dissect"; it deletes only the notes it made
// and puts the edited block's text back.
import { execFileSync } from "node:child_process";
import { chromium } from "playwright-core";

const BASE = process.env.BASE ?? "http://localhost:3161";
const DB = process.env.DB ?? "dissect_r5safe5";
const OUT = process.env.OUT ?? "";
const LANG = process.env.LANG_UI ?? "en";
const WIDTH = Number(process.env.WIDTH ?? 1440);
if (DB === "dissect") {
  console.error("Refusing the shared database.");
  process.exit(1);
}
const sql = (q) =>
  execFileSync("psql", ["-h", "localhost", "-U", "postgres", "-d", DB, "-Atc", q], { env: { ...process.env, PGPASSWORD: "postgres" } })
    .toString()
    .trim();
let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` ${detail}`}`);
};
const TAG = `SAFE5 ${Date.now().toString(36)}`;
const BLOCK_TEXT = sql(`SELECT text FROM "Block" WHERE id='rev4-b4'`);
const quotes = [
  { documentId: "rev4-d3", blockId: "rev4-b3", quotedText: "Suffering is the ground of compassion." },
  { documentId: "rev4-d4", blockId: "rev4-b4", quotedText: "words a collaborator removed" },
];
const post = (headers) =>
  fetch(`${BASE}/api/notes`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: "dissect-session=rev3-sc", ...headers },
    body: JSON.stringify({ sectionId: "rev5-s-p", content: `${TAG} api: my own thoughts, typed offline`, quotes }),
  });

// ── 1. API ────────────────────────────────────────────────────────────────
const online = await post({});
check("online: a quote that does not resolve still answers 400", online.status === 400, String(online.status));
// REV6-06/REV7-02: the header carries the time the record was queued. Any
// whole number takes the keeping path, however old or however fast the
// clock; any other value takes the online path. Each case its own words.
const postAs = (words, headers) =>
  fetch(`${BASE}/api/notes`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: "dissect-session=rev3-sc", ...headers },
    body: JSON.stringify({ sectionId: "rev5-s-p", content: `${TAG} ${words}: my own thoughts, typed offline`, quotes }),
  });
const r0 = await postAs("not a number", { "x-unitos-replay": "yes" });
check("replay header not a number: 400 as online, no note", r0.status === 400, String(r0.status));
for (const [what, value] of [["a bare 1", "1"], ["a time 40 days old", String(Date.now() - 40 * 864e5)], ["a time an hour ahead", String(Date.now() + 3600e3)]]) {
  const r = await postAs(what, { "x-unitos-replay": value });
  const saved = sql(`SELECT count(*) FROM "Note" WHERE content LIKE '${TAG} ${what}: my own%'`);
  check(`replay header ${what}: 201, the words kept, one quote kept as text`, r.status === 201 && saved === "1" && r.headers.get("x-unitos-quotes-kept") === "1", `${r.status} ${saved}`);
  const again = await postAs(what, { "x-unitos-replay": value });
  const after = sql(`SELECT count(*) FROM "Note" WHERE content LIKE '${TAG} ${what}: my own%'`);
  check(`replay header ${what}, sent again: 201 with the saved note, no second note`, again.status === 201 && after === "1", `${again.status} ${after}`);
}
const queuedAt = Date.now() - 5000;
const replay = await post({ "x-unitos-replay": String(queuedAt) });
const note = replay.status === 201 ? await replay.json() : null;
check("replay: 201", replay.status === 201, `${replay.status} ${note ? "" : await replay.text().catch(() => "")}`);
check("replay: the answer says 1 quote was kept as text", replay.headers.get("x-unitos-quotes-kept") === "1", String(replay.headers.get("x-unitos-quotes-kept")));
check(
  "replay: the note keeps the reader's words, the resolved quote, and the lost quote's words",
  !!note && note.content.includes("my own thoughts, typed offline") && note.content.includes("> Suffering is the ground of compassion.") && note.content.includes("> words a collaborator removed"),
  note?.content,
);
const again = await post({ "x-unitos-replay": String(queuedAt) });
const againNote = again.status === 201 ? await again.json() : null;
check(
  "the same record replayed again (at-least-once): 201 with the saved note, no second note",
  again.status === 201 && againNote?.id === note?.id && sql(`SELECT count(*) FROM "Note" WHERE content LIKE '${TAG} api: my own%'`) === "1",
  `${again.status} ${againNote?.id} ${note?.id}`,
);
check("replay: one source, for the quote that resolves", note?.sources?.length === 1 && note.sources[0].blockId === "rev4-b3", JSON.stringify(note?.sources?.map((s) => s.blockId)));
const outside = await fetch(`${BASE}/api/notes`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Cookie: "dissect-session=rev3-sc", "x-unitos-replay": String(Date.now()) },
  body: JSON.stringify({ sectionId: "rev5-s-p", content: `${TAG} api: a document that left the project`, quotes: [{ documentId: "rev5-d5", quotedText: "B private" }] }),
});
const outsideNote = outside.status === 201 ? await outside.json() : null;
check(
  "replay: a quote whose document is not in the project keeps its words and writes no source on it",
  outside.status === 201 && outsideNote.sources.length === 0 && outsideNote.content.includes("> B private"),
  `${outside.status}`,
);

// ── 2. Browser: the real queue ───────────────────────────────────────────
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--disable-dev-shm-usage"] });
try {
  const context = await browser.newContext({ viewport: { width: WIDTH, height: WIDTH < 600 ? 844 : 900 }, hasTouch: WIDTH < 600, isMobile: WIDTH < 600 });
  await context.addCookies([
    { name: "dissect-session", value: "rev3-sc", url: BASE },
    { name: "dissect-lang", value: LANG, url: BASE },
  ]);
  const page = await context.newPage();
  page.on("response", (r) => r.url().includes("/api/notes") && console.log("   response", r.request().method(), r.status(), r.url().slice(BASE.length)));
  page.on("requestfailed", (r) => r.url().includes("/api/") && console.log("   requestfailed", r.url().slice(BASE.length), r.failure()?.errorText));
  await page.goto(`${BASE}/n/rev3-p`, { waitUntil: "domcontentloaded", timeout: 300000 });
  const words = `${TAG} browser: three sentences I typed with the network off.`;
  await page.evaluate(
    ({ words }) => {
      localStorage.setItem("unitos-premium", "1");
      localStorage.setItem(
        "unitos-note-gather:rev3-uc:rev3-p",
        JSON.stringify({
          content: words,
          sectionId: "rev5-s-p",
          quotes: [
            { documentId: "rev4-d3", blockId: "rev4-b3", text: "Suffering is the ground of compassion." },
            { documentId: "rev4-d4", blockId: "rev4-b4", text: "Compassion weakens the strong." },
          ],
          savedAt: Date.now(),
        }),
      );
    },
    { words },
  );
  await page.goto(`${BASE}/n/rev3-p?graph=1`, { waitUntil: "networkidle", timeout: 300000 });
  const save = page.getByRole("button", { name: LANG === "zh" ? "保存笔记" : "Save note" });
  await page.waitForSelector("[data-graph-note-gather-quotes]", { timeout: 120000 });
  await context.setOffline(true);
  await page.waitForTimeout(300);
  // On a phone the Stitch sheet covers the dock (WALK5-12, not this check's
  // subject): the click goes to the button itself.
  if (WIDTH < 600) await save.first().dispatchEvent("click");
  else await save.first().click();
  await page.waitForTimeout(1200);
  const queued = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const req = indexedDB.open("unitos-offline");
        req.onsuccess = () => {
          const t = req.result.transaction("writes", "readonly").objectStore("writes").getAll();
          t.onsuccess = () => resolve(t.result.map((r) => ({ path: r.path, content: r.body?.content, quotes: r.body?.quotes?.length })));
        };
        req.onerror = () => resolve(null);
      }),
  );
  check("offline: Save note queues the note with the words and 2 quotes", Array.isArray(queued) && queued.some((r) => r.path === "/api/notes" && r.content === words && r.quotes === 2), JSON.stringify(queued));
  // A collaborator edits the quoted paragraph before the replay.
  sql(`UPDATE "Block" SET text='Pity weakens the strong.' WHERE id='rev4-b4'`);
  if (OUT) await page.screenshot({ path: `${OUT}/REV5-06-offline-queued-${LANG}-${WIDTH}.png` });
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  let landed = "";
  for (let i = 0; i < 160 && !landed; i++) {
    await page.waitForTimeout(250);
    landed = sql(`SELECT id FROM "Note" WHERE content LIKE '%${TAG} browser%' LIMIT 1`);
  }
  check("online again: the queue replays and the note lands", !!landed);
  const content = landed ? sql(`SELECT content FROM "Note" WHERE id='${landed}'`) : "";
  check("…with every word the reader typed", content.includes(words), content);
  check("…and both quotes' words, the lost one as text", content.includes("> Suffering is the ground of compassion.") && content.includes("> Compassion weakens the strong."), content);
  check("…one source (the quote that still resolves)", landed && sql(`SELECT count(*) FROM "Source" WHERE "noteId"='${landed}'`) === "1");
  const pill = await page.locator("[data-offline-quotes-kept]").first().textContent({ timeout: 5000 }).catch(() => null);
  check("the offline status says a quote was kept as text", !!pill && /1/.test(pill), String(pill));
  console.log("status:", pill);
  // The pill sits in the header, under the graph: close the graph to see it.
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(800);
  if (OUT) await page.screenshot({ path: `${OUT}/REV5-06-after-${LANG}-${WIDTH}.png` });
  const left = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const req = indexedDB.open("unitos-offline");
        req.onsuccess = () => {
          const t = req.result.transaction("writes", "readonly").objectStore("writes").count();
          t.onsuccess = () => resolve(t.result);
        };
      }),
  );
  check("the queue is empty", left === 0, String(left));
} finally {
  sql(`UPDATE "Block" SET text='${BLOCK_TEXT.replace(/'/g, "''")}' WHERE id='rev4-b4'`);
  sql(`DELETE FROM "Note" WHERE content LIKE '%${TAG}%'`); // this run's notes, with their sources
  await browser.close();
}
console.log(failed === 0 ? "\nall checks pass" : `\n${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
