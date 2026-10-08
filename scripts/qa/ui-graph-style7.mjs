// Round 7 STYLE7: one look per action across the graph's panels and the reader's link card.
//   BASE=http://localhost:3176 NB=<project> W=1440|390 LANG_UI=en|zh TAG=before|after SHOT=<dir> \
//     node scripts/qa/ui-graph-style7.mjs
// TAG=before (the round 6 build, read only): screenshots and measures; it never presses Remove,
// sends a Stitch command, or saves. TAG=after (your own server and database) also removes a link and
// brings it back with Undo, and sends one Stitch command to the mock model to measure Save as note
// and the rating thumbs. Nothing else is written; the new note's quotes go back out with Discard.
import { chromium } from "playwright-core";

const BASE = process.env.BASE ?? "http://localhost:3176";
const NB = process.env.NB ?? "cmuz6qch6005b7dluh2d3lqhz";
const W = Number(process.env.W ?? 1440);
const H = W < 500 ? 844 : 900;
const LANG = process.env.LANG_UI ?? "en";
const TAG = process.env.TAG ?? "after";
const SHOT = process.env.SHOT ?? "/mnt/project-files/stitch-graph-loop/round-7/style7";
const writes = TAG === "after";
if (writes && /:3111\b/.test(BASE)) throw new Error("TAG=after writes: not on :3111");
const touch = W < 500;
const floor = touch ? 40 : 24;

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, hasTouch: touch, isMobile: touch });
await ctx.addCookies([{ name: "dissect-lang", value: LANG, url: BASE }]);
const page = await ctx.newPage();
page.on("dialog", (d) => void d.accept());
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${W} ${LANG} ${name}${detail !== "" ? ` — ${detail}` : ""}`);
};
const shot = (id) => page.screenshot({ path: `${SHOT}/${id}-${TAG}-${W}-${LANG}.png` });
const box = async (loc) => ((await loc.count()) ? await loc.first().boundingBox() : null);
const style = (loc, prop) => loc.first().evaluate((el, prop) => getComputedStyle(el)[prop], prop);
const tipShown = () => page.evaluate(() => {
  const t = document.getElementById("app-tip");
  return !!t && t.getBoundingClientRect().width > 0 && getComputedStyle(t).opacity !== "0" && getComputedStyle(t).visibility !== "hidden";
});
const graph = async () => {
  await page.goto(`${BASE}/n/${NB}?graph=1`, { waitUntil: "networkidle", timeout: 300000 });
  await page.waitForSelector(".react-flow__node", { timeout: 120000 });
  await page.waitForTimeout(2000);
};

await graph();

// VIEW7-06: the counts are drawn as a pill, as tall as the Notes pill.
{
  const counts = page.locator('[data-track="graph-documents"]');
  const notes = page.locator('[data-track="graph-notes"]');
  const [c, n] = [await box(counts), await box(notes)];
  const border = await style(counts, "borderTopStyle");
  check("VIEW7-06: the counts are a bordered pill as tall as Notes", border === "solid" && c && n && Math.abs(c.height - n.height) <= 3, `${border} ${c?.height} vs ${n?.height}`);
  await shot("VIEW7-06");
}

// VIEW7-03: the node card's heads are Figtree, not the display face; the document chip is 24 px.
{
  await page.locator(".react-flow__node").first().click({ force: true });
  await page.waitForTimeout(1500);
  const card = page.locator("[data-graph-side-list], .graph-overlay aside").first();
  const h3 = card.locator("h3");
  const fam = (await h3.count()) ? await style(h3, "fontFamily") : "none";
  check("VIEW7-03: the card's section heads are not Caprasimo", !/caprasimo/i.test(fam), fam.slice(0, 40));
  const chip = await box(card.locator('[data-track="graph-card-neighbour"]'));
  if (chip) check("VIEW7-03: the document chip meets the floor", chip.height >= (touch ? 32 : 24), `${chip.height}`);
  const lead = await box(card.locator('[data-track="graph-card-open"]'));
  const pick = await box(card.locator('[data-track="graph-card-pick"]'));
  if (lead && pick) check("VIEW7-02: Open in reader and Pick are one height", Math.abs(lead.height - pick.height) < 1, `${lead.height} / ${pick.height}`);
  await shot("VIEW7-03");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
}

// VIEW7-01, 02, 04, 10: the link panel from the Links list.
{
  await page.locator('[data-track="graph-links"]').first().click();
  await page.waitForTimeout(1000);
  const row = page.locator("[data-track=graph-links-open]").first();
  await row.click();
  await page.waitForTimeout(1500);
  if (!touch) {
    // The pointer is still where the row was: no bubble over the panel (VIEW7-10).
    check("VIEW7-10: no tooltip pops under a still pointer after the panel opens", !(await tipShown()));
  }
  await shot("VIEW7-01");
  const panel = page.locator('[data-graph-side-list], .graph-overlay aside').first();
  const title = panel.locator("h2").first();
  if (await title.count()) check("VIEW7-04: the link panel's title is 16 px", (await style(title, "fontSize")) === "16px", await style(title, "fontSize"));
  else check("VIEW7-04: the link panel's title is 16 px", false, "no h2");
  const remove = panel.locator('[data-track="graph-link-remove"]');
  if (await remove.count()) {
    const color = await style(remove, "color");
    const [r, g, b] = (color.match(/[\d.]+/g) ?? []).map(Number);
    const red = color.startsWith("lab") ? Number(color.match(/lab\(([\d.]+) ([\d.-]+)/)?.[2]) > 30 : r > g + 60 && r > b + 60;
    check("VIEW7-01: Remove draws red", red, color);
  }
  const hs = [];
  for (const t of ["reply", "graph-link-note", "graph-link-remove"]) {
    const b = await box(panel.locator(`[data-track="${t}"]`));
    if (b) hs.push(Math.round(b.height));
  }
  check("VIEW7-02: the action row is one height at the floor", hs.length > 0 && hs.every((h) => h === hs[0] && h >= floor), hs.join("/"));
  const adds = await box(panel.locator('[data-track^="graph-note-gather-add"]'));
  const opens = await box(panel.locator('[data-track="graph-link-open"]'));
  if (adds && opens) check("VIEW7-02: Add to note and Open in reader are one height", Math.abs(adds.height - opens.height) < 1, `${adds.height} / ${opens.height}`);
  if (!touch) {
    const add = panel.locator('[data-tip]').filter({ hasText: /./ }).nth(1);
    const ab = await box(add);
    if (ab) {
      await page.mouse.move(ab.x + ab.width / 2 + 2, ab.y + ab.height / 2);
      await page.waitForTimeout(700);
      check("VIEW7-10: a real move shows the tooltip", await tipShown());
      await page.mouse.move(5, H / 2);
    }
  }
  // WALK7-10: Undo after Remove (writes: the link is hidden in this project, then Undo brings it back).
  if (writes && (await remove.count())) {
    await remove.first().click();
    const undo = page.locator('[data-track="graph-link-remove-undo"]');
    await undo.waitFor({ timeout: 10000 }).catch(() => {});
    const ub = await box(undo);
    check("WALK7-10: Undo meets the floor", !!ub && ub.height >= floor, `${ub?.width}x${ub?.height}`);
    await shot("WALK7-10-undo");
    if (ub) {
      await undo.click();
      await undo.waitFor({ state: "detached", timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(1000);
      const [left, removeBack, line] = [await undo.count(), await page.locator('[data-track="graph-link-remove"]').count(), await page.locator("[data-link-removed]").count()];
      check("WALK7-10: Undo brings the link back", left === 0 && removeBack === 1, `undo ${left}, Remove ${removeBack}, removed line ${line}`);
    }
  }
  // VIEW7-05: the same link in the reader's Annotations tab.
  const open = panel.locator('[data-track="graph-link-open"]').first();
  if (await open.count()) {
    await open.click();
    await page.waitForTimeout(8000);
    const show = page.locator('[data-track="link-show-on-graph"]');
    if (!(await show.first().isVisible().catch(() => false))) {
      // On a phone the Annotations tab is chosen but its sheet waits for a tap.
      await page.locator('[data-track="annotations"]:visible').first().click().catch(() => {});
      await page.waitForTimeout(2000);
    }
    const sb = await box(show);
    check("VIEW7-05: the reader's Show on graph meets the floor", !!sb && sb.height >= floor, `${sb?.height}`);
    const rm = page.locator('[data-track="link-remove"]');
    const rb = await box(rm);
    if (rb) {
      const color = await style(rm, "color");
      check("VIEW7-05: the reader's Remove meets the floor, red", rb.height >= floor && Math.abs(rb.height - (sb?.height ?? 0)) < 1, `${rb.height} ${color}`);
    }
    await shot("VIEW7-05");
  }
}

// VIEW7-07, VIEW7-02 (Gaps only): the Documents list.
await graph();
{
  await page.locator('[data-track="graph-documents"]').first().click();
  await page.waitForTimeout(1500);
  const row = page.locator("[data-graph-documents-row]").first();
  const btn = row.locator('[data-track="graph-documents-row-open"]');
  const [rb, bb] = [await box(row), await box(btn)];
  check("VIEW7-07: a shut row's button fills the row", !!rb && !!bb && rb.height - bb.height <= 2.5 && rb.width - bb.width <= 2.5, `row ${rb?.width}x${rb?.height}, button ${bb?.width}x${bb?.height}`);
  const gaps = await box(page.locator('[data-track="graph-documents-gaps"]'));
  if (gaps) check("VIEW7-02: Gaps only meets the floor", gaps.height >= floor, `${gaps.height}`);
  await shot("VIEW7-07");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
}

// VIEW7-02: Accept and Dismiss in Recommended links line up.
{
  const pill = page.locator('[data-track="graph-recommended-links"]');
  if (await pill.count()) {
    await pill.first().click();
    await page.waitForTimeout(1500);
    const a = await box(page.locator('[data-track="link-accept"]'));
    const d = await box(page.locator('[data-track="link-dismiss"]'));
    if (a && d) check("VIEW7-02: Accept and Dismiss are one height and line up", Math.abs(a.height - d.height) < 1 && Math.abs(a.y - d.y) < 1, `${a.height}@${a.y} / ${d.height}@${d.y}`);
    await shot("VIEW7-02");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
  }
}

// VIEW7-11: Open in notes shows at rest on the first Notes row.
{
  await page.locator('[data-track="graph-notes"]').first().click();
  await page.waitForTimeout(1500);
  await page.mouse.move(5, H / 2);
  const first = page.locator('[data-track="graph-notes-open"]').first();
  if (await first.count()) {
    const op = await style(first, "opacity");
    check("VIEW7-11: Open in notes shows on the first row", op === "1", op);
    const b = await box(first);
    check("VIEW7-11: Open in notes meets the floor", !!b && b.height >= floor, `${b?.height}`);
  }
  await shot("VIEW7-11");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
}

// WALK7-10: the new note's Save note and Discard (Find, Add to note).
{
  const find = page.locator('[data-track="graph-find"]').first();
  await find.click();
  await find.fill("will"); // the project's documents are in English
  await page.waitForTimeout(4000);
  const add = page.locator('[data-track^="graph-note-gather-add"]').first();
  if (await add.count()) {
    await add.click();
    await page.waitForTimeout(1200);
    const save = await box(page.locator('[data-track="graph-note-gather-save"]'));
    const discard = await box(page.locator('[data-track="graph-note-gather-discard"]'));
    check("WALK7-10: Save note and Discard meet the floor", !!save && !!discard && save.height >= floor && discard.height >= floor, `${save?.width}x${save?.height} / ${discard?.width}x${discard?.height}`);
    await page.locator('[data-track="graph-note-gather-save"]').scrollIntoViewIfNeeded().catch(() => {});
    await shot("WALK7-10-new-note");
    if (discard) {
      await page.locator('[data-track="graph-note-gather-discard"]').click();
      await page.waitForTimeout(600);
    }
  } else check("WALK7-10: Find found a passage to add", false);
  await find.fill("");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
}

// WALK7-10: Pick documents, Save as note, and the rating thumbs in the Stitch box.
{
  if (touch) {
    const pill = page.locator('[data-track="stitch-expand"]');
    if (await pill.count()) {
      await pill.click();
      await page.waitForTimeout(800);
    }
  }
  const pick = await box(page.locator('[data-track="stitch-pick"]'));
  check("WALK7-10: Pick documents meets the floor", !!pick && pick.height >= floor, `${pick?.width}x${pick?.height}`);
  if (writes) {
    const field = page.locator("[data-stitch-slot] textarea").first();
    await field.click();
    await field.fill(LANG === "zh" ? "这些文档怎么说意志？" : "What do these documents say about the will?");
    await page.keyboard.press("Enter");
    const save = page.locator('[data-track="assistant-save-note:stitch"]');
    await save.waitFor({ timeout: 90000 }).catch(() => {});
    const sb = await box(save);
    check("WALK7-10: Save as note meets the floor", !!sb && sb.height >= floor, `${sb?.width}x${sb?.height}`);
    const up = await box(page.locator('[data-track="rate:stitch:up"]'));
    const down = await box(page.locator('[data-track="rate:stitch:down"]'));
    check("WALK7-10: the rating thumbs meet the floor", !!up && !!down && up.height >= floor && down.height >= floor && up.x + up.width <= down.x + 0.5, `${up?.width}x${up?.height} / ${down?.width}x${down?.height}`);
    await shot("WALK7-10-stitch");
  }
}

console.log(`${pass} pass, ${fail} fail; page errors: ${JSON.stringify(errors)}`);
await browser.close();
process.exit(fail ? 1 : 0);
