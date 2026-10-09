// REV8-01's floor, in Chromium: a Note on this link written offline that the
// server still refuses on replay (here: the writer's role went to viewer
// meanwhile) puts its words back into the box; the next time the editor
// opens the link, Note on this link opens on them. Runs on a COPY of the
// database seeded with the review seeds (see link-remove-check.ts) with a
// sign-in-on dev server on it. C (rev3-sc) writes in P (rev3-p).
//
//   DB=dissect_r8safe8 BASE=http://localhost:3173 OUT=<dir> LANG_UI=en WIDTH=1440 node scripts/qa/ui-link-drop.mjs
// It creates one link and deletes it at the end, and puts C's role back.
import { execFileSync } from "node:child_process";
import { chromium } from "playwright-core";

const BASE = process.env.BASE ?? "http://localhost:3173";
const DB = process.env.DB ?? "dissect_r8safe8";
const OUT = process.env.OUT ?? "";
const LANG = process.env.LANG_UI ?? "en";
const WIDTH = Number(process.env.WIDTH ?? 1440);
const SHOT = process.env.SHOT ?? "REV8-01-after";
const PHONE = WIDTH < 600;
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
const zh = LANG === "zh";
const LINK = `safe8-ui-${Date.now().toString(36)}`;
const WORDS = `SAFE8 ${LINK}: what I make of this link, typed on the train`;
sql(`INSERT INTO "DocLink"(id,"createdById","notebookId","fromDocumentId","fromBlockId","startOffset","endOffset","quotedText",prefix,suffix,"toDocumentId","toBlockId","toQuotedText",reason)
     VALUES ('${LINK}','rev3-ua','rev3-p','rev4-d3','rev4-b3',0,9,'Suffering','',' is the ground','rev4-d4','rev4-b4','Compassion','SAFE8: the ground and the weakness')`);
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--disable-dev-shm-usage"] });
// On a phone the Stitch sheet can cover the panel (WALK5-12, not this check's subject): the press goes to the button itself.
const press = async (loc) => (PHONE ? loc.dispatchEvent("click") : loc.click());
try {
  const context = await browser.newContext({ viewport: { width: WIDTH, height: PHONE ? 844 : 900 }, hasTouch: PHONE, isMobile: PHONE });
  await context.addCookies([
    { name: "dissect-session", value: "rev3-sc", url: BASE },
    { name: "dissect-lang", value: LANG, url: BASE },
  ]);
  const page = await context.newPage();
  const card = page.locator(`[data-annotation-link-id="${LINK}"]:visible`).first();
  const panel = page.locator("[data-graph-link-panel]");
  // [lists9] WALK9-10: Note on this link fills the new note docked under the side list.
  const words = page.locator("[data-graph-note-gather-words]");
  async function openPanel() {
    await page.goto(`${BASE}/n/rev3-p?doc=rev4-d3&link=${LINK}`, { waitUntil: "networkidle", timeout: 300000 });
    if (PHONE) {
      const tab = page.getByRole("button", { name: zh ? "批注" : "Annotations", exact: true }).first();
      for (let i = 0; i < 6; i++) {
        await page.waitForTimeout(1500);
        await tab.tap();
        await card.waitFor({ timeout: 5000 }).catch(() => {});
        if (await card.isVisible().catch(() => false)) break;
      }
    }
    await card.waitFor({ timeout: 60000 });
    await card.scrollIntoViewIfNeeded();
    await press(card.getByRole("button", { name: zh ? "在图谱中显示" : "Show on graph" }));
    await panel.waitFor({ timeout: 60000 });
    await page.waitForTimeout(1200);
  }
  await openPanel();
  await page.evaluate(() => localStorage.setItem("unitos-premium", "1"));
  await press(panel.getByRole("button", { name: zh ? "就此链接写笔记" : "Note on this link" }));
  await words.waitFor({ timeout: 10000 });
  await words.fill(WORDS);
  await context.setOffline(true);
  await page.waitForTimeout(300);
  await press(page.locator('[data-track="graph-note-gather-save"]'));
  await page.waitForTimeout(1500);
  const draftNow = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("graph-link-note:") || k.startsWith("unitos-note-gather:")).map((k) => localStorage.getItem(k)).join(" "));
  check("offline: Save queues the note and the box lets the draft go", !draftNow.includes("typed on the train"), draftNow.slice(0, 120));
  // Meanwhile the owner makes C a viewer: the replay answers 403.
  sql(`UPDATE "NotebookCollaborator" SET role='VIEWER' WHERE id='rev3-c1'`);
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  let left = 1;
  for (let i = 0; i < 80 && left > 0; i++) {
    await page.waitForTimeout(250);
    left = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const req = indexedDB.open("unitos-offline");
          req.onsuccess = () => {
            const t = req.result.transaction("writes", "readonly").objectStore("writes").count();
            t.onsuccess = () => resolve(t.result);
          };
          req.onerror = () => resolve(-1);
        }),
    );
  }
  check("online: the queue drops the refused note", left === 0, String(left));
  check("…and no note was saved", sql(`SELECT count(*) FROM "Note" WHERE content LIKE 'SAFE8 ${LINK}%'`) === "0");
  // [lists9] WALK9-10, REV9-02: the words go to the link's draft, and the new
  // note takes them up at once while the link is open (its draft then holds
  // them, unitos-note-gather:…), else when the link opens again.
  const kept = await page.evaluate(() =>
    Object.keys(localStorage)
      .filter((k) => k.startsWith("graph-link-note:") || k.startsWith("unitos-note-gather:"))
      .map((k) => localStorage.getItem(k))
      .join(" "),
  );
  check("the words are kept in a draft (the link's, or the new note's while the link is open)", kept.includes(WORDS), kept.slice(0, 160));
  // C is an editor again and opens the link: the new note opens on the words, with the link's two ends.
  sql(`UPDATE "NotebookCollaborator" SET role='EDITOR' WHERE id='rev3-c1'`);
  await openPanel();
  await words.waitFor({ timeout: 10000 }).catch(() => {});
  const shown = (await words.count()) > 0 ? await words.inputValue() : "";
  check("the new note opens on the words when the link opens", shown === WORDS && (await page.locator("[data-graph-note-gather-quote]").count()) === 2, JSON.stringify(shown));
  if ((await words.count()) > 0) await words.scrollIntoViewIfNeeded();
  if (OUT) await page.screenshot({ path: `${OUT}/${SHOT}-${LANG}-${WIDTH}.png` });
  await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith("unitos-note-gather:")) localStorage.removeItem(k); });
  await context.close();
} finally {
  sql(`UPDATE "NotebookCollaborator" SET role='EDITOR' WHERE id='rev3-c1'`);
  sql(`DELETE FROM "Note" WHERE content LIKE 'SAFE8 ${LINK}%'`);
  sql(`DELETE FROM "BlockEdit" WHERE meta->>'linkId'='${LINK}'`);
  sql(`DELETE FROM "DocLink" WHERE id='${LINK}'`);
  await browser.close();
}
console.log(failed === 0 ? "\nall checks pass" : `\n${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
