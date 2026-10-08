// The reader's side of WALK5-01, WALK5-08 and WALK5-02, in Chromium:
//   1. Remove on a link card in the Annotations tab hides the link and shows
//      "Link removed · Undo"; Undo brings the card back.
//   2. An editor's Remove on the owner's link asks first and names the maker;
//      the owner's History offers Restore, and Restore brings it back.
//   3. Note on this link: Cancel folds the box and keeps the words; on a
//      phone, Save and Cancel are 44 px tall and 12 px apart.
// Runs on a COPY of the database seeded with the review seeds (see
// link-remove-check.ts) with a sign-in-on dev server on it.
//
//   DB=dissect_r5safe5 BASE=http://localhost:3161 OUT=<dir> LANG_UI=en WIDTH=1440 node scripts/qa/ui-link-remove.mjs
// It creates one link and deletes it (with its edits) at the end.
import { execFileSync } from "node:child_process";
import { chromium } from "playwright-core";

const BASE = process.env.BASE ?? "http://localhost:3161";
const DB = process.env.DB ?? "dissect_r5safe5";
const OUT = process.env.OUT ?? "";
const LANG = process.env.LANG_UI ?? "en";
const WIDTH = Number(process.env.WIDTH ?? 1440);
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
const L = {
  remove: zh ? "移除" : "Remove",
  undo: zh ? "撤销" : "Undo",
  restore: zh ? "恢复" : "Restore",
  noteOnLink: zh ? "就此链接写笔记" : "Note on this link",
  cancel: zh ? "取消" : "Cancel",
};
const LINK = `safe5-ui-${Date.now().toString(36)}`;
sql(`INSERT INTO "DocLink"(id,"createdById","notebookId","fromDocumentId","fromBlockId","startOffset","endOffset","quotedText",prefix,suffix,"toDocumentId","toBlockId","toQuotedText",reason)
     VALUES ('${LINK}','rev3-ua','rev3-p','rev4-d3','rev4-b3',0,9,'Suffering','',' is the ground','rev4-d4','rev4-b4','Compassion','SAFE5: the ground and the weakness')`);
const hidden = () => sql(`SELECT count(*) FROM "DocLinkHidden" WHERE "docLinkId"='${LINK}'`);
const shot = async (page, name) => OUT && page.screenshot({ path: `${OUT}/${name}-${LANG}-${WIDTH}.png` });

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--disable-dev-shm-usage"] });
async function as(session) {
  const context = await browser.newContext({ viewport: { width: WIDTH, height: PHONE ? 844 : 900 }, hasTouch: PHONE, isMobile: PHONE });
  await context.addCookies([
    { name: "dissect-session", value: session, url: BASE },
    { name: "dissect-lang", value: LANG, url: BASE },
  ]);
  return { context, page: await context.newPage() };
}
const card = (page) => page.locator(`[data-annotation-link-id="${LINK}"]:visible`).first();
async function openCard(page) {
  await page.goto(`${BASE}/n/rev3-p?doc=rev4-d3&link=${LINK}`, { waitUntil: "networkidle", timeout: 300000 });
  // On a phone the Annotations tab opens from the rail.
  if (PHONE) {
    // A tap before the page hydrates does nothing (a busy dev server takes seconds): tap again until the tab opens.
    const tab = page.getByRole("button", { name: zh ? "批注" : "Annotations", exact: true }).first();
    for (let i = 0; i < 6; i++) {
      await page.waitForTimeout(1500);
      await tab.tap();
      await card(page).waitFor({ timeout: 5000 }).catch(() => {});
      if (await card(page).isVisible().catch(() => false)) break;
    }
  }
  await card(page).waitFor({ timeout: 60000 }).catch(async (e) => {
    if (process.env.DEBUG) await page.screenshot({ path: process.env.DEBUG });
    throw e;
  });
  await card(page).scrollIntoViewIfNeeded();
}
const press = async (loc) => (PHONE ? loc.tap() : loc.click());

