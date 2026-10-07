// What the documents say, on the graph (SPEC.md §13): the walk over the
// seed "VIEW — Nietzsche and Schopenhauer" (.qa-tmp/stitch/r2/view/seed.json)
// at 1440 / 1000 / 390, in en and zh. Checks the node card (a click
// selects, the gist, the parts, the links grouped with their parts, the
// notes, the neighbour walk, the second click, Back, a part's jump, ← →,
// Esc, the phone sheet), the hover card (one card, the gist, the notes:
// VIEW2-01), Find (counts, the list, Pick these, Ask Stitch, metacharacters),
// the last Stitch answer's proposed links (en 1440), and that the card and
// Find make no model call (UsageEvent rows, and no request to a model route).
// The graph's data loads from GET .../graph (GR-18): its size is reported.
//
//   BASE=http://localhost:3143 OUT=<dir> MODE=after node scripts/qa/ui-graph-view.mjs
// MODE=before takes the screenshots only (against the unchanged code).
// The P3 step runs one mock Stitch command, then dismisses the links it made.

import { chromium } from "playwright-core";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3143";
const OUT = process.env.OUT ?? "/mnt/project-files/stitch-graph-loop/round-2/view2";
const MODE = process.env.MODE ?? "after";
const DB = process.env.DB ?? "dissect";
const SEED = process.env.SEED ?? "/home/user/unitos/.qa-tmp/stitch/r2/view/seed.json";
const ONLY = process.env.ONLY ?? ""; // "1440", "zh", …: run the matching passes only
const LOG = process.env.LOG ?? ""; // the dev server's log, for the no-model-call check
const seed = JSON.parse(fs.readFileSync(SEED, "utf8"));
const NB = seed.notebookId;
const id = (title) => seed.docs.find((d) => d.title === title).id;
const NCN = id("Nietzsche combined notes");
const FN = id("Friedrich Nietzsche");
const BOOK2 = id("BOOK TWO");
fs.mkdirSync(OUT, { recursive: true });

const psql = (sql) =>
  execFileSync("psql", ["-h", "localhost", "-U", "postgres", DB, "-At", "-c", sql], {
    env: { ...process.env, PGPASSWORD: "postgres" },
  })
    .toString()
    .trim();
const usage = () => Number(psql(`SELECT count(*) FROM "UsageEvent"`));

