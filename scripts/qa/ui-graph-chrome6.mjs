// Round 6 CHROME6: the graph's header, canvas and side lists made denser.
//   node scripts/qa/ui-graph-chrome6.mjs <port>
// Projects (from a copy of `dissect`): LINDA (7 documents, 9 generated, recommended links, notes across
// documents), FORTY (40 documents, none generated). Writes nothing: no Stitch command, no Accept.
// Checks: generated documents not drawn with the switch off (VIEW6-03) and the page switch draws them; no
// Generated content pill at 0; Scan for links and ✕ head the Recommended links list (VIEW6-02, VIEW6-11) and
// the ✕ closes it; a recommended link is at most 160 px; Generated content has a ✕; Find shows Ask Stitch and
// no Pick for two or more documents (WALK6-08); Open in notes shows on hover, always on touch (VIEW6-06); the
// key is under 420 px at 1440 and under 600 at 390 (VIEW6-10); at 1440 a node's card covers no node, and the
// node clicked stays under the pointer (VIEW6-05); on a phone every node of FORTY is in the canvas (WALK6-07)
// and every pill is in view (VIEW6-08). en and zh where words are read.
import { chromium } from "playwright-core";

const port = process.argv[2] || "3167";
const B = `http://localhost:${port}`;
const LINDA = process.env.LINDA || "cmuyh40a8005b7dv2ln1r7tiv";
const FORTY = process.env.FORTY || "cmuyh42hr00hs7dw1ate1069g";
const SHOT = process.env.SHOT ?? "/mnt/project-files/stitch-graph-loop/round-6/chrome6/checks";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const errors = [];
let failures = 0;
let passes = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures++;
  else passes++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
async function open(nb, width, height, lang, touch = false) {
  const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch });
  await ctx.addCookies([{ name: "dissect-lang", value: lang, url: B }]);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  await page.goto(`${B}/n/${nb}?graph=1`, { waitUntil: "load", timeout: 300000 });
  await page.locator(".react-flow__node").first().waitFor({ timeout: 120000 });
  await page.waitForTimeout(2500);
  return { ctx, page };
}

