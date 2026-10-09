// The Documents list (VIEW3-06, SPEC.md §13) and the graph's lighter data (COST3-03, COST3-04).
//   node scripts/qa/ui-graph-documents.mjs <port> <projectId> [provenanceProjectId] [tag]
// projectId: a project with links and gists (VIEW, 7 documents). provenanceProjectId: one with generated
// documents (Linda WALK). Screenshots go to SHOT (default the round 3 docs3 folder).
// Checks: the list does not open by itself; the header counts open it with one parts=titles call and no
// other call; one row per document in the graph's order (linked first); hover lights the node; a link row
// opens the link panel, whose passages load with one call and whose Back returns to the list; Esc closes the
// list and keeps the graph; a part jumps to the reader and Back finds the list; a reopen refetch is a 304;
// the provenance switch fetches ?provenance=1 and a generated document's card lists its links; the phone
// sheet; zh.
import { chromium } from "playwright-core";

const port = process.argv[2] || "3164";
const NB = process.argv[3] || "cmuxjmvh7006t7d0bk8xjqaja";
const PROV = process.argv[4] || "cmuxjfnla005b7dx8rwkz1ekt";
const tag = process.argv[5] || "after";
const B = `http://localhost:${port}`;
const SHOT = process.env.SHOT ?? "/mnt/project-files/stitch-graph-loop/round-3/docs3";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const errors = [];
let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

async function newPage(width, height, lang, touch = false) {
  const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch });
  await ctx.addCookies([{ name: "dissect-lang", value: lang, url: B }]);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  const calls = [];
  page.on("response", (r) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith("/api/")) calls.push({ method: r.request().method(), path: u.pathname + u.search, status: r.status(), at: Date.now() });
  });
  return { ctx, page, calls };
}
async function openGraph(page, nb) {
  await page.goto(`${B}/n/${nb}`, { waitUntil: "networkidle", timeout: 300000 });
  for (let i = 0; i < 6 && (await page.locator(".graph-overlay-in").count()) === 0; i++) {
    await page.locator('[data-track="graph"]').first().click();
    await page.waitForTimeout(1500);
  }
  await page.locator(".react-flow__node").first().waitFor({ timeout: 60000 });
  await page.waitForTimeout(1800);
}
const list = (page) => page.locator("[data-graph-documents-list]");
// [chrome6] VIEW6-04: a row is one line until opened; open them all to read their lines.
async function openAllRows(page) {
  const heads = page.locator("[data-graph-documents-row]:not([data-open]) [data-row-head]");
  for (let i = (await heads.count()) - 1; i >= 0; i--) await heads.nth(i).click();
  await page.waitForTimeout(300);
}

