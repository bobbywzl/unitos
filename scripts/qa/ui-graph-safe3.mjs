// SAFE3 checks (round 3): a link's removal keeps every reply (REV3-02), its
// confirm asks first, Dismiss shows only to the maker of a link shared
// across accounts (REV3-03), each recommended card decides on its own
// (REV3-12), reply drafts belong to their account (REV3-04), and Show on a
// note with no source keeps the graph behind Back (WALK3-05).
//
//   BASE=http://localhost:3161 DB=dissect_r3safe3 OUT=<dir> MODE=after LANG_UI=en WIDTH=1440 \
//     node scripts/qa/ui-graph-safe3.mjs
// Runs against a COPY of the database seeded with
// .qa-tmp/stitch/r3/rev/seed.sql, seed2.sql and the SAFE3 seed3.sql (sign-in
// on). It removes links: restore the copy before a second run. MODE=before
// only takes the screenshots that write nothing.

import { chromium } from "playwright-core";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3161";
const DB = process.env.DB ?? "dissect_r3safe3";
const OUT = process.env.OUT ?? ".qa-tmp/stitch/r3/safe3";
const MODE = process.env.MODE ?? "after";
const LANG = process.env.LANG_UI ?? "en";
const WIDTH = Number(process.env.WIDTH ?? 1440);
const ONLY = process.env.ONLY ?? "";
const after = MODE === "after";
const NB = "rev3-p";
fs.mkdirSync(OUT, { recursive: true });

const sql = (q) =>
  execFileSync("psql", ["-h", "localhost", "-U", "postgres", DB, "-tAc", q], {
    env: { ...process.env, PGPASSWORD: "postgres" },
  })
    .toString()
    .trim();

