// Round 4 canvas checks (GRAPH4): the view stays where the reader clicks
// (WALK4-01), a tapped node stays above the phone's sheet (WALK4-10), the
// open link is lit (WALK4-04), labels tell titles apart and stay inside the
// canvas (VIEW4-05), a quiet far zoom (VIEW4-06), the key explains the curve
// marks (WALK4-13), and a sent reply and an Accept show at once (WALK4-15).
//   BASE=http://localhost:3162 DB=dissect_r4graph4 TAG=after node scripts/qa/ui-graph-canvas4.mjs
// WRITES=1 adds the reply and Accept checks (they write a reply and accept a
// recommended link in DB, so run them on a copy).
import { chromium } from "playwright-core";
import { execFileSync } from "node:child_process";

const BASE = process.env.BASE ?? "http://localhost:3162";
const DB = process.env.DB ?? "dissect_r4graph4";
const TAG = process.env.TAG ?? "after";
const OUT = process.env.OUT ?? "/mnt/project-files/stitch-graph-loop/round-4/graph4";
const WRITES = process.env.WRITES === "1";
const NB = process.env.NB ?? "cmuy46sr4005b7doy5eghkkeq"; // the walk's 7 documents
const NB40 = process.env.NB40 ?? "cmuy46ui500hs7dpzttt5f9il"; // the walk's 40 documents
const LIB = process.env.LIB ?? "cmuxjmw8704qt7dztg6adlhps"; // the 36-document library
const BIG = process.env.BIG ?? "g2-big"; // 100 documents

const psql = (sql) =>
  execFileSync("psql", ["-h", "localhost", "-U", "postgres", DB, "-At", "-c", sql], { env: { ...process.env, PGPASSWORD: "postgres" } })
    .toString()
    .trim();
const docId = (nb, title) =>
  psql(`SELECT d.id FROM "Document" d JOIN "NotebookDocument" nd ON nd."documentId" = d.id WHERE nd."notebookId" = '${nb}' AND d.title = '${title.replace(/'/g, "''")}' LIMIT 1`);

