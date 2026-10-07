// Round 5 GATHER5 (SPEC.md §13 Add to note, §22 Stitch): the path from the graph to writing.
//   WALK5-10 a Find passage is quoted at sentence bounds; VIEW5-05 Write a page from these;
//   VIEW5-04 Add to note on a passage a Stitch answer cites; WALK5-12 the new note clears the Stitch sheet.
// (REV5-03 two tabs and REV5-04 a save in flight: .qa-tmp/stitch/r5/gather5/gather-race.mjs.)
//   B=http://localhost:3162 TAG=after|before DB=<database> SESSION=<token> node scripts/qa/ui-graph-gather5.mjs [only]
// TAG=before takes screenshots only (the round 4 build on :3111). only: walk10 | view05 | view04 | walk12.
// Writes (after only): one note per language in WALK's first section (left in place: rows you created).
// VIEW5-04 stubs POST .../stitch with a reply that cites two blocks, `cited` built from the blocks' own
// text cut to 600 chars, as the route builds it (the mock's answers cite no block).
import { chromium } from "playwright-core";
import { execFileSync } from "node:child_process";

const B = process.env.B ?? "http://localhost:3162";
const TAG = process.env.TAG ?? "after";
const DB = process.env.DB ?? "dissect_r5gather5";
const SESSION = process.env.SESSION ?? "";
const SHOT = process.env.SHOT ?? "/mnt/project-files/stitch-graph-loop/round-5/gather5";
const WALK = "cmuxrbab0005b7drqv65fzl40"; // Linda WALK3, 7 documents
const only = process.argv[2] ?? "";
const before = TAG === "before";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--disable-dev-shm-usage"] });
const errors = [];
let passes = 0;
let failures = 0;
const check = (name, ok, detail = "") => {
  if (before) {
    console.log(`(before) ${name}${detail ? ` — ${detail}` : ""}`);
    return;
  }
  if (ok) passes++;
  else failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const sql = (q) => execFileSync("psql", ["-h", "localhost", "-U", "postgres", DB, "-At", "-c", q], { env: { ...process.env, PGPASSWORD: "postgres" } }).toString().trim();
const shot = (page, name) => page.screenshot({ path: `${SHOT}/${name}-${TAG}.png` });
const ENDS = /[.!?…。！？]["'”’)\]）」』]*$/;
const STARTS = /^["'“‘(\[]?[\p{Lu}\p{N}\p{Script=Han}]/u;

async function newPage(width, height, lang) {
  const touch = width < 500;
  const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch });
  const cookies = [{ name: "dissect-lang", value: lang, url: B }];
  if (SESSION) cookies.push({ name: "dissect-session", value: SESSION, url: B });
  await ctx.addCookies(cookies);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  page.on("dialog", (d) => void d.accept());
  return { ctx, page };
}
async function openGraph(page, q = "") {
  await page.goto(`${B}/n/${WALK}?graph=1${q ? `&graphFind=${encodeURIComponent(q)}` : ""}`, { waitUntil: "networkidle", timeout: 300000 });
  await page.locator(".react-flow__node").first().waitFor({ timeout: 120000 });
  await page.evaluate(() => {
    for (const k of Object.keys(localStorage)) if (k.startsWith("unitos-note-gather:")) localStorage.removeItem(k);
  });
  await page.reload({ waitUntil: "networkidle", timeout: 300000 });
  await page.locator(".react-flow__node").first().waitFor({ timeout: 120000 });
  if (q) await page.locator("[data-graph-find-group]").first().waitFor({ timeout: 60000 });
  await page.waitForTimeout(1000);
}
const storedQuotes = (page) =>
  page.evaluate(() => {
    const k = Object.keys(localStorage).find((x) => x.startsWith("unitos-note-gather:"));
    return k ? JSON.parse(localStorage.getItem(k)).quotes : [];
  });
// Controls a view adds (Linda, round 5: no bloat): buttons, fields, and selects inside the element.
const controls = (page, sel) => page.locator(sel).first().evaluate((el) => el.querySelectorAll("button, select, textarea, input").length).catch(() => 0);
const dockCount = (page) => page.locator("[data-graph-note-gather-quote]").count();
async function gatherTwo(page) {
  const adds = page.locator('[data-graph-find-list] [data-graph-add-to-note="out"]');
  await adds.first().waitFor({ timeout: 20000 });
  await adds.nth(0).click();
  await page.waitForTimeout(200);
  await page.locator('[data-graph-find-list] [data-graph-add-to-note="out"]').nth(0).click();
  await page.waitForTimeout(300);
}

// WALK5-10: a Find passage is quoted at sentence bounds.
if (!only || only === "walk10") {
  for (const [lang, w, h] of [["en", 1440, 900], ["zh", 1440, 900], ["en", 390, 844]]) {
    const { ctx, page } = await newPage(w, h, lang);
    await openGraph(page, "suffering");
    await gatherTwo(page);
    const quotes = await storedQuotes(page);
    const bounds = quotes.map((q) => `${STARTS.test(q.text) ? "starts" : "MID"}…${ENDS.test(q.text) ? "ends" : "MID"} (${q.text.length})`);
    console.log(`  ${lang} ${w} quotes:`, quotes.map((q) => JSON.stringify(q.text.slice(0, 70) + "…" + q.text.slice(-40))).join("\n    "));
    check(`WALK5-10 ${lang} ${w} two quotes, each a whole sentence`, quotes.length === 2 && quotes.every((q) => STARTS.test(q.text) && ENDS.test(q.text)), bounds.join(", "));
    await page.locator("[data-graph-note-gather-quote]").first().scrollIntoViewIfNeeded();
    await shot(page, `WALK5-10-dock-${w}-${lang}`);
    if (!before && w === 1440) {
      const posted = page.waitForResponse((r) => r.url().endsWith("/api/notes") && r.request().method() === "POST");
      await page.locator('[data-track="graph-note-gather-save"]').click();
      const note = await (await posted).json();
      const rows = sql(
        `SELECT s."startOffset" || ':' || s."endOffset" || ':' || length(b.text) || ':' || substr(b.text, greatest(s."startOffset" - 1, 1), 2) || '|' || substr(b.text, s."endOffset", 1) FROM "Source" s JOIN "Block" b ON b.id = s."blockId" WHERE s."noteId" = '${note.id}' ORDER BY s."startOffset"`,
      ).split("\n");
      // Each source starts the block or after a sentence end + space, and ends at a sentence end.
      const ok = rows.length === 2 && rows.every((r) => {
        const [start, , , edge] = r.split(":");
        const [beforeStart, last] = edge.split("|");
        return (start === "0" || /^[.!?…"'”’)\]。！？] ?/.test(beforeStart) || /[。！？]/.test(beforeStart)) && /[.!?…"'”’)\]。！？]/.test(last);
      });
      check(`WALK5-10 ${lang} the saved sources sit at sentence bounds`, ok, rows.join(" ; "));
    }
    await ctx.close();
  }
}

// VIEW5-05: Write a page from these.
if (!only || only === "view05") {
  for (const [lang, w, h] of [["en", 1440, 900], ["zh", 1440, 900], ["en", 390, 844], ["zh", 390, 844]]) {
    const { ctx, page } = await newPage(w, h, lang);
    await openGraph(page, "suffering");
    await gatherTwo(page);
    const button = page.locator('[data-track="graph-note-gather-write-page"]');
    console.log(`  controls in the composer (2 quotes): ${await controls(page, "[data-graph-note-gather]")}; rows: ${await page.locator("[data-graph-note-gather] form > *").count()}`);
    await shot(page, `VIEW5-05-dock-${w}-${lang}`);
    check(`VIEW5-05 ${lang} ${w} the composer has Write a page from these`, (await button.count()) === 1);
    if (before || (await button.count()) === 0) {
      await ctx.close();
      continue;
    }
    const posts = [];
    page.on("request", (r) => r.url().includes("/stitch") && !r.url().includes("/warm") && r.method() === "POST" && posts.push(r.url()));
    await button.click();
    await page.waitForTimeout(800);
    const box = page.locator('[data-stitch-slot] textarea');
    await box.waitFor({ timeout: 10000 });
    const command = await box.inputValue();
    const head = lang === "zh" ? "按这个顺序，用下面这些片段写一页" : "Write one page from these passages";
    const quotes = await storedQuotes(page);
    check(`VIEW5-05 ${lang} ${w} the Stitch box holds the command and both quotes`, command.startsWith(head) && command.includes("1. \"") && command.includes("2. \""), JSON.stringify(command.slice(0, 120)));
    const picked = await page.locator('[data-track="stitch-unpick"]').count();
    const docs = new Set(quotes.map((q) => q.documentId)).size;
    check(`VIEW5-05 ${lang} ${w} the quotes' documents are picked`, picked === docs, `${picked} picked, ${docs} documents`);
    check(`VIEW5-05 ${lang} ${w} nothing is sent`, posts.length === 0);
    check(`VIEW5-05 ${lang} ${w} the draft is kept`, quotes.length === 2);
    await shot(page, `VIEW5-05-box-${w}-${lang}`);
    await ctx.close();
  }
}

// VIEW5-04: Add to note on a passage a Stitch answer cites.
if (!only || only === "view04") {
  const blocks = sql(
    `SELECT b.id || '|' || b."documentId" || '|' || replace(d.title, '|', ' ') FROM "Block" b JOIN "Document" d ON d.id = b."documentId" JOIN "NotebookDocument" nd ON nd."documentId" = b."documentId" WHERE nd."notebookId" = '${WALK}' AND length(b.text) > 700 AND b.type = 'PARAGRAPH' ORDER BY b."documentId", b."order" LIMIT 1`,
  )
    .split("\n")
    .concat(
      sql(
        `SELECT b.id || '|' || b."documentId" || '|' || replace(d.title, '|', ' ') FROM "Block" b JOIN "Document" d ON d.id = b."documentId" JOIN "NotebookDocument" nd ON nd."documentId" = b."documentId" WHERE nd."notebookId" = '${WALK}' AND length(b.text) BETWEEN 120 AND 500 AND b.type = 'PARAGRAPH' ORDER BY b."documentId" DESC, b."order" LIMIT 1`,
      ).split("\n"),
    )
    .map((r) => {
      const [id, documentId, title] = r.split("|");
      return { id, documentId, title, text: sql(`SELECT text FROM "Block" WHERE id = '${id}'`).slice(0, 600) };
    });
  for (const [lang, w, h] of [["en", 1440, 900], ["zh", 1440, 900], ["en", 390, 844]]) {
    const { ctx, page } = await newPage(w, h, lang);
    await openGraph(page);
    await page.route("**/api/notebooks/*/stitch", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      const cited = Object.fromEntries(blocks.map((b) => [b.id, { documentId: b.documentId, title: b.title, text: b.text }]));
      const reply = `Both documents weigh suffering [block ${blocks[0].id}], and one answers it [block ${blocks[1].id}].`;
      await route.fulfill({ status: 200, contentType: "text/plain", body: JSON.stringify({ ok: true, reply, linkCount: 0, document: null, documents: [], cited, linkIds: [] }) });
    });
    if ((await page.locator('[data-track="stitch-expand"]').count()) > 0) await page.locator('[data-track="stitch-expand"]').click();
    const box = page.locator("[data-stitch-slot] textarea");
    await box.fill("What do these say about suffering?");
    await box.press("Enter");
    await page.locator('[data-track="stitch-citation"]').first().waitFor({ timeout: 20000 });
    await page.locator('[data-track="stitch-citation"]').first().click();
    await page.locator('[data-track-surface="stitch-passage"]').waitFor();
    const add = page.locator('[data-track-surface="stitch-passage"] [data-graph-add-to-note]');
    console.log(`  controls in the passage card: ${await controls(page, '[data-track-surface="stitch-passage"]')}; height ${Math.round((await page.locator('[data-track-surface="stitch-passage"]').boundingBox()).height)} px`);
    check(`VIEW5-04 ${lang} ${w} the passage card has Add to note`, (await add.count()) === 1);
    if (before || (await add.count()) === 0) {
      await shot(page, `VIEW5-04-passage-${w}-${lang}`);
      await ctx.close();
      continue;
    }
    await add.click();
    await page.waitForTimeout(300);
    const q = (await storedQuotes(page))[0];
    check(
      `VIEW5-04 ${lang} ${w} the cited passage is in the new note, at its block, ending a sentence`,
      q && q.blockId === blocks[0].id && blocks[0].text.startsWith(q.text) && ENDS.test(q.text) && q.text.length <= 600,
      q ? `${q.text.length} chars, block ${q.blockId}` : "no quote",
    );
    check(`VIEW5-04 ${lang} ${w} the button reads In the note`, (await add.getAttribute("data-graph-add-to-note")) === "in");
    await shot(page, `VIEW5-04-passage-${w}-${lang}`);
    // The short block is quoted whole.
    await page.locator('[data-track="stitch-passage-close"]').click();
    await page.locator('[data-track="stitch-citation"]').nth(1).click();
    await page.locator('[data-track-surface="stitch-passage"] [data-graph-add-to-note]').click();
    await page.waitForTimeout(300);
    const q2 = (await storedQuotes(page))[1];
    check(`VIEW5-04 ${lang} ${w} a short cited block is quoted whole`, q2 && q2.text === blocks[1].text.trim());
    await ctx.close();
  }
}

// WALK5-12: the new note clears the Stitch sheet.
if (!only || only === "walk12") {
  for (const [lang, w, h] of [["en", 390, 844], ["zh", 390, 844], ["en", 1440, 900], ["zh", 1440, 900]]) {
    const { ctx, page } = await newPage(w, h, lang);
    await openGraph(page, "suffering");
    await gatherTwo(page);
    await page.locator("[data-graph-note-gather-words]").fill(lang === "zh" ? "我的话。" : "My words.");
    // Close the Find list, then open Stitch.
    if (w < 1000) {
      const close = page.locator('[data-graph-side-list="find"] [aria-label]').filter({ hasText: "✕" }).first();
      if (await close.count()) await close.click();
      else await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
    }
    if ((await page.locator('[data-track="stitch-expand"]').count()) > 0) await page.locator('[data-track="stitch-expand"]').click();
    await page.waitForTimeout(800);
    const rects = await page.evaluate(() => {
      const r = (el) => (el ? el.getBoundingClientRect().toJSON() : null);
      const slot = document.querySelector("[data-stitch-slot]");
      const dock = document.querySelector("[data-graph-note-gather]");
      const box = slot?.firstElementChild;
      const d = r(dock);
      const head = d ? document.elementFromPoint(d.left + 40, d.top + 18) : null;
      return { box: r(box), dock: d, state: dock?.getAttribute("data-graph-note-gather"), headInDock: Boolean(head && dock?.contains(head)) };
    });
    const overlap = rects.box && rects.dock && rects.box.left < rects.dock.right && rects.box.right > rects.dock.left && rects.box.top < rects.dock.bottom && rects.box.bottom > rects.dock.top;
    check(`WALK5-12 ${lang} ${w} the new note and the Stitch box do not overlap`, !overlap && rects.headInDock, `dock ${Math.round(rects.dock?.top)}–${Math.round(rects.dock?.bottom)} (${rects.state}), box ${Math.round(rects.box?.top)}–${Math.round(rects.box?.bottom)}`);
    await shot(page, `WALK5-12-stitch-open-${w}-${lang}`);
    if (!before && w < 1000) {
      check(`WALK5-12 ${lang} ${w} over the box the new note folds to its header`, rects.state === "folded");
      await page.locator('[data-track="graph-note-gather-fold"]').click();
      await page.waitForTimeout(600);
      const words = await page.locator("[data-graph-note-gather-words]").inputValue().catch(() => "");
      const folded = await page.locator('[data-track="stitch-expand"]').count();
      check(`WALK5-12 ${lang} ${w} unfolding the note folds the box; the words are kept`, folded === 1 && words.length > 0, JSON.stringify(words));
      await shot(page, `WALK5-12-note-open-${w}-${lang}`);
    }
    await ctx.close();
  }
}

console.log(`${passes} pass, ${failures} fail; page errors: ${JSON.stringify(errors)}`);
await browser.close();
process.exit(failures ? 1 : 0);
