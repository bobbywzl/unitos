// REV9-03, the browser side: a note edit queued offline by an editor whose
// role went to viewer meanwhile is refused on replay (403) and leaves the
// queue — and its words are kept in the account's not-saved list, which the
// offline pill says and copies on a press. Runs on a COPY of the database
// seeded with the review seeds (C = rev3-sc, account rev3-uc, editor of
// P = rev3-p; section rev5-s-p "P notes"; collaborator row rev3-c1) with a
// sign-in-on dev server on it:
//   DB=dissect_r9safe9 BASE=http://localhost:3176 OUT=<dir> LANG_UI=en WIDTH=1440 node scripts/qa/ui-dropped-words.mjs
// Makes one note of C's and deletes it; restores C's role; no draft is left.
import { execFileSync } from "node:child_process";
import { chromium } from "playwright-core";

const BASE = process.env.BASE ?? "http://localhost:3176";
const DB = process.env.DB ?? "";
if (!DB || DB === "dissect") throw new Error("Set DB to a copy of the database, never the shared one.");
const OUT = process.env.OUT ?? "";
const LANG = process.env.LANG_UI ?? "en";
const WIDTH = Number(process.env.WIDTH ?? 1440);
const SHOT = process.env.SHOT ?? "REV9-03-after";
const PHONE = WIDTH < 600;
const zh = LANG === "zh";
const q = (sql) =>
  execFileSync("psql", ["-h", "localhost", "-U", "postgres", "-d", DB, "-Atc", sql], { env: { ...process.env, PGPASSWORD: "postgres" } })
    .toString()
    .trim();
const TAG = `SAFE9 ${Date.now().toString(36)}`;
const NOTE = `safe9-n-${Date.now().toString(36)}`;
const WORDS = `${TAG} typed on the train: C's edit of the note`;
let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` | ${detail}` : ""}`);
};
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--disable-dev-shm-usage"] });
try {
  q(`INSERT INTO "Note"(id,"sectionId",content,"order","createdById","updatedAt") VALUES ('${NOTE}','rev5-s-p','${TAG} C own note',999,'rev3-uc',now())`);
  q(`UPDATE "NotebookCollaborator" SET role='VIEWER' WHERE id='rev3-c1'`);
  const ctx = await browser.newContext({ viewport: { width: WIDTH, height: PHONE ? 844 : 900 }, hasTouch: PHONE, isMobile: PHONE });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
  await ctx.addCookies([
    { name: "dissect-session", value: "rev3-sc", url: BASE },
    { name: "dissect-account", value: "rev3-uc", url: BASE },
    { name: "dissect-lang", value: LANG, url: BASE },
  ]);
  const page = await ctx.newPage();
  const warnings = [];
  page.on("console", (m) => {
    if (m.type() === "warning" || m.type() === "error") warnings.push(m.text());
  });
  await page.goto(`${BASE}/n/rev3-p?doc=rev3-d1`, { waitUntil: "networkidle", timeout: 300000 });
  const key = "unitos-not-saved:rev3-uc";
  const read = () => page.evaluate((k) => localStorage.getItem(k), key);
  check("the list starts empty", (await read()) === null, await read());
  // C's edit of C's own note, queued offline while C was an editor.
  await page.evaluate(
    async ({ NOTE, WORDS }) => {
      const db = await new Promise((res) => {
        const r = indexedDB.open("unitos-offline", 3);
        r.onsuccess = () => res(r.result);
      });
      const t = db.transaction("writes", "readwrite").objectStore("writes");
      t.add({ path: `/api/notes/${NOTE}`, method: "PATCH", body: { content: WORDS }, account: "rev3-uc", queuedAt: Date.now() - 3600e3 });
      await new Promise((r) => (t.transaction.oncomplete = r));
      window.dispatchEvent(new Event("online"));
    },
    { NOTE, WORDS },
  );
  const line = page.locator("[data-offline-not-saved]");
  await line.waitFor({ timeout: 20000 }).catch(() => {});
  const records = await page.evaluate(
    () =>
      new Promise((res) => {
        const r = indexedDB.open("unitos-offline", 3);
        r.onsuccess = () => {
          const c = r.result.transaction("writes").objectStore("writes").count();
          c.onsuccess = () => res(c.result);
        };
      }),
  );
  check("the refused edit left the queue (403: C is a viewer now)", records === 0, `records ${records}`);
  check("the note's words on the server are unchanged", q(`SELECT content FROM "Note" WHERE id='${NOTE}'`) === `${TAG} C own note`);
  const stored = await read();
  check("the edit's words are kept in C's not-saved list", stored?.includes(WORDS) === true, stored ?? "null");
  check("the pill says 1 offline change could not be saved, with Copy", (await line.count()) === 1 && (await line.first().innerText()).includes(zh ? "1 项离线更改无法保存" : "1 offline change could not be saved"), await line.first().innerText().catch(() => "no line"));
  console.log(`console warnings: ${warnings.length ? warnings.join(" / ").slice(0, 300) : "none"}`);
  if (OUT) await page.screenshot({ path: `${OUT}/${SHOT}-${LANG}-${WIDTH}.png` });
  if ((await line.count()) === 1) {
    await (PHONE ? line.first().dispatchEvent("click") : line.first().click());
    await page.waitForTimeout(800);
    const clip = await page.evaluate(() => navigator.clipboard.readText()).catch((e) => `clipboard error ${e.message}`);
    check("Copy puts the words on the clipboard", clip.includes(WORDS), clip.slice(0, 120));
    check("the list goes once copied", (await read()) === null && (await line.count()) === 0, await read());
    const copied = page.locator("[data-offline-not-saved-copied]");
    check("the pill says Copied", (await copied.count()) === 1 && (await copied.innerText()) === (zh ? "已复制" : "Copied"), await copied.innerText().catch(() => "no pill"));
  }
  await ctx.close();
} finally {
  await browser.close();
  q(`UPDATE "NotebookCollaborator" SET role='EDITOR' WHERE id='rev3-c1'`);
  q(`DELETE FROM "Note" WHERE id='${NOTE}'`);
}
console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAIL`);
process.exit(failed === 0 ? 0 : 1);