let failures = 0;
const check = (ok, what, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${what}${detail ? ` — ${detail}` : ""}`);
};
const waitSql = async (q, want, ms = 90000) => {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 500))) if (sql(q) === want) return;
};
const suffix = `${LANG === "en" ? "" : `-${LANG}`}${WIDTH === 1440 ? "" : `-${WIDTH}`}`;
const shot = (page, id) => page.screenshot({ path: `${OUT}/${id}-${MODE}${suffix}.png` });

const exe = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: fs.existsSync(exe) ? exe : undefined });
const ctx = await browser.newContext({ viewport: { width: WIDTH, height: WIDTH < 600 ? 844 : 900 } });
async function signIn(session) {
  await ctx.clearCookies();
  await ctx.addCookies([
    { name: "dissect-lang", value: LANG, url: BASE },
    { name: "dissect-session", value: session, url: BASE },
  ]);
}
const page = await ctx.newPage();
page.setDefaultNavigationTimeout(180000);
page.setDefaultTimeout(60000);
page.on("pageerror", (e) => console.log("pageerror", e.message));
if (process.env.DEBUG) page.on("request", (r) => r.url().includes("/api/links") && console.log("req", r.method(), r.url()));
if (process.env.DEBUG) page.on("response", (r) => r.url().includes("/api/links") && console.log("res", r.status(), r.url()));
const dialogs = [];
let answer = true;
page.on("dialog", (d) => {
  dialogs.push(d.message());
  void (answer ? d.accept() : d.dismiss());
});

const overlay = () => page.locator(".graph-overlay-in");
async function openGraph() {
  await page.goto(`${BASE}/n/${NB}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  for (let i = 0; i < 5 && (await overlay().count()) === 0; i++) {
    await page.click('[data-track="graph"]', { timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(1500);
  }
  // The graph's data loads after the open; a dev server may compile the route first.
  await page.locator(".react-flow__node").first().waitFor({ timeout: 180000 }).catch(() => {});
  await page.waitForTimeout(1200);
}
async function openRecommended() {
  // Back keeps the open side list per tab (graph-keep.ts): open it only when shut.
  if ((await page.locator("[data-graph-recommended]").count()) > 0) return;
  await page.click('[data-track="graph-recommended-links"]');
  await page.waitForTimeout(800);
}
async function openAnnotations() {
  for (let i = 0; i < 6 && (await page.locator('[data-track="link-remove"]').count()) === 0; i++) {
    await page.click('[data-track="annotations"]').catch(() => {});
    await page.waitForTimeout(1500);
  }
}
const card = (id) => page.locator(`[data-graph-recommended="${id}"]`);

// ── REV3-03: C (editor of A's P) sees Accept, no Dismiss, on A's cross-account link
if (!ONLY || ONLY === "03") {
  await signIn("rev3-sc");
  await openGraph();
  await openRecommended();
  const l3 = card("rev3-l3");
  check((await l3.locator('[data-track="link-accept"]').count()) === 1, "REV3-03 C sees Accept on l3");
  check((await l3.locator('[data-track="link-dismiss"]').count()) === (after ? 0 : 1), `REV3-03 C ${after ? "sees no" : "sees"} Dismiss on l3`);
  check((await card("s3-l4").locator('[data-track="link-dismiss"]').count()) === 1, "REV3-03 C sees Dismiss on a link of P (s3-l4)");
  await shot(page, "REV3-03");
}

// ── REV3-12: two Accepts in a row, the first held in flight
if ((!ONLY || ONLY === "12") && after) {
  await signIn("rev3-sa");
  await openGraph();
  await openRecommended();
  await page.route("**/api/links/s3-l4*", async (route) => {
    await new Promise((r) => setTimeout(r, 2500));
    await route.continue();
  });
  await card("s3-l4").locator('[data-track="link-accept"]').click();
  await page.waitForTimeout(300);
  const next = card("s3-l5").locator('[data-track="link-accept"]');
  check(!(await next.isDisabled()), "REV3-12 the next card's Accept works while one is in flight");
  await shot(page, "REV3-12");
  await next.click();
  await waitSql(`SELECT count(*) FROM "DocLink" WHERE id IN ('s3-l4','s3-l5') AND NOT recommended`, "2");
  check(sql(`SELECT string_agg(id || ':' || recommended, ',' ORDER BY id) FROM "DocLink" WHERE id IN ('s3-l4','s3-l5')`) === "s3-l4:false,s3-l5:false", "REV3-12 both accepted");
  await page.unroute("**/api/links/s3-l4*");
}

// ── REV3-02: Remove on a link with replies asks first, keeps every reply row,
// and the link stays in B's project X
if ((!ONLY || ONLY === "02") && after) {
  await signIn("rev3-sa");
  await page.goto(`${BASE}/n/${NB}?doc=rev3-d1`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await openAnnotations();
  const removeButtons = page.locator('[data-track="link-remove"]');
  check((await removeButtons.count()) >= 1, "REV3-02 Remove shows in the Annotations tab");
  // l2 (B's and C's replies): Cancel first, then OK.
  const l2Card = page.locator("div", { has: page.locator("text=B: my reply, written in my project X") }).filter({ has: page.locator('[data-track="link-remove"]') }).last();
  await l2Card.scrollIntoViewIfNeeded().catch(() => {});
  await shot(page, "REV3-02-tab");
  answer = false;
  await l2Card.locator('[data-track="link-remove"]').click();
  await page.waitForTimeout(800);
  check(dialogs.at(-1)?.includes("2") ?? false, "REV3-02 Remove asks first", JSON.stringify(dialogs.at(-1)));
  check(sql(`SELECT count(*) FROM "DocLinkHidden" WHERE "docLinkId"='rev3-l2'`) === "0", "REV3-02 Cancel removes nothing");
  answer = true;
  await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/links/rev3-l2") && r.request().method() === "DELETE"),
    l2Card.locator('[data-track="link-remove"]').click(),
  ]);
  await page.locator("text=B: my reply, written in my project X").first().waitFor({ state: "detached", timeout: 60000 }).catch(() => {});
  check(sql(`SELECT count(*) FROM "DocLink" WHERE id='rev3-l2'`) === "1", "REV3-02 the link row stays");
  check(sql(`SELECT count(*) FROM "Reply" WHERE "docLinkId"='rev3-l2'`) === "2", "REV3-02 B's and C's replies stay");
  check(
    sql(`SELECT string_agg("notebookId", ',' ORDER BY "notebookId") FROM "DocLinkHidden" WHERE "docLinkId"='rev3-l2'`) === "rev3-p,rev3-q",
    "REV3-02 hidden in A's P and Q only",
  );
  check((await page.locator("text=B: my reply, written in my project X").count()) === 0, "REV3-02 the link left A's Annotations tab");
  await shot(page, "REV3-02-removed");
  await signIn("rev3-sb");
  await page.goto(`${BASE}/n/rev3-x?doc=rev3-d1`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await openAnnotations();
  check((await page.locator("text=B: my reply, written in my project X").count()) >= 1, "REV3-02 B still sees the link and its reply in X");
  await shot(page, "REV3-02-B-keeps");
}

// ── REV3-04: a reply draft belongs to its account
if ((!ONLY || ONLY === "04") && after) {
  const DRAFT = `A's unsent reply ${Date.now()}`;
  await signIn("rev3-sa");
  await page.goto(`${BASE}/n/${NB}?doc=rev3-d1`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await openAnnotations();
  const reply = page.locator('[data-track="reply"]').first();
  await reply.click();
  const box = page.locator("textarea").last();
  await box.fill(DRAFT);
  await page.waitForTimeout(300);
  const keys = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("unitos-reply-draft:")));
  check(keys.some((k) => k.startsWith("unitos-reply-draft:rev3-ua:")), "REV3-04 the draft key names A", keys.join(" "));
  // C on the same browser.
  await signIn("rev3-sc");
  await page.goto(`${BASE}/n/${NB}?doc=rev3-d1`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await openAnnotations();
  check((await page.locator(`textarea`).evaluateAll((els, d) => els.some((e) => e.value === d), DRAFT)) === false, "REV3-04 C never sees A's draft");
  await shot(page, "REV3-04-C");
  // A legacy draft (no account in the key) goes to A on Sign out.
  await page.waitForLoadState("load");
  await page.waitForTimeout(3000);
  await page.evaluate(() =>
    localStorage.setItem("unitos-reply-draft:link:legacy-x", JSON.stringify({ content: "old words", savedAt: Date.now() })),
  );
  await signIn("rev3-sa");
  await page.goto(`${BASE}/settings`, { waitUntil: "networkidle" });
  await page.click("a[href='/api/auth/logout']");
  await page.waitForTimeout(2000);
  const moved = await page.evaluate(() => ({
    legacy: localStorage.getItem("unitos-reply-draft:link:legacy-x"),
    a: localStorage.getItem("unitos-reply-draft:rev3-ua:link:legacy-x"),
    mine: Object.keys(localStorage).filter((k) => k.startsWith("unitos-reply-draft:rev3-ua:")).length,
  }));
  check(moved.legacy === null && moved.a !== null, "REV3-04 Sign out moves a legacy draft to A", JSON.stringify(moved));
  check(moved.mine >= 2, "REV3-04 Sign out keeps A's drafts", JSON.stringify(moved));
  sql(`INSERT INTO "Session"(token,"userId","expiresAt") VALUES ('rev3-sa','rev3-ua',now()+interval '30 days') ON CONFLICT DO NOTHING`);
  // A again: the draft opens.
  await signIn("rev3-sa");
  await page.goto(`${BASE}/n/${NB}?doc=rev3-d1`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await openAnnotations();
  check(await page.locator(`textarea`).evaluateAll((els, d) => els.some((e) => e.value === d), DRAFT), "REV3-04 A's draft opens again for A");
  await shot(page, "REV3-04-A");
}

// ── WALK3-05: Show on a note with no source, then Back opens the graph again
if (!ONLY || ONLY === "05") {
  await signIn("rev3-sa");
  await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" }).catch(() => {});
  await openGraph();
  await page.click('[data-track="graph-notes"]');
  await page.waitForTimeout(800);
  const row = page.locator('[data-graph-notes-row="s3-note"]');
  await row.locator('[data-track="graph-notes-open"]').click();
  await page.waitForURL((u) => !u.searchParams.has("graph"), { timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const u1 = page.url();
  check((await overlay().count()) === 0, "WALK3-05 Show closes the graph", u1);
  await shot(page, "WALK3-05-show");
  await page.goBack();
  await page.waitForTimeout(2000);
  const u2 = page.url();
  check(u2.includes(`/n/${NB}`) && u2.includes("graph=1"), `WALK3-05 Back ${after ? "opens the graph again" : "leaves the project"}`, u2);
  await shot(page, "WALK3-05-back");
}

await browser.close();
console.log(failures ? `${failures} FAILED` : "all passed");
process.exitCode = failures ? 1 : 0;
