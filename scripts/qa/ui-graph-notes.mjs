// The notes and the link replies on the graph (SPEC.md §13): the walk over
// the seed "QA Graph Notes" (.qa-tmp/stitch/gn/seed-gn.mjs). Checks the node
// chips, the curve marks, the reply thread in an expanded link, Notes
// quoting both, the note curve, the node card, the Notes list and its
// section filter, and Note on this link (draft kept over a reload, the note
// saved with both ends as sources). With SESSION=<token> (a dev server with
// sign-in on) it also sends and resolves a reply on a link.
//
//   BASE=http://localhost:3124 DB=dissect_notes OUT=<dir> MODE=after \
//     [SESSION=<token>] node scripts/qa/ui-graph-notes.mjs
// MODE=before only takes the screenshots (against the unchanged code).
// It writes notes and replies: run it against a copy of the database.

import { chromium } from "playwright-core";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3124";
const DB = process.env.DB ?? "dissect_notes";
const OUT = process.env.OUT ?? ".qa-tmp/stitch/notes";
const MODE = process.env.MODE ?? "after";
const SESSION = process.env.SESSION ?? "";
const NB = process.env.NOTEBOOK ?? "cmuxeddll000n7d4emxkf26sh";
const [A, B, C, D, E] = [
  "cmuxeddkp00007d4e8tomrjpj", // Heat pumps in cold climates
  "cmuxeddl000057d4ev1lxdhbe", // Grid load and electrified heating
  "cmuxeddl6000a7d4e6pai7ydu", // Household energy budgets
  "cmuxeddlb000f7d4exkjkddx0", // Contractor workforce survey
  "cmuxeddlg000j7d4e7gtknv18", // State rebate programs
];
const LINK_AB = "cmuxeddmd001e7d4edhm52kxu";
const LINK_AC = "cmuxeddmi001g7d4ekyk9s476";
const pair = (x, y) => [x, y].sort().join("|");
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

const exe = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: fs.existsSync(exe) ? exe : undefined });

