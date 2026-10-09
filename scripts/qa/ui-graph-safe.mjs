// SAFE package checks on the graph of "QA Graph Notes" (users never lose
// data or typed words): a reply draft on a link survives ✕, Back, and a
// reload (REV2-06 / WALK2-08); Resolve answers at once (WALK2-12); a link of
// another account's project hides what this account may not change
// (REV2-01); the Notes list shows errors, has Undo for Reject (REV2-08), and
// lists the notes on the project (WALK2-01); Note on this link offline says
// it waits in the queue, and Show comes once it lands (REV2-07); Stitch
// Retry keeps a command typed after the failure (REV2-04); Save as note →
// Show opens the Notes list on the note (VIEW5-10), Open in notes closes the
// graph and its graph=1 entry, and the saved line stays (WALK2-10, WALK5-05).
//
//   BASE=http://localhost:3141 SESSION=rev-owner DB=dissect_r2safe OUT=<dir> MODE=after \
//     node scripts/qa/ui-graph-safe.mjs
// MODE=before (BASE=http://localhost:3111, no SESSION) only takes the
// screenshots that write nothing. MODE=after writes replies and notes: run it
// against a COPY of the database seeded with .qa-tmp/stitch/r2/safe/seed-safe.sql.

import { chromium } from "playwright-core";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3141";
const DB = process.env.DB ?? "dissect_r2safe";
const OUT = process.env.OUT ?? ".qa-tmp/stitch/r2/safe";
const MODE = process.env.MODE ?? "after";
const SESSION = process.env.SESSION ?? "";
const LANG = process.env.LANG_UI ?? "en";
const NB = "cmuxeddll000n7d4emxkf26sh";
const A = "cmuxeddkp00007d4e8tomrjpj"; // Heat pumps in cold climates
const B = "cmuxeddl000057d4ev1lxdhbe"; // Grid load and electrified heating
const LINK_AB = "cmuxeddmd001e7d4edhm52kxu";
const LINK_X = "safe-x-link";
const after = MODE === "after";
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
const waitSql = async (q, want, ms = 30000) => {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 500))) if (sql(q) === want) return;
};
const shot = (page, id) => page.screenshot({ path: `${OUT}/${id}-${MODE}${LANG === "en" ? "" : `-${LANG}`}.png` });

const exe = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: fs.existsSync(exe) ? exe : undefined });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const cookies = [{ name: "dissect-lang", value: LANG, url: BASE }];
if (SESSION) cookies.push({ name: "dissect-session", value: SESSION, url: BASE });
await ctx.addCookies(cookies);
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("pageerror", e.message));

