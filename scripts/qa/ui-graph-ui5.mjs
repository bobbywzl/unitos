// UI5 checks on the graph of "Linda WALK5" (round 5): keyboard and screen
// reader (WALK5-09), the Links pill after Back (WALK5-04), Show on the graph
// and the URL after Open in notes (VIEW5-10, WALK5-05), one saved line at a
// time (WALK5-14), the phone's fold of generated documents (WALK5-11), the
// Draft tag (WALK5-13), the zh chip and the reply buttons (WALK5-15).
//
//   BASE=http://localhost:3166 DB=dissect_r5ui5 OUT=<dir> MODE=after LANG_UI=en \
//     [ONLY=a11y,back,show,phone,draft,sizes] node scripts/qa/ui-graph-ui5.mjs
// MODE=before (BASE=http://localhost:3111) takes the screenshots and reads
// only; MODE=after also saves notes (the "show" step): run it on a copy of
// the database. Sign-in off.

import { chromium } from "playwright-core";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3166";
const DB = process.env.DB ?? "dissect_r5ui5";
const OUT = process.env.OUT ?? "/tmp/ui5";
const MODE = process.env.MODE ?? "after";
const LANG = process.env.LANG_UI ?? "en";
const ONLY = (process.env.ONLY ?? "a11y,back,show,phone,draft,sizes").split(",");
const NB = "cmuyh40a8005b7dv2ln1r7tiv";
const ARTHUR = "cmuyh403g00097dv23o7i2w5d";
const BOOK2 = "cmuyh403z002o7dv278aqhyeb";
const FLUTE = "cmuyh40nj005h7dv2ia9scz6x"; // BOOK TWO ⇄ Extra notes, 2 replies
const WILL = "cmuyh40dr005f7dv2huuu1mur"; // Schopenhauer as Educator ⇄ Arthur Schopenhauer
const after = MODE === "after";
const zh = LANG === "zh";
fs.mkdirSync(OUT, { recursive: true });

const sql = (q) =>
  execFileSync("psql", ["-h", "localhost", "-U", "postgres", DB, "-tAc", q], { env: { ...process.env, PGPASSWORD: "postgres" } })
    .toString()
    .trim();
