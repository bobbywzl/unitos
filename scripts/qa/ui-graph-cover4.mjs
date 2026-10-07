// Round 4 COVER4 (SPEC.md §13): coverage on the graph (VIEW4-01), Add to note (VIEW4-03), the notes on a
// link in the reader (WALK4-05), provenance folded in the Annotations tab and the picker's count (WALK4-03).
//   node scripts/qa/ui-graph-cover4.mjs <port> [tag] [only]
// tag "before" takes screenshots only (the round 3 build has none of it). only: cover | gather | reader | phone.
// Writes: one note in VIEW's first section per run of "gather" (left in place: rows you created).
// DB=<database> lets the script read the saved note's sources with psql.
import { chromium } from "playwright-core";
import { execFileSync } from "node:child_process";

const port = process.argv[2] || "3164";
const tag = process.argv[3] || "after";
const only = process.argv[4] || "";
const B = `http://localhost:${port}`;
const VIEW = "cmuxjmvh7006t7d0bk8xjqaja";
const WALK = "cmuxrbab0005b7drqv65fzl40";
const SAE = "cmuxrb9sm00007drqzuvoiubg"; // Schopenhauer as Educator (Linda WALK3)
const BOOK2 = "cmuxrba7y002o7drqgjys6uv2"; // BOOK TWO (Linda WALK3)
const SHOT = process.env.SHOT ?? "/mnt/project-files/stitch-graph-loop/round-4/cover4";
const DB = process.env.DB ?? "dissect_r4cover4";
const before = tag === "before";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const errors = [];
let failures = 0;
let passes = 0;
const check = (name, ok, detail = "") => {
  if (before) return;
  if (ok) passes++;
  else failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const sql = (q) => execFileSync("psql", ["-h", "localhost", "-U", "postgres", DB, "-At", "-c", q], { env: { ...process.env, PGPASSWORD: "postgres" } }).toString().trim();

async function newPage(width, height, lang, touch = false) {
  const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch });
  await ctx.addCookies([{ name: "dissect-lang", value: lang, url: B }]);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  page.on("dialog", (d) => void d.accept());
  return { ctx, page };
}
async function openGraph(page, nb) {
  await page.goto(`${B}/n/${nb}`, { waitUntil: "networkidle", timeout: 300000 });
  for (let i = 0; i < 6 && (await page.locator(".graph-overlay-in").count()) === 0; i++) {
    await page.locator('[data-track="graph"]').first().click();
    await page.waitForTimeout(1500);
  }
  await page.locator(".react-flow__node").first().waitFor({ timeout: 60000 });
  await page.waitForTimeout(2000);
}
const shot = (page, name) => page.screenshot({ path: `${SHOT}/${name}-${tag}.png` });

