// Round 2 graph checks (GRAPH2) on a small project with generated documents: the header counts, the
// provenance switch, a link in the side panel, the Links list, Back to the same view, the canvas by keyboard,
// node positions across a Stitch answer, the Stitch box's cap, the second open's fit, the phone, and zh.
//   node scripts/qa/ui-graph-r2.mjs <port> [projectId] [tag]
// The project is the GRAPH2 seed (.qa-tmp/stitch/r2/graph/seed.sql, id g2-gen). A Stitch command writes a
// generated document into that project (mock models).
import { chromium } from "playwright-core";
import { writeFileSync } from "node:fs";
const port = process.argv[2] || "3142";
const NB = process.argv[3] || "g2-gen";
const tag = process.argv[4] || "after";
const B = `http://localhost:${port}`;
const SHOT = process.env.SHOT ?? "/mnt/project-files/stitch-graph-loop/round-2/graph";
const OUT = process.env.OUT ?? "/home/user/unitos/.qa-tmp/stitch/r2/graph";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const res = {};
const errors = [];

async function newPage(width, height, lang, touch = false) {
  const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch });
  await ctx.addCookies([{ name: "dissect-lang", value: lang, url: B }]);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  return { ctx, page };
}
async function openGraph(page) {
  await page.goto(`${B}/n/${NB}`, { waitUntil: "networkidle", timeout: 300000 });
  // A click before hydration does nothing: click again until the graph is up.
  for (let i = 0; i < 6 && (await page.locator(".graph-overlay-in").count()) === 0; i++) {
    await page.locator('[data-track="graph"]').first().click();
    await page.waitForTimeout(1500);
  }
  await page.locator(".react-flow__node").first().waitFor({ timeout: 60000 });
  await page.waitForTimeout(1800);
}
const positions = (page) =>
  page.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll(".react-flow__node")].map((n) => [n.getAttribute("data-id"), n.style.transform]),
    ),
  );
const active = (page) =>
  page.evaluate(() => {
    const a = document.activeElement;
    return {
      tag: a?.tagName,
      node: a?.closest(".react-flow__node")?.getAttribute("data-id") ?? null,
      edge: a?.closest(".react-flow__edge")?.getAttribute("data-testid") ?? null,
      inList: Boolean(a?.closest("[data-curve-list]")),
      label: a?.getAttribute("aria-label") ?? a?.textContent?.slice(0, 40),
    };
  });

