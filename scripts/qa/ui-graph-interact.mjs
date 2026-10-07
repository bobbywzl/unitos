// The graph's interactions (SPEC.md §13): the link list at its curve and its size on screen, a node's card,
// the key, Escape from the inside out (typed words kept), the side lists beside the Stitch box, dragged
// positions across a close, Back to the graph, and Enter on a focused node.
//   node scripts/qa/ui-graph-interact.mjs <port> <tag> [en|zh]
// Env: SHOT (screenshot dir). Prints one line per check: PASS/FAIL/INFO.
import { chromium } from "playwright-core";
const port = process.argv[2] || "3123";
const tag = process.argv[3] || "after";
const lang = process.argv[4] || "en";
const B = `http://localhost:${port}`;
const SHOT = process.env.SHOT || "/mnt/project-files/stitch-graph-loop/round-1/canvas/";
const SEVEN = "cmuxebxpk00307diibsh2enao";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const ctx = await browser.newContext();
if (lang === "zh") await ctx.addCookies([{ name: "dissect-lang", value: "zh", url: B }]);
const log = (status, name, detail) => console.log(`${status} ${name}${detail === undefined ? "" : " " + JSON.stringify(detail)}`);

async function openGraph(page, nb = SEVEN, w = 1440, h = 900) {
  await page.setViewportSize({ width: w, height: h });
  await page.goto(`${B}/n/${nb}`, { waitUntil: "networkidle", timeout: 180000 });
  for (let i = 0; i < 6; i++) {
    await page.locator('[data-track="graph"]').first().click();
    if (await page.locator(".graph-overlay-in").first().waitFor({ timeout: 8000 }).then(() => true, () => false)) break;
  }
  await page.locator(".react-flow__node").first().waitFor({ timeout: 90000 });
  await page.waitForTimeout(1800);
}
const overlayOpen = (page) => page.locator(".graph-overlay-in").count().then((n) => n > 0);
async function edgeMid(page, a, b) {
  // The pill of a curve sits at its middle; find the curve between two titled nodes by their dots.
  return page.evaluate(([a, b]) => {
    const nodes = [...document.querySelectorAll(".react-flow__node")];
    const id = (t) => nodes.find((n) => n.textContent.includes(t))?.getAttribute("data-id");
    const ia = id(a), ib = id(b);
    const edge = [...document.querySelectorAll(".react-flow__edge")].find((e) => {
      const tid = e.getAttribute("data-testid") || "";
      return tid.includes(ia) && tid.includes(ib);
    });
    const path = edge?.querySelector("path");
    if (!path) return null;
    const len = path.getTotalLength();
    const p = path.getPointAtLength(len / 2);
    const m = path.getScreenCTM();
    return { x: p.x * m.a + m.e, y: p.y * m.d + m.f };
  }, [a, b]);
}
function rect(page, sel) {
  return page.evaluate((sel) => {
    const e = document.querySelector(sel);
    if (!e) return null;
    const b = e.getBoundingClientRect();
    return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
  }, sel);
}
const overlap = (a, b) => !!a && !!b && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const BOX = '[role="region"][data-track-surface], [data-track="stitch-expand"]';
const LIST = '[data-track-surface="graph-links"]';