const results = [];
let failures = 0;
function check(name, ok, detail = "") {
  results.push({ name, ok: Boolean(ok), detail });
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const report = { graphRoute: [], outline: [], find: [] };

async function openGraph(page) {
  await page.goto(`${BASE}/n/${NB}?graph=1`, { waitUntil: "networkidle", timeout: 300000 });
  await page.waitForSelector(".react-flow__node", { timeout: 120000 });
  await page.waitForTimeout(1800);
}
const node = (page, docId) => page.locator(`.react-flow__node[data-id="${docId}"]`);
async function press(page, docId, touch) {
  const box = await node(page, docId).boundingBox();
  if (!box) throw new Error(`node ${docId} not on screen`);
  // The dot: the top of the node's box (the label hangs under it).
  const x = box.x + box.width / 2;
  const y = box.y + 14;
  if (touch) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
}

for (const lang of ["en", "zh"]) {
  for (const [w, h] of [[1440, 900], [1000, 800], [390, 844]]) {
    const tag = `${w}-${lang}`;
    if (ONLY && !tag.includes(ONLY)) continue;
    const touch = w < 500;
    const context = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch });
    await context.addCookies([{ name: "dissect-lang", value: lang, url: BASE }]);
    const page = await context.newPage();
    const modelCalls = [];
    page.on("request", (r) => {
      if (/\/api\/(derive|assistant|multi|notes\/gist|notebooks\/[^/]+\/(stitch|connect))/.test(r.url())) modelCalls.push(r.url());
    });
    page.on("response", async (r) => {
      const u = r.url();
      if (!/\/api\/notebooks\/[^/]+\/(graph|outline|find)/.test(u)) return;
      const body = await r.body().catch(() => Buffer.alloc(0));
      const row = { tag, url: u.replace(BASE, ""), bytes: body.length };
      if (u.includes("/graph")) report.graphRoute.push(row);
      else if (u.includes("/outline")) report.outline.push(row);
      else report.find.push(row);
    });
    await openGraph(page);
    await page.screenshot({ path: `${OUT}/graph-${MODE}-${tag}.png` });

    // ── Hover (VIEW2-01, P1b) ──────────────────────────────────────────────
    if (!touch) {
      const box = await node(page, NCN).boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + 14);
      await page.waitForTimeout(900);
      await page.screenshot({ path: `${OUT}/VIEW2-01-${MODE}-${tag}.png` });
      if (MODE === "after") {
        const cards = await page.locator('[role="tooltip"]').count();
        const notesCards = await page.locator('[data-track-surface="graph-node-notes"]').count();
        check(`${tag} hover: one card`, cards === 1 && notesCards === 0, `tooltips ${cards}, notes cards ${notesCards}`);
        const gist = await page.locator("[data-graph-hover-gist]").innerText().catch(() => "");
        check(`${tag} hover: the gist's first words`, gist.startsWith("From The Antichrist"), gist.slice(0, 60));
        const notes = await page.locator("[data-graph-hover-notes]").innerText().catch(() => "");
        check(`${tag} hover: the notes`, /Pity as the hinge/.test(notes), notes.replace(/\n/g, " | ").slice(0, 80));
      }
      await page.mouse.move(5, h - 5);
      await page.waitForTimeout(400);
    }

    // ── Click selects (P1) ────────────────────────────────────────────────
    const usageBefore = usage();
    const logAt = LOG ? fs.statSync(LOG).size : 0;
    await press(page, NCN, touch);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/P1-select-${MODE}-${tag}.png` });
    if (MODE === "before") {
      results.push({ name: `${tag} before: click`, ok: true, detail: page.url().replace(BASE, "") });
      await context.close();
      continue;
    }
    const url = new URL(page.url());
    check(`${tag} click: the URL keeps graph=1 and gains graphDoc`, url.searchParams.get("graph") === "1" && url.searchParams.get("graphDoc") === NCN, url.search);
    const card = page.locator(`[data-graph-node-card="${NCN}"]`);
    await card.waitFor({ timeout: 20000 });
    await page.locator("[data-graph-gist]").waitFor({ timeout: 20000 });
    const gist = await page.locator("[data-graph-gist]").innerText();
    check(`${tag} card: the gist`, gist.startsWith("From The Antichrist: good is what increases the feeling of power"), gist.slice(0, 70));
    const parts = await card.locator("[data-graph-part]").allInnerTexts();
    check(
      `${tag} card: two parts with summaries`,
      parts.length === 2 && parts[0].startsWith("2–6: Power, the higher type, and corruption") && parts[1].startsWith("7–13: Pity, theologians, and Kant") && parts.every((p) => p.split("\n").length >= 2),
      parts.map((p) => p.split("\n")[0]).join(" / "),
    );
    const groups = await card.locator("[data-graph-card-group]").evaluateAll((els) => els.map((e) => e.getAttribute("data-graph-card-group")));
    check(`${tag} card: links grouped by document`, groups.includes(FN) && groups.includes(id("Extra notes on Schopenhauer as educator")), groups.length + " groups");
    const cardText = await card.innerText();
    check(`${tag} card: the notes`, cardText.includes("Pity as the hinge"));
    check(`${tag} card: a link's part`, /in 7–13: Pity, theologians, and Kant|位于“7–13: Pity, theologians, and Kant”/.test(cardText));
    check(`${tag} card: the AI line`, lang === "en" ? cardText.includes("Written by AI from the document") : cardText.includes("由 AI 根据文档写成"));
    const outlines = report.outline.filter((r) => r.tag === tag && r.url.includes(NCN));
    check(`${tag} card: one outline request ≤ 2 kB`, outlines.length === 1 && outlines[0].bytes <= 2048, outlines.map((o) => o.bytes).join(","));
    if (touch) {
      const cb = await card.boundingBox();
      const dot = await node(page, NCN).boundingBox();
      check(`${tag} sheet: ≤ 60% of the height`, cb.height <= 0.6 * h + 1, `${Math.round(cb.height)} of ${h}`);
      check(`${tag} sheet: the node's dot above it`, dot && dot.y + 30 <= cb.y, `dot ${Math.round(dot?.y ?? -1)}, sheet ${Math.round(cb.y)}`);
    }

    // ── Walk to a neighbour ───────────────────────────────────────────────
    await card.locator(`[data-graph-card-group="${FN}"] [data-track="graph-card-neighbour"]`).click();
    await page.locator(`[data-graph-node-card="${FN}"]`).waitFor({ timeout: 20000 });
    await page.waitForFunction(() => document.querySelector("[data-graph-gist]")?.textContent?.startsWith("Zarathustra"), null, { timeout: 20000 }).catch(() => {});
    const fnCard = page.locator(`[data-graph-node-card="${FN}"]`);
    const fnParts = await fnCard.locator("[data-graph-part]").count();
    const fnGist = await page.locator("[data-graph-gist]").innerText().catch(() => "");
    check(`${tag} neighbour: the card moves`, fnGist.startsWith("Zarathustra") && fnParts === 4, `${fnGist.slice(0, 40)} · ${fnParts} parts`);
    await page.screenshot({ path: `${OUT}/P1-neighbour-${MODE}-${tag}.png` });

    // ── Second click opens, Back returns ─────────────────────────────────
    if (w === 1440 || touch) {
      if (touch) await fnCard.locator('[data-track="graph-card-open"]').click();
      else await press(page, FN, false);
      await page.waitForURL((u) => u.searchParams.get("doc") === FN && u.searchParams.get("graph") !== "1", { timeout: 30000 }).catch(() => {});
      const opened = new URL(page.url());
      check(`${tag} ${touch ? "Open in reader" : "second click"} opens the document`, opened.searchParams.get("doc") === FN && opened.searchParams.get("graph") !== "1", opened.search);
      await page.goBack();
      await page.waitForSelector(`[data-graph-node-card="${FN}"]`, { timeout: 60000 }).catch(() => {});
      check(`${tag} Back: the graph and the card`, (await page.locator(`[data-graph-node-card="${FN}"]`).count()) === 1, new URL(page.url()).search);
    }

    // ── A part's jump ─────────────────────────────────────────────────────
    if (w === 1000) {
      await page.locator(`[data-graph-node-card="${FN}"] [data-graph-part]`, { hasText: "Man is a rope" }).first().click();
      await page.waitForURL((u) => u.searchParams.has("block"), { timeout: 30000 }).catch(() => {});
      const jumped = new URL(page.url());
      check(`${tag} part: the reader opens at the part`, jumped.searchParams.get("doc") === FN && jumped.searchParams.has("block"), jumped.search);
      await openGraph(page);
    }

    // ── Keyboard: Esc closes the card, then the graph; → walks ──────────
    if (w === 1440) {
      await press(page, NCN, false);
      await page.locator(`[data-graph-node-card="${NCN}"]`).waitFor({ timeout: 20000 });
      await page.mouse.move(5, h - 5);
      await page.keyboard.press("ArrowRight");
      await page.waitForTimeout(600);
      const walked = await page.locator("[data-graph-node-card]").getAttribute("data-graph-node-card");
      check(`${tag} → walks to a linked document`, walked && walked !== NCN, walked ?? "");
      await page.keyboard.press("ArrowLeft");
      await page.waitForTimeout(600);
      check(`${tag} ← walks back`, (await page.locator("[data-graph-node-card]").getAttribute("data-graph-node-card")) === NCN);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(400);
      check(`${tag} Esc closes the card`, (await page.locator("[data-graph-node-card]").count()) === 0 && (await page.locator(".graph-overlay").count()) === 1);
      // ⇧-click picks and opens no card.
      const b2 = await node(page, BOOK2).boundingBox();
      await page.keyboard.down("Shift");
      await page.mouse.click(b2.x + b2.width / 2, b2.y + 14);
      await page.keyboard.up("Shift");
      await page.waitForTimeout(500);
      const pickText = await page.locator('[aria-label="Stitch"], [aria-label="缝合"]').first().innerText().catch(() => "");
      check(`${tag} ⇧-click picks, no card`, (await page.locator("[data-graph-node-card]").count()) === 0 && /BOOK TWO/.test(pickText));
      await page.locator('[data-track="stitch-pick-clear"]').click().catch(() => {});
    }

    // ── Find (P2) ─────────────────────────────────────────────────────────
    const findBox = page.locator('[data-graph-find] input');
    await findBox.fill("pity");
    await page.locator("[data-graph-find-list]").waitFor({ timeout: 20000 });
    await page.waitForFunction(() => document.querySelectorAll("[data-graph-find-group]").length > 0, null, { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(800);
    const counts = await page.locator("[data-graph-find-count]").evaluateAll((els) => els.map((e) => Number(e.getAttribute("data-graph-find-count"))).sort((a, b) => b - a));
    check(`${tag} find: 5 nodes lit with counts`, counts.join("/") === "2/1/1/1/1", counts.join("/"));
    const summary = await page.locator("[data-graph-find-summary]").innerText();
    check(`${tag} find: the summary`, lang === "en" ? summary.startsWith("Found in 5 of 7 documents") : summary.includes("在 7 个文档中的 5 个找到"), summary);
    const marks = await page.locator(`[data-graph-find-group="${NCN}"] mark`).allInnerTexts();
    check(`${tag} find: the word lit`, marks.length > 0 && marks.every((m) => m.toLowerCase() === "pity"), marks.join(","));
    await page.screenshot({ path: `${OUT}/P2-find-${MODE}-${tag}.png` });
    check(`${tag} find: graphFind in the URL`, new URL(page.url()).searchParams.get("graphFind") === "pity");
    if (w === 1440) {
      await page.locator('[data-track="graph-find-ask"]').click();
      await page.waitForTimeout(500);
      const value = await page.locator("textarea").first().inputValue();
      check(`${tag} find: Ask Stitch fills the box`, lang === "en" ? value === "What do these documents say about pity?" : value === "这些文档对“pity”说了什么？", value);
      const scope = await page.locator('[aria-label="Stitch"], [aria-label="缝合"]').first().innerText().catch(() => "");
      check(`${tag} find: Pick these picks 5`, /5 documents picked|已选取 5 篇文档/.test(scope));
      await page.locator("textarea").first().fill("");
      await page.locator('[data-track="stitch-pick-clear"]').click().catch(() => {});
      // A passage jumps; Back keeps the find.
      await page.locator("[data-graph-find-passage]").first().click();
      await page.waitForURL((u) => u.searchParams.has("block"), { timeout: 30000 }).catch(() => {});
      check(`${tag} find: a passage opens the reader at its block`, new URL(page.url()).searchParams.has("block"));
      await page.goBack();
      await page.waitForSelector("[data-graph-find-list]", { timeout: 60000 }).catch(() => {});
      await page
        .waitForFunction(() => document.querySelector("[data-graph-find] input")?.value === "pity", null, { timeout: 15000 })
        .catch(() => {});
      const kept = await page.locator("[data-graph-find] input").inputValue().catch(() => "(no box)");
      check(`${tag} find: Back keeps the find`, kept === "pity", `${kept} · ${new URL(page.url()).search}`);
    }
    await page.locator('[data-graph-find] input').fill("50%_(");
    await page
      .waitForFunction(() => !/Finding|正在查找/.test(document.querySelector("[data-graph-find-summary]")?.textContent ?? "Finding"), null, { timeout: 15000 })
      .catch(() => {});
    const none = await page.locator("[data-graph-find-summary]").innerText().catch(() => "");
    check(`${tag} find: metacharacters, no hit`, lang === "en" ? none === "No passage has these words." : none === "没有片段包含这些词。", none);
    await page.locator('[data-graph-find] input').fill("");
    // No model call: the browser asked no model route, and the dev server
    // (its log, when LOG is given) served no model route in the window. The
    // database's UsageEvent count is shared with other sessions, so it is
    // reported, not judged.
    const usageAfter = usage();
    const served = LOG ? fs.readFileSync(LOG, "utf8").slice(logAt).split("\n") : [];
    const modelServed = served.filter((l) => /(POST|GET) \/api\/(derive|assistant|multi|notes\/gist|notebooks\/[^/]+\/(stitch|connect))/.test(l));
    check(
      `${tag} card and Find: no model call`,
      modelCalls.length === 0 && modelServed.length === 0,
      `model routes asked ${modelCalls.length}, served ${modelServed.length}${LOG ? "" : " (no LOG)"}; UsageEvent (every session) ${usageBefore} → ${usageAfter}`,
    );

    // ── The last Stitch answer (P3) ─────────────────────────────────────
    if (tag === "1440-en") {
      const before = new Set(psql(`SELECT id FROM "DocLink" WHERE "notebookId" = '${NB}' AND recommended`).split("\n").filter(Boolean));
      await page.locator('[data-track="stitch-suggest:contradict"]').click();
      await page.waitForSelector("[data-graph-proposed]", { timeout: 180000 }).catch(() => {});
      await page.waitForTimeout(1500);
      const halos = await page.locator("[data-graph-proposed]").count();
      const made = psql(`SELECT id FROM "DocLink" WHERE "notebookId" = '${NB}' AND recommended`).split("\n").filter((x) => x && !before.has(x));
      check(`${tag} Stitch: the proposed links' curves lit`, made.length > 0 && halos > 0, `${made.length} links made, ${halos} halos`);
      await page.screenshot({ path: `${OUT}/P3-proposed-${MODE}-${tag}.png` });
      const pair = await page.locator("[data-graph-proposed]").first().getAttribute("data-graph-proposed");
      if (pair) {
        await page.locator(`[data-testid="rf__edge-${pair}"]`).click({ force: true }).catch(() => {});
        await page.waitForTimeout(700);
        const marked = await page.locator("[data-graph-from-answer]").count();
        check(`${tag} Stitch: the curve's list marks the answer's link first`, marked > 0);
        await page.screenshot({ path: `${OUT}/P3-list-${MODE}-${tag}.png` });
      }
      // Clean up: the links this run made go (they were recommended only).
      for (const linkId of made) {
        await page.evaluate(async ([l, nb]) => fetch(`/api/links/${l}?notebookId=${nb}`, { method: "DELETE" }), [linkId, NB]);
      }
      // …and so does the page the mock wrote (a generated document of this seed only).
      const generated = psql(
        `SELECT d.id FROM "Document" d JOIN "NotebookDocument" nd ON nd."documentId" = d.id WHERE nd."notebookId" = '${NB}' AND d."generatedCommand" IS NOT NULL AND d."createdAt" > now() - interval '30 minutes'`,
      )
        .split("\n")
        .filter(Boolean);
      for (const docId of generated) {
        await page.evaluate(async (d) => fetch(`/api/documents/${d}`, { method: "DELETE" }), docId);
      }
      report.cleaned = { links: made, generated };
    }
    await context.close();
  }
}

await browser.close();
const out = { mode: MODE, base: BASE, failures, results, report };
fs.writeFileSync(`${OUT}/ui-graph-view-${MODE}.json`, JSON.stringify(out, null, 1));
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} pass`);
process.exit(failures ? 1 : 0);