{
  const { ctx, page } = await newPage(1440, 900, "en");
  await openGraph(page);
  res.header = await page.locator('[role="dialog"] [data-graph-title]').evaluate((el) => el.parentElement.textContent.replace(/\s+/g, " ").slice(0, 200));
  res.edgesBefore = await page.locator(".react-flow__edge").count();
  // Provenance switch (WALK2-02).
  const prov = page.locator('[data-track="graph-provenance"]');
  res.provenanceSwitch = await prov.count();
  if (res.provenanceSwitch) {
    const opacity = () => page.locator(".react-flow__node.graph-generated").first().evaluate((n) => getComputedStyle(n).opacity);
    res.generatedOpacityOff = await opacity();
    await prov.click();
    await page.waitForTimeout(400);
    res.edgesWithProvenance = await page.locator(".react-flow__edge").count();
    res.provenanceCurves = await page.locator(".graph-prov-curve").count();
    res.generatedOpacityOn = await opacity();
    await page.mouse.move(5, 5);
    await page.screenshot({ path: `${SHOT}/WALK2-02-provenance-${tag}.png` });
    await prov.click();
  }

  // Keyboard (REV2-10): title → Skip to Stitch; Tab into the canvas; arrows; ] to a curve; Enter pins and
  // focuses its list; Esc back to the curve, Esc back to the node; Tabs from the node to the Stitch box.
  await page.locator("[data-graph-title]").focus();
  await page.keyboard.press("Tab");
  res.firstTab = await active(page);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
  res.afterSkip = await active(page);
  await page.locator("[data-graph-title]").focus();
  let tabsToCanvas = -1;
  for (let i = 1; i < 40; i++) {
    await page.keyboard.press("Tab");
    if ((await active(page)).node) {
      tabsToCanvas = i;
      break;
    }
  }
  res.tabsTitleToCanvas = tabsToCanvas;
  const startNode = (await active(page)).node;
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(250);
  res.arrowRight = { from: startNode, to: (await active(page)).node };
  await page.keyboard.press("]");
  await page.waitForTimeout(400);
  res.bracket = await active(page);
  res.bracketListShown = await page.locator("[data-curve-list]").count();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(500);
  res.enterOnCurve = await active(page);
  await page.screenshot({ path: `${SHOT}/REV2-10-${tag}.png` });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  res.escFromList = await active(page);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  res.escFromCurve = await active(page);
  let tabsToStitch = -1;
  for (let i = 1; i < 80; i++) {
    await page.keyboard.press("Tab");
    const a = await active(page);
    if (a.tag === "TEXTAREA" && a.label === "Stitch") {
      tabsToStitch = i;
      break;
    }
  }
  res.tabsCanvasToStitch = tabsToStitch;
  res.names = await page.evaluate(() => [...document.querySelectorAll(".react-flow__edge")].map((e) => e.getAttribute("aria-label")));

  // A link in the side panel (WALK2-05): click a curve's first link row.
  await page.keyboard.press("Escape").catch(() => {});
  // A point on the first link curve's path, in screen pixels.
  const at = await page.evaluate(() => {
    const path = document.querySelector(".react-flow__edge-link .graph-curve-stroke");
    const p = path.getPointAtLength(path.getTotalLength() * 0.4);
    const m = path.getScreenCTM();
    return { x: p.x * m.a + m.e, y: p.y * m.d + m.f };
  });
  await page.mouse.click(at.x, at.y);
  await page.waitForTimeout(500);
  const row = page.locator('[data-curve-list] [data-track="graph-link-expand"]').first();
  res.curveListRows = await row.count();
  if (res.curveListRows) {
    await row.click();
    await page.waitForTimeout(600);
    res.linkPanel = await page.locator("[data-graph-link-panel]").evaluate((el) => ({ h: el.getBoundingClientRect().height, scrollH: el.scrollHeight }));
    res.pinnedStill = await page.locator("[data-curve-list]").count();
    await page.screenshot({ path: `${SHOT}/WALK2-05-${tag}.png` });
  }

  // The Links list (WALK2-06) and its Back.
  await page.locator('[data-track="graph-links"]').click();
  await page.waitForTimeout(400);
  res.linksListRows = await page.locator('[data-track="graph-links-open"]').count();
  await page.locator('[data-track="graph-links-open"]').first().click();
  await page.waitForTimeout(400);
  res.linksListOpensPanel = await page.locator("[data-graph-link-panel]").count();
  await page.locator('[data-track="graph-link-panel-back"]').click();
  await page.waitForTimeout(300);
  res.panelBackToList = await page.locator('[data-track="graph-links-open"]').count();

  // Back from a document restores the list, the section, and the open note (WALK2-07).
  await page.mouse.move(5, 450);
  await page.keyboard.press("Escape"); // unpins the curve: the Notes list then lists across documents
  await page.waitForTimeout(300);
  await page.locator('[data-track="graph-notes"]').click();
  await page.waitForTimeout(400);
  const select = page.locator('[data-track="graph-notes-section"]');
  const option = await select.locator("option").nth(2).getAttribute("value");
  await select.selectOption(option);
  await page.waitForTimeout(300);
  await page.locator('[data-track="graph-notes-expand"]').first().click();
  await page.waitForTimeout(300);
  const openNote = await page.locator('[data-track="graph-notes-expand"][aria-expanded="true"]').count();
  await page.screenshot({ path: `${SHOT}/WALK2-07-${tag}-1.png` });
  await page.locator('[data-track="graph-notes-jump"]').first().click();
  await page.waitForURL(/doc=/, { timeout: 30000 });
  await page.waitForTimeout(1500);
  await page.goBack();
  await page.locator(".react-flow__node").first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(1500);
  res.back = {
    beforeOpenNote: openNote,
    notesListOpen: await page.locator('[data-track-surface="graph-notes-list"]').count(),
    section: await page.locator('[data-track="graph-notes-section"]').inputValue().catch(() => null),
    sectionWanted: option,
    noteOpen: await page.locator('[data-track="graph-notes-expand"][aria-expanded="true"]').count(),
  };
  await page.screenshot({ path: `${SHOT}/WALK2-07-${tag}.png` });
  // ✕ drops the kept view.
  await page.locator('[data-track="graph-close"]').click();
  await page.waitForTimeout(500);
  await page.locator('[data-track="graph"]').first().click();
  await page.locator(".react-flow__node").first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(1500);
  res.afterCloseReopenListOpen = await page.locator('[data-track-surface="graph-notes-list"]').count();

  // Second open fits clear of the Stitch box (WALK2-15).
  const fitCheck = () =>
    page.evaluate(() => {
      const box = document.querySelector('[data-stitch-slot]')?.getBoundingClientRect();
      const bottoms = [...document.querySelectorAll("[data-graph-label]")].map((l) => l.getBoundingClientRect().bottom);
      return { boxTop: Math.round(box?.top ?? 0), maxLabelBottom: Math.round(Math.max(...bottoms)) };
    });
  res.secondOpenFit = await fitCheck();
  await page.screenshot({ path: `${SHOT}/WALK2-15-${tag}.png` });

  // Positions across Stitch answers (WALK2-03) and the box's cap (WALK2-04).
  const before = await positions(page);
  const nodesBefore = Object.keys(before).length;
  const input = page.locator('textarea[aria-label="Stitch"]');
  for (const [i, command] of ["How does Nietzsche's view of Schopenhauer change?", "And in BOOK TWO?", "Write one page that combines them"].entries()) {
    await input.fill(command);
    await input.press("Enter");
    await page.waitForFunction((n) => document.querySelectorAll('[role="log"] .markdown, [role="log"] p').length > n, i, { timeout: 120000 }).catch(() => {});
    await page.waitForTimeout(4000);
  }
  await page.waitForTimeout(3000);
  const after = await positions(page);
  const moved = Object.keys(before).filter((id) => after[id] && after[id] !== before[id]);
  res.stitch = { nodesBefore, nodesAfter: Object.keys(after).length, oldNodesMoved: moved.length };
  res.stitchLive = await page.locator('[role="log"][aria-live="polite"]').count();
  res.boxCap = await page.evaluate(() => {
    const pane = document.querySelector(".react-flow__pane").getBoundingClientRect();
    const box = document.querySelector('[role="region"][aria-label="Stitch"]').getBoundingClientRect();
    return { box: Math.round(box.height), canvas: Math.round(pane.height), share: +(box.height / pane.height).toFixed(2) };
  });
  await page.screenshot({ path: `${SHOT}/WALK2-04-${tag}.png` });
  await ctx.close();
}

