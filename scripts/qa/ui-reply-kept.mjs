// REV9-02: the reply box on a link is open and typed in when the queue drops
// an older queued reply on the same link (the server refused it). The words
// go back into the box's draft after the typed ones (keepDroppedWords) and
// the open box shows them at once, so the next keystroke writes over
// nothing. Runs on a COPY of the database seeded with the review seeds (see
// link-remove-check.ts: A = rev3-sa owns P = rev3-p, link rev3-l1) with a
// sign-in-on dev server on it.
//   DB=dissect_r9safe9 BASE=http://localhost:3176 OUT=<dir> LANG_UI=en WIDTH=1440 node scripts/qa/ui-reply-kept.mjs
// Nothing is saved on the server (the queued reply is refused); the box is
// emptied at the end so no draft is left.
import { chromium } from "playwright-core";

const BASE = process.env.BASE ?? "http://localhost:3176";
const OUT = process.env.OUT ?? "";
const LANG = process.env.LANG_UI ?? "en";
const WIDTH = Number(process.env.WIDTH ?? 1440);
const SHOT = process.env.SHOT ?? "REV9-02-after";
const PHONE = WIDTH < 600;
const zh = LANG === "zh";
const LINK = "rev3-l1";
const OLD = `SAFE9 kept ${Date.now().toString(36)}: the reply I typed on the train`;
let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` | ${detail}` : ""}`);
};
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--disable-dev-shm-usage"] });
// On a phone the Stitch sheet can cover the panel (WALK5-12, not this check's subject): the press goes to the button itself.
const press = async (loc) => (PHONE ? loc.dispatchEvent("click") : loc.click());
try {
  const ctx = await browser.newContext({ viewport: { width: WIDTH, height: PHONE ? 844 : 900 }, hasTouch: PHONE, isMobile: PHONE });
  await ctx.addCookies([
    { name: "dissect-session", value: "rev3-sa", url: BASE },
    { name: "dissect-account", value: "rev3-ua", url: BASE },
    { name: "dissect-lang", value: LANG, url: BASE },
  ]);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/n/rev3-p?doc=rev3-d1&link=${LINK}`, { waitUntil: "networkidle", timeout: 300000 });
  const card = page.locator(`[data-annotation-link-id="${LINK}"]:visible`).first();
  if (PHONE) {
    const tab = page.getByRole("button", { name: zh ? "批注" : "Annotations", exact: true }).first();
    for (let i = 0; i < 6; i++) {
      await page.waitForTimeout(1500);
      await tab.tap();
      await card.waitFor({ timeout: 5000 }).catch(() => {});
      if (await card.isVisible().catch(() => false)) break;
    }
  }
  await card.waitFor({ timeout: 90000 });
  await card.scrollIntoViewIfNeeded();
  await press(card.getByRole("button", { name: zh ? "在图谱中显示" : "Show on graph" }));
  const panel = page.locator("[data-graph-link-panel]");
  await panel.waitFor({ timeout: 90000 });
  await page.waitForTimeout(1200);
  await press(panel.getByRole("button", { name: zh ? "回复" : "Reply", exact: true }).first());
  const box = panel.locator("textarea").first();
  await box.waitFor({ timeout: 10000 });
  await box.fill("New thought");
  const key = `unitos-reply-draft:rev3-ua:link:${LINK}`;
  const read = () => page.evaluate((k) => localStorage.getItem(k), key);
  check("typing writes the draft", (await read())?.includes("New thought"), await read());
  // An older queued reply on this link that the server refuses (404: asked from a project that is not the link's).
  await page.evaluate(
    async ({ LINK, OLD }) => {
      const db = await new Promise((res) => {
        const r = indexedDB.open("unitos-offline", 3);
        r.onsuccess = () => res(r.result);
      });
      const t = db.transaction("writes", "readwrite").objectStore("writes");
      t.add({ path: "/api/replies", method: "POST", body: { docLinkId: LINK, notebookId: "safe9-not-this-project", content: OLD }, account: "rev3-ua", queuedAt: Date.now() - 3600e3 });
      await new Promise((r) => (t.transaction.oncomplete = r));
      window.dispatchEvent(new Event("online"));
    },
    { LINK, OLD },
  );
  let kept = null;
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(250);
    kept = await read();
    if (kept?.includes("train")) break;
  }
  check("the dropped reply's words go into the draft, after the typed ones", kept?.includes("New thought") && kept?.includes("train"), kept);
  await page.waitForTimeout(300);
  const shown = await box.inputValue();
  check("the open box shows the kept words", shown.includes("train") && shown.startsWith("New thought"), JSON.stringify(shown));
  await box.press("End");
  await box.type(" and one more", { delay: 30 });
  await page.waitForTimeout(500);
  const after = await read();
  check("after 13 more keystrokes the draft still holds the kept words", after?.includes("train") && after?.includes("and one more"), after);
  if (OUT) {
    await box.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${OUT}/${SHOT}-${LANG}-${WIDTH}.png` });
  }
  await box.fill("");
  check("emptying the box clears the draft", (await read()) === null, await read());
  await ctx.close();
} finally {
  await browser.close();
}
console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAIL`);
process.exit(failed === 0 ? 0 : 1);