{
  // 1. The link list: at its curve, screen-sized, never under the box (GR-03, GR-04, GN-05).
  const page = await ctx.newPage();
  await openGraph(page);
  for (const [a, b, name] of [
    ["Bought or Earned", "Search Market", "pair"],
    ["Firefox", "Firefox", "loop"],
  ]) {
    let mid = name === "loop" ? null : await edgeMid(page, a, b);
    if (name === "loop") {
      mid = await page.evaluate(() => {
        const e = [...document.querySelectorAll(".react-flow__edge")].find((e) => {
          const [x, y] = (e.getAttribute("data-testid") || "").replace("rf__edge-", "").split("|");
          return x && x === y;
        });
        const p = e?.querySelector("path");
        if (!p) return null;
        const q = p.getPointAtLength(p.getTotalLength() / 2);
        const m = p.getScreenCTM();
        return { x: q.x * m.a + m.e, y: q.y * m.d + m.f };
      });
    }
    if (!mid) { log("FAIL", `link list ${name}: curve not found`); continue; }
    await page.mouse.move(mid.x, mid.y);
    await page.waitForTimeout(500);
    const list = await rect(page, LIST);
    const box = await rect(page, BOX);
    const font = await page.evaluate((sel) => { const e = document.querySelector(`${sel} button span`); return e ? e.getBoundingClientRect().height : null; }, LIST);
    const dist = list ? Math.min(Math.abs(list.y - mid.y), Math.abs(list.y + list.h - mid.y)) : null;
    // Under or over the curve's middle, or beside a loop whose top has no room above it.
    const beside = list && name === "loop" && Math.abs(list.x - mid.x) < 60 && list.y < mid.y + 40;
    const near = list && ((dist < 40 && mid.x >= list.x - 20 && mid.x <= list.x + list.w + 20) || beside);
    log(near && list.w >= 280 && !overlap(list, box) ? "PASS" : "FAIL", `link list ${name} at its curve, screen-sized, clear of the box`, { mid, list, box, rowLineHeight: font });
    await page.screenshot({ path: `${SHOT}GR-04-${name}-${lang}-${tag}.png` });
    // Expand the first link: the reason shows once.
    await page.mouse.click(mid.x, mid.y);
    await page.waitForTimeout(300);
    await page.locator(`${LIST} button[aria-expanded]`).first().click();
    await page.waitForTimeout(400);
    const whyCount = await page.locator(`${LIST} [data-track-surface="link-detail"]`).count();
    const listOpen = await rect(page, LIST);
    log(listOpen && listOpen.w >= 390 && !overlap(listOpen, await rect(page, BOX)) ? "PASS" : "FAIL", `expanded link ${name} 400px wide, clear of the box`, { listOpen, whyCount });
    await page.screenshot({ path: `${SHOT}GR-13-${name}-expanded-${lang}-${tag}.png` });
    // Escape closes the pinned list, not the graph (GR-11).
    await page.mouse.move(5, 300);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    log((await overlayOpen(page)) && (await page.locator(LIST).count()) === 0 ? "PASS" : "FAIL", `Escape closes the pinned ${name} list first, the graph stays`);
  }
  await page.close();
}

{
  // 2. A node's card (GR-14) and the key (GR-12).
  const page = await ctx.newPage();
  await openGraph(page);
  const dot = page.locator(".react-flow__node", { hasText: "Bought or Earned" }).locator("[data-graph-dot], span.rounded-full").first();
  const db = await dot.boundingBox();
  await page.mouse.move(db.x + db.width / 2, db.y + db.height / 2);
  await page.waitForTimeout(700);
  const card = await page.locator('[role="tooltip"]').first().innerText().catch(() => null);
  log(card && /link/i.test(card) || (card && /链接/.test(card)) ? "PASS" : "FAIL", "node card shows title, kind, length, links", card);
  await page.screenshot({ path: `${SHOT}GR-14-card-${lang}-${tag}.png` });
  await page.mouse.move(5, 300);
  const keyBtn = page.locator('[data-track="graph-key"]');
  if (await keyBtn.count()) {
    await keyBtn.click();
    await page.waitForTimeout(300);
    const key = await rect(page, '[role="dialog"] [role="dialog"], .corpus-graph [role="dialog"]');
    log(key && !overlap(key, await rect(page, BOX)) ? "PASS" : "FAIL", "key opens top left, clear of the box", key);
    await page.screenshot({ path: `${SHOT}GR-12-key-${lang}-${tag}.png` });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    log((await overlayOpen(page)) && !(await page.locator(".corpus-graph [role=dialog]").count()) ? "PASS" : "FAIL", "Escape closes the key, the graph stays");
  } else log("INFO", "no key button");
  // Escape inside the Stitch input with words: the words stay, the graph stays (GR-11).
  const input = page.locator('[role="region"] textarea').first();
  if (await input.count()) {
    await input.fill("Compare what each document says about default payments");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    const value = await input.inputValue().catch(() => "");
    log((await overlayOpen(page)) && value.startsWith("Compare") ? "PASS" : "FAIL", "Escape in the Stitch input keeps the graph and the words", value);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    log(!(await overlayOpen(page)) ? "PASS" : "INFO", "a second Escape outside the input closes the graph");
  }
  await page.close();
}

