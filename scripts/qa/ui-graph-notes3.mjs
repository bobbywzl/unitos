// Round 3 NOTES3 (graph ⇄ notes ⇄ reader) over the WALK3 project
// "Linda WALK3 — Nietzsche and Schopenhauer" (.qa-tmp/stitch/r3/walk/seed-walk3.mjs
// and the walk's own rows). Read-only: it writes no row.
//   WALK3-01  a Note on this link's sources reach their words (?src=)
//   WALK3-03  the link panel lists the notes on the link
//   VIEW3-04  Show on graph from the tray and the notes full page
//   VIEW3-05  the Notes list's line: Show them, and the notes full page
//   VIEW3-02  the chain icon's reply count; ?link= turns the tray to Annotations;
//             a link card's Show on graph
//   VIEW3-09  the rail's graph from a reader at a link opens its panel
//
//   BASE=http://localhost:3163 OUT=<dir> MODE=after|before node scripts/qa/ui-graph-notes3.mjs
// MODE=before only takes the screenshots (against the unchanged build).

import { chromium } from "playwright-core";
import fs from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3163";
const OUT = process.env.OUT ?? ".qa-tmp/stitch/r3/notes3";
const MODE = process.env.MODE ?? "after";
const ONLY = process.env.ONLY ?? "";
const NB = "cmuxrbab0005b7drqv65fzl40";
const BOOK_TWO = "cmuxrba7y002o7drqgjys6uv2";
const EXTRA = "cmuxrba8g003h7drqp5u98xhj";
const ARTHUR = "cmuxrba7b00097drq9o4uakh7";
const FLUTE_LINK = "cmuxrbahi005h7drqh5o818gz"; // BOOK TWO ⇄ Extra notes, 2 open replies
const FLUTE_NOTE = "cmuxrgul9001j7dahrz4l4med"; // "Flute and pessimism", Note on this link
const FLUTE_SRC = { [BOOK_TWO]: "cmuxrgula001l7dahcz5a82kh", [EXTRA]: "cmuxrgula001m7dahsc58lxtw" };
const OLD_FLUTE_NOTE = "cmuxrbajw006b7drq9s4f3aow"; // "The flute-playing pessimist"
const SINGLE_NOTE = "cmuxrbajh00627drqmw78rze0"; // "Happiness is negative", one document
fs.mkdirSync(OUT, { recursive: true });

let failures = 0;
const check = (ok, what, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${what}${detail ? ` — ${detail}` : ""}`);
};
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}-${MODE}.png` });

const exe = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: fs.existsSync(exe) ? exe : undefined });

async function newPage(width, lang) {
  const ctx = await browser.newContext({ viewport: { width, height: width > 500 ? 900 : 844 } });
  await ctx.addCookies([{ name: "dissect-lang", value: lang, url: BASE }]);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("pageerror", e.message));
  return { ctx, page };
}
const settle = (page, ms = 1500) => page.waitForTimeout(ms);
async function hydrated(page) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await settle(page, 1200);
}
async function railGraph(page) {
  for (let i = 0; i < 5 && (await page.locator(".graph-overlay-in").count()) === 0; i++) {
    await page.locator('[data-track="graph"]').first().click({ force: true }).catch(() => {});
    await settle(page);
  }
  await settle(page);
}
// Where an element sits against the reader pane: true when its top is in view.
const inView = (page, selector) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: Math.round(r.top), ok: r.top >= 0 && r.bottom <= window.innerHeight && r.width > 0 };
  }, selector);

// Wait for a selector (the graph's data lands after the open).
const has = (page, sel, ms = 15000) =>
  page.locator(sel).first().waitFor({ state: "attached", timeout: ms }).then(() => true, () => false);

const run = (id) => !ONLY || ONLY.split(",").includes(id);