try {
  // ── 1. Remove, then Undo (A, the link's maker) ───────────────────────────
  {
    const { context, page } = await as("rev3-sa");
    await openCard(page);
    let dialog = null;
    page.on("dialog", async (d) => {
      dialog = d.message();
      await d.accept();
    });
    await shot(page, "WALK5-01-card");
    await press(card(page).getByRole("button", { name: L.remove, exact: true }));
    await page.locator("[data-link-removed]").waitFor({ timeout: 60000 });
    check("A's Remove on A's own link asks nothing", dialog === null, String(dialog));
    check("…the link is hidden, its row kept", hidden() === "1" && sql(`SELECT count(*) FROM "DocLink" WHERE id='${LINK}'`) === "1");
    for (let i = 0; i < 40 && (await page.locator(`[data-annotation-link-id="${LINK}"]`).count()) > 0; i++) await page.waitForTimeout(250);
    check("…the card goes and the Undo line shows", (await page.locator(`[data-annotation-link-id="${LINK}"]`).count()) === 0 && (await page.locator("[data-link-removed]").isVisible()));
    await shot(page, "WALK5-01-after-removed");
    const undoUrl = page.waitForRequest((r) => r.method() === "DELETE" && r.url().includes("/hidden?"));
    await press(page.locator("[data-link-removed]").getByRole("button", { name: L.undo }));
    check("Undo names its Remove's edit (REV7-06)", /[?&]edit=[^&]+/.test((await undoUrl).url()), (await undoUrl).url());
    await card(page).waitFor({ timeout: 20000 });
    check("Undo: the card is back and the hide row gone", hidden() === "0");
    await context.close();
  }

  // ── 2. C (editor) removes A's link: the confirm names A; A restores ──────
  {
    const { context, page } = await as("rev3-sc");
    await openCard(page);
    let dialog = null;
    page.on("dialog", async (d) => {
      dialog = d.message();
      await d.accept();
    });
    await press(card(page).getByRole("button", { name: L.remove, exact: true }));
    await page.locator("[data-link-removed]").waitFor({ timeout: 60000 });
    console.log("   confirm:", dialog);
    check("C's Remove on A's link asks and names A", !!dialog && dialog.includes("Rev A"), String(dialog));
    check("…hidden in P", hidden() === "1");
    await context.close();
  }
  if (!PHONE) {
    const { context, page } = await as("rev3-sa");
    await page.goto(`${BASE}/n/rev3-p?doc=rev4-d3`, { waitUntil: "networkidle", timeout: 300000 });
    const historyButton = page.locator('[data-track="history"]');
    for (let i = 0; i < 5 && (await historyButton.getAttribute("aria-expanded")) !== "true"; i++) {
      await historyButton.click();
      await page.waitForTimeout(800);
    }
    const restore = page.locator(`[data-history-restore="${LINK}"]`);
    await restore.waitFor({ timeout: 20000 });
    await shot(page, "WALK5-08-after-history-restore");
    await restore.click();
    for (let i = 0; i < 40 && hidden() !== "0"; i++) await page.waitForTimeout(250);
    check("A's History Restore brings C's removal back", hidden() === "0");
    await page.waitForTimeout(1500);
    check("…and History reads restored a link", (await page.getByText(zh ? "恢复了一个链接" : "restored a link").count()) > 0);
    await shot(page, "WALK5-08-after-history-restored");
    await context.close();
  } else {
    sql(`DELETE FROM "DocLinkHidden" WHERE "docLinkId"='${LINK}'`); // History is not on a phone's header
  }

  // ── 3. Note on this link: Cancel keeps the words ─────────────────────────
  {
    const { context, page } = await as("rev3-sa");
    await openCard(page);
    await press(card(page).getByRole("button", { name: zh ? "在图谱中显示" : "Show on graph" }));
    const panel = page.locator("[data-graph-link-panel]");
    await panel.waitFor({ timeout: 60000 });
    await page.waitForTimeout(1200);
    const opener = panel.getByRole("button", { name: L.noteOnLink });
    await opener.scrollIntoViewIfNeeded();
    await press(opener);
    const form = panel.locator(`[data-graph-link-note-composer="${LINK}"]`);
    await form.waitFor({ timeout: 10000 });
    const words = "SAFE5: a long thought typed with my thumb about the ground and the weakness";
    await form.locator("textarea").fill(words);
    const cancel = form.locator('[data-track="graph-link-note-cancel"]');
    const save = form.locator('[data-track="graph-link-note-save"]');
    await cancel.scrollIntoViewIfNeeded();
    const cb = await cancel.boundingBox();
    const sb = await save.boundingBox();
    console.log("   cancel", cb, "save", sb);
    if (PHONE) {
      check("phone: Cancel and Save are 44 px tall", cb.height >= 44 && sb.height >= 44, `${cb.height} ${sb.height}`);
      check("phone: 12 px between them", sb.x - (cb.x + cb.width) >= 12, String(sb.x - (cb.x + cb.width)));
    }
    await shot(page, "WALK5-02-after-composer");
    await press(cancel);
    await page.waitForTimeout(500);
    const stored = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("graph-link-note:")).map((k) => localStorage.getItem(k)));
    check("Cancel folds the box and keeps the draft in the browser", (await form.count()) === 0 && stored.some((v) => v?.includes("SAFE5: a long thought")), JSON.stringify(stored).slice(0, 200));
    await press(panel.getByRole("button", { name: L.noteOnLink }));
    await form.waitFor({ timeout: 10000 });
    check("Note on this link opens on the words again", (await form.locator("textarea").inputValue()) === words);
    await form.locator("textarea").fill(""); // the reader empties the box: the draft goes
    await context.close();
  }
} finally {
  sql(`DELETE FROM "DocLinkHidden" WHERE "docLinkId"='${LINK}'`);
  sql(`DELETE FROM "BlockEdit" WHERE meta->>'linkId'='${LINK}'`);
  sql(`DELETE FROM "DocLink" WHERE id='${LINK}'`);
  await browser.close();
}
console.log(failed === 0 ? "\nall checks pass" : `\n${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