let failures = 0;
function check(name, ok, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
async function open(nb, w, h, lang = "en", extra = "") {
  const touch = w < 500;
  const context = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch });
  await context.addCookies([{ name: "dissect-lang", value: lang, url: BASE }]);
  const page = await context.newPage();
  page.on("pageerror", (e) => console.log("pageerror:", e.message.slice(0, 200)));
  await page.goto(`${BASE}/n/${nb}?graph=1${extra}`, { waitUntil: "networkidle", timeout: 300000 });
  await page.waitForSelector(".react-flow__node", { timeout: 120000 });
  await page.waitForTimeout(2500);
  return { page, context, touch };
}
const nodeBox = async (page, id) => page.locator(`.react-flow__node[data-id="${id}"] [data-graph-dot]`).boundingBox();
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}-${TAG}.png` });

try {
  // ── WALK4-01: a click pins the card; the node stays under the pointer ──
  for (const lang of ["en", "zh"]) {
    const { page, context } = await open(NB, 1440, 900, lang);
    const book2 = docId(NB, "BOOK TWO");
    const b0 = await nodeBox(page, book2);
    const n0 = await page.locator(`.react-flow__node[data-id="${book2}"]`).boundingBox();
    await page.mouse.move(b0.x + b0.width / 2, b0.y + b0.height / 2);
    await page.waitForTimeout(400);
    await page.mouse.click(b0.x + b0.width / 2, b0.y + b0.height / 2);
    const xs = [];
    for (const ms of [100, 300, 400, 700]) {
      await page.waitForTimeout(ms);
      xs.push(Math.round((await page.locator(`.react-flow__node[data-id="${book2}"]`).boundingBox()).x));
    }
    const card = await page.locator('aside[data-graph-node-card]').count();
    const curveList = await page.locator("[data-curve-list]").count();
    if (lang === "en") await shot(page, "WALK4-01");
    check(`WALK4-01 ${lang} the card opens`, card === 1);
    check(`WALK4-01 ${lang} BOOK TWO stays still`, xs.every((x) => Math.abs(x - n0.x) < 2), `x ${Math.round(n0.x)} → ${xs.join(", ")}`);
    check(`WALK4-01 ${lang} no curve list opens under the pointer`, curveList === 0, `${curveList} open`);
    // A node the card would cover (fresh view): the view pans just enough.
    if (lang === "en") {
      const fresh = await open(NB, 1440, 900, lang);
      const boxes = await fresh.page.evaluate(() => [...document.querySelectorAll(".react-flow__node")].map((e) => [e.getAttribute("data-id"), e.getBoundingClientRect().right]));
      const [rightId, rightX] = boxes.sort((x, y) => y[1] - x[1])[0];
      if (rightX > 1440 - 412) {
        const d = await nodeBox(fresh.page, rightId);
        await fresh.page.mouse.click(d.x + d.width / 2, d.y + d.height / 2);
        await fresh.page.waitForTimeout(1500);
        const after = await fresh.page.locator(`.react-flow__node[data-id="${rightId}"]`).boundingBox();
        const cb = await fresh.page.locator("aside[data-graph-node-card]").boundingBox();
        await fresh.page.screenshot({ path: `${OUT}/WALK4-01-covered-${TAG}.png` });
        check("WALK4-01 a node under the card pans clear of it", after && cb && after.x + after.width <= cb.x, `node right ${Math.round(after.x + after.width)}, card left ${Math.round(cb.x)}`);
        const lists = await fresh.page.locator("[data-curve-list]").count();
        check("WALK4-01 the pan opens no curve list", lists === 0);
      } else console.log("note: no node where the card opens");
      await fresh.context.close();
    }
    // ── WALK4-04: the open link lights its curve and its two documents ──
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    await page.locator('[data-track="graph-links"]').click();
    await page.waitForTimeout(800);
    await page.locator("[data-graph-links-row]").first().click();
    await page.waitForSelector("[data-graph-link-panel]", { timeout: 10000 });
    await page.waitForTimeout(900);
    const lit = await page.evaluate(() => ({
      spot: document.querySelector(".corpus-graph")?.hasAttribute("data-spot") ?? false,
      nodes: document.querySelectorAll(".react-flow__node[data-lit]").length,
      edges: document.querySelectorAll(".react-flow__edge[data-lit]").length,
      all: document.querySelectorAll(".react-flow__node").length,
    }));
    if (lang === "en") await shot(page, "WALK4-04");
    check(`WALK4-04 ${lang} the open link lights its documents and curve`, lit.spot && lit.nodes >= 1 && lit.nodes <= 2 && lit.edges >= 1, JSON.stringify(lit));
    // ── WALK4-13: the key explains the curve marks ──
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    await page.locator('[data-track="graph-key"]').click();
    await page.waitForTimeout(300);
    const key = await page.locator('[role="dialog"][aria-label]').filter({ has: page.locator("ul") }).last().innerText();
    if (lang === "en") await shot(page, "WALK4-13");
    const want = lang === "en" ? ["number of links", "Open replies", "quote both documents", "Pending notes", "Zoomed out"] : ["链接数", "未解决回复", "同时引用", "待定笔记", "缩小视图"];
    check(`WALK4-13 ${lang} the key names the curve marks`, want.every((w) => key.includes(w)), want.filter((w) => !key.includes(w)).join(", "));
    check(`WALK4-13 ${lang} no chip reads 0`, (await page.locator("[data-graph-node-notes]").allInnerTexts()).every((s) => !/^\s*0\b/.test(s)));
    await context.close();
  }

  // ── WALK4-10: a tapped node and its links stay above the sheet (390 zh) ──
  for (const lang of ["zh", "en"]) {
    const { page, context } = await open(NB40, 390, 844, lang);
    // The lowest node in view with a linked document: the one the sheet would cover.
    const id = await page.evaluate(() => {
      const linked = new Set([...document.querySelectorAll(".react-flow__edge")].flatMap((e) => (e.getAttribute("data-testid") ?? "").replace(/^rf__edge-/, "").split("|")));
      const c = document.querySelector(".react-flow").getBoundingClientRect();
      const cands = [...document.querySelectorAll(".react-flow__node")]
        .map((n) => ({ id: n.getAttribute("data-id"), r: n.querySelector("[data-graph-dot]").getBoundingClientRect() }))
        .filter((n) => linked.has(n.id) && n.r.left > c.left + 10 && n.r.right < c.right - 10 && n.r.top > c.top + 20 && n.r.bottom < c.bottom - 140);
      return cands.sort((a, b) => b.r.top - a.r.top)[0]?.id;
    });
    const b = await nodeBox(page, id);
    await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
    await page.waitForTimeout(1800);
    const sheet = await page.locator('aside[data-graph-node-card]').boundingBox();
    const lit = await page.evaluate(() => [...document.querySelectorAll(".react-flow__node[data-lit] [data-graph-dot]")].map((d) => d.getBoundingClientRect().bottom));
    const tapped = await nodeBox(page, id);
    await shot(page, `WALK4-10-${lang}`);
    check(`WALK4-10 ${lang} the tapped node is above the sheet`, sheet && tapped && tapped.y + tapped.height <= sheet.y, `node bottom ${Math.round(b.y + b.height)} before the tap, ${tapped && Math.round(tapped.y + tapped.height)} after, sheet top ${sheet && Math.round(sheet.y)}`);
    check(`WALK4-10 ${lang} its linked documents are above the sheet`, sheet && lit.length > 0 && lit.every((y) => y <= sheet.y), `${lit.length} lit, lowest ${Math.round(Math.max(...lit))}`);
    await context.close();
  }

  // ── VIEW4-05: labels apart and inside the canvas ──
  for (const [nb, w, h, lang] of [[LIB, 390, 844, "en"], [LIB, 1440, 900, "en"], [NB40, 390, 844, "zh"]]) {
    const { page, context } = await open(nb, w, h, lang);
    const m = await page.evaluate(() => {
      const c = document.querySelector(".react-flow").getBoundingClientRect();
      const ls = [...document.querySelectorAll("[data-graph-label]")];
      const out = ls.filter((l) => {
        const r = document.createRange();
        r.selectNodeContents(l);
        const b = r.getBoundingClientRect();
        return b.width > 0 && (b.left < c.left - 1 || b.right > c.right + 1);
      });
      return { labels: ls.length, out: out.length, ex: out.slice(0, 4).map((l) => l.textContent), texts: ls.map((l) => l.textContent) };
    });
    await shot(page, `VIEW4-05-${nb.slice(-4)}-${w}-${lang}`);
    check(`VIEW4-05 ${nb.slice(-4)} ${w} ${lang} labels inside the canvas`, m.out === 0, `${m.out} of ${m.labels} out ${m.ex.join(" | ")}`);
    if (nb === LIB) {
      const bge = m.texts.filter((t) => t.startsWith("Beyond Good…"));
      check(`VIEW4-05 ${w} chapter labels keep their own words`, bge.length >= 9 && new Set(bge).size === bge.length, bge.slice(0, 3).join(" | "));
    }
    await context.close();
  }

  // ── P4: the Documents list's parts line shows 8 parts and a count ──
  {
    const { page, context } = await open(LIB, 1440, 900, "en");
    await page.locator('[data-track="graph-documents"]').click();
    // Past 20 rows each row is one line (LISTS4): open the row with the most parts first.
    await page.waitForSelector("[data-graph-documents-row]", { timeout: 30000 }).catch(() => {});
    if (await page.locator("[data-graph-documents-list][data-compact]").count()) {
      const id = await page.locator("[data-graph-documents-row]").evaluateAll((els) => {
        let best = null, k = -1;
        for (const el of els) {
          const m = /(\d+) parts?/.exec(el.textContent ?? "");
          if (m && Number(m[1]) > k) { k = Number(m[1]); best = el.getAttribute("data-graph-documents-row"); }
        }
        return best;
      });
      if (id) await page.locator(`[data-graph-documents-row="${id}"] [data-row-head]`).click();
    }
    await page.waitForSelector("[data-graph-parts-more]", { timeout: 30000 }).catch(() => {});
    const more = page.locator("[data-graph-parts-more]").first();
    const n = Number((await more.getAttribute("data-graph-parts-more").catch(() => null)) ?? 0);
    const partsIn = () => more.evaluate((el) => el.closest("p")?.querySelectorAll("[data-graph-part]").length ?? 0);
    const line = await more.evaluateHandle((el) => el.closest("p"));
    const before = await partsIn();
    await more.scrollIntoViewIfNeeded();
    await shot(page, "P4-parts");
    await more.click();
    await page.waitForTimeout(300);
    const after = await line.evaluate((p) => p.querySelectorAll("[data-graph-part]").length);
    check("P4 a long parts line shows 8 parts and a count", n > 0 && before === 8, `${before} shown, ${n} more`);
    check("P4 the count opens every part", after === before + n, `${after}`);
    await context.close();
  }

  // ── VIEW4-06: a quiet far zoom; marks at a near zoom ──
  for (const [nb, w, h] of [[BIG, 1440, 900], [NB40, 390, 844], [NB40, 1440, 900]]) {
    const { page, context } = await open(nb, w, h, "en");
    const m = await page.evaluate(() => {
      const shown = (sel) => [...document.querySelectorAll(sel)].filter((e) => e.getBoundingClientRect().width > 0).length;
      return {
        far: document.querySelector(".corpus-graph")?.hasAttribute("data-far"),
        chips: shown("[data-graph-node-notes]"),
        notes: shown('[data-graph-curve-mark="notes"]'),
        counts: shown('[data-graph-curve-mark="count"]'),
        replies: shown('[data-graph-curve-mark="replies"]'),
        repliesAll: document.querySelectorAll('[data-graph-curve-mark="replies"]').length,
      };
    });
    await shot(page, `VIEW4-06-${nb.slice(-4)}-${w}`);
    if (m.far) check(`VIEW4-06 ${nb.slice(-4)} ${w}: far zoom hides chips and pills`, m.chips === 0 && m.notes === 0 && m.counts === 0, JSON.stringify(m));
    else console.log(`note: ${nb.slice(-4)} ${w} is not at a far zoom`, JSON.stringify(m));
    check(`VIEW4-06 ${nb.slice(-4)} ${w}: the reply marks still draw`, m.replies === m.repliesAll, JSON.stringify(m));
    await context.close();
  }
  {
    const { page, context } = await open(NB, 1440, 900, "en");
    const m = await page.evaluate(() => ({
      far: document.querySelector(".corpus-graph")?.hasAttribute("data-far"),
      chips: [...document.querySelectorAll("[data-graph-node-notes]")].filter((e) => e.getBoundingClientRect().width > 0).length,
      ones: [...document.querySelectorAll('[data-graph-curve-mark="notes"]')].map((e) => e.textContent),
    }));
    check("VIEW4-06 7 documents: the near zoom keeps the chips", !m.far && m.chips > 0, JSON.stringify(m));
    check("VIEW3-08 a one-note pill shows the mark alone", m.ones.every((s) => s !== "1"), JSON.stringify(m.ones));

    // ── WALK4-15 (writes) ──
    if (WRITES) {
      // A link with replies offers Reply even with sign-in off.
      const linkId = psql(`SELECT r."docLinkId" FROM "Reply" r JOIN "DocLink" l ON l.id = r."docLinkId" JOIN "NotebookDocument" nd ON nd."documentId" = l."fromDocumentId" WHERE nd."notebookId" = '${NB}' AND l.recommended = false LIMIT 1`);
      let replied = false;
      if (linkId) {
        await page.locator('[data-track="graph-links"]').click();
        await page.waitForTimeout(800);
        await page.locator(`[data-graph-links-row="${linkId}"]`).click();
        const P = page.locator("[data-graph-link-panel]");
        await P.waitFor({ timeout: 10000 });
        await page.waitForTimeout(600);
        await P.getByRole("button", { name: /^(Reply)$/ }).first().click();
        const ta = P.locator("textarea").first();
        const words = `GRAPH4 reply ${Date.now()}`;
        await ta.fill(words);
        const t0 = Date.now();
        await ta.press("Enter");
        await P.getByText(words).first().waitFor({ timeout: 5000 });
        const at = Date.now() - t0;
        await shot(page, "WALK4-15-reply");
        check("WALK4-15 a sent reply stays in view", at < 500, `${at} ms`);
        await page.waitForTimeout(3000);
        check("WALK4-15 the reply shows once after the refresh", (await P.getByText(words).count()) === 1);
        replied = true;
      }
      if (!replied) console.log("note: no link offers Reply here (sign-in off and no replies); reply check skipped");
      await page.goto(`${BASE}/n/${NB}?graph=1`, { waitUntil: "networkidle", timeout: 300000 });
      await page.waitForSelector(".react-flow__node", { timeout: 120000 });
      await page.waitForTimeout(2000);
      // [style9] VIEW9-03: the first pill counts the documents alone and the
      // links count once, on Links; an Accept moves the header's counts there.
      const counts = page.locator('[data-track="graph-documents"], [data-track="graph-links"]');
      const before = (await counts.allInnerTexts()).join(" | ");
      await page.locator('[data-track="graph-recommended-links"]').click();
      await page.waitForTimeout(800);
      const accept = page.locator('[data-track="link-accept"]').first();
      if ((await accept.count()) > 0) {
        await accept.click();
        const t0 = Date.now();
        let after = before;
        while (Date.now() - t0 < 2000 && after === before) {
          await page.waitForTimeout(50);
          after = (await counts.allInnerTexts()).join(" | ");
        }
        check("WALK4-15 the header counts an Accept at once", after !== before && Date.now() - t0 < 1000, `${before} → ${after} in ${Date.now() - t0} ms`);
      } else console.log("note: no recommended link to accept");
    }
    await context.close();
  }
} finally {
  await browser.close();
}
console.log(failures ? `${failures} FAIL` : "all pass");
process.exit(failures ? 1 : 0);