for (const lang of ["en", "zh"]) {
  for (const width of [1440, 390]) {
    const tag = `${lang}-${width}`;
    const { ctx, page } = await newPage(width, lang);

    // WALK3-01: each source of the Note on this link reaches its words.
    if (run("WALK3-01")) {
      for (const doc of [BOOK_TWO, EXTRA]) {
        const src = FLUTE_SRC[doc];
        await page.goto(`${BASE}/n/${NB}?doc=${doc}&src=${src}`);
        await hydrated(page);
        await settle(page, 2500);
        const sel = `[data-source-id="${src}"], [data-source-ids~="${src}"]`;
        const at = await inView(page, sel);
        if (doc === BOOK_TWO) await shot(page, `WALK3-01-${tag}`);
        if (MODE === "after") check(Boolean(at?.ok), `${tag} WALK3-01 ?src= reaches the quote in ${doc === BOOK_TWO ? "BOOK TWO" : "Extra notes"}`, JSON.stringify(at));
      }
    }

    // VIEW3-02: the chain's reply count, and the arrival on the Annotations tab.
    if (run("VIEW3-02")) {
      await page.goto(`${BASE}/n/${NB}?doc=${BOOK_TWO}&link=${FLUTE_LINK}`);
      await hydrated(page);
      await settle(page, 2500);
      await shot(page, `VIEW3-02-${tag}`);
      if (MODE === "after") {
        const chain = await page.locator(`a.link-chain[data-link-replies]`).first().getAttribute("data-link-replies").catch(() => null);
        check(chain === "2", `${tag} VIEW3-02 the flute link's chain counts 2 replies`, String(chain));
        if (width > 500) {
          const card = await inView(page, `[data-annotation-link-id="${FLUTE_LINK}"]`);
          check(Boolean(card?.ok), `${tag} VIEW3-02 ?link= shows the link card in the Annotations tab`, JSON.stringify(card));
          // Show on graph on the link card opens its panel.
          await page.locator(`[data-annotation-link-id="${FLUTE_LINK}"] [data-track="link-show-on-graph"]`).click();
          await settle(page, 2500);
          check(await has(page, `[data-graph-link-panel="${FLUTE_LINK}"]`), `${tag} VIEW3-02 link card Show on graph opens the link panel`);
          await shot(page, `VIEW3-02-graph-${tag}`);
        } else {
          // On a phone the sheet stays shut: only the tab turns.
          check((await page.locator(`[data-annotation-link-id="${FLUTE_LINK}"]`).first().isVisible().catch(() => false)) === false, `${tag} VIEW3-02 the phone's sheet stays shut on arrival`);
        }
      }
    }

    // VIEW3-09: the rail from a reader at a link opens that link's panel.
    if (run("VIEW3-09")) {
      await page.goto(`${BASE}/n/${NB}?doc=${BOOK_TWO}&link=${FLUTE_LINK}`);
      await hydrated(page);
      // A fresh visit: no kept view.
      await page.evaluate(() => sessionStorage.clear());
      await railGraph(page);
      await has(page, ".react-flow__node");
      await settle(page, 800);
      await shot(page, `VIEW3-09-${tag}`);
      if (MODE === "after") check(await has(page, `[data-graph-link-panel="${FLUTE_LINK}"]`), `${tag} VIEW3-09 graph from ?link= opens the link panel`);

      // WALK3-03: that panel lists the notes on the link.
      if (run("WALK3-03")) {
        const panel = page.locator(`[data-graph-link-panel="${FLUTE_LINK}"]`);
        const notes = panel.locator(`[data-graph-link-notes="${FLUTE_LINK}"]`);
        if (await notes.count()) await notes.scrollIntoViewIfNeeded();
        await shot(page, `WALK3-03-${tag}`);
        if (MODE === "after") {
          const ids = await notes.locator("[data-graph-note-row]").evaluateAll((els) => els.map((e) => e.getAttribute("data-graph-note-row")));
          check(ids.includes(FLUTE_NOTE) && ids.includes(OLD_FLUTE_NOTE), `${tag} WALK3-03 the panel lists both notes on the link`, ids.join(","));
          // A row shows the note in the tray, at its quote.
          await notes.locator(`[data-graph-note-row="${FLUTE_NOTE}"] button`).first().click();
          await settle(page, 3500);
          const url = page.url();
          check(url.includes(`src=`) && (await page.locator(".graph-overlay-in").count()) === 0, `${tag} WALK3-03 a row opens the reader at the note's quote`, url.replace(BASE, ""));
          const src = new URL(url).searchParams.get("src");
          const at = src ? await inView(page, `[data-source-id="${src}"], [data-source-ids~="${src}"]`) : null;
          check(Boolean(at?.ok), `${tag} WALK3-01 Open in notes reaches the quote`, JSON.stringify(at));
        }
      }
    }

    // VIEW3-05: the Notes list's single-document line.
    if (run("VIEW3-05")) {
      await page.goto(`${BASE}/n/${NB}?doc=${ARTHUR}`);
      await hydrated(page);
      await page.evaluate(() => sessionStorage.clear());
      await railGraph(page);
      await has(page, ".react-flow__node");
      await page.locator('[data-track="graph-notes"]').click({ force: true });
      await settle(page, 800);
      if (MODE === "after") {
        const single = page.locator('[data-track="graph-notes-single"]');
        check((await single.count()) === 1, `${tag} VIEW3-05 the line has Show them`);
        await single.click().catch(() => {});
        await settle(page, 500);
        check((await page.locator(`[data-graph-notes-single] [data-graph-notes-row="${SINGLE_NOTE}"]`).count()) === 1, `${tag} VIEW3-05 Show them lists "Happiness is negative"`);
        const href = await page.locator('[data-track="graph-notes-full-page"]').getAttribute("href").catch(() => null);
        check(href === `/n/${NB}/notes`, `${tag} VIEW3-05 the notes full page link`, String(href));
        await page.locator("[data-graph-notes-single]").scrollIntoViewIfNeeded().catch(() => {});
      }
      await shot(page, `VIEW3-05-${tag}`);
    }

    // VIEW3-04: Show on graph from the tray.
    if (run("VIEW3-04")) {
      await page.goto(`${BASE}/n/${NB}?doc=${ARTHUR}`);
      await hydrated(page);
      await page.evaluate(() => sessionStorage.clear());
      await page.evaluate((id) => window.dispatchEvent(new CustomEvent("dissect:show-note", { detail: { noteId: id } })), SINGLE_NOTE);
      await settle(page, 1500);
      const card = page.locator(`aside [data-note-id="${SINGLE_NOTE}"]`).first();
      await card.hover().catch(() => {});
      await shot(page, `VIEW3-04-tray-${tag}`);
      if (MODE === "after") {
        const button = card.locator('[data-track="note-show-on-graph"]');
        check((await button.count()) === 1, `${tag} VIEW3-04 the tray's note card has Show on graph`);
        await button.click({ force: true }).catch(() => {});
        await settle(page, 3000);
        check(page.url().includes("graph=1"), `${tag} VIEW3-04 the graph opens`, page.url().replace(BASE, ""));
        check(await has(page, `[data-graph-notes-row="${SINGLE_NOTE}"]`), `${tag} VIEW3-04 the Notes list is on the one-document note`);
        await has(page, "[data-graph-notes-link]");
        await page.mouse.move(2, 2);
        await settle(page, 600);
        const lit = await page.evaluate(() =>
          [...document.querySelectorAll(".react-flow__node[data-lit]")].map((n) => n.getAttribute("data-id")),
        );
        check(lit.length === 1 && lit[0] === ARTHUR, `${tag} VIEW3-04 the canvas lights the note's one document`, lit.join(","));
        const links = await page.locator("[data-graph-notes-link]").count();
        check(links >= 1, `${tag} VIEW3-04 the links of its document are listed`, String(links));
        await shot(page, `VIEW3-04-graph-${tag}`);
        // A link there opens its panel; Back returns to the list.
        await page.locator("[data-graph-notes-link]").first().click();
        await settle(page, 600);
        check((await page.locator("[data-graph-link-panel]").count()) === 1, `${tag} VIEW3-04 a link opens the panel`);
        await page.locator('[data-track="graph-link-panel-back"]').click().catch(() => {});
        await settle(page, 600);
        check((await page.locator(`[data-graph-notes-row="${SINGLE_NOTE}"]`).count()) === 1, `${tag} VIEW3-04 the panel's Back returns to the shown note`);
        // ✕ closes the graph; Back returns to the tray on the note.
        await page.locator('[data-track="graph-close"]').click();
        await settle(page, 1500);
        check((await page.locator(".graph-overlay-in").count()) === 0 && page.url().includes(`doc=${ARTHUR}`), `${tag} VIEW3-04 ✕ returns to the reader`, page.url().replace(BASE, ""));
      }
    }

    // VIEW3-04: Show on graph from the notes full page.
    if (run("VIEW3-04")) {
      await page.goto(`${BASE}/n/${NB}/notes`);
      await hydrated(page);
      await page.evaluate(() => sessionStorage.clear());
      const card = page.locator(`[data-note-id="${FLUTE_NOTE}"]`).first();
      await card.scrollIntoViewIfNeeded().catch(() => {});
      await card.hover().catch(() => {});
      await shot(page, `VIEW3-04-fullpage-${tag}`);
      if (MODE === "after") {
        let button = card.locator('[data-track="note-show-on-graph"]');
        if ((await button.count()) === 0) {
          // A collapsed card: open it first.
          await card.click().catch(() => {});
          await settle(page, 500);
          button = card.locator('[data-track="note-show-on-graph"]');
        }
        check((await button.count()) === 1, `${tag} VIEW3-04 the notes full page card has Show on graph`);
        await button.click({ force: true }).catch(() => {});
        await page.waitForURL(/graph=1/, { timeout: 15000 }).catch(() => {});
        await hydrated(page);
        await settle(page, 2500);
        check(await has(page, `[data-graph-notes-row="${FLUTE_NOTE}"]`), `${tag} VIEW3-04 from the full page the Notes list is on the note`);
        check(!page.url().includes("graphNote="), `${tag} VIEW3-04 graphNote leaves the URL`, page.url().replace(BASE, ""));
        await has(page, "[data-graph-notes-link]");
        const between = await page.locator("[data-graph-notes-link]").evaluateAll((els) => els.map((e) => e.getAttribute("data-graph-notes-link")));
        check(between.includes(FLUTE_LINK), `${tag} VIEW3-04 the links between its documents include the flute link`, between.join(","));
        await shot(page, `VIEW3-04-fromfull-${tag}`);
      }
    }
    await ctx.close();
  }
}
await browser.close();
console.log(failures === 0 ? "ALL PASS" : `${failures} FAIL`);
process.exit(failures === 0 ? 0 : 1);