let failures = 0;
const check = (ok, what, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${what}${detail ? ` — ${detail}` : ""}`);
};
const exe = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: fs.existsSync(exe) ? exe : undefined });

async function open(width, height = width < 640 ? 844 : 900) {
  const ctx = await browser.newContext({ viewport: { width, height }, ...(width < 640 ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
  await ctx.addCookies([{ name: "dissect-lang", value: LANG, url: BASE }]);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("pageerror", e.message));
  await page.goto(`${BASE}/n/${NB}?graph=1`, { waitUntil: "domcontentloaded", timeout: 180000 });
  await page.locator(".react-flow__node").first().waitFor({ timeout: 120000 });
  await page.waitForTimeout(1800); // the settle
  return { ctx, page };
}
const shot = (page, id, w) => page.screenshot({ path: `${OUT}/${id}-${MODE}-${w}-${LANG}.png` });
const node = (page, id) => page.locator(`.react-flow__node[data-id="${id}"]`);
const statusText = (page) => page.locator("[data-graph-status]").innerText().catch(() => "");

// ── WALK5-09: keyboard and screen reader ──
if (ONLY.includes("a11y")) {
  for (const w of [1440, 390]) {
    const { ctx, page } = await open(w);
    await page.evaluate(() => {
      window.__said = [];
      new MutationObserver((ms) => {
        for (const m of ms) {
          const el = m.target.nodeType === 1 ? m.target : m.target.parentElement;
          const live = el?.closest("[aria-live],[role=status],[role=log],[role=alert]");
          if (live && live.closest('[role="dialog"]')) window.__said.push(live.innerText.trim());
        }
      }).observe(document.body, { subtree: true, childList: true, characterData: true });
    });
    await node(page, ARTHUR).focus();
    await page.keyboard.press(" ");
    await page.waitForTimeout(400);
    const pressed = await page.evaluate(() => [...document.querySelectorAll(".react-flow__node")].map((n) => n.getAttribute("aria-pressed")));
    check(await node(page, ARTHUR).getAttribute("aria-pressed") === "true" || !after, "Space: the picked node reads aria-pressed=true", String(await node(page, ARTHUR).getAttribute("aria-pressed")));
    check(pressed.filter((p) => p === "false").length === pressed.length - 1 || !after, "every other node reads aria-pressed=false", pressed.join(","));
    const pickSaid = await statusText(page);
    check(/Arthur Schopenhauer/.test(pickSaid) && /1/.test(pickSaid) || !after, "the status says the pick", pickSaid);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(700);
    const cardSaid = await statusText(page);
    check((zh ? /卡片/ : /card shown/).test(cardSaid) || !after, "Enter pins the card and the status says so", cardSaid);
    await shot(page, "WALK5-09-card", w);
    // Skip to Stitch, type, Enter with one pick.
    await page.locator("[data-graph-title]").focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(600);
    const box = page.locator('[data-track="stitch-send"]').locator("xpath=ancestor::form[1]").locator("textarea");
    await box.focus();
    await page.keyboard.type("Which documents mention the flute?");
    await page.evaluate(() => (window.__said = []));
    await page.keyboard.press("Enter");
    await page.waitForTimeout(900);
    const said = await page.evaluate(() => window.__said);
    const describedBy = await box.getAttribute("aria-describedby");
    const reason = describedBy ? await page.locator(`[id="${describedBy}"]`).evaluate((e) => `${e.getAttribute("role")}: ${e.textContent}`).catch(() => "") : "";
    check((zh ? /再选取一篇/ : /Pick one more document/).test(reason) && reason.startsWith("status") || !after, "the text box points to the blocked line, a status", reason);
    check(said.some((s) => (zh ? /再选取一篇/ : /Pick one more document/).test(s)) || !after, "Enter with one pick says the reason again", JSON.stringify(said));
    check((await box.inputValue()) === "Which documents mention the flute?", "the command stays in the box");
    await shot(page, "WALK5-09-blocked", w);
    // Unpick from the card's button: the status says it.
    await node(page, ARTHUR).focus();
    await page.keyboard.press(" ");
    await page.waitForTimeout(400);
    const unpicked = await statusText(page);
    check((zh ? /没有选取/ : /No document picked/).test(unpicked) || !after, "unpicking the last says Stitch reads every document", unpicked);
    // axe on the open graph: no serious violation from these parts.
    await page.addScriptTag({ path: "node_modules/axe-core/axe.min.js" });
    const axe = await page.evaluate(async (detail) => {
      const r = await window.axe.run(document.querySelector('[role="dialog"]'), { runOnly: ["wcag2a", "wcag2aa", "wcag22aa"] });
      return r.violations
        .filter((v) => v.impact === "serious" || v.impact === "critical")
        .map((v) => `${v.id}:${v.nodes.length}${detail ? ` [${v.nodes.map((n) => n.target.join(" ")).join(" | ")}]` : ""}`);
    }, Boolean(process.env.AXE_DETAIL));
    console.log(`  axe ${w} ${LANG} serious/critical: ${axe.join(" ") || "none"}`);
    await ctx.close();
  }
}

// ── WALK5-04: the Links pill and Back to Links after a document and Back ──
if (ONLY.includes("back")) {
  const { ctx, page } = await open(1440);
  await page.click('[data-track="graph-links"]');
  await page.locator(`[data-graph-links-row="${FLUTE}"]`).click();
  await page.locator('[data-track="graph-link-panel-back"]').waitFor({ timeout: 8000 });
  const beforeVisit = await page.locator('[data-track="graph-links"]').getAttribute("aria-expanded");
  await page.locator('[data-graph-side-list="link"] [data-track="graph-link-open"]').first().click();
  await page.waitForURL((u) => u.search.includes("doc="), { timeout: 30000 });
  await page.locator(".graph-overlay-in").waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await page.goBack();
  await page.locator(".graph-overlay-in").waitFor({ timeout: 30000 });
  await page.waitForTimeout(1500);
  const backBtn = await page.locator('[data-track="graph-link-panel-back"]').count();
  const pill = await page.locator('[data-track="graph-links"]').getAttribute("aria-expanded");
  check(beforeVisit === "true", "before the visit: the Links pill reads open");
  check(backBtn === 1 || !after, "after Back: the panel still has Back to Links", String(backBtn));
  check(pill === "true" || !after, "after Back: the Links pill still reads open", String(pill));
  await shot(page, "WALK5-04-back", 1440);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  const listAfterEsc = await page.locator('[data-graph-side-list="links"]').count();
  const focusRow = await page.evaluate(() => document.activeElement?.getAttribute("data-graph-links-row"));
  check((listAfterEsc === 1 && focusRow === "cmuyh40nj005h7dv2ia9scz6x") || !after, "Escape goes back to the Links list, on the link's row", `${listAfterEsc} ${focusRow}`);
  await ctx.close();
}

// ── VIEW5-10, WALK5-14, WALK5-05: Show stays on the graph; one saved line; the URL ──
if (ONLY.includes("show") && after) {
  for (const w of [1440, 390]) {
    const { ctx, page } = await open(w);
    const tag = `${w}-${LANG}-${Date.now() % 100000}`;
    // Add to note from Find, then Save note: the dock's saved line.
    const find = page.locator('input[data-track="graph-find"]');
    await find.click();
    await find.fill("suffering");
    const passage = page.locator("[data-graph-find-passage]").first();
    await passage.waitFor({ timeout: 30000 });
    await passage.hover().catch(() => {});
    await page.locator('[data-track="graph-note-gather-add"]').first().click({ force: true });
    await page.locator('[data-graph-note-gather] textarea').fill(`UI5 gathered ${tag}`);
    await page.click('[data-track="graph-note-gather-save"]');
    await page.locator("[data-graph-note-gather-saved]").waitFor({ timeout: 20000 });
    let gatherId = "";
    for (let i = 0; i < 40 && !gatherId; i++) {
      gatherId = (await page.locator("[data-graph-note-gather-saved]").getAttribute("data-graph-note-gather-saved")) ?? "";
      if (!gatherId) await page.waitForTimeout(250);
    }
    await shot(page, "WALK5-14-gather-saved", w);
    // Note on this link on the will link: its saved line folds the dock's.
    await page.keyboard.press("Escape");
    await page.click('[data-track="graph-links"]');
    await page.locator(`[data-graph-links-row="${WILL}"]`).click();
    const panel = page.locator('[data-graph-side-list="link"]');
    await panel.locator('[data-track="graph-link-note"]').click();
    await panel.locator("textarea").last().fill(`UI5 link note ${tag}`);
    await panel.locator('[data-track="graph-link-note-save"]').click();
    await panel.locator('[data-track="graph-link-note-show"]').waitFor({ timeout: 20000 });
    const savedLines = await page.locator('[data-graph-note-gather-saved], [data-graph-link-note-saved]').count();
    check(savedLines === 1, "one saved line at a time: the link note's line folds the dock's", String(savedLines));
    await shot(page, "WALK5-14-one-line", w);
    const linkNoteId = await panel.locator("[data-graph-link-note-saved]").getAttribute("data-graph-link-note-saved");
    // Show: the graph stays, the Notes list opens on the note.
    const t0 = Date.now();
    await panel.locator('[data-track="graph-link-note-show"]').click();
    const list = page.locator('[data-graph-side-list="notes"]');
    await list.locator(`[data-graph-notes-row="${linkNoteId}"]`).waitFor({ timeout: 10000 }).catch(() => {});
    check((await page.locator(".graph-overlay-in").count()) === 1, "Show keeps the graph open");
    check((await list.locator(`[data-graph-notes-row="${linkNoteId}"]`).count()) === 1, "the Notes list opens on the note", `${Date.now() - t0} ms`);
    check(page.url().includes("graph=1"), "the URL keeps graph=1 while the graph shows the note");
    const lit = await page.evaluate(() => document.querySelectorAll(".react-flow__node.graph-lit, .react-flow__node [data-lit]").length);
    console.log(`  lit nodes (class probe): ${lit}`);
    await shot(page, "VIEW5-10-shown", w);
    // Open in notes leaves the graph; the URL moves at once.
    await list.locator('[data-track="graph-notes-open"]').first().click();
    const t1 = Date.now();
    const left = await page.waitForURL((u) => !u.search.includes("graph=1"), { timeout: 5000 }).then(() => Date.now() - t1, () => -1);
    check(left >= 0, "Open in notes (a note with sources): the URL leaves graph=1 once the reader renders", `${left} ms`);
    await page.locator(`[data-note-id="${linkNoteId}"]`).first().waitFor({ timeout: 10000 }).catch(() => {});
    check((await page.locator(".graph-overlay-in").count()) === 0 && (await page.locator(`[data-note-id="${linkNoteId}"]`).count()) > 0, "Open in notes closes the graph and the tray shows the note");
    const srcDoc = new URL(page.url()).searchParams.get("doc");
    await page.waitForTimeout(2500);
    const readerDoc = await page.evaluate(() => document.querySelector("[data-document-id]")?.getAttribute("data-document-id") ?? document.querySelector("[data-doc-id]")?.getAttribute("data-doc-id") ?? "");
    console.log(`  reader: url doc ${srcDoc}, drawn ${readerDoc}`);
    await shot(page, "VIEW5-10-open-in-notes", w);
    check(sql(`select count(*) from "Note" where content like 'UI5 % ${tag}'`) === "2" || sql(`select count(*) from "Note" where content like '%${tag}%'`) === "2", "both notes are stored once", sql(`select count(*) from "Note" where content like '%${tag}%'`));
    // Back: the graph again; Stitch's Save as note → Show stays on the graph.
    await page.goBack();
    await page.locator(".graph-overlay-in").waitFor({ timeout: 20000 }).catch(() => {});
    if ((await page.locator(".graph-overlay-in").count()) === 0) {
      await page.keyboard.press("m");
      await page.locator(".graph-overlay-in").waitFor({ timeout: 20000 });
    }
    await page.waitForTimeout(1200);
    if (w < 640) await page.locator('[data-track="stitch-expand"], [aria-label="Open Stitch"], [aria-label="展开缝合"]').first().click().catch(() => {});
    const stitchInput = page.locator('[data-track="stitch-send"]').locator("xpath=ancestor::form[1]").locator("textarea");
    await stitchInput.fill(zh ? "这些文档怎样说意志？" : "What do these documents say about the will?");
    await page.click('[data-track="stitch-send"]');
    const save = page.locator('[data-track="assistant-save-note:stitch"]').last();
    await save.waitFor({ timeout: 90000 }).catch(() => {});
    await save.click().catch(() => {});
    const sshow = page.locator('[data-track="assistant-saved-note-show"]').last();
    await sshow.waitFor({ timeout: 60000 }).catch(() => {});
    await sshow.click().catch(() => {});
    await page.locator('[data-graph-side-list="notes"]').waitFor({ timeout: 8000 }).catch(() => {});
    check((await page.locator(".graph-overlay-in").count()) === 1 && (await page.locator('[data-graph-side-list="notes"]').count()) === 1, "Save as note → Show keeps the graph and opens the Notes list");
    await shot(page, "VIEW5-10-stitch-shown", w);
    // The mock's note has no source: Open in notes changes only the graph's
    // parameters, so the URL moves at once (WALK5-05).
    const nl = page.locator('[data-graph-side-list="notes"]');
    await nl.locator('[data-track="graph-notes-open"]').first().waitFor({ timeout: 15000 }).catch(() => {});
    const before = page.url();
    await nl.locator('[data-track="graph-notes-open"]').first().click();
    const t2 = Date.now();
    const gone = await page.waitForURL((u) => !u.search.includes("graph=1"), { timeout: 5000 }).then(() => Date.now() - t2, () => -1);
    check(gone >= 0 && gone < 300, "Open in notes (a note on no document): the URL leaves graph=1 at once", `${gone} ms (round 4: 1200–2000 ms); ${before.replace(BASE, "")} → ${page.url().replace(BASE, "")}`);
    await ctx.close();
  }
}

// ── WALK5-11: the phone's fold of generated documents ──
if (ONLY.includes("phone")) {
  const { ctx, page } = await open(390);
  const boxes = await page.evaluate(() =>
    [...document.querySelectorAll(".react-flow__node")].map((n) => {
      const r = n.getBoundingClientRect();
      return { gen: n.classList.contains("graph-generated"), x: r.x, y: r.y, w: r.width, h: r.height };
    }),
  );
  const own = boxes.filter((b) => !b.gen);
  const span = (list, k, d) => Math.round(Math.max(...list.map((b) => b[k] + b[d])) - Math.min(...list.map((b) => b[k])));
  const inView = (b) => b.y + b.h > 0 && b.y < 844 && b.x + b.w > 0 && b.x < 390;
  console.log(`  own documents span ${span(own, "x", "w")}×${span(own, "y", "h")} px; generated in view: ${boxes.filter((b) => b.gen && inView(b)).length} of ${boxes.filter((b) => b.gen).length}`);
  check((await page.locator("[data-graph-generated-chip]").count()) === 0, "no new control on the canvas (round 5: add nothing new)");
  check(boxes.filter((b) => b.gen && inView(b)).length === 0 || !after, "no generated document is drawn on the phone with the switch off");
  const controls = await page.evaluate(() => [...document.querySelectorAll(".react-flow__controls button")].map((b) => { const r = b.getBoundingClientRect(); const t = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return b.contains(t); }));
  check(controls.every(Boolean), "the zoom controls are clear", controls.join(","));
  check(own.every(inView), "every own document is in view");
  await shot(page, "WALK5-11-phone", 390);
  if (after) {
    // The provenance switch shows them again.
    await page.click('[data-track="graph-provenance"]');
    await page.waitForTimeout(1200);
    const shown = await page.evaluate(() => document.querySelectorAll(".react-flow__node.graph-generated").length);
    check(shown > 0, "the provenance switch draws the generated documents again", String(shown));
    await page.click('[data-track="graph-provenance"]');
  }
  await ctx.close();
}

// ── WALK5-13: the Draft tag ──
if (ONLY.includes("draft")) {
  for (const w of [1440, 390]) {
    const { ctx, page } = await open(w);
    await page.evaluate(
      ([will, flute]) => {
        localStorage.setItem(`graph-link-note:user-1:${will}`, JSON.stringify({ content: "an unsent thought", sectionId: null, savedAt: Date.now() }));
        localStorage.setItem(`unitos-reply-draft:user-1:link:${flute}`, JSON.stringify({ content: "an unsent reply", savedAt: Date.now() }));
      },
      [WILL, FLUTE],
    );
    await page.click('[data-track="graph-links"]');
    await page.locator(`[data-graph-links-row="${WILL}"]`).waitFor();
    const tags = await page.locator("[data-graph-side-list=links] [data-link-draft]").evaluateAll((els) => els.map((e) => e.getAttribute("data-link-draft")));
    check((tags.includes(WILL) && tags.includes(FLUTE)) || !after, "the Links rows with a draft carry the draft dot", tags.join(","));
    check(tags.length === 2 || !after, "no other row carries the dot", String(tags.length));
    await shot(page, "WALK5-13-links", w);
    await page.keyboard.press("Escape");
    await node(page, BOOK2).click();
    await page.locator(`[data-graph-card-link="${FLUTE}"]`).waitFor({ timeout: 8000 }).catch(() => {});
    check((await page.locator(`[data-graph-card-link="${FLUTE}"] [data-link-draft]`).count()) === 1 || !after, "the card's link row carries the dot");
    await shot(page, "WALK5-13-card", w);
    // The reader's link card.
    await page.goto(`${BASE}/n/${NB}?doc=${BOOK2}&link=${FLUTE}`, { waitUntil: "domcontentloaded" });
    await page.locator(`[data-annotation-link-id="${FLUTE}"]`).first().waitFor({ timeout: 60000 }).catch(() => {});
    check((await page.locator(`[data-annotation-link-id="${FLUTE}"] [data-link-draft]`).count()) >= 1 || !after, "the reader's link card carries the dot");
    await shot(page, "WALK5-13-reader", w);
    await page.evaluate(([will, flute]) => {
      localStorage.removeItem(`graph-link-note:user-1:${will}`);
      localStorage.removeItem(`unitos-reply-draft:user-1:link:${flute}`);
    }, [WILL, FLUTE]);
    await ctx.close();
  }
}

// ── WALK5-15: the zh chip and the reply buttons ──
if (ONLY.includes("sizes")) {
  const { ctx, page } = await open(1440);
  // [chrome6] VIEW6-05: a small project may frame at zoom 1.3; a chip's height is read in flow units.
  const zoom = await page.evaluate(() => Number(document.querySelector(".corpus-graph")?.style.getPropertyValue("--graph-zoom")) || 1);
  const chips = await page.locator("[data-graph-node-notes]").evaluateAll((els, z) => els.map((e) => Math.round(e.getBoundingClientRect().height / z)), zoom);
  check(chips.every((h) => h <= 20) || !after, "every node's notes chip is one line", chips.join(","));
  await page.click('[data-track="graph-links"]');
  await page.locator(`[data-graph-links-row="${FLUTE}"]`).click();
  await page.locator('[data-track="reply-resolve"]').first().waitFor({ timeout: 10000 }).catch(() => {});
  const sizes = await page.evaluate(() =>
    ["reply-resolve", "reply-delete", "reply"].map((k) => {
      const e = document.querySelector(`[data-graph-side-list="link"] [data-track="${k}"]`);
      const r = e?.getBoundingClientRect();
      return r ? `${k} ${Math.round(r.width)}×${Math.round(r.height)}` : `${k} none`;
    }),
  );
  const small = sizes.filter((s) => /×/.test(s) && s.split(" ")[1].split("×").some((n) => Number(n) < 24));
  check(small.length === 0 || !after, "reply buttons are 24 px or more on a fine pointer", sizes.join(", "));
  await page.locator('[data-graph-side-list="link"] [data-graph-link-thread]').first().scrollIntoViewIfNeeded().catch(() => {});
  await shot(page, "WALK5-15-replies", 1440);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  await shot(page, "WALK5-15-chips", 1440);
  await ctx.close();
}

await browser.close();
console.log(failures === 0 ? "ALL PASS" : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
