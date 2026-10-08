// Round 4 LISTS4: the Documents list at scale, the keyboard, the header pills, and the small fixes.
//   node scripts/qa/ui-graph-lists4.mjs <port> [ONLY=a,b]
// Projects (from `dissect`): LIB (36 documents), FORTY (41, zh names), LINDA (7 + generated documents,
// a link with replies, notes in documents). Writes nothing to the database: the one note draft it types
// goes back out with Cancel. Screenshots go to SHOT.
import { chromium } from "playwright-core";

const port = process.argv[2] || "3163";
const B = `http://localhost:${port}`;
const LIB = process.env.LIB || "cmuxjmw8704qt7dztg6adlhps";
const FORTY = process.env.FORTY || "cmuy46ui500hs7dpzttt5f9il";
const LINDA = process.env.LINDA || "cmuy46sr4005b7doy5eghkkeq";
const NOTE = process.env.NOTE || "cmuy46tl500627doygqdr5yy8";
const REPLY_LINK = process.env.REPLY_LINK || "cmuy46tir005h7doy49wc2qdz";
const SHOT = process.env.SHOT ?? "/mnt/project-files/stitch-graph-loop/round-4/lists4";
const only = process.env.ONLY?.split(",");
const want = (id) => !only || only.includes(id);
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const errors = [];
let failures = 0;
let passes = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures++;
  else passes++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

async function newPage(width, height, lang, touch = false) {
  const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch });
  await ctx.addCookies([{ name: "dissect-lang", value: lang, url: B }]);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  const calls = [];
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith("/api/")) calls.push(`${r.method()} ${u.pathname}`);
  });
  return { ctx, page, calls };
}
async function openGraph(page, nb) {
  await page.goto(`${B}/n/${nb}`, { waitUntil: "load", timeout: 300000 });
  for (let i = 0; i < 6 && (await page.locator(".graph-overlay-in").count()) === 0; i++) {
    await page.locator('[data-track="graph"]').first().click().catch(() => {});
    await page.waitForTimeout(1500);
  }
  await page.locator(".react-flow__node").first().waitFor({ timeout: 90000 }).catch(async (e) => {
    await page.screenshot({ path: `${SHOT}/debug-open.png` });
    throw e;
  });
  await page.waitForTimeout(1500);
}
const list = (page) => page.locator("[data-graph-documents-list]");
// [chrome6] VIEW6-04: rows are one line until opened; open the first row with a link.
async function openRowWithLink(page) {
  const row = page.locator("[data-graph-documents-row]").filter({ hasText: /\blinks?\b|条链接/ }).first();
  if ((await row.getAttribute("data-open")) === null) await row.locator("[data-row-head]").click();
  await page.waitForTimeout(200);
}
async function openList(page) {
  // The part titles load once per tab: wait for that answer when it is asked for.
  const titles = page.waitForResponse((r) => r.url().includes("parts=titles"), { timeout: 120000 }).catch(() => null);
  await page.locator('[data-track="graph-documents"]').click();
  await list(page).waitFor({ timeout: 10000 });
  await Promise.race([titles, page.waitForTimeout(8000)]);
  await page.waitForTimeout(500);
}
const active = (page) =>
  page.evaluate(() => {
    const a = document.activeElement;
    if (!a || a === document.body) return "body";
    return a.getAttribute("data-track") || [...a.attributes].map((x) => x.name).filter((n) => n.startsWith("data-")).join(",") || a.tagName;
  });

