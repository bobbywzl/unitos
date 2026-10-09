// Runs on a COPY seeded with the review seeds (see link-remove-check.ts), sign-in on:
//   BASE=http://localhost:3161 LANG_UI=en WIDTH=1440 node scripts/qa/ui-link-seen.mjs
// REV6-05: the new-replies marks. Two tabs of one browser (A in rev3-p, C replied on rev3-l1).
// 1. A first look writes its `since` from an effect (the store exists after load).
// 2. Tab 2's Links list shows "1 new" on rev3-l1; tab 1 opens the link's thread; tab 2's mark goes without a reload.
// 3. A mark of a link that no longer exists and is older than 90 days is pruned when the graph loads.
import { chromium } from "playwright-core";
const BASE = process.env.BASE ?? "http://localhost:3161", LANG = process.env.LANG_UI ?? "en", WIDTH = Number(process.env.WIDTH ?? 1440);
const OUT = process.env.OUT ?? "";
const KEY = "unitos-link-seen:rev3-ua:rev3-p", LINK = "rev3-l1";
let failed = 0;
const check = (n, ok, d = "") => { if (!ok) failed++; console.log(`${ok ? "ok  " : "FAIL"} ${n}${ok ? "" : " " + d}`); };
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--disable-dev-shm-usage"] });
const ctx = await browser.newContext({ viewport: { width: WIDTH, height: WIDTH < 600 ? 844 : 900 } });
await ctx.addCookies([{ name: "dissect-session", value: "rev3-sa", url: BASE }, { name: "dissect-lang", value: LANG, url: BASE }]);
const t1 = await ctx.newPage();
t1.on("pageerror", (e) => console.log("pageerror", e.message));
// 1. no store: the page writes one after render
await t1.goto(`${BASE}/n/rev3-p`, { waitUntil: "networkidle", timeout: 300000 });
await t1.evaluate((k) => localStorage.removeItem(k), KEY);
async function openGraph(page) {
  for (let i = 0; i < 5 && (await page.locator(".graph-overlay-in").count()) === 0; i++) {
    await page.click('[data-track="graph"]', { timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(1500);
  }
  await page.locator(".react-flow__edge").first().waitFor({ timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(1200);
}
await t1.reload({ waitUntil: "networkidle" });
await openGraph(t1);
const first = await t1.evaluate((k) => localStorage.getItem(k), KEY);
check("a first look stores its since after render", !!first && JSON.parse(first).since > "2026", String(first));
// seed: every reply is new; a gone link 200 days old, a gone link 1 day old
const old = new Date(Date.now() - 200 * 864e5).toISOString(), recent = new Date(Date.now() - 864e5).toISOString();
await t1.evaluate(([k, old, recent]) => localStorage.setItem(k, JSON.stringify({ since: "2000-01-01T00:00:00.000Z", links: { "gone-old": old, "gone-recent": recent } })), [KEY, old, recent]);
await t1.goto(`${BASE}/n/rev3-p`, { waitUntil: "networkidle" });
const t2 = await ctx.newPage();
await t2.goto(`${BASE}/n/rev3-p`, { waitUntil: "networkidle" });
await openGraph(t2);
const pruned = JSON.parse(await t2.evaluate((k) => localStorage.getItem(k), KEY));
check("prune: a gone link's mark older than 90 days goes", !("gone-old" in pruned.links), JSON.stringify(pruned));
check("prune: a gone link's recent mark stays (the answer had no provenance links)", "gone-recent" in pruned.links, JSON.stringify(pruned));
await t2.click('[data-track="graph-links"]');
await t2.waitForTimeout(1200);
const before = await t2.locator(`[data-graph-link-replies="${LINK}"] [data-graph-link-new-replies]`).count();
check("tab 2: rev3-l1 shows new replies", before > 0, String(before));
if (OUT) await t2.screenshot({ path: `${OUT}/REV6-05-tab2-before-${LANG}-${WIDTH}.png` });
// tab 1 opens the thread: from the Annotations tab's link card, Show on graph
await t1.goto(`${BASE}/n/rev3-p?doc=rev3-d1&link=${LINK}`, { waitUntil: "networkidle" });
await t1.waitForTimeout(1500);
const show = t1.locator(`[data-annotation-link-id="${LINK}"]:visible [data-track="link-show-on-graph"]`).first();
if (await show.count()) await show.click();
else await t1.locator('[data-track="link-show-on-graph"]:visible').first().click();
await t1.locator(`[data-graph-link-thread="${LINK}"]`).waitFor({ timeout: 60000 }).catch(() => {});
await t1.waitForTimeout(1000);
const marked = JSON.parse(await t1.evaluate((k) => localStorage.getItem(k), KEY));
check("tab 1: opening the thread marks the link seen", LINK in marked.links, JSON.stringify(marked));
check("tab 1's write kept the other marks", "gone-recent" in marked.links);
await t2.waitForTimeout(800);
const after = await t2.locator(`[data-graph-link-replies="${LINK}"] [data-graph-link-new-replies]`).count();
check("tab 2: the mark goes without a reload (storage event)", after === 0, String(after));
if (OUT) await t2.screenshot({ path: `${OUT}/REV6-05-tab2-after-${LANG}-${WIDTH}.png` });
await t1.evaluate((k) => localStorage.removeItem(k), KEY);
await browser.close();
console.log(failed ? `${failed} failed` : "all pass");
process.exit(failed ? 1 : 0);