async function edgePoint(page, id, at = 0.5) {
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

async function openGraph(page) {
  await page.goto(`${BASE}/n/${NB}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  // A click before hydration does nothing: try again until the graph is up.
  for (let i = 0; i < 4 && (await page.locator(".graph-overlay-in").count()) === 0; i++) {
    await page.click('[data-track="graph"]');
    await page.waitForTimeout(1500);
  }
  await page.waitForTimeout(1500);
}

// The notes the graph should count on a node: accepted notes of the visible
// sections written in the document or quoting it (the seed plus whatever an
// earlier run wrote).
const expectedChip = (documentId) =>
  sql(
    `select count(*) from "Note" n join "Section" s on s.id=n."sectionId" where s."notebookId"='${NB}' and not s.hidden and n.status='ACCEPTED' and (n."documentId"='${documentId}' or exists (select 1 from "Source" so where so."noteId"=n.id and so."documentId"='${documentId}'))`,
  );

async function pin(page, id, at = 0.35) {
  await page.mouse.move(4, 300);
  await page.waitForTimeout(300);
  const pt = await edgePoint(page, id, at);
  if (!pt) return false;
  await page.mouse.click(pt.x, pt.y);
  await page.waitForTimeout(500);
  return true;
}

async function newPage(width, lang) {
  const ctx = await browser.newContext({ viewport: { width, height: width > 500 ? 900 : 844 } });
  const cookies = [{ name: "dissect-lang", value: lang, url: BASE }];
  if (SESSION) cookies.push({ name: "dissect-session", value: SESSION, url: BASE });
  await ctx.addCookies(cookies);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("pageerror", e.message));
  return { ctx, page };
}

// A link opens in the side panel beside the canvas (GRAPH2, WALK2-05).
const panelOf = (page, id) => page.locator(`[data-graph-link-panel="${id}"]`);
const nodeChip = (page, id) => page.locator(`[data-graph-node-notes="${id}"]`);

for (const lang of ["en", "zh"]) {
  for (const width of [1440, 390]) {
    const tag = `${lang}-${width}`;
    const { ctx, page } = await newPage(width, lang);
    await openGraph(page);
    await page.screenshot({ path: `${OUT}/graph-${tag}-${MODE}.png` });
    if (MODE === "before") {
      if (await pin(page, pair(A, B))) {
        await page.locator('[data-track-surface="graph-links"] [data-track="graph-link-expand"]').first().click();
        await page.waitForTimeout(400);
      }
      await page.screenshot({ path: `${OUT}/link-pinned-${tag}-${MODE}.png` });
      await ctx.close();
      continue;
    }

    // Package 2: node chips (accepted count, pending dot).
    const chipA = (await nodeChip(page, A).innerText().catch(() => "")).trim();
    const chipC = (await nodeChip(page, C).innerText().catch(() => "")).trim();
    const dotE = await nodeChip(page, E).locator("span.rounded-full").count();
    check(chipA === expectedChip(A), `${tag} Heat pumps chip reads ${expectedChip(A)}`, chipA);
    check(chipC === expectedChip(C), `${tag} Household chip reads ${expectedChip(C)}`, chipC);
    check(dotE === 1, `${tag} State rebate chip has a pending dot`);
    // The note curve: Household ⇄ State rebate has no link, one note.
    check((await page.locator(`[data-graph-note-curve="${pair(C, E)}"]`).count()) === 1, `${tag} sage dotted curve Household ⇄ State rebate`);
    // Package 1: the A–B curve carries the open-reply mark "2" and a notes pill.
    const abEdge = page.locator(`[data-testid="rf__edge-${pair(A, B)}"]`);
    const repliesMark = (await abEdge.locator('[data-graph-curve-mark="replies"] text').textContent().catch(() => "")) ?? "";
    check(repliesMark.trim() === "2", `${tag} A–B curve shows 2 open replies`, repliesMark);
    check((await abEdge.locator('[data-graph-curve-mark="notes"]').count()) === 1, `${tag} A–B curve shows a notes pill`);

    // Pin the A–B curve: the row counts replies, the expanded link shows the thread.
    check(await pin(page, pair(A, B)), `${tag} pinned A–B`);
    const list = page.locator('[data-track-surface="graph-links"]');
    const rowCount = await list.locator(`[data-graph-link-replies="${LINK_AB}"]`).innerText().catch(() => "");
    check(/2/.test(rowCount), `${tag} row reads 2 replies`, rowCount);
    const pairNotes = await list.locator(`[data-graph-pair-notes="${pair(A, B)}"]`).innerText().catch(() => "");
    check(/COP 2\.6/.test(pairNotes), `${tag} Notes quoting both lists the COP note`);
    await list.locator('[data-track="graph-link-expand"]').first().click();
    await page.waitForTimeout(500);
    const thread = await panelOf(page, LINK_AB).locator(`[data-graph-link-thread="${LINK_AB}"]`).innerText().catch(() => "");
    const seeded = sql(`select count(*) from "Reply" where "docLinkId"='${LINK_AB}' and "resolvedById" is null`);
    check(thread.split("\n").filter((l) => l.trim()).length >= Number(seeded), `${tag} thread shows the seeded replies`, JSON.stringify(thread.slice(0, 160)));
    await page.screenshot({ path: `${OUT}/link-pinned-${tag}-${MODE}.png` });

    if (SESSION && lang === "en" && width === 1440) {
      // Send a reply on the graph, then resolve it.
      const REPLY = `graph reply ${Date.now()}`;
      await panelOf(page, LINK_AB).locator(`[data-graph-link-thread="${LINK_AB}"] [data-track="reply"]`).click();
      await panelOf(page, LINK_AB).locator(`[data-graph-link-thread="${LINK_AB}"] textarea`).fill(REPLY);
      await panelOf(page, LINK_AB).locator(`[data-graph-link-thread="${LINK_AB}"] [data-track="reply-send"]`).click();
      // The reply shows once the refresh lands (the first call compiles the route in dev).
      await panelOf(page, LINK_AB).locator(`[data-graph-link-thread="${LINK_AB}"]`, { hasText: REPLY }).waitFor({ timeout: 30000 }).catch(() => {});
      await abEdge.locator('[data-graph-curve-mark="replies"] text', { hasText: "3" }).waitFor({ timeout: 15000 }).catch(() => {});
      const sent = await panelOf(page, LINK_AB).locator(`[data-graph-link-thread="${LINK_AB}"]`).innerText().catch(() => "");
      check(sent.includes(REPLY), "signed in: the sent reply shows in the thread");
      check(sql(`select count(*) from "Reply" where "docLinkId"='${LINK_AB}' and content='${REPLY}'`) === "1", "signed in: SQL finds the reply on the A–B link");
      const mark = await abEdge.locator('[data-graph-curve-mark="replies"] text').textContent().catch(() => "");
      check(mark?.trim() === "3", "signed in: the curve mark counts 3", mark ?? "");
      await page.screenshot({ path: `${OUT}/reply-sent-${tag}.png` });
      const row = panelOf(page, LINK_AB).locator(`[data-graph-link-thread="${LINK_AB}"] div.flex.items-start`, { hasText: REPLY });
      await row.locator('[data-track="reply-resolve"]').click();
      await abEdge.locator('[data-graph-curve-mark="replies"] text', { hasText: "2" }).waitFor({ timeout: 20000 }).catch(() => {});
      const mark2 = await abEdge.locator('[data-graph-curve-mark="replies"] text').textContent().catch(() => "");
      check(mark2?.trim() === "2", "signed in: resolved, the curve mark counts 2", mark2 ?? "");
      check(sql(`select count(*) from "Reply" where "docLinkId"='${LINK_AB}' and content='${REPLY}' and "resolvedById" is not null`) === "1", "signed in: SQL finds the reply resolved");
      await page.screenshot({ path: `${OUT}/reply-resolved-${tag}.png` });
    }

    // The node card: hover Heat pumps.
    await page.mouse.click(4, 300); // unpin
    await page.mouse.move(4, 320);
    await page.waitForTimeout(300);
    if (width > 500) {
      await page.locator(`[data-id="${A}"]`).hover();
      await page.waitForTimeout(700);
      const card = await page.locator('[data-track-surface="graph-node-notes"]').innerText().catch(() => "");
      check(/COP 2\.6/.test(card) && /installer/i.test(card), `${tag} node card lists both notes`);
      check(card.includes("Grid load and electrified heating"), `${tag} COP row shows the Grid load chip`);
      await page.screenshot({ path: `${OUT}/node-card-${tag}-${MODE}.png` });
      await page.mouse.move(4, 320);
      await page.waitForTimeout(500);
    }

    // Package 4: the Notes list.
    await page.click('[data-track="graph-notes"]');
    await page.waitForTimeout(500);
    const aside = page.locator('[data-track-surface="graph-notes-list"]');
    const rows = await aside.locator("[data-graph-notes-row]").count();
    check(rows >= 4, `${tag} Notes across documents lists the cross-document notes`, `${rows} rows`);
    check((await aside.locator('[data-track="graph-notes-accept"]').count()) >= 1, `${tag} the pending note offers Accept`);
    await page.screenshot({ path: `${OUT}/notes-list-${tag}-${MODE}.png` });
    if (width > 500) {
      await aside.locator('[data-graph-notes-row="cmuxeddly000w7d4evwwt1od5"]').hover();
      await page.waitForTimeout(500);
      const op = async (id) => page.locator(`[data-id="${id}"] > div`).first().evaluate((el) => getComputedStyle(el).opacity);
      const lit = [await op(C), await op(E)];
      const dim = [await op(A), await op(B), await op(D)];
      check(lit.every((o) => Number(o) > 0.9) && dim.every((o) => Number(o) < 0.3), `${tag} hover on the savings note lights Household and State rebate`, `${lit} / ${dim}`);
      await page.screenshot({ path: `${OUT}/notes-hover-${tag}-${MODE}.png` });
      await page.mouse.move(700, 120);
      await page.waitForTimeout(300);
      const openQuestions = sql(`select id from "Section" where "notebookId"='${NB}' and title='Open questions'`);
      await aside.locator('[data-track="graph-notes-section"]').selectOption(openQuestions);
      await page.waitForTimeout(700);
      const after = [await op(A), await op(D), await op(B), await op(C)];
      check(Number(after[0]) > 0.9 && Number(after[1]) > 0.9 && Number(after[2]) < 0.5 && Number(after[3]) < 0.5, `${tag} section Open questions keeps Heat pumps and Contractor lit`, after.join(","));
      const chipA2 = (await nodeChip(page, A).innerText().catch(() => "")).trim();
      check(chipA2 === "1", `${tag} with the section, Heat pumps chip reads 1`, chipA2);
      await page.screenshot({ path: `${OUT}/notes-section-${tag}-${MODE}.png` });
      await aside.locator('[data-track="graph-notes-section"]').selectOption("");
      await page.waitForTimeout(300);
    }
    await page.click('[data-track="graph-notes"]');
    await page.waitForTimeout(400);

    // Package 3a: Note on this link (once, en at 1440).
    if (lang === "en" && width === 1440) {
      check(await pin(page, pair(A, C), 0.4), "pinned Heat pumps ⇄ Household");
      await list.locator('[data-track="graph-link-expand"]').first().click();
      await page.waitForTimeout(300);
      await panelOf(page, LINK_AC).locator('[data-track="graph-link-note"]').click();
      await panelOf(page, LINK_AC).locator(`[data-graph-link-note-composer="${LINK_AC}"] textarea`).fill("running cost and savings agree");
      await page.waitForTimeout(200);
      // Reload mid-typing: the draft comes back.
      await openGraph(page);
      await pin(page, pair(A, C), 0.4);
      await list.locator('[data-track="graph-link-expand"]').first().click();
      await page.waitForTimeout(300);
      const restored = await panelOf(page, LINK_AC).locator(`[data-graph-link-note-composer="${LINK_AC}"] textarea`).inputValue().catch(() => "");
      check(restored === "running cost and savings agree", "the draft comes back after a reload", restored);
      await page.screenshot({ path: `${OUT}/link-note-composer-${tag}.png` });
      await panelOf(page, LINK_AC).locator('[data-track="graph-link-note-save"]').click();
      await page.waitForTimeout(1800);
      const savedLine = await panelOf(page, LINK_AC).locator("[data-graph-link-note-saved]").innerText().catch(() => "");
      check(/Note saved in/.test(savedLine), "the composer closes into Note saved in …", savedLine);
      const noteRow = sql(`select n.id || ',' || n.status || ',' || coalesce(n."documentId",'null') from "Note" n where n.content='running cost and savings agree' order by n."createdAt" desc limit 1`);
      const [noteId, status, documentId] = noteRow.split(",");
      const sources = sql(`select string_agg(s."documentId" || ':' || s."quotedText", ' | ' order by s."documentId") from "Source" s where s."noteId"='${noteId}'`);
      check(status === "ACCEPTED" && documentId === "null", "the note is accepted, the project's note", noteRow);
      check(sources.includes(A) && sources.includes(C), "two sources, one in each document", sources);
      const draftLeft = await page.evaluate((k) => localStorage.getItem(k), `graph-link-note:${LINK_AC}`);
      check(draftLeft === null, "the draft is cleared once the server has the note");
      await page.screenshot({ path: `${OUT}/link-note-saved-${tag}.png` });
      // Show: the graph closes and the tray shows the note.
      await panelOf(page, LINK_AC).locator('[data-track="graph-link-note-show"]').click();
      await page.waitForTimeout(2500);
      const overlay = await page.locator(".graph-overlay-in").count();
      const card = await page.locator(`[data-note-id="${noteId}"]`).count();
      check(overlay === 0 && card > 0, "Show closes the graph and the tray shows the note", `overlay ${overlay}, cards ${card}`);
      await page.screenshot({ path: `${OUT}/link-note-shown-${tag}.png` });
    }
    await ctx.close();
  }
}
await browser.close();
console.log(failures === 0 ? "ALL PASS" : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