for (const lang of ["en", "zh"]) {
  const { ctx, page } = await open(LINDA, 1440, 900, lang);
  const genCount = Number(await page.locator('[data-track="graph-generated"] span').last().textContent());
  check(`${lang} VIEW6-03: switch off, no generated document drawn; the pill counts them`, genCount > 0 && (await page.locator(".react-flow__node.graph-generated").count()) === 0, `${genCount} counted`);
  await page.locator('[data-track="graph-provenance"]').click();
  await page.waitForTimeout(1500);
  check(`${lang} VIEW6-03: the page switch draws them`, (await page.locator(".react-flow__node.graph-generated").count()) === genCount);
  await page.locator('[data-track="graph-provenance"]').click();
  await page.waitForTimeout(1200);
  check(`${lang} VIEW6-03: off again, none drawn`, (await page.locator(".react-flow__node.graph-generated").count()) === 0);

  // VIEW6-02 / VIEW6-11: the Recommended links list.
  check(`${lang} VIEW6-02: no Scan for links in the header`, (await page.locator('.graph-pill-row [data-track="graph-recommend-links"]').count()) === 0);
  await page.locator('[data-track="graph-recommended-links"]').click();
  const rec = page.locator('[data-graph-side-list="recommended"]');
  await rec.waitFor();
  await page.waitForTimeout(500);
  const head = await rec.evaluate((el) => {
    const scan = el.querySelector('[data-track="graph-recommend-links"]')?.getBoundingClientRect();
    const close = el.querySelector('[data-track="graph-recommended-close"]')?.getBoundingClientRect();
    const first = el.querySelector("[data-graph-recommended]")?.getBoundingClientRect();
    return { scan: scan ? Math.round(scan.top) : null, close: close ? Math.round(close.top) : null, first: first ? Math.round(first.top) : null };
  });
  check(`${lang} VIEW6-02: Scan for links and ✕ head the list`, head.scan !== null && head.close !== null && Math.abs(head.scan - head.close) < 8 && (head.first === null || head.scan < head.first), JSON.stringify(head));
  const heights = await rec.locator("[data-graph-recommended]").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
  check(`${lang} VIEW6-11: a recommended link is at most 160 px`, heights.length > 0 && Math.max(...heights) <= 160, heights.join(","));
  check(`${lang} WALK6-08: the list's intro is the pill's tooltip`, ((await page.locator('[data-track="graph-recommended-links"]').getAttribute("data-tip")) ?? "").length > 40);
  if (lang === "en") await page.screenshot({ path: `${SHOT}/VIEW6-11-recommended-1440-${lang}.png` });
  await rec.locator('[data-track="graph-recommended-close"]').click();
  await page.waitForTimeout(500);
  check(`${lang} VIEW6-11: ✕ closes the list, the graph stays`, (await rec.count()) === 0 && (await page.locator(".graph-overlay").count()) === 1);

  await page.locator('[data-track="graph-generated"]').click();
  const gen = page.locator('[data-graph-side-list="generated"]');
  await gen.waitFor();
  check(`${lang} WALK6-08: Generated content has a ✕ and no intro line`, (await gen.locator('[data-track="graph-generated-close"]').count()) === 1 && (await gen.locator("> p").count()) === 0);
  await gen.locator('[data-track="graph-generated-close"]').click();
  await page.waitForTimeout(400);

  // WALK6-08: Find folds Pick into Ask Stitch.
  const find = page.locator('[data-track="graph-find"]');
  await find.click();
  await find.fill("will"); // LINDA's documents are in English
  await page.locator("[data-graph-find-summary]").waitFor({ timeout: 10000 });
  await page.waitForTimeout(2500);
  const groups = await page.locator("[data-graph-find-group]").count();
  if (groups >= 2) check(`${lang} WALK6-08: Find shows Ask Stitch and no Pick`, (await page.locator('[data-track="graph-find-ask"]').count()) === 1 && (await page.locator('[data-track="graph-find-pick"]').count()) === 0, `${groups} documents`);
  else check(`${lang} WALK6-08: Find found two documents to ask about`, false, `${groups}`);
  await find.fill("");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);

  // VIEW6-06: Open in notes shows on hover or focus with a mouse.
  await page.locator('[data-track="graph-notes"]').click();
  const notes = page.locator('[data-track-surface="graph-notes-list"]');
  await notes.waitFor();
  await page.waitForTimeout(600);
  const btn = notes.locator('[data-track="graph-notes-open"]').first();
  await page.mouse.move(5, 450);
  const restOpacity = await btn.evaluate((el) => getComputedStyle(el).opacity);
  await btn.locator("xpath=ancestor::*[contains(@class,'group/row')][1]").hover();
  await page.waitForTimeout(300);
  const hoverOpacity = await btn.evaluate((el) => getComputedStyle(el).opacity);
  check(`${lang} VIEW6-06: Open in notes hides at rest, shows on hover`, restOpacity === "0" && hoverOpacity === "1", `${restOpacity} → ${hoverOpacity}`);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);

  // VIEW6-10: the key.
  await page.locator('[data-track="graph-key"]').click();
  await page.waitForTimeout(500);
  const key = await page.locator("[data-graph-key]").boundingBox();
  check(`${lang} VIEW6-10: the key is under 420 px tall at 1440 (was 701)`, key && key.height < 420, JSON.stringify(key));
  check(`${lang} VIEW6-10: no generated-document row while none is drawn`, (await page.locator("[data-graph-key] li").count()) >= 10 && !(await page.locator("[data-graph-key]").innerText()).includes(lang === "en" ? "A generated document" : "生成文档："));
  if (lang === "en") await page.screenshot({ path: `${SHOT}/VIEW6-10-key-1440-${lang}.png` });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);

  // VIEW6-05: the fit keeps the card's room; a click moves no node; the card covers none.
  if (lang === "en") {
    const node = page.locator(".react-flow__node").nth(2);
    const before = await node.boundingBox();
    await page.mouse.click(before.x + before.width / 2, before.y + 16);
    await page.locator("[data-graph-node-card]").waitFor({ timeout: 10000 });
    await page.waitForTimeout(900);
    const after = await node.boundingBox();
    const card = await page.locator("[data-graph-node-card]").boundingBox();
    const covered = await page.evaluate((left) => [...document.querySelectorAll(".react-flow__node [data-graph-dot]")].filter((d) => d.getBoundingClientRect().right > left).length, card.x);
    check("VIEW6-05: the clicked node stays under the pointer", Math.abs(after.x - before.x) < 2 && Math.abs(after.y - before.y) < 2, `${Math.round(before.x)},${Math.round(before.y)} → ${Math.round(after.x)},${Math.round(after.y)}`);
    check("VIEW6-05: the card covers no node", covered === 0, `${covered}`);
    const zoom = await page.evaluate(() => Number(document.querySelector(".corpus-graph")?.style.getPropertyValue("--graph-zoom")));
    check("VIEW6-05: a small project frames above 1.1", zoom > 1.1, String(zoom));
    await page.screenshot({ path: `${SHOT}/VIEW6-05-card-1440-${lang}.png` });
  }
  await ctx.close();
}