async function edgePoint(id, at = 0.5) {
  return page.evaluate(
    ([id, at]) => {
      const g = document.querySelector(`[data-testid="rf__edge-${id}"]`);
      if (!g) return null;
      const p = g.querySelector("path.react-flow__edge-interaction") || g.querySelector("path");
      const L = p.getTotalLength();
      const pt = p.getPointAtLength(L * at);
      const m = p.getScreenCTM();
      return { x: pt.x * m.a + pt.y * m.c + m.e, y: pt.x * m.b + pt.y * m.d + m.f };
    },
    [id, at],
  );
}
const overlay = () => page.locator(".graph-overlay-in");
async function openGraph({ load = true } = {}) {
  if (load) {
    await page.goto(`${BASE}/n/${NB}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1200);
  }
  // A reload with graph=1 opens the graph by itself after hydration.
  await overlay().waitFor({ timeout: 2500 }).catch(() => {});
  for (let i = 0; i < 5 && (await overlay().count()) === 0; i++) {
    await page.click('[data-track="graph"]', { timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(1500);
  }
  // The graph's data loads after the open (GET .../graph): wait for the canvas.
  await page.locator(".react-flow__edge").first().waitFor({ timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(1200);
}
async function pinAB() {
  await page.mouse.move(4, 300);
  await page.waitForTimeout(300);
  const id = [A, B].sort().join("|");
  const pt = await edgePoint(id, 0.35);
  if (!pt) return false;
  await page.mouse.click(pt.x, pt.y);
  await page.waitForTimeout(600);
  return true;
}
const list = () => page.locator('[data-track-surface="graph-links"]');
// A link opens in the side panel beside the canvas (GRAPH2, WALK2-05), not in
// place in the curve's list.
const panel = (id) => page.locator(`[data-graph-link-panel="${id}"]`);
const thread = (id) => panel(id).locator(`[data-graph-link-thread="${id}"]`);
// [panel6] WALK6-05: Reply sits in the panel's action row, above the thread.
const replyButton = (id) => panel(id).locator('[data-graph-link-actions] [data-track="reply"], [data-graph-link-thread] [data-track="reply"]');
/** Open one link of the pinned list in the side panel. */
async function expand(id) {
  const rows = list().locator('[data-track="graph-link-expand"]');
  const n = await rows.count();
  for (let i = 0; i < n; i++) {
    if (await thread(id).count()) return true;
    // [lists7] WALK7-05: a row that opens the panel closes the curve's list; pin the curve again for the next row.
    if ((await rows.count()) === 0) await pinAB();
    await rows.nth(i).click();
    await page.waitForTimeout(500);
  }
  return (await thread(id).count()) > 0;
}
async function openLink(id) {
  check(await pinAB(), `pinned Heat pumps ⇄ Grid load`);
  check(await expand(id), `expanded link ${id}`);
}
const replyBox = (id) => thread(id).locator("textarea");

// ── REV2-06 / WALK2-08: the reply draft survives ✕, Back, and a reload ──
const DRAFT = `SAFE draft reply ${Date.now()}`;
await openGraph();
await openLink(LINK_AB);
await replyButton(LINK_AB).first().click();
await replyBox(LINK_AB).fill(DRAFT);
await shot(page, "REV2-06-typed");
await page.click('[data-track="graph-close"]');
await page.waitForTimeout(800);
await openGraph({ load: false });
await openLink(LINK_AB);
const afterClose = await replyBox(LINK_AB).inputValue().catch(() => "");
check(afterClose === DRAFT || !after, `reply draft after ✕`, JSON.stringify(afterClose));
await shot(page, "REV2-06-after-close");
if (after) {
  // Back: the graph closes (its graph=1 entry pops), then opens again.
  await page.goBack();
  await page.waitForTimeout(900);
  check((await overlay().count()) === 0, "Back closed the graph");
  await openGraph({ load: false });
  await openLink(LINK_AB);
  check((await replyBox(LINK_AB).inputValue().catch(() => "")) === DRAFT, "reply draft after Back");
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await openGraph({ load: false });
  await openLink(LINK_AB);
  check((await replyBox(LINK_AB).inputValue().catch(() => "")) === DRAFT, "reply draft after a reload");
  await shot(page, "REV2-06-after-reload");
  // Send: the server has it, the draft goes.
  await thread(LINK_AB).locator('[data-track="reply-send"]').click();
  await thread(LINK_AB).filter({ hasText: DRAFT }).locator("p", { hasText: DRAFT }).waitFor({ timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(800);
  const kept = await page.evaluate((k) => localStorage.getItem(k), `unitos-reply-draft:link:${LINK_AB}`);
  check(kept === null, "draft cleared once the server has the reply", String(kept));
  // The thread shows the reply at once (done: false) and the POST lands after: wait for the row, up to 15 s.
  for (let i = 0; i < 30 && sql(`select count(*) from "Reply" where "docLinkId"='${LINK_AB}' and content='${DRAFT}'`) !== "1"; i++) await page.waitForTimeout(500);
  check(sql(`select count(*) from "Reply" where "docLinkId"='${LINK_AB}' and content='${DRAFT}'`) === "1", "SQL finds the sent reply");

  // ── WALK2-12: Resolve answers at once ──
  const row = thread(LINK_AB).locator("div.flex.items-start", { hasText: DRAFT });
  await page.route("**/api/replies/**", async (route) => {
    await new Promise((r) => setTimeout(r, 1500)); // a slow server
    await route.continue();
  });
  await row.locator('[data-track="reply-resolve"]').click();
  await page.waitForTimeout(150);
  const label = await thread(LINK_AB).locator("div.flex.items-start", { hasText: DRAFT }).locator('[data-track="reply-resolve"]').textContent().catch(() => "");
  check(/Reopen|重新打开/.test(label ?? "") || (await thread(LINK_AB).locator("p.line-through", { hasText: DRAFT }).count()) > 0 || !(await thread(LINK_AB).locator("p", { hasText: DRAFT }).isVisible().catch(() => false)),
    "Resolve shows at once (150 ms, server 1.5 s)", String(label));
  await shot(page, "WALK2-12-resolve-at-once");
  await page.waitForTimeout(2500);
  await page.unroute("**/api/replies/**");
  check(sql(`select count(*) from "Reply" where content='${DRAFT}' and "resolvedById" is not null`) === "1", "SQL finds the reply resolved");
  // A refused resolve comes back with the error.
  await page.route("**/api/replies/**", (route) => route.fulfill({ status: 500, contentType: "application/json", body: '{"error":"SAFE refused"}' }));
  const resolvedToggle = thread(LINK_AB).locator('[data-track="reply-show-resolved"]');
  if (await resolvedToggle.count()) await resolvedToggle.click();
  const reopen = thread(LINK_AB).locator("div.flex.items-start", { hasText: DRAFT }).locator('[data-track="reply-resolve"]');
  await reopen.click();
  await page.waitForTimeout(800);
  check((await thread(LINK_AB).locator("text=SAFE refused").count()) > 0, "a refused Reopen shows the error");
  check(sql(`select count(*) from "Reply" where content='${DRAFT}' and "resolvedById" is not null`) === "1", "the refused Reopen changed nothing");
  await page.unroute("**/api/replies/**");

  // ── REV2-01: another account's link hides what this account may not change ──
  await page.mouse.click(4, 300);
  await openLink(LINK_X);
  const x = thread(LINK_X);
  const xRow = x.locator("div.flex.items-start", { hasText: "SAFE reply by the other account" });
  const mineRow = x.locator("div.flex.items-start", { hasText: "SAFE reply by the owner of QA Graph Notes" });
  check((await replyButton(LINK_X).count()) === 0, "no Reply on another account's link");
  check((await xRow.locator('[data-track="reply-delete"]').count()) === 0, "no × on the other account's reply");
  check((await xRow.locator('[data-track="reply-resolve"]').count()) === 0, "no Resolve on the other account's reply");
  check((await mineRow.locator('[data-track="reply-resolve"]').count()) === 1, "Resolve on my own reply");
  check((await mineRow.locator('[data-track="reply-delete"]').count()) === 1, "× on my own reply");
  await shot(page, "REV2-01-other-account-link");
  await page.mouse.click(4, 300);
}

// ── WALK2-01 + REV2-08: the Notes list ──
await page.click('[data-track="graph-notes"]');
await page.waitForTimeout(700);
const notes = page.locator('[data-track-surface="graph-notes-list"]');
const projectGroup = notes.locator("[data-graph-notes-project]");
check(!after || (await projectGroup.count()) === 1, "Notes on the project group", await projectGroup.innerText().catch(() => ""));
check(!after || /Project-level question/.test(await projectGroup.innerText().catch(() => "")), "the project-level note is listed");
await shot(page, "WALK2-01-notes-list");
if (after) {
  const r1 = notes.locator('[data-graph-notes-row="safe-pending-1"]');
  const r2 = notes.locator('[data-graph-notes-row="safe-pending-2"]');
  // A refused Reject: the row stays, with the error.
  await page.route("**/api/notes/safe-pending-1", (route) =>
    route.fulfill({ status: 500, contentType: "application/json", body: '{"error":"SAFE reject refused"}' }),
  );
  await r1.locator('[data-track="graph-notes-reject"]').click();
  await page.waitForTimeout(1000);
  check((await r1.count()) === 1 && /SAFE reject refused/.test(await r1.innerText()), "a refused Reject shows its error on the row");
  await shot(page, "REV2-08-reject-error");
  await page.unroute("**/api/notes/safe-pending-1");
  // Reject, then Undo.
  await r2.locator('[data-track="graph-notes-reject"]').click();
  await page.waitForTimeout(150);
  const line = notes.locator('[data-graph-notes-rejected="safe-pending-2"]');
  check((await line.count()) === 1, "Note rejected · Undo shows at once");
  await waitSql(`select status from "Note" where id='safe-pending-2'`, "REJECTED");
  check(sql(`select status from "Note" where id='safe-pending-2'`) === "REJECTED", "SQL: rejected");
  await shot(page, "REV2-08-rejected-undo");
  await line.locator('[data-track="graph-notes-undo-reject"]').click();
  await waitSql(`select status from "Note" where id='safe-pending-2'`, "PENDING");
  await r2.waitFor({ timeout: 20000 }).catch(() => {});
  check(sql(`select status from "Note" where id='safe-pending-2'`) === "PENDING", "SQL: Undo made it pending again");
  check((await r2.count()) === 1, "the note is back in the list");
  await shot(page, "REV2-08-undone");
}
await page.click('[data-track="graph-notes-close"]');
await page.waitForTimeout(400);

// ── REV2-07: Note on this link offline ──
if (after) {
  await page.evaluate(() => localStorage.setItem("unitos-premium", "1"));
  await openLink(LINK_AB);
  const text = `SAFE offline note ${Date.now()}`;
  await page.route("**/api/notes", (route) => (route.request().method() === "POST" ? route.abort("internetdisconnected") : route.continue()));
  // [lists9] WALK9-10: Note on this link fills the new note under the side list.
  await panel(LINK_AB).locator('[data-track="graph-link-note"]').click();
  await page.locator("[data-graph-note-gather-words]").fill(text);
  await page.locator('[data-track="graph-note-gather-save"]').click();
  await page.waitForTimeout(1200);
  const queued = page.locator('[data-graph-note-gather-saved=""]');
  check((await queued.count()) === 1, "offline: the line says the note waits in the queue", await queued.innerText().catch(() => ""));
  check((await page.locator('[data-track="graph-note-gather-show"]').count()) === 0, "offline: no Show yet");
  await shot(page, "REV2-07-queued");
  await page.unroute("**/api/notes");
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  let savedId = null;
  for (let i = 0; i < 120 && !savedId; i++) {
    await page.waitForTimeout(250);
    savedId = (await page.locator("[data-graph-note-gather-saved]").getAttribute("data-graph-note-gather-saved").catch(() => null)) || null;
  }
  check(savedId !== null && sql(`select content from "Note" where id='${savedId}'`) === text, "landed: Show names the synced note", String(savedId));
  await shot(page, "REV2-07-landed");
  await page.mouse.click(4, 300);
}

// ── REV2-04: Retry keeps a command typed after the failure ──
const box = page.locator('[data-track-surface="graph"] textarea, textarea[placeholder]').last();
const stitchBox = page.locator('[data-track="stitch-send"]').locator("xpath=ancestor::form[1]");
const stitchInput = stitchBox.locator("textarea");
await page.route("**/api/notebooks/*/stitch", (route) => route.abort("connectionreset"));
await stitchInput.fill("What do these documents say about heat pumps?");
await page.click('[data-track="stitch-send"]');
await page.locator('[data-track="stitch-retry"]').waitFor({ timeout: 15000 }).catch(() => {});
await stitchInput.fill("A new command I typed after the failure");
await page.click('[data-track="stitch-retry"]');
await page.waitForTimeout(1500);
const kept = await stitchInput.inputValue();
check(kept === "A new command I typed after the failure" || !after, "Retry keeps the new command", JSON.stringify(kept));
await shot(page, "REV2-04-retry");
await page.unroute("**/api/notebooks/*/stitch");
void box;

// ── WALK2-10: Save as note → Show ──
if (after) {
  await stitchInput.fill("What do these documents say about heat pumps?");
  await page.click('[data-track="stitch-send"]');
  const save = page.locator('[data-track="assistant-save-note:stitch"]').last();
  await save.waitFor({ timeout: 90000 }).catch(() => {});
  // [style9] REV8-05: the box keeps the earlier turns, and their saved lines;
  // the counts before Save tell the new line and the new note from theirs.
  const notesCount = `select count(*) from "Note" n join "Section" s on s.id=n."sectionId" where s."notebookId"='${NB}'`;
  const shows = page.locator('[data-track="assistant-saved-note-show"]');
  const showsBefore = await shows.count();
  const beforeSave = Number(sql(notesCount));
  await save.click();
  for (let i = 0; i < 240 && (await shows.count()) <= showsBefore; i++) await page.waitForTimeout(250);
  const show = shows.last();
  await waitSql(notesCount, String(beforeSave + 1));
  const before = sql(notesCount);
  check(before === String(beforeSave + 1), "Save as note made one note", `${beforeSave} → ${before}`);
  await shot(page, "WALK2-10-saved");
  await show.click();
  // VIEW5-10: Show keeps the graph and opens the Notes list on the note.
  const notesList = page.locator('[data-graph-side-list="notes"]');
  await notesList.waitFor({ timeout: 5000 }).catch(() => {});
  check((await overlay().count()) === 1 && (await notesList.count()) === 1, "Show kept the graph and opened the Notes list");
  check(page.url().includes("graph=1"), "the graph's URL stays while it shows the note", page.url());
  await shot(page, "WALK2-10-shown");
  // Open in notes closes the graph; the URL moves with no server round trip
  // (WALK5-05): wait for the URL, not for a fixed time.
  await notesList.locator('[data-track="graph-notes-open"]').first().click();
  await overlay().waitFor({ state: "detached", timeout: 8000 }).catch(() => {});
  const urlLeft = await page.waitForURL((u) => !u.search.includes("graph=1"), { timeout: 5000 }).then(() => true, () => false);
  check((await overlay().count()) === 0, "Open in notes closed the graph");
  check(urlLeft, "Open in notes left no graph=1 in the URL", page.url());
  await shot(page, "WALK2-10-open-in-notes");
  await openGraph({ load: false });
  // [style9] REV8-05: the graph opens on kept turns with the box folded; the
  // saved line is in the turns, so the fold button opens them first.
  if (await page.locator("[data-stitch-folded]").count()) {
    await page.click('[data-track="stitch-collapse"]');
    await page.waitForTimeout(600);
  }
  check((await page.locator('[data-track="assistant-saved-note-show"]').count()) >= 1, "reopened: the saved line stays");
  check((await page.locator('[data-track="assistant-save-note:stitch"]').count()) === 0, "reopened: no second Save as note on that answer");
  check(sql(notesCount) === before, "no duplicate note", `${before} → ${sql(notesCount)}`);
  await shot(page, "WALK2-10-reopened");
}

await browser.close();
console.log(failures === 0 ? "ALL PASS" : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