// ── VIEW4-04 / WALK4-09: 36 documents, 1440 en ─────────────────────────────
if (want("scale")) {
  const { ctx, page } = await newPage(1440, 900, "en");
  await openGraph(page, LIB);
  await openList(page);
  const rows = page.locator("[data-graph-documents-row]");
  const n = await rows.count();
  // [chrome6] VIEW6-04: one-line rows at every size; past 20 rows the reader's documents come first.
  check("36 rows, one line each, the reader's documents first past 20", n >= 36 && (await list(page).getAttribute("data-compact")) !== null && (await list(page).getAttribute("data-mine-first")) !== null, `${n} rows`);
  const heights = await rows.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
  check("every row is one line (≤ 40px)", Math.max(...heights) <= 40, `tallest ${Math.max(...heights)}`);
  const scroll = await list(page).evaluate((el) => el.scrollHeight);
  check("the list is under a quarter of round 3's 7,121px", scroll < 1780, `${scroll}px`);
  check("structure: a list, a heading per row, labelled Documents",
    (await list(page).locator("ul[role=list] > li").count()) === n &&
      (await list(page).locator("li h3").count()) === n &&
      (await list(page).getAttribute("aria-label")) === "Documents");
  const tabbable = await list(page).evaluate((el) =>
    [...el.querySelectorAll("button, input, a[href], select")].filter((x) => x.tabIndex >= 0 && x.getClientRects().length).length);
  // The head's controls: close, the filter, and COVER4's Gaps only when the coverage has loaded.
  const head = 2 + (await list(page).locator("[data-graph-gaps-only]").count());
  const rowStops = await list(page).evaluate((el) =>
    [...el.querySelectorAll("ul[role=list] button, ul[role=list] input, ul[role=list] a[href], ul[role=list] select")].filter((x) => x.tabIndex >= 0 && x.getClientRects().length).length);
  check("one Tab stop per row (+ close, filter, Gaps only)", tabbable === n + head && rowStops === n, `${tabbable} for ${n} rows (${rowStops} in the rows, ${head} in the head)`);
  await page.screenshot({ path: `${SHOT}/VIEW4-04-after-compact.png` });
  // Open the row with the most parts: parts capped at 8 with "N more parts".
  const most = await rows.evaluateAll((els) => {
    let best = null, k = -1;
    for (const el of els) {
      const m = /(\d+) parts?/.exec(el.textContent ?? "");
      if (m && Number(m[1]) > k) { k = Number(m[1]); best = el.getAttribute("data-graph-documents-row"); }
    }
    return { id: best, parts: k };
  });
  const row = page.locator(`[data-graph-documents-row="${most.id}"]`);
  await row.locator("[data-row-head]").click();
  await page.waitForTimeout(300);
  const shownParts = await row.locator("[data-graph-part]").count();
  check("an opened row shows 8 parts and N more", shownParts === Math.min(8, most.parts) &&
    (most.parts <= 8 || (await row.locator("[data-graph-documents-parts-more]").textContent())?.includes(`${most.parts - 8} more`)),
    `${shownParts} of ${most.parts}`);
  if (most.parts > 8) {
    await row.locator("[data-graph-documents-parts-more]").click();
    check("N more parts lists them all", (await row.locator("[data-graph-part]").count()) === most.parts);
  }
  await row.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOT}/VIEW4-04-after-open-row.png` });
  // Keyboard: the arrows walk the row and on to the next title; Tab goes row to row.
  await row.locator("[data-row-head]").focus();
  await page.keyboard.press("ArrowDown");
  const second = await active(page);
  check("↓ goes into the row (Show this document's card)", second === "graph-documents-card", second);
  await row.locator("[data-row-head]").focus();
  await page.keyboard.press("Tab");
  const nextId = await page.evaluate(() => document.activeElement?.closest("[data-graph-documents-row]")?.getAttribute("data-graph-documents-row"));
  const ids = await rows.evaluateAll((els) => els.map((el) => el.getAttribute("data-graph-documents-row")));
  check("Tab from a row's title goes to the next row's title", nextId === ids[ids.indexOf(most.id) + 1] &&
    (await page.evaluate(() => document.activeElement?.hasAttribute("data-row-head"))));
  // The filter.
  await list(page).locator("[data-graph-documents-filter]").fill("zarathustra");
  await page.waitForTimeout(300);
  const filtered = await rows.count();
  check("the filter narrows the rows", filtered > 0 && filtered < n, `${filtered}`);
  // [chrome6] VIEW6-04: rows stay one line; the graph's order comes back (no reorder for a small list).
  check("≤ 20 matches: one line still, in the graph's order", filtered > 20 || ((await list(page).getAttribute("data-compact")) !== null && (await list(page).getAttribute("data-mine-first")) === null));
  check("the filter count is a live region", (await list(page).locator("[data-graph-documents-found][role=status]").count()) === 1);
  await page.screenshot({ path: `${SHOT}/VIEW4-04-after-filter.png` });
  await list(page).locator("[data-graph-documents-filter]").fill("");
  await ctx.close();
}

// ── WALK4-11: 41 documents on a phone, zh ──────────────────────────────────
if (want("phone")) {
  const { ctx, page } = await newPage(390, 844, "zh", true);
  await openGraph(page, FORTY);
  await openList(page);
  const scroll = await list(page).evaluate((el) => el.scrollHeight);
  const view = await list(page).evaluate((el) => el.clientHeight);
  check("40 documents on a phone: under 5 screens of the sheet (round 3: 18)", scroll / view < 5, `${scroll}px / ${view}px = ${(scroll / view).toFixed(1)}`);
  check("zh filter placeholder", (await list(page).locator("[data-graph-documents-filter]").getAttribute("placeholder")) === "按标题、要旨或部分筛选");
  await page.screenshot({ path: `${SHOT}/WALK4-11-after.png` });
  await list(page).locator("[data-graph-documents-filter]").fill("永恒");
  await page.waitForTimeout(400);
  check("a zh filter finds rows", (await page.locator("[data-graph-documents-row]").count()) >= 1);
  await page.screenshot({ path: `${SHOT}/WALK4-11-after-filter.png` });
  await list(page).evaluate((el) => (el.scrollTop = el.scrollHeight));
  await list(page).locator("[data-graph-documents-filter]").fill("");
  await page.waitForTimeout(300);
  await list(page).evaluate((el) => (el.scrollTop = el.scrollHeight));
  await page.waitForTimeout(300);
  const lastRow = await page.locator("[data-graph-documents-row]").last().boundingBox();
  const pill = await page.locator("[data-stitch-slot] button").first().boundingBox();
  check("the last row ends above the Stitch pill", !pill || !lastRow || lastRow.y + lastRow.height <= pill.y + 1,
    `row ends ${lastRow && Math.round(lastRow.y + lastRow.height)}, pill at ${pill && Math.round(pill.y)}`);
  await ctx.close();
}

// ── VIEW4-07: generated documents ──────────────────────────────────────────
if (want("generated")) {
  for (const lang of ["en", "zh"]) {
    const { ctx, page } = await newPage(1440, 900, lang);
    await openGraph(page, LINDA);
    await openList(page);
    // [chrome6] VIEW6-03: generated documents are not drawn with the switch off; the Generated content pill counts them.
    const generatedNodes = Number(await page.locator('[data-track="graph-generated"] span').last().textContent());
    check(`${lang}: switch off, no generated document drawn`, generatedNodes > 0 && (await page.locator(".react-flow__node.graph-generated").count()) === 0, `${generatedNodes} counted`);
    const hidden = list(page).locator("[data-graph-documents-generated-hidden]");
    check(`${lang}: switch off, a line says the generated documents are not listed`,
      (await hidden.count()) === 1 && (await hidden.textContent()).includes(String(generatedNodes)), await hidden.textContent());
    await list(page).evaluate((el) => (el.scrollTop = el.scrollHeight));
    await page.screenshot({ path: `${SHOT}/VIEW4-07-after-off-${lang}.png` });
    await hidden.locator("button").click();
    await page.waitForTimeout(1500);
    const marks = await list(page).locator("[data-graph-documents-generated]").count();
    const rows = await page.locator("[data-graph-documents-row]").evaluateAll((els) => els.map((el) => Boolean(el.querySelector("[data-graph-documents-generated]"))));
    const firstGen = rows.indexOf(true);
    check(`${lang}: switch on, every generated document has a row, marked, last`,
      marks === generatedNodes && firstGen >= 0 && rows.slice(firstGen).every(Boolean), `${marks} marked of ${generatedNodes}`);
    await list(page).evaluate((el) => (el.scrollTop = el.scrollHeight));
    await page.screenshot({ path: `${SHOT}/VIEW4-07-after-on-${lang}.png` });
    await ctx.close();
  }
}

// ── WALK4-07 / WALK4-09: Escape and focus; Find announced ──────────────────
if (want("esc")) {
  const { ctx, page } = await newPage(1440, 900, "en");
  await openGraph(page, LINDA);
  check("WALK4-19: Feedback hides while the graph is open", !(await page.locator("[data-feedback-button]").isVisible().catch(() => false)));
  // Stitch box.
  const box = page.locator("[data-stitch-slot] textarea");
  await box.click();
  await box.fill("words kept");
  await page.keyboard.press("Escape");
  check("Esc in the Stitch box: focus on its title, words kept", (await active(page)) === "data-stitch-title" && (await box.inputValue()) === "words kept", await active(page));
  await box.fill("");
  // Find.
  const find = page.locator('[data-track="graph-find"]');
  await find.click();
  await find.fill("will");
  await page.locator("[data-graph-find-summary]").waitFor({ timeout: 10000 });
  await page.waitForTimeout(1500);
  check("Find's summary is a live region", (await page.locator("[data-graph-find-summary]").getAttribute("role")) === "status", await page.locator("[data-graph-find-summary]").textContent());
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  check("Esc in Find with words: cleared, focus stays in Find", (await find.inputValue()) === "" && (await active(page)) === "graph-find");
  await page.keyboard.press("Escape");
  check("Esc in an empty Find: focus on the graph's title", (await active(page)) === "data-graph-title", await active(page));
  // A link from the Documents list: one Esc back to the list, the next closes it.
  await openList(page);
  await openRowWithLink(page);
  const linkRow = list(page).locator("[data-graph-documents-link]").first();
  const linkId = await linkRow.getAttribute("data-graph-documents-link");
  await linkRow.click();
  await page.locator("[data-graph-link-panel]").waitFor();
  await page.waitForTimeout(400);
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => document.activeElement?.hasAttribute("data-graph-documents-link"), null, { timeout: 3000 }).catch(() => {});
  // Focus reaches the row at once; the link panel fades out and leaves about 120 ms later (its exit animation).
  await page.locator("[data-graph-link-panel]").waitFor({ state: "detached", timeout: 3000 }).catch(() => {});
  check("first Esc on a link from Documents: back to the list, on its row",
    (await list(page).count()) === 1 && (await page.locator("[data-graph-link-panel]").count()) === 0 && (await active(page)).includes("graph-documents-link"),
    await active(page));
  void linkId;
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  check("next Esc closes the list, the graph stays", (await list(page).count()) === 0 && (await page.locator(".graph-overlay").count()) === 1);
  // Note on this link: Esc folds it, focus on its button, words kept.
  await page.goto("about:blank");
  await openGraph(page, LINDA);
  await openList(page);
  await openRowWithLink(page);
  await list(page).locator("[data-graph-documents-link]").first().click();
  await page.locator("[data-graph-link-panel]").waitFor();
  const noteBtn = page.locator('[data-track="graph-link-note"]');
  if (await noteBtn.count()) {
    await noteBtn.click();
    const ta = page.locator("[data-graph-link-note-composer] textarea");
    await ta.fill("a draft to keep");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    check("Esc in Note on this link: folded, focus on its button, the panel stays",
      (await active(page)) === "graph-link-note" && (await page.locator("[data-graph-link-panel]").count()) === 1, await active(page));
    await page.locator('[data-track="graph-link-note"]').click();
    check("the words are still there on reopen", (await page.locator("[data-graph-link-note-composer] textarea").inputValue()) === "a draft to keep");
    await page.locator('[data-track="graph-link-note-cancel"]').click();
  } else check("Note on this link shown (canEdit)", false);
  await ctx.close();
}

// ── WALK4-08 / WALK4-02: the Stitch box ────────────────────────────────────
if (want("box")) {
  const { ctx, page, calls } = await newPage(1440, 900, "en");
  await openGraph(page, LINDA);
  const box = page.locator("[data-stitch-slot] textarea");
  const n0 = calls.filter((c) => c.includes("/stitch") && !c.includes("warm")).length;
  await page.locator('[data-track="stitch-suggest:contradict"]').click();
  await page.waitForTimeout(800);
  const v = await box.inputValue();
  const sel = await box.evaluate((el) => el.selectionStart);
  check("WALK4-02: the contradictions chip fills the box, caret at the end, nothing runs",
    v.length > 10 && sel === v.length && calls.filter((c) => c.includes("/stitch") && !c.includes("warm")).length === n0, JSON.stringify(v));
  await page.screenshot({ path: `${SHOT}/WALK4-02-after.png` });
  await box.fill("draft A");
  await page.locator('[data-track="graph-close"]').click();
  await page.waitForTimeout(800);
  await page.keyboard.press("m");
  await page.locator(".react-flow__node").first().waitFor();
  await page.waitForTimeout(800);
  await page.locator('[data-track="graph-skip-stitch"]').focus();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(500);
  const caret = await box.evaluate((el) => [el.selectionStart, el.value.length, document.activeElement === el]);
  check("WALK4-08: Skip to Stitch puts the caret after the kept words", caret[2] && caret[0] === caret[1] && caret[1] === 7, JSON.stringify(caret));
  await page.keyboard.type(" more");
  check("typed words follow the kept ones", (await box.inputValue()) === "draft A more");
  await box.fill("");
  await ctx.close();
}

// ── WALK4-12: the header pills ─────────────────────────────────────────────
if (want("header")) {
  for (const [w, lang, touch] of [[1440, "en", false], [1280, "en", false], [1000, "en", false], [820, "zh", true], [390, "zh", true]]) {
    const { ctx, page } = await newPage(w, 900, lang, touch);
    await openGraph(page, LINDA);
    const rec = page.locator('[data-track="graph-recommended-links"]');
    const gen = page.locator('[data-track="graph-generated"]');
    const visibleText = (loc) => loc.evaluate((el) => [...el.querySelectorAll("span")].filter((x) => !x.matches(".sr-only") && getComputedStyle(x).display !== "none" && x.getClientRects().length && x.getBoundingClientRect().width > 2 && !(getComputedStyle(x).clip || "").startsWith("rect(0")).map((x) => x.textContent).join(" ").replace(/\s+/g, " ").trim());
    const named = (loc) => loc.evaluate((el) => el.textContent.replace(/\s+/g, " ").trim());
    const r = await visibleText(rec), g = await visibleText(gen);
    const words = lang === "en" ? (w >= 1400 ? ["Recommended links", "Generated content"] : ["Recommended", "Generated"]) : w >= 1400 ? ["推荐链接", "生成内容"] : ["推荐", "生成"];
    // [chrome6] VIEW6-08: below 768px a pill is its mark and its count; its name stays for a screen reader.
    if (w >= 768) check(`${w} ${lang}: every pill shows a name`, r.includes(words[0]) && g.includes(words[1]), `${r} | ${g}`);
    else check(`${w} ${lang}: a pill is its mark and count, its name read aloud`, !/[A-Za-z\u4e00-\u9fff]/.test(r + g) && (await named(rec)).includes(lang === "en" ? "Recommended links" : "推荐链接") && (await named(gen)).includes(lang === "en" ? "Generated content" : "生成内容"), `${r} | ${g}`);
    // [chrome6] VIEW6-02: Scan for links heads the Recommended links list, not the header.
    check(`${w} ${lang}: no Scan for links in the header`, (await page.locator('.graph-overlay > div [data-track="graph-recommend-links"]').count()) === 0);
    // [chrome6] WALK6-07: every pill in view, no sideways scroll of the pill row.
    const pillsIn = await page.evaluate(() => [...document.querySelectorAll('.graph-pill-row > *')].every((el) => el.getBoundingClientRect().right <= window.innerWidth + 0.5));
    check(`${w} ${lang}: every pill in view`, pillsIn);
    const fits = await page.evaluate(() => {
      const close = document.querySelector('[data-track="graph-close"]').getBoundingClientRect();
      return close.right <= window.innerWidth && document.documentElement.scrollWidth <= window.innerWidth;
    });
    check(`${w} ${lang}: ✕ in view, no page scroll`, fits);
    await page.locator(".graph-overlay > div").first().screenshot({ path: `${SHOT}/WALK4-12-${w}-${lang}-after.png` });
    await ctx.close();
  }
}

// ── WALK4-16 / WALK4-17: the phone link panel ──────────────────────────────
if (want("touch")) {
  const { ctx, page } = await newPage(390, 844, "en", true);
  await page.goto(`${B}/n/${LINDA}?graph=1`, { waitUntil: "load", timeout: 300000 });
  await page.locator(".react-flow__node").first().waitFor({ timeout: 90000 });
  await openList(page);
  const row = list(page).locator(`[data-graph-documents-link="${REPLY_LINK}"]`);
  if (!(await row.count())) await list(page).locator(`[data-graph-documents-links-more]`).first().click().catch(() => {});
  // Open the replies' link through the Links list (the row may sit in a folded row).
  await page.locator('[data-track="graph-documents-close"]').click();
  await page.locator('[data-track="graph-links"]').click();
  await page.locator(`[data-graph-links-row="${REPLY_LINK}"]`).click();
  await page.locator("[data-graph-link-panel]").waitFor();
  await page.waitForTimeout(800);
  const boxes = await page.locator('[data-track="reply-resolve"], [data-track="reply-delete"]').evaluateAll((els) => els.map((el) => { const b = el.getBoundingClientRect(); return [el.getAttribute("data-track"), Math.round(b.x), Math.round(b.width), Math.round(b.height)]; }));
  const small = boxes.filter((b) => b[2] < 40 || b[3] < 40);
  check("WALK4-16: Resolve and Delete are at least 40px under a finger", boxes.length > 0 && small.length === 0, JSON.stringify(boxes.slice(0, 4)));
  const firstPair = boxes.slice(0, 2);
  if (firstPair.length === 2) check("…and at least 8px apart", firstPair[1][1] - (firstPair[0][1] + firstPair[0][2]) >= 8, JSON.stringify(firstPair));
  await page.locator('[data-track="reply-resolve"]').first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOT}/WALK4-16-after.png` });
  const noteBtn = page.locator('[data-track="graph-link-note"]');
  await noteBtn.scrollIntoViewIfNeeded();
  await noteBtn.click();
  await page.waitForTimeout(600);
  const save = await page.locator('[data-track="graph-link-note-save"]').boundingBox();
  const panel = await page.locator("[data-graph-link-panel]").boundingBox();
  check("WALK4-17: Save is in view when the composer opens", save && panel && save.y + save.height <= panel.y + panel.height && save.y >= panel.y, JSON.stringify({ save, panel }));
  await page.screenshot({ path: `${SHOT}/WALK4-17-after.png` });
  await page.locator('[data-track="graph-link-note-cancel"]').click();
  await ctx.close();
}