// ── Coverage: the Documents list, the rings, No reply (VIEW4-01) ───────────
async function cover(lang, width, height) {
  const { ctx, page } = await newPage(width, height, lang, width < 500);
  await openGraph(page, VIEW);
  const w = `${lang}-${width}`;
  await shot(page, `VIEW4-01-canvas-${w}`);
  const rings = await page.locator("[data-graph-coverage-ring]").evaluateAll((els) => els.map((e) => Number(e.getAttribute("data-share"))));
  check(`${w} a ring on every document with parts or notes`, rings.length === 7, JSON.stringify(rings));
  check(`${w} the rings' shares are the parts noted`, rings.some((s) => s > 0 && s < 1) && rings.some((s) => s === 0), JSON.stringify(rings));
  await page.locator('[data-track="graph-documents"]').click();
  await page.locator("[data-graph-documents-list]").waitFor();
  await page.waitForFunction(() => document.querySelectorAll("[data-graph-documents-list] [data-graph-part]").length > 0, null, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await shot(page, `VIEW4-01-documents-${w}`);
  if (!before) {
    const head = await page.evaluate(() => ({
      parts: document.querySelector("[data-graph-coverage-parts]")?.getAttribute("data-graph-coverage-parts"),
      unopened: document.querySelector("[data-graph-coverage-unopened]")?.getAttribute("data-graph-coverage-unopened"),
      noReply: document.querySelector("[data-graph-coverage-noreply]")?.getAttribute("data-graph-coverage-noreply"),
      text: document.querySelector("[data-graph-coverage-head]")?.textContent,
    }));
    check(`${w} head: 7 of 19 parts noted`, head.parts === "7/19", JSON.stringify(head));
    check(`${w} head: 4 of 5 links with no reply`, head.noReply === "4/5", JSON.stringify(head));
    check(`${w} head: documents not opened counted`, /^\d+\/7$/.test(head.unopened ?? ""), JSON.stringify(head));
    check(`${w} head reads in the language`, lang === "zh" ? /个部分中/.test(head.text ?? "") : /parts noted/.test(head.text ?? ""), head.text);
    const dots = await page.locator("[data-graph-documents-list] [data-graph-part-dot]").evaluateAll((els) => els.map((e) => e.getAttribute("data-graph-part-dot")));
    check(`${w} 7 noted dots, 12 empty`, dots.filter((d) => d === "noted").length === 7 && dots.filter((d) => d === "empty").length === 12, JSON.stringify(dots));
    const lines = await page.locator("[data-graph-coverage-noted]").count();
    check(`${w} each row says N of M parts noted`, lines === 7, String(lines));
    const unopenedRows = await page.locator("[data-graph-documents-list] [data-graph-not-opened]").count();
    check(`${w} Not opened rows match the head`, String(unopenedRows) === head.unopened?.split("/")[0], String(unopenedRows));
    await page.locator("[data-graph-gaps-only]").click();
    await page.waitForTimeout(400);
    const gapDots = await page.locator("[data-graph-documents-list] [data-graph-part-dot]").evaluateAll((els) => els.map((e) => e.getAttribute("data-graph-part-dot")));
    check(`${w} Gaps only keeps the 12 empty parts`, gapDots.length === 12 && gapDots.every((d) => d === "empty"), JSON.stringify(gapDots));
    const gapLinks = await page.locator("[data-graph-documents-list] [data-graph-documents-link]").evaluateAll((els) => new Set(els.map((e) => e.getAttribute("data-graph-documents-link"))).size);
    // Round 5 (WALK5-06): Gaps only is about notes; links waiting for a reply are No reply's.
    check(`${w} Gaps only lists no links`, gapLinks === 0, String(gapLinks));
    const why = await page.locator("[data-graph-documents-list] [data-graph-gap-why]").count();
    const rows = await page.locator("[data-graph-documents-row]").count();
    check(`${w} each row Gaps only keeps says why`, rows > 0 && why === rows, `${why} of ${rows}`);
    check(`${w} Gaps only hides notes`, (await page.locator("[data-graph-documents-list] [data-graph-note-row]").count()) === 0);
    await shot(page, `VIEW4-01-gaps-${w}`);
    await page.locator("[data-graph-gaps-only]").click();
    // The Links list's No reply.
    await page.locator('[data-track="graph-links"]').click();
    await page.locator('[data-graph-side-list="links"]').waitFor();
    const all = await page.locator("[data-graph-links-row]").count();
    await page.locator("[data-graph-links-no-reply]").click();
    await page.waitForTimeout(300);
    const kept = await page.locator("[data-graph-links-row]").count();
    check(`${w} No reply keeps 4 of 5 links`, all === 5 && kept === 4, `${all} → ${kept}`);
    await shot(page, `VIEW4-01-noreply-${w}`);
  }
  await ctx.close();
}

// ── Add to note (VIEW4-03) ─────────────────────────────────────────────────
async function gather(lang) {
  const { ctx, page } = await newPage(1440, 900, lang);
  await openGraph(page, VIEW);
  await page.evaluate(() => {
    for (const k of Object.keys(localStorage)) if (k.startsWith("unitos-note-gather:")) localStorage.removeItem(k);
  });
  await page.locator("[data-graph-find] input").fill("pity");
  await page.locator("[data-graph-find-list]").waitFor({ timeout: 20000 });
  await page.waitForFunction(() => document.querySelectorAll("[data-graph-find-group]").length > 1, null, { timeout: 20000 }).catch(() => {});
  if (before) {
    await shot(page, `VIEW4-03-find-${lang}-1440`);
    await ctx.close();
    return;
  }
  const groups = page.locator("[data-graph-find-group]");
  const g = await groups.count();
  let added = 0;
  for (let i = 0; i < g && added < 3; i++) {
    await groups.nth(i).locator('[data-graph-add-to-note="out"]').first().click();
    added++;
  }
  await page.waitForTimeout(300);
  const summary = await page.locator("[data-graph-note-gather-summary]").innerText().catch(() => "");
  check(`${lang} 3 passages in the note composer`, (await page.locator("[data-graph-note-gather-quote]").count()) === 3, summary);
  check(`${lang} the graph stays open`, (await page.locator(".graph-overlay-in").count()) === 1);
  const box = await page.evaluate(() => {
    const dock = document.querySelector("[data-graph-note-gather]")?.getBoundingClientRect();
    const list = document.querySelector("[data-graph-find-list]")?.getBoundingClientRect();
    return { dockTop: dock?.top, listBottom: list?.bottom, dockRight: dock?.right, listRight: list?.right };
  });
  check(`${lang} the composer docks under the side list`, box.listBottom <= box.dockTop && Math.abs(box.dockRight - box.listRight) < 2, JSON.stringify(box));
  await shot(page, `VIEW4-03-gather-${lang}-1440`);
  // A link panel's passage, and a node card's part.
  await page.locator('[data-track="graph-links"]').click();
  await page.locator("[data-graph-links-row]").first().click();
  await page.locator("[data-graph-link-panel]").waitFor();
  await page.locator('[data-graph-link-panel] [data-graph-add-to-note="out"]').first().click();
  await page.waitForTimeout(200);
  check(`${lang} a link's passage adds a quote`, (await page.locator("[data-graph-note-gather-quote]").count()) === 4);
  await shot(page, `VIEW4-03-link-${lang}-1440`);
  // Press In the note again: the quote leaves.
  await page.locator('[data-graph-link-panel] [data-graph-add-to-note="in"]').first().click();
  check(`${lang} a second press takes the quote out`, (await page.locator("[data-graph-note-gather-quote]").count()) === 3);
  // Close the graph and reload: the draft is kept.
  await page.locator('[data-track="graph-close"]').click();
  await page.waitForTimeout(500);
  await openGraph(page, VIEW);
  check(`${lang} a reload keeps the quotes`, (await page.locator("[data-graph-note-gather-quote]").count()) === 3);
  await page.locator("[data-graph-note-gather-words]").fill(`Pity across the project (${lang})`);
  await page.reload({ waitUntil: "networkidle" });
  for (let i = 0; i < 6 && (await page.locator(".graph-overlay-in").count()) === 0; i++) {
    await page.locator('[data-track="graph"]').first().click();
    await page.waitForTimeout(1500);
  }
  await page.locator("[data-graph-note-gather-words]").waitFor({ timeout: 20000 });
  check(`${lang} a reload keeps the words`, (await page.locator("[data-graph-note-gather-words]").inputValue()).startsWith("Pity across"));
  // A node card's part.
  await page.locator(".react-flow__node").first().click();
  await page.locator('aside[data-graph-node-card] [data-graph-add-to-note="out"]').first().waitFor({ timeout: 15000 });
  await page.locator('aside[data-graph-node-card] [data-graph-add-to-note="out"]').first().click();
  check(`${lang} a node card's part adds a quote`, (await page.locator("[data-graph-note-gather-quote]").count()) === 4);
  const docs = await page.locator("[data-graph-note-gather-quote]").evaluateAll((els) => new Set(els.map((e) => e.getAttribute("data-graph-note-gather-quote"))).size);
  await shot(page, `VIEW4-03-card-${lang}-1440`);
  const t0 = Date.now();
  const posted = page.waitForResponse((r) => r.url().endsWith("/api/notes") && r.request().method() === "POST");
  await page.locator('[data-track="graph-note-gather-save"]').click();
  const res = await posted;
  const note = await res.json();
  check(`${lang} Save note answers 201`, res.status() === 201, `${res.status()} in ${Date.now() - t0} ms`);
  await page.locator("[data-graph-note-gather-saved]").waitFor({ timeout: 10000 });
  await shot(page, `VIEW4-03-saved-${lang}-1440`);
  const stored = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("unitos-note-gather:")).length);
  check(`${lang} the draft is cleared once the server has the note`, stored === 0, String(stored));
  if (note.id) {
    const row = sql(`select n.status, n."documentId" is null, count(s.id), count(distinct s."documentId") from "Note" n join "Source" s on s."noteId"=n.id where n.id='${note.id}' group by 1,2`);
    const [status, projectNote, sources, sourceDocs] = row.split("|");
    check(`${lang} the note is accepted, each quote a source`, status === "ACCEPTED" && Number(sources) === 4, row);
    check(`${lang} sources on ${docs} documents`, Number(sourceDocs) === docs, row);
    check(`${lang} a note over several documents belongs to the project`, docs === 1 || projectNote === "t", row);
    check(`${lang} the note's text: the words, then each quote`, note.content.startsWith("Pity across") && (note.content.match(/^> /gm) ?? []).length >= 4, note.content.slice(0, 120));
  }
  // The API refuses a document of another project.
  const other = sql(`select nd."documentId" from "NotebookDocument" nd where nd."notebookId" <> '${VIEW}' and nd."documentId" not in (select "documentId" from "NotebookDocument" where "notebookId"='${VIEW}') limit 1`);
  const section = sql(`select id from "Section" where "notebookId"='${VIEW}' and not hidden order by "order" limit 1`);
  const refused = await page.evaluate(async ({ section, other }) => {
    const r = await fetch("/api/notes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sectionId: section, quotes: [{ documentId: other, quotedText: "the" }] }) });
    return r.status;
  }, { section, other });
  check(`${lang} a quote from another project's document is refused`, refused === 400, String(refused));
  const bad = await page.evaluate(async ({ section }) => {
    const r = await fetch("/api/notes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sectionId: section, quotes: [{ documentId: "x" }] }) });
    return r.status;
  }, { section });
  check(`${lang} a quote with no block and no words is refused`, bad === 400, String(bad));
  await ctx.close();
}

async function openAnnotations(page) {
  if ((await page.locator('[data-track="annotations"][aria-current="true"]').count()) === 0) await page.locator('[data-track="annotations"]').first().click();
  await page.waitForTimeout(800);
}

// ── The reader: notes on a link (WALK4-05), provenance folded (WALK4-03) ──
async function reader(lang) {
  const { ctx, page } = await newPage(1440, 900, lang);
  await page.goto(`${B}/n/${WALK}?doc=${SAE}`, { waitUntil: "networkidle", timeout: 300000 });
  await openAnnotations(page);
  await page.waitForTimeout(1500);
  await shot(page, `WALK4-03-annotations-${lang}-1440`);
  const cards = await page.locator("[data-annotation-link-id]").count();
  const removes = await page.locator('[data-annotation-link-id] [data-track="link-remove"]').count();
  const rows = await page.locator("[data-annotation-provenance-row]").count();
  check(`${lang} Schopenhauer as Educator: 3 link cards, no provenance card`, cards === 3, `${cards} cards, ${removes} Remove`);
  check(`${lang} provenance folds into rows, one per generated document`, rows >= 1 && rows <= 6, String(rows));
  const count = await page.locator('[data-track="document-list"] span.tabular-nums').first().innerText();
  check(`${lang} the picker counts the documents the graph counts`, count.trim() === "7", count);
  const stored = sql(`select count(*) from "DocLink" where "toDocumentId"='${SAE}' or "fromDocumentId"='${SAE}'`);
  console.log(`  links stored on the document: ${stored} (nothing removed)`);
  // WALK4-05: the link card and the chain tip on BOOK TWO.
  await page.goto(`${B}/n/${WALK}?doc=${BOOK2}`, { waitUntil: "networkidle", timeout: 300000 });
  await page.waitForTimeout(1500);
  const chain = await page.locator("[data-link-notes]").evaluateAll((els) => els.map((e) => [e.getAttribute("data-link-notes"), e.getAttribute("data-tip")]));
  check(`${lang} the chain tip counts the notes on the link`, chain.some(([n, tip]) => Number(n) === 2 && /2/.test(tip ?? "")), JSON.stringify(chain));
  await openAnnotations(page);
  await page.waitForTimeout(1000);
  const linkNotes = await page.locator("[data-annotation-link-notes]").evaluateAll((els) => els.map((e) => Number(e.getAttribute("data-annotation-link-notes"))));
  check(`${lang} the link card lists 2 notes on this link`, linkNotes.includes(2), JSON.stringify(linkNotes));
  const card = page.locator("[data-annotation-link-notes='2']").first();
  if (await card.count()) {
    await card.scrollIntoViewIfNeeded();
    await shot(page, `WALK4-05-card-${lang}-1440`);
    await card.locator("[data-annotation-link-note]").first().click();
    await page.waitForTimeout(1200);
    check(`${lang} a row shows the note in the tray`, (await page.locator('[data-note-id], [data-outline-note]').count()) > 0);
  }
  await ctx.close();
}

// ── Phone: the composer and the sheet (390) ───────────────────────────────
async function phone(lang) {
  const { ctx, page } = await newPage(390, 844, lang, true);
  await openGraph(page, VIEW);
  await page.locator('[data-track="graph-documents"]').click();
  await page.waitForTimeout(2500);
  await shot(page, `VIEW4-01-documents-${lang}-390`);
  if (!before) {
    await page.evaluate(() => {
      for (const k of Object.keys(localStorage)) if (k.startsWith("unitos-note-gather:")) localStorage.removeItem(k);
    });
    await page.locator("[data-graph-find] input").fill("pity");
    await page.locator("[data-graph-find-list]").waitFor({ timeout: 20000 });
    await page.waitForFunction(() => document.querySelectorAll("[data-graph-find-group]").length > 1, null, { timeout: 20000 }).catch(() => {});
    await page.locator('[data-graph-add-to-note="out"]').first().tap();
    await page.locator('[data-graph-add-to-note="out"]').first().tap();
    await page.waitForTimeout(300);
    const box = await page.evaluate(() => {
      const dock = document.querySelector("[data-graph-note-gather]")?.getBoundingClientRect();
      const list = document.querySelector("[data-graph-find-list]")?.getBoundingClientRect();
      return { dock: dock && [dock.left, dock.right, dock.top, dock.bottom], listBottom: list?.bottom, w: innerWidth, sw: document.documentElement.scrollWidth };
    });
    check(`${lang} 390: the composer fits the screen`, box.dock && box.dock[0] >= 0 && box.dock[1] <= 390 && box.sw <= 390, JSON.stringify(box));
    check(`${lang} 390: the list ends above the composer`, box.listBottom <= box.dock[2] + 1, JSON.stringify(box));
    await shot(page, `VIEW4-03-gather-${lang}-390`);
    await page.locator('[data-track="graph-note-gather-discard"]').tap();
    await page.waitForTimeout(300);
    check(`${lang} 390: Discard (confirmed) empties the composer`, (await page.locator("[data-graph-note-gather]").count()) === 0);
  }
  await ctx.close();
}

for (const lang of ["en", "zh"]) {
  if (!only || only === "cover") await cover(lang, 1440, 900);
  if (!only || only === "gather") await gather(lang);
  if (!only || only === "reader") await reader(lang);
  if (!only || only === "phone") await phone(lang);
}
await browser.close();
console.log(errors.length ? `page errors: ${JSON.stringify(errors)}` : "no page errors");
if (!before) console.log(`${passes} pass, ${failures} fail${failures ? "" : " — ALL PASS"}`);
process.exit(failures ? 1 : 0);