// ── 1440, en: the list ────────────────────────────────────────────────────
{
  const { ctx, page, calls } = await newPage(1440, 900, "en");
  await openGraph(page, NB);
  check("the list does not open by itself", (await list(page).count()) === 0);
  check("no parts=titles call before the list opens", !calls.some((c) => c.path.includes("parts=titles")));
  const graphCall = calls.find((c) => /\/graph$/.test(c.path));
  check("the graph's data loads", graphCall?.status === 200, JSON.stringify(graphCall));
  const before = calls.length;
  const t0 = Date.now();
  await page.locator('[data-track="graph-documents"]').click();
  await list(page).waitFor({ timeout: 10000 });
  await page.waitForTimeout(1500);
  // The workspace's own sync poll runs on a timer, and the click counter
  // (data-track) records the press: neither reads the project.
  const opened = calls.filter((c) => c.at >= t0 && !c.path.includes("/sync") && c.path !== "/api/clicks");
  check(
    "opening the list makes one call, parts=titles, and nothing else",
    opened.length === 1 && opened[0].path.includes("outline?parts=titles") && opened[0].method === "GET",
    JSON.stringify(opened.map((c) => `${c.method} ${c.path}`)),
  );
  void before;
  // [chrome6] VIEW6-03: with the switch off, generated documents are not drawn.
  const generated = await page.locator(".react-flow__node.graph-generated").count();
  const nodeCount = await page.locator(".react-flow__node").count();
  const oneLine = await page.locator("[data-graph-documents-row]").evaluateAll((els) => els.every((el) => el.getBoundingClientRect().height <= 40));
  check("every row is one line until opened", oneLine && (await list(page).getAttribute("data-mine-first")) === null);
  await openAllRows(page);
  const rows = await page.locator("[data-graph-documents-row]").evaluateAll((els) =>
    els.map((el) => ({
      id: el.getAttribute("data-graph-documents-row"),
      links: el.querySelectorAll("[data-graph-documents-link]").length,
      gist: Boolean(el.querySelector("[data-graph-documents-gist]")),
      noSummary: Boolean(el.querySelector("[data-graph-no-summary]")),
      parts: el.querySelectorAll("[data-graph-part]").length,
    })),
  );
  check("one row per document (generated documents behind the switch)", generated === 0 && rows.length === nodeCount, `${rows.length} rows, ${nodeCount} nodes, ${generated} generated`);
  const lastLinked = rows.map((r) => r.links > 0).lastIndexOf(true); // links: accepted and recommended, as the layout groups them
  const firstBare = rows.findIndex((r) => r.links === 0);
  check("linked documents come first (the graph's order)", firstBare === -1 || lastLinked < firstBare, JSON.stringify(rows.map((r) => r.links)));
  check("every row has a gist or the no-summary line", rows.every((r) => r.gist || r.noSummary));
  console.log("rows", JSON.stringify(rows));
  check("part titles are listed", rows.some((r) => r.parts > 0));
  await page.mouse.move(5, 5);
  await page.screenshot({ path: `${SHOT}/VIEW3-06-list-1440-${tag}.png` });

  // Hover lights the node.
  const first = page.locator("[data-graph-documents-row]").first();
  const firstId = await first.getAttribute("data-graph-documents-row");
  await first.locator("button").first().hover();
  await page.waitForTimeout(300);
  const lit = await page.evaluate((id) => {
    const node = document.querySelector(`.react-flow__node[data-id=${JSON.stringify(id)}]`);
    return { lit: node?.hasAttribute("data-lit") ?? false, spot: Boolean(document.querySelector("[data-spot]")) };
  }, firstId);
  check("hovering a row lights its node", lit.lit && lit.spot, JSON.stringify(lit));
  await page.screenshot({ path: `${SHOT}/VIEW3-06-hover-1440-${tag}.png` });
  await page.mouse.move(5, 5);
  await page.waitForTimeout(200);
  check("the light goes out on leave", !(await page.evaluate(() => Boolean(document.querySelector("[data-spot]")))));

  // A link row opens the link panel; its passages load with one call; Back returns to the list.
  const linkRow = page.locator("[data-graph-documents-link]").first();
  const linkId = await linkRow.getAttribute("data-graph-documents-link");
  const t1 = Date.now();
  await linkRow.click();
  const panel = page.locator(`[data-graph-link-panel="${linkId}"]`);
  await panel.waitFor({ timeout: 10000 });
  await page.locator("[data-link-passages]").waitFor({ timeout: 10000 }).catch(() => undefined);
  const passageCalls = calls.filter((c) => c.at >= t1 && c.path.includes("/graph/passages"));
  check("a link row opens the link panel", (await panel.count()) === 1);
  check("the passages load with one call", passageCalls.length === 1 && passageCalls[0].path.includes(`linkId=${linkId}`), JSON.stringify(passageCalls.map((c) => c.path)));
  check("the passages are drawn", (await page.locator("[data-link-passages]").count()) === 1);
  const back = page.locator('[data-track="graph-link-panel-back"]');
  check("Back reads Back to Documents", (await back.getAttribute("aria-label")) === "Back to Documents");
  await page.screenshot({ path: `${SHOT}/VIEW3-06-link-1440-${tag}.png` });
  await back.click();
  await list(page).waitFor({ timeout: 5000 });
  check("Back returns to the list", (await list(page).count()) === 1);
  // A second open of the same link draws the passages at once, no call.
  const t2 = Date.now();
  await page.locator(`[data-graph-documents-link="${linkId}"]`).first().click();
  await panel.waitFor();
  await page.waitForTimeout(400);
  check("a second open uses the kept passages", calls.filter((c) => c.at >= t2 && c.path.includes("/graph/passages")).length === 0);
  await back.click();

  // Esc closes the list and keeps the graph.
  await page.locator("[data-graph-title]").focus();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  check("Esc closes the list", (await list(page).count()) === 0);
  check("…and keeps the graph", (await page.locator(".graph-overlay-in").count()) === 1);

  // Keyboard: the skip link lands in the list.
  await page.locator('[data-track="graph-documents"]').click();
  await list(page).waitFor();
  await page.locator("[data-graph-title]").focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  const skip = await page.evaluate(() => document.activeElement?.getAttribute("data-track"));
  if (skip === "graph-skip-list") {
    await page.keyboard.press("Enter");
    check("Skip to the open list lands in the list", await page.evaluate(() => Boolean(document.activeElement?.closest("[data-graph-documents-list]"))));
  } else check("Skip to the open list is the second Tab stop", false, String(skip));

  // A part jumps to the reader; Back finds the list.
  await openAllRows(page);
  const part = page.locator("[data-graph-documents-row] [data-graph-part]").first();
  if ((await part.count()) > 0) {
    const block = await part.getAttribute("data-graph-part");
    await part.click();
    await page.waitForURL((u) => u.searchParams.get("block") === block, { timeout: 30000 });
    check("a part jumps to the reader at its block", page.url().includes(`block=${block}`));
    await page.waitForTimeout(1500);
    await page.goBack({ waitUntil: "networkidle" });
    await page.waitForTimeout(2500);
    check("Back finds the graph with the list open", (await list(page).count()) === 1);
  }

  // A reopen refetches with the last ETag: a 304.
  await page.locator('[data-track="graph-close"]').click();
  await page.waitForTimeout(800);
  const t3 = Date.now();
  await page.locator('[data-track="graph"]').first().click();
  await page.locator(".react-flow__node").first().waitFor({ timeout: 60000 });
  await page.waitForTimeout(1500);
  const re = calls.filter((c) => c.at >= t3 && /\/graph$/.test(c.path));
  check("a reopen with nothing changed is a 304", re.length >= 1 && re.every((c) => c.status === 304), JSON.stringify(re.map((c) => c.status)));
  await ctx.close();
}