// ── WALK4-06: Show on graph from the notes full page ───────────────────────
if (want("notes")) {
  const { ctx, page } = await newPage(1440, 900, "en");
  await page.goto(`${B}/n/${LINDA}/notes`, { waitUntil: "load", timeout: 300000 });
  await page.waitForTimeout(3000);
  const card = page.locator(`[data-note-id="${NOTE}"]`).first();
  await card.scrollIntoViewIfNeeded().catch(() => {});
  await card.hover().catch(() => {});
  let show = card.locator('[data-track="note-show-on-graph"]');
  if ((await show.count()) === 0) {
    await card.click().catch(() => {}); // a collapsed card opens first
    await page.waitForTimeout(600);
    show = card.locator('[data-track="note-show-on-graph"]');
  }
  if (!(await show.count())) {
    check("a note with Show on graph on the notes full page", false);
  } else {
    await page.screenshot({ path: `${SHOT}/WALK4-06-after-notes.png` });
    await show.click({ force: true });
    await page.locator(".react-flow__node").first().waitFor({ timeout: 90000 });
    await page.waitForTimeout(1000);
    check("the graph opened from the notes full page, without graphFrom left in the URL", !page.url().includes("graphFrom"), page.url());
    await page.locator('[data-track="graph-close"]').click();
    await page.waitForURL(/\/notes/, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(800);
    check("closing the graph returns to the notes full page", new URL(page.url()).pathname.endsWith("/notes"), page.url());
  }
  await ctx.close();
}

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
console.log(`\n${passes} pass, ${failures} fail${failures ? "" : ", ALL PASS"}`);
await browser.close();
process.exit(failures ? 1 : 0);