// Phone (REV2-12, WALK2-06): the Links list reaches a link; the curve's hit path is wide.
{
  const { ctx, page } = await newPage(390, 844, "en", true);
  await openGraph(page);
  res.phoneHit = await page.locator(".graph-edge-hit").first().evaluate((p) => getComputedStyle(p).strokeWidth);
  res.phoneNodeHit = await page.locator(".react-flow__node").first().evaluate((n) => {
    const b = getComputedStyle(n, "::before");
    return { w: b.width, h: b.height };
  });
  await page.locator('[data-track="graph-links"]').scrollIntoViewIfNeeded();
  await page.locator('[data-track="graph-links"]').tap();
  await page.waitForTimeout(400);
  await page.locator('[data-track="graph-links-open"]').first().tap();
  await page.waitForTimeout(500);
  res.phoneLinkPanel = await page.locator("[data-graph-link-panel]").count();
  await page.screenshot({ path: `${SHOT}/WALK2-06-${tag}.png` });
  await ctx.close();
}

// zh (WALK2-17): the zoom names, the curve names, a generated date, the Links list.
{
  const { ctx, page } = await newPage(1440, 900, "zh");
  await openGraph(page);
  res.zh = await page.evaluate(() => ({
    zoom: [...document.querySelectorAll(".react-flow__controls-button")].map((b) => b.getAttribute("aria-label")),
    curves: [...document.querySelectorAll(".react-flow__edge")].slice(0, 8).map((e) => e.getAttribute("aria-label")),
  }));
  await page.locator('[data-track="graph-generated"]').click();
  await page.waitForTimeout(400);
  res.zh.generatedDate = await page.locator('[data-track="generated-open"] span').last().textContent();
  await page.locator('[data-track="graph-links"]').click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOT}/WALK2-17-${tag}.png` });
  await ctx.close();
}

res.errors = errors;
writeFileSync(`${OUT}/r2-${tag}.json`, JSON.stringify(res, null, 2));
console.log(JSON.stringify(res, null, 2));
await browser.close();