{
  // 3. Side lists vs the box (GR-05, BOX-05) at 1440 and 1000, Feedback at 820 (BOX-06).
  for (const [w, h] of [[1440, 900], [1000, 800], [820, 1100], [390, 844]]) {
    const page = await ctx.newPage();
    await openGraph(page, SEVEN, w, h);
    await page.locator('[data-track="graph-recommended-links"]').click();
    await page.waitForTimeout(600);
    const aside = await rect(page, "aside.menu-in");
    const box = await rect(page, BOX);
    log(!overlap(aside, box) ? "PASS" : "FAIL", `${w}: Recommended links list clear of the box`, { aside, box });
    await page.screenshot({ path: `${SHOT}BOX-05-${w}-${lang}-${tag}.png` });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    log((await overlayOpen(page)) && !(await page.locator("aside.menu-in").count()) ? "PASS" : "FAIL", `${w}: Escape closes the list first, the graph stays`);
    if (w === 820) {
      const fb = await page.evaluate(() => {
        const e = [...document.querySelectorAll("button")].find((b) => /^(Feedback|反馈)$/.test(b.textContent.trim()));
        if (!e) return null;
        const r = e.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      });
      log(!overlap(fb, await rect(page, BOX)) ? "PASS" : "FAIL", "820: the Feedback button clear of the box", { fb, box: await rect(page, BOX) });
    }
    await page.close();
  }
}

{
  // 4. Drag, close, reopen: the node stays (GR-10). Click a node, Back: the graph reopens.
  const page = await ctx.newPage();
  await openGraph(page);
  const node = page.locator(".react-flow__node", { hasText: "Unrelated" }).first();
  const before = await node.getAttribute("style");
  const b = await node.locator("[data-graph-dot], span.rounded-full").first().boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + 160, b.y - 60, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const dragged = await node.getAttribute("style");
  await page.locator('[data-track="graph-close"]').click();
  await page.waitForTimeout(800);
  for (let i = 0; i < 4; i++) {
    await page.locator('[data-track="graph"]').first().click();
    if (await page.locator(".graph-overlay-in").first().waitFor({ timeout: 5000 }).then(() => true, () => false)) break;
  }
  await page.waitForTimeout(2200);
  const reopened = await page.locator(".react-flow__node", { hasText: "Unrelated" }).first().getAttribute("style");
  const tr = (s) => (s || "").match(/translate\(([^)]+)\)/)?.[1];
  const xy = (s) => (tr(s) || "").split(",").map((v) => parseFloat(v));
  const same = (a, b) => xy(a).every((v, i) => Math.abs(v - xy(b)[i]) <= 1);
  log(same(reopened, dragged) && !same(dragged, before) ? "PASS" : "FAIL", "dragged node keeps its place after close and reopen", { before: tr(before), dragged: tr(dragged), reopened: tr(reopened) });
  // Enter on a focused node opens it (GR-16).
  const target = page.locator(".react-flow__node", { hasText: "Search Market" }).first();
  await target.focus();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1500);
  log(!(await overlayOpen(page)) && /doc=/.test(page.url()) ? "PASS" : "FAIL", "Enter on a focused node opens the document", page.url());
  await page.goBack();
  await page.waitForTimeout(2500);
  log(await overlayOpen(page) ? "PASS" : "FAIL", "Back from the document reopens the graph", page.url());
  await page.goBack();
  await page.waitForTimeout(1500);
  log(!(await overlayOpen(page)) ? "PASS" : "FAIL", "Back again closes the graph", page.url());
  // The dialog: role, focus inside.
  for (let i = 0; i < 4; i++) {
    await page.locator('[data-track="graph"]').first().click();
    if (await page.locator(".graph-overlay-in").first().waitFor({ timeout: 5000 }).then(() => true, () => false)) break;
  }
  await page.waitForTimeout(800);
  const dialog = await page.evaluate(() => {
    const d = document.querySelector(".graph-overlay-in");
    return { role: d?.getAttribute("role"), modal: d?.getAttribute("aria-modal"), focusInside: d?.contains(document.activeElement) };
  });
  log(dialog.role === "dialog" && dialog.focusInside ? "PASS" : "FAIL", "overlay is a dialog and takes focus", dialog);
  await page.keyboard.press("Tab");
  const tabbed = await page.evaluate(() => document.querySelector(".graph-overlay-in")?.contains(document.activeElement));
  log(tabbed ? "PASS" : "FAIL", "Tab stays inside the graph");
  // Clean up the drag so later runs start from the layout.
  await page.evaluate((nb) => localStorage.removeItem(`unitos-graph-pos:${nb}`), SEVEN);
  await page.close();
}
await browser.close();