// FORTY at 1440: no Generated content pill at 0 (VIEW6-03).
{
  const { ctx, page } = await open(FORTY, 1440, 900, "en");
  check("VIEW6-03: no Generated content pill with no generated document", (await page.locator('[data-track="graph-generated"]').count()) === 0);
  await ctx.close();
}

// Phones: every pill in view; FORTY frames every node (WALK6-07, VIEW6-08); the key (VIEW6-10).
for (const lang of ["en", "zh"]) {
  for (const nb of [LINDA, FORTY]) {
    const { ctx, page } = await open(nb, 390, 844, lang, true);
    const pills = await page.evaluate(() => [...document.querySelectorAll(".graph-pill-row > *")].map((el) => Math.round(el.getBoundingClientRect().right)));
    check(`${lang} 390 ${nb === LINDA ? "LINDA" : "FORTY"} VIEW6-08: every pill in view`, pills.every((r) => r <= 390), pills.join(","));
    if (nb === FORTY) {
      const inside = await page.evaluate(() => {
        const c = document.querySelector(".react-flow").getBoundingClientRect();
        const dots = [...document.querySelectorAll(".react-flow__node [data-graph-dot]")].map((d) => d.getBoundingClientRect());
        return { all: dots.length, in: dots.filter((r) => r.top >= c.top - 1 && r.bottom <= c.bottom + 1 && r.left >= c.left - 1 && r.right <= c.right + 1).length };
      });
      check(`${lang} WALK6-07: every node of forty is in the canvas`, inside.all >= 40 && inside.in === inside.all, JSON.stringify(inside));
      await page.screenshot({ path: `${SHOT}/WALK6-07-forty-390-${lang}.png` });
    } else {
      await page.locator('[data-track="graph-key"]').click();
      await page.waitForTimeout(500);
      const key = await page.locator("[data-graph-key]").boundingBox();
      check(`${lang} 390 VIEW6-10: the key is under 600 px tall (was 701)`, key && key.height < 600, JSON.stringify(key));
      await page.screenshot({ path: `${SHOT}/VIEW6-10-key-390-${lang}.png` });
    }
    await ctx.close();
  }
}

check("no page errors", errors.length === 0, errors.join(" | "));
console.log(failures === 0 ? `ALL PASS (${passes})` : `${failures} FAIL, ${passes} pass`);
await browser.close();