// ── 1000 and 390, en ──────────────────────────────────────────────────────
for (const [w, h, touch] of [
  [1000, 800, false],
  [390, 844, true],
]) {
  const { ctx, page } = await newPage(w, h, "en", touch);
  await openGraph(page, NB);
  await page.locator('[data-track="graph-documents"]').click();
  await list(page).waitFor();
  await page.waitForTimeout(800);
  const box = await list(page).boundingBox();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(`${w}: no sideways scroll`, overflow <= 0, String(overflow));
  if (w < 640) {
    // [lists7] VIEW7-09: the sheet's foot is 64 px above the screen's, clear of the Stitch pill.
    const pill = await page.locator("[data-stitch-slot] > *").first().boundingBox().catch(() => null);
    check(`${w}: the list is a sheet above the Stitch pill`, Math.abs(box.y + box.height - (h - 64)) < 4 && box.width >= w - 26 && box.height < h * 0.7 && (!pill || pill.y >= box.y + box.height), JSON.stringify({ box, pill }));
    // The canvas fits its nodes above the sheet.
    const nodesAbove = await page.evaluate((top) => [...document.querySelectorAll(".react-flow__node")].every((n) => n.getBoundingClientRect().top < top), box.y);
    check(`${w}: the nodes sit above the sheet`, nodesAbove);
  } else {
    check(`${w}: the list sits beside the canvas`, box.x + box.width <= w && box.width <= 401, JSON.stringify(box));
  }
  await page.screenshot({ path: `${SHOT}/VIEW3-06-list-${w}-${tag}.png` });
  await ctx.close();
}

// ── zh ────────────────────────────────────────────────────────────────────
for (const [w, h, touch] of [
  [1440, 900, false],
  [390, 844, true],
]) {
  const { ctx, page } = await newPage(w, h, "zh", touch);
  await openGraph(page, NB);
  const btn = page.locator('[data-track="graph-documents"]');
  check(`zh ${w}: the counts read in zh`, /个文档/.test(await btn.textContent()));
  await btn.click();
  await list(page).waitFor();
  await page.waitForTimeout(800);
  // [lists8] WALK8-02: the order is the list name's tooltip.
  const head = await list(page).locator("[data-graph-list-name]").first().getAttribute("data-tip");
  check(`zh ${w}: the list's head reads in zh`, /按图谱的顺序/.test(head ?? ""), head ?? "");
  const ai = await list(page).locator("p").last().textContent();
  check(`zh ${w}: the AI line reads in zh`, /AI/.test(ai ?? "") && /核对/.test(ai ?? ""), ai ?? "");
  await page.screenshot({ path: `${SHOT}/VIEW3-06-list-zh-${w}-${tag}.png` });
  await ctx.close();
}

// ── Provenance links on request (COST3-03) ────────────────────────────────
{
  const { ctx, page, calls } = await newPage(1440, 900, "en");
  await openGraph(page, PROV);
  const first = calls.find((c) => /\/graph$/.test(c.path));
  check("the graph opens without provenance links (no ?provenance=1 call)", Boolean(first) && !calls.some((c) => c.path.includes("provenance=1")));
  const prov = page.locator('[data-track="graph-provenance"]');
  if ((await prov.count()) > 0) {
    const t0 = Date.now();
    await prov.click();
    await page.waitForTimeout(2500);
    check("the provenance switch fetches ?provenance=1", calls.some((c) => c.at >= t0 && c.path.includes("provenance=1") && c.status === 200));
    check("provenance curves draw", (await page.locator(".graph-prov-curve").count()) > 0);
    // A generated document's card lists its links while the switch shows
    // them (GRAPH3: the card counts only the links the canvas draws).
    const gen = page.locator(".react-flow__node.graph-generated").first();
    if ((await gen.count()) > 0) {
      const genId = await gen.getAttribute("data-id");
      await page.evaluate((id) => {
        const u = new URL(location.href);
        u.searchParams.set("graphDoc", id);
        history.replaceState(history.state, "", u);
      }, genId);
      await gen.click({ force: true });
      await page.locator("[data-graph-node-card]").waitFor({ timeout: 10000 }).catch(() => undefined);
      await page.waitForTimeout(2500);
      const groups = await page.locator("[data-graph-card-group]").count();
      check("a generated document's card lists its links", groups > 0, `${groups} groups`);
      await page.screenshot({ path: `${SHOT}/COST3-03-generated-card-${tag}.png` });
    }
  } else check("the provenance switch exists", false);
  await ctx.close();
}

check("no page errors", errors.length === 0, errors.join(" | "));
console.log(failures === 0 ? "ALL PASS" : `${failures} FAIL`);
await browser.close();
