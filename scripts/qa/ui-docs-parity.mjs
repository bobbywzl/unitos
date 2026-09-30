// UI walk of the page editor's Google Docs parity features (the docs-parity
// loop, SPEC.md §29), one group per feature, driven at a person's pace in
// headless Chromium: BORDERS is Format > Paragraph styles > Borders and
// shading; FULLSCREEN is View > Full screen; IMAGENOTE is an image dragged
// from the page onto a note in the notes tray (a person's mouse drag, which
// the browser runs as its own drag); SPELLING is Add to dictionary, Ignore
// all, and Tools > Spelling and grammar > Personal dictionary; CHART is
// Insert > Chart. Each check prints PASS or FAIL with its evidence; each
// case leaves a screenshot (light theme, 1440×900; the dark case in dark).
//
// Usage:
//   node scripts/qa/ui-docs-parity.mjs [BORDERS FULLSCREEN IMAGENOTE SPELLING CHART] [--label after] [--keep]
// With no group named, every group runs. Env: BASE (default
// http://localhost:3111), SHOT_DIR (default <tmp>/ui-docs-parity), CHROME
// (default /opt/pw-browsers/chromium), FIXTURE_PORT (default 3492), DATABASE_URL
// (read from .env when unset). Expects the dev server with sign-in off. The
// project the walk makes is deleted at the end unless --keep.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { PrismaClient } from "@prisma/client";
import { strFromU8, unzipSync } from "fflate";
import { chromium } from "playwright-core";

const ROOT = process.cwd();
if (!process.env.DATABASE_URL && existsSync(join(ROOT, ".env"))) {
  const m = /^DATABASE_URL="?([^"\n]+)"?/m.exec(readFileSync(join(ROOT, ".env"), "utf8"));
  if (m) process.env.DATABASE_URL = m[1];
}
const BASE = process.env.BASE ?? "http://localhost:3111";
const CHROME = process.env.CHROME ?? "/opt/pw-browsers/chromium";
const FIXTURE_PORT = Number(process.env.FIXTURE_PORT ?? 3492);
const FIXTURE = `http://localhost:${FIXTURE_PORT}`;
const args = process.argv.slice(2);
const LABEL = args.includes("--label") ? args[args.indexOf("--label") + 1] : "run";
const KEEP = args.includes("--keep");
const ONLY = new Set(args.filter((a, i) => /^[A-Z]+$/.test(a) && args[i - 1] !== "--label"));
const SHOT = join(process.env.SHOT_DIR ?? join(tmpdir(), "ui-docs-parity"), LABEL);
const STAMP = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
mkdirSync(SHOT, { recursive: true });

const db = new PrismaClient();
const results = [];
const record = (level, group, name, detail = "") => {
  const line = `${level} ${group} ${name}${detail ? ` — ${detail}` : ""}`;
  results.push({ level, line });
  console.log(line);
};
const check = (group, ok, name, detail) => record(ok ? "PASS" : "FAIL", group, name, detail);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 20_000, every = 200) {
  const end = Date.now() + ms;
  for (;;) {
    const value = await fn();
    if (value || Date.now() >= end) return value;
    await sleep(every);
  }
}

// ── The app ─────────────────────────────────────────────────────────────────

async function api(p, method = "GET", body) {
  const res = await fetch(`${BASE}${p}`, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  try {
    return { status: res.status, body: JSON.parse(text) };
  } catch {
    return { status: res.status, body: text };
  }
}
const blockId = () => `d${Math.random().toString(36).slice(2, 12)}${Math.random().toString(36).slice(2, 12)}`;
const ctx = { notebookId: null, documents: [] };

/** A blank document holding `paragraphs`, one per line. */
async function blankDocument(title, paragraphs) {
  const blank = await api("/api/documents/blank", "POST", { notebookId: ctx.notebookId, title });
  const rt = await api(`/api/documents/${blank.body.id}/rich-text`);
  const doc = { type: "doc", content: paragraphs.map((text) => ({ type: "paragraph", attrs: { blockId: blockId() }, content: [{ type: "text", text }] })) };
  const put = await api(`/api/documents/${blank.body.id}/rich-text`, "PUT", { richText: doc, rev: rt.body.rev });
  if (put.status !== 200) throw new Error(`blank document: HTTP ${put.status}`);
  ctx.documents.push(blank.body.id);
  return blank.body.id;
}

/** A blank document holding `content`, the page editor's own nodes. */
async function richDocument(title, content) {
  const blank = await api("/api/documents/blank", "POST", { notebookId: ctx.notebookId, title });
  const rt = await api(`/api/documents/${blank.body.id}/rich-text`);
  const put = await api(`/api/documents/${blank.body.id}/rich-text`, "PUT", { richText: { type: "doc", content }, rev: rt.body.rev });
  if (put.status !== 200) throw new Error(`blank document: HTTP ${put.status}`);
  ctx.documents.push(blank.body.id);
  return blank.body.id;
}
const paragraph = (text) => ({ type: "paragraph", attrs: { blockId: blockId() }, content: [{ type: "text", text }] });
const image = (src, alt) => ({ type: "image", attrs: { src, alt, blockId: blockId() } });

// ── The browser ─────────────────────────────────────────────────────────────

let browser;
async function newPage({ width = 1440, height = 900, theme = "light" } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, colorScheme: theme });
  context.setDefaultTimeout(60_000);
  context.setDefaultNavigationTimeout(120_000);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return { page, errors, close: () => context.close() };
}
async function shot(page, name) {
  const file = join(SHOT, `${name}.png`);
  await page.screenshot({ path: file });
  return file;
}
async function openEditor(page, documentId, words) {
  await page.goto(`${BASE}/n/${ctx.notebookId}?doc=${documentId}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction((w) => Boolean(window.__docsEditor) && !window.__docsEditor.isDestroyed && document.querySelector(".docs-prose")?.textContent.includes(w), words, { timeout: 120_000 });
  await page.waitForSelector('[data-track="voice-note"]', { timeout: 60_000 }).catch(() => {});
  await sleep(600);
}
async function setMode(page, to) {
  await page.click('[data-track="docs:mode"]');
  await page.locator(`[data-track="docs:mode:${to}"]`).click();
  await page.waitForFunction((m) => document.querySelector('[data-track="docs:mode"]')?.getAttribute("data-mode") === m, to, { timeout: 10_000 });
  await sleep(300);
}
/** The stored copy caught up with the page. */
async function saved(page) {
  return until(
    () =>
      page
        .evaluate(async () => {
          const id = new URLSearchParams(location.search).get("doc");
          const res = await fetch(`/api/documents/${id}/rich-text`, { cache: "no-store" });
          if (!res.ok) return false;
          const { richText } = await res.json();
          const ed = window.__docsEditor;
          return JSON.stringify(ed.schema.nodeFromJSON(richText).toJSON()) === JSON.stringify(ed.getJSON());
        })
        .catch(() => false),
    30_000,
    400,
  );
}
/** The client box of the words of the paragraph that starts with `words`. */
async function wordsBox(page, words) {
  return page.evaluate((words) => {
    const p = [...document.querySelectorAll(".docs-prose p")].find((e) => e.textContent.startsWith(words));
    const range = document.createRange();
    range.selectNodeContents(p);
    const r = range.getClientRects()[0];
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, y: (r.top + r.bottom) / 2 };
  }, words);
}
/** A caret in, or a drag across, paragraphs as a person does it. */
async function clickIn(page, words) {
  const b = await wordsBox(page, words);
  await page.mouse.click(b.left + 20, b.y);
  await sleep(200);
}
async function selectAcross(page, fromWords, toWords) {
  const a = await wordsBox(page, fromWords);
  const b = await wordsBox(page, toWords);
  await page.mouse.move(a.left + 4, a.y);
  await page.mouse.down();
  await page.mouse.move((a.left + b.right) / 2, (a.y + b.y) / 2, { steps: 6 });
  await page.mouse.move(b.right - 4, b.y, { steps: 6 });
  await page.mouse.up();
  await sleep(300);
}
/** The attributes and drawn style of each paragraph that starts with one of `words`. */
async function paragraphs(page, words) {
  return page.evaluate((words) => {
    const ed = window.__docsEditor;
    const out = [];
    ed.state.doc.descendants((node, pos) => {
      if (node.type.name !== "paragraph") return true;
      const w = words.find((x) => node.textContent.startsWith(x));
      if (!w) return false;
      const dom = ed.view.nodeDOM(pos);
      const cs = getComputedStyle(dom);
      out.push({
        words: w,
        attrs: { top: node.attrs.borderTop, bottom: node.attrs.borderBottom, left: node.attrs.borderLeft, right: node.attrs.borderRight, between: node.attrs.borderBetween, shading: node.attrs.shading },
        marks: node.marks.map((m) => m.type.name),
        cls: dom.className,
        css: { top: cs.borderTopWidth + " " + cs.borderTopStyle, bottom: cs.borderBottomWidth + " " + cs.borderBottomStyle, left: cs.borderLeftWidth, bg: cs.backgroundColor, mt: cs.marginTop, mb: cs.marginBottom, color: cs.color },
        rect: dom.getBoundingClientRect().toJSON(),
      });
      return false;
    });
    return out;
  }, words);
}
/** Open Borders and shading from the Styles menu. */
async function openBorders(page) {
  await page.click('[data-track="docs:styles"]');
  await page.locator('[data-track="docs:borders-shading"]').click();
  await page.waitForSelector('[role="dialog"].docs-borders-dialog', { timeout: 10_000 });
  await sleep(200);
}
const dialog = (page) => page.locator('[role="dialog"].docs-borders-dialog');

const GROUPS = {};

// ── Borders and shading ─────────────────────────────────────────────────────

GROUPS.BORDERS = async () => {
  const G = "BORDERS";
  const P = ["Alpha opens the page.", "Bravo is the paragraph in a box.", "Charlie shares the box with Bravo.", "Delta closes the page."];
  const id = await blankDocument("Borders and shading", P);
  const { page, errors, close } = await newPage();
  await openEditor(page, id, "Delta");
  await shot(page, "borders-0-before");

  // 1. One paragraph: every side, a background, padding 6.
  await clickIn(page, "Bravo");
  await openBorders(page);
  const betweenShown = await dialog(page).locator('[data-track="docs:borders:between"]').count();
  check(G, betweenShown === 0, "one paragraph: the dialog offers no line between paragraphs", `${betweenShown} between toggles`);
  await dialog(page).locator('[data-track="docs:borders:all"]').click();
  await dialog(page).locator('[data-track="docs:borders:padding"]').fill("6");
  await dialog(page).locator('[data-track="docs:borders-background"]').click();
  await sleep(300);
  await page.locator('[data-docs-menu] [role="menuitemradio"][aria-label]').nth(22).click();
  await sleep(200);
  await shot(page, "borders-1-dialog");
  await dialog(page).locator('button[type="submit"]').click();
  await sleep(500);
  let [b] = await paragraphs(page, ["Bravo"]);
  const side = "1 solid #000000 6";
  check(G, b.attrs.top === side && b.attrs.bottom === side && b.attrs.left === side && b.attrs.right === side && /^#[0-9a-f]{6} 6$/.test(b.attrs.shading ?? ""), "Apply puts every side and the background on the paragraph", JSON.stringify(b.attrs));
  check(G, /solid/.test(b.css.top) && parseFloat(b.css.top) >= 1 && parseFloat(b.css.left) >= 1 && b.css.bg === "rgb(252, 229, 205)", "the page draws the box and the background", JSON.stringify(b.css));
  await shot(page, "borders-1-one-paragraph");

  // 2. Undo takes it off in one step; Redo puts it back.
  await page.keyboard.press("Control+z");
  await sleep(300);
  const [u] = await paragraphs(page, ["Bravo"]);
  await page.keyboard.press("Control+y");
  await sleep(300);
  const [r] = await paragraphs(page, ["Bravo"]);
  check(G, !u.attrs.top && !u.attrs.shading && r.attrs.top === side && r.attrs.shading === b.attrs.shading, "Undo takes the box off in one step, Redo puts it back", `${JSON.stringify(u.attrs)} → ${JSON.stringify(r.attrs)}`);

  // 3. Two paragraphs: one box with the line between, one background.
  await selectAcross(page, "Bravo", "Charlie");
  await openBorders(page);
  const between = dialog(page).locator('[data-track="docs:borders:between"]');
  check(G, (await between.count()) === 1, "two paragraphs: the dialog offers the line between them");
  if (!(await between.getAttribute("aria-pressed")).includes("true")) await between.click();
  await dialog(page).locator('button[type="submit"]').click();
  await sleep(500);
  const [bb, cc] = await paragraphs(page, ["Bravo", "Charlie"]);
  check(G, bb.attrs.between === side && cc.attrs.between === side && cc.attrs.shading === bb.attrs.shading && cc.attrs.top === side, "Apply gives both paragraphs the same box and the line between", `${JSON.stringify(bb.attrs)} | ${JSON.stringify(cc.attrs)}`);
  const joined = Math.abs(bb.rect.bottom - cc.rect.top) < 0.6;
  check(G, bb.cls.includes("docs-box-first") && cc.cls.includes("docs-box-last") && /solid/.test(bb.css.bottom) && /none/.test(cc.css.top) && joined, "they draw one box: the line between under the first, no top line on the second, no gap in the background", `classes ${bb.cls.match(/docs-box-\w+/)} / ${cc.cls.match(/docs-box-\w+/)}; first bottom ${bb.css.bottom}, second top ${cc.css.top}; gap ${Math.round((cc.rect.top - bb.rect.bottom) * 10) / 10}px`);
  await page.mouse.click(10, 880);
  await sleep(200);
  await shot(page, "borders-3-one-box");

  // 4. Saved, and the same after a reload.
  const ok = await saved(page);
  await openEditor(page, id, "Delta");
  const [rb, rc] = await paragraphs(page, ["Bravo", "Charlie"]);
  check(G, Boolean(ok) && JSON.stringify(rb.attrs) === JSON.stringify(bb.attrs) && JSON.stringify(rc.attrs) === JSON.stringify(cc.attrs) && rb.cls.includes("docs-box-first"), "saved, and after a reload the box is the same", `${JSON.stringify(rb.attrs)}`);

  // The Word download keeps the box: the sides, the line between, the background.
  const docx = await page.request.get(`${BASE}/api/documents/${id}/export?format=docx`);
  const xml = docx.ok() ? strFromU8(unzipSync(new Uint8Array(await docx.body()))["word/document.xml"]) : "";
  const bravoXml = /<w:p>(?:(?!<\/w:p>).)*?Bravo(?:(?!<\/w:p>).)*?<\/w:p>/s.exec(xml)?.[0] ?? "";
  check(G, /<w:pBdr>/.test(bravoXml) && /<w:between /.test(bravoXml) && /<w:shd [^>]*w:fill="FCE5CD"/i.test(bravoXml), "the Word download keeps the sides, the line between, and the background", `HTTP ${docx.status()}; pBdr ${/<w:pBdr>/.test(bravoXml)}, between ${/<w:between /.test(bravoXml)}, shd ${/<w:shd [^>]*w:fill="FCE5CD"/i.test(bravoXml)}`);

  // That Word file, added back as an import, keeps the box. The Imports
  // switch is on for the add alone, then as it was.
  const was = await db.appSetting.findUnique({ where: { key: "imports" } });
  await db.appSetting.upsert({ where: { key: "imports" }, create: { key: "imports", value: "on" }, update: { value: "on" } });
  let back = null;
  try {
    const form = new FormData();
    form.set("notebookId", ctx.notebookId);
    form.set("file", new File([await docx.body()], "Borders and shading.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }));
    const res = await fetch(`${BASE}/api/documents`, { method: "POST", body: form });
    const lines = (await res.text()).split("\n").filter(Boolean).map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return {};
      }
    });
    const last = lines.findLast((l) => l.id || l.error);
    if (last?.id) {
      ctx.documents.push(last.id);
      const rt = await api(`/api/documents/${last.id}/rich-text`);
      const attrsOf = (words) => rt.body?.richText?.content?.find((n) => n.type === "paragraph" && (n.content ?? []).map((c) => c.text ?? "").join("").startsWith(words))?.attrs ?? null;
      const pick = (a) => a && { top: a.borderTop, bottom: a.borderBottom, left: a.borderLeft, right: a.borderRight, between: a.borderBetween, shading: a.shading };
      back = { bravo: pick(attrsOf("Bravo")), charlie: pick(attrsOf("Charlie")) };
    } else back = { error: last?.error ?? `HTTP ${res.status}` };
  } finally {
    if (was) await db.appSetting.update({ where: { key: "imports" }, data: { value: was.value } });
    else await db.appSetting.deleteMany({ where: { key: "imports" } });
  }
  const same = (a) => Boolean(a) && ["top", "bottom", "left", "right", "between", "shading"].every((k) => a[k] === bb.attrs[k]);
  check(G, same(back?.bravo) && same(back?.charlie), "the Word file, added back, keeps the sides, the line between, and the background", JSON.stringify(back));

  // 5. Search the menus finds it.
  await clickIn(page, "Alpha");
  await page.keyboard.press("Alt+/");
  await sleep(300);
  await page.keyboard.type("borders", { delay: 40 });
  await sleep(500);
  const found = await page.evaluate(() => [...document.querySelectorAll("[data-docs-menu] [role='option'], [data-docs-menu] [data-menu-item]")].map((e) => e.textContent).filter((t) => /Borders and shading/.test(t)).length);
  check(G, found > 0, "Search the menus finds Borders and shading", `${found} rows`);
  await page.keyboard.press("Escape");
  await sleep(200);

  // 6. Reset takes the box off.
  await clickIn(page, "Bravo");
  await openBorders(page);
  await dialog(page).getByRole("button", { name: /Reset/ }).click();
  await dialog(page).locator('button[type="submit"]').click();
  await sleep(500);
  const [x] = await paragraphs(page, ["Bravo"]);
  check(G, !x.attrs.top && !x.attrs.bottom && !x.attrs.left && !x.attrs.right && !x.attrs.between && !x.attrs.shading, "Reset, then Apply, takes the box off", JSON.stringify(x.attrs));

  // 7. Suggesting: the change is a suggestion; Reject takes it back.
  await setMode(page, "suggesting");
  await clickIn(page, "Delta");
  await openBorders(page);
  await dialog(page).locator('[data-track="docs:borders:bottom"]').click();
  await dialog(page).locator('button[type="submit"]').click();
  await sleep(600);
  const [d] = await paragraphs(page, ["Delta"]);
  check(G, d.attrs.bottom === "1 solid #000000 0" && d.marks.includes("modification"), "in Suggesting the new line is a suggestion", `${JSON.stringify(d.attrs)} marks ${JSON.stringify(d.marks)}`);
  await shot(page, "borders-7-suggested");
  const reject = page.locator('[data-track="suggestion-reject"]').first();
  if (await reject.count()) {
    await reject.click();
    await sleep(500);
  }
  const [dr] = await paragraphs(page, ["Delta"]);
  check(G, !dr.attrs.bottom && !dr.marks.includes("modification"), "Reject takes the suggested line back", JSON.stringify(dr.attrs));
  check(G, errors.length === 0, "no page errors", errors.slice(0, 2).join(" | "));
  await close();

  // 8. Dark mode: the words on a light background keep the light theme's ink.
  const dark = await newPage({ theme: "dark" });
  await openEditor(dark.page, id, "Delta");
  const [db1] = await paragraphs(dark.page, ["Charlie"]);
  check(G, db1.css.color === "rgb(0, 0, 0)", "dark mode: the words on a light background stay dark", `color ${db1.css.color} on ${db1.css.bg}`);
  await shot(dark.page, "borders-8-dark");
  await dark.close();
};

// ── View > Full screen ──────────────────────────────────────────────────────

/** Run a command from Search the menus, as a person does: Alt+/, the words, Enter. */
async function searchMenus(page, words) {
  await page.keyboard.press("Alt+/");
  await sleep(300);
  await page.keyboard.type(words, { delay: 40 });
  await sleep(500);
  const rows = await page.evaluate(() => [...document.querySelectorAll("[data-docs-menu] [role='option']")].map((e) => e.textContent));
  await page.keyboard.press("Enter");
  await sleep(500);
  return rows;
}
const toolbarShown = (page) => page.evaluate(() => {
  const bar = document.querySelector('.docs-header [role="toolbar"]');
  return Boolean(bar && bar.getBoundingClientRect().height > 0);
});

GROUPS.FULLSCREEN = async () => {
  const G = "FULLSCREEN";
  const id = await blankDocument("Full screen", ["Alpha opens the page.", "Bravo is the second line."]);
  const { page, errors, close } = await newPage();
  await openEditor(page, id, "Bravo");
  const before = await page.evaluate(() => document.querySelector(".docs-prose").getBoundingClientRect().top);
  await shot(page, "fullscreen-0-before");
  await clickIn(page, "Bravo");
  const rows = await searchMenus(page, "full screen");
  check(G, rows.some((r) => /Full screen/.test(r)), "Search the menus finds View > Full screen", JSON.stringify(rows.slice(0, 3)));
  const hidden = !(await toolbarShown(page)) && (await page.locator(".docs-title-row").count()) === 0;
  const after = await page.evaluate(() => document.querySelector(".docs-prose").getBoundingClientRect().top);
  const toast = await page.evaluate(() => document.querySelector("[data-reader-toast]")?.textContent ?? "");
  check(G, hidden && after < before - 60, "full screen hides the title row, the toolbar, and the ruler; the page moves up", `toolbar shown ${!hidden}; text top ${Math.round(before)} → ${Math.round(after)}`);
  check(G, /Press Esc/.test(toast), "a toast says how to leave", toast);
  await shot(page, "fullscreen-1-on");
  // The page still takes typing and the keys.
  await clickIn(page, "Bravo");
  await page.keyboard.press("End");
  await page.keyboard.type(" Typed in full screen.");
  await page.keyboard.press("Shift+Home");
  // The page reads the selection the key made on the browser's next turn.
  await sleep(300);
  await page.keyboard.press("Control+b");
  await sleep(300);
  const typed = await page.evaluate(() => {
    const ed = window.__docsEditor;
    let bold = false;
    ed.state.doc.descendants((n) => {
      if (n.isText && n.text.includes("Typed in full screen") && n.marks.some((m) => m.type.name === "bold")) bold = true;
    });
    return { text: ed.state.doc.textContent.includes("Typed in full screen."), bold };
  });
  check(G, typed.text && typed.bold, "typing and Ctrl+B work in full screen", JSON.stringify(typed));
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Escape");
  await sleep(400);
  check(G, (await toolbarShown(page)) && (await page.locator(".docs-title-row").count()) === 1, "Esc brings the header back");
  await shot(page, "fullscreen-2-esc");
  check(G, errors.length === 0, "no page errors", errors.slice(0, 2).join(" | "));
  await close();
};

// ── An image dragged from the page onto a note ─────────────────────────────

/** Three bars on a light ground, `w` × `h`: a small chart. */
function barsPng(w = 320, h = 180) {
  const c = createCanvas(w, h);
  const g = c.getContext("2d");
  g.fillStyle = "#f4ede1";
  g.fillRect(0, 0, w, h);
  for (const [color, x, bar] of [["#6b8f71", 0.12, 0.5], ["#c4785a", 0.41, 0.72], ["#7a8fb3", 0.69, 0.33]]) {
    g.fillStyle = color;
    g.fillRect(w * x, h * (0.89 - bar), w * 0.19, h * bar);
  }
  return c.toBuffer("image/png");
}

/** Two sites that serve the same picture: one lets the browser read it
    (CORS), one does not. */
function serveImages(png) {
  const server = createServer((req, res) => {
    const path = new URL(req.url, FIXTURE).pathname;
    if (path === "/open.png") res.writeHead(200, { "content-type": "image/png", "access-control-allow-origin": "*" });
    else if (path === "/closed.png") res.writeHead(200, { "content-type": "image/png" });
    else {
      res.writeHead(404);
      res.end();
      return;
    }
    res.end(png);
  });
  return new Promise((resolve) => server.listen(FIXTURE_PORT, () => resolve(server)));
}

/** A person's drag of the page's image that shows `alt` onto `target`: a
    press on the image, a short pull, the way over, a pause, the release.
    `whileOver` runs during the pause. */
async function dragImage(page, alt, target, whileOver) {
  const from = await page.evaluate((alt) => {
    const img = [...document.querySelectorAll(".docs-prose figure.docs-img img")].find((i) => i.alt === alt);
    img.scrollIntoView({ block: "center" });
    const r = img.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, alt);
  await sleep(300);
  await page.mouse.click(from.x, from.y);
  await sleep(300);
  const to = await target.boundingBox();
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 30, from.y + 5, { steps: 5 });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 25 });
  await sleep(300);
  const seen = whileOver ? await whileOver() : undefined;
  await page.mouse.up();
  await sleep(300);
  return seen;
}

GROUPS.IMAGENOTE = async () => {
  const G = "IMAGENOTE";
  const png = barsPng();
  const stored = await (await fetch(`${BASE}/api/images`, { method: "POST", headers: { "content-type": "image/png" }, body: png })).json();
  const server = await serveImages(png);
  try {
    const id = await richDocument("Image to note", [
      paragraph("The counts at the three stations, spring survey."),
      image(stored.url, "Counts by station"),
      paragraph("The same chart, from a site that lets the browser read it."),
      image(`${FIXTURE}/open.png`, "Open site"),
      paragraph("The same chart, from a site that does not."),
      image(`${FIXTURE}/closed.png`, "Closed site"),
      paragraph("The east station counted the fewest birds."),
    ]);
    const section = await db.section.findFirst({ where: { notebookId: ctx.notebookId }, orderBy: { order: "asc" } });
    const made = await api("/api/notes", "POST", { sectionId: section.id, content: "Station counts: why is the east bank low?", documentId: id });
    const noteId = made.body.id;
    const content = async () => (await db.note.findUnique({ where: { id: noteId }, select: { content: true } }))?.content ?? "";
    const { page, errors, close } = await newPage();
    const posts = [];
    page.on("request", (r) => r.method() === "POST" && r.url().startsWith(`${BASE}/api/images`) && posts.push(r.url()));
    await openEditor(page, id, "fewest");
    await page.waitForFunction(() => [...document.querySelectorAll(".docs-prose figure.docs-img img")].every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 20_000 }).catch(() => {});
    if ((await page.locator('[data-track="notes"][aria-current="true"]').count()) === 0) {
      await page.click('[data-track="notes"]');
      await sleep(1200);
    }
    const card = page.locator(`aside[data-track-surface="tray"] [data-note-id="${noteId}"]`).first();
    await card.waitFor({ state: "visible", timeout: 20_000 });
    await shot(page, "imagenote-0-before");

    // 1. A stored image: the note takes the same address, nothing uploads,
    // and the note rings while the image is over it.
    let ring = await dragImage(page, "Counts by station", card, () => card.evaluate((el) => getComputedStyle(el).outlineStyle));
    let text = await until(async () => ((await content()).includes("![") ? content() : null), 10_000);
    check(G, ring === "dashed", "while the image is over the note, the note rings", `outline ${ring}`);
    check(G, (text ?? "").endsWith(`![Counts by station](/api/images/${stored.id})`), "a stored image dragged onto a note goes into the note, with its own address", JSON.stringify(text));
    check(G, posts.length === 0, "the stored image is not stored again", posts.join(", ") || "no uploads");
    const figures = await page.evaluate(() => document.querySelectorAll(".docs-prose figure.docs-img").length);
    const kept = await saved(page);
    check(G, figures === 3 && Boolean(kept), "the page keeps its image", `${figures} images on the page; saved ${Boolean(kept)}`);
    if ((await card.locator(".note-body").count()) === 0) {
      await card.locator('button[data-track="note-collapse"]').first().evaluate((el) => el.click());
      await sleep(600);
    }
    const painted = await until(() => card.evaluate((el) => [...el.querySelectorAll("img")].some((i) => i.complete && i.naturalWidth > 0)), 10_000);
    check(G, Boolean(painted), "the note shows the image");
    await shot(page, "imagenote-1-stored");

    // 2. An image from a site that lets the browser read it: stored for the note.
    const before2 = posts.length;
    await dragImage(page, "Open site", card);
    text = await until(async () => ((await content()).includes("![Open site]") ? content() : null), 15_000);
    const copied = /!\[Open site\]\(\/api\/images\/([a-z0-9]+)\)$/.exec(text ?? "")?.[1];
    check(G, Boolean(copied) && copied !== stored.id && posts.length === before2 + 1, "an image from a site that lets the browser read it is stored for the note", `${JSON.stringify((text ?? "").split("\n").pop())}; uploads ${posts.length - before2}`);

    // 3. An image the browser may not read: the note says so and stays as it was.
    const before3 = await content();
    await dragImage(page, "Closed site", card);
    const said = await until(() => card.evaluate((el) => el.textContent.includes("Unitos could not read this image")), 15_000);
    await shot(page, "imagenote-3-refused");
    check(G, Boolean(said) && (await content()) === before3, "an image the browser may not read is refused with a plain message", `message ${Boolean(said)}; note unchanged ${(await content()) === before3}`);

    // 4. In Viewing, the page cannot change, and the note still takes the image.
    await setMode(page, "viewing");
    const before4 = await content();
    await dragImage(page, "Counts by station", card);
    const viewed = await until(async () => ((await content()) !== before4 ? content() : null), 10_000);
    const imagesAfter = await page.evaluate(() => document.querySelectorAll(".docs-prose figure.docs-img").length);
    check(G, (viewed ?? "").endsWith(`![Counts by station](/api/images/${stored.id})`) && imagesAfter === 3, "in Viewing an image dragged onto a note goes into the note, and the page stays as it was", `${JSON.stringify((viewed ?? "").split("\n").pop())}; ${imagesAfter} images on the page`);
    await setMode(page, "editing");

    // 5. Inside the page the drag still moves the image, and no note changes:
    // the last image goes to the end of the last paragraph, both in view.
    const before5 = await content();
    await page.evaluate(() => [...document.querySelectorAll(".docs-prose p")].find((e) => e.textContent.startsWith("The east")).scrollIntoView({ block: "center" }));
    await sleep(400);
    const last = await wordsBox(page, "The east station");
    const from = await page.evaluate(() => {
      const img = [...document.querySelectorAll(".docs-prose figure.docs-img img")].find((i) => i.alt === "Closed site");
      const r = img.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await page.mouse.click(from.x, from.y);
    await sleep(300);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 20, from.y + 10, { steps: 5 });
    await page.mouse.move(last.right - 2, last.y, { steps: 25 });
    await sleep(300);
    await page.mouse.up();
    await sleep(800);
    const order = await page.evaluate(() => {
      const out = [];
      window.__docsEditor.state.doc.forEach((n) => out.push(n.type.name === "image" ? `image(${n.attrs.alt})` : n.textContent.split(" ").slice(0, 2).join(" ")));
      return out.join(" | ");
    });
    const moved = order.indexOf("image(Closed site)") > order.indexOf("The east");
    check(G, moved && order.split("image(").length - 1 === 3 && (await content()) === before5, "a drag inside the page still moves the image, and no note changes", order);
    await shot(page, "imagenote-5-moved-in-page");
    check(G, errors.length === 0, "no page errors", errors.slice(0, 2).join(" | "));
    await close();
  } finally {
    server.close();
  }
};

// ── Add to dictionary, Ignore all, Personal dictionary ─────────────────────

/** The middle of the first place `word` stands in the page. */
async function wordPoint(page, word) {
  return page.evaluate((word) => {
    const walker = document.createTreeWalker(document.querySelector(".docs-prose"), NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const i = n.textContent.indexOf(word);
      if (i < 0) continue;
      const r = document.createRange();
      r.setStart(n, i);
      r.setEnd(n, i + word.length);
      const b = r.getBoundingClientRect();
      return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    }
    return null;
  }, word);
}
/** The right-click menu's rows on `word`, once its spelling rows had the time to join. */
async function menuRows(page, word) {
  const at = await wordPoint(page, word);
  await page.mouse.click(at.x, at.y, { button: "right" });
  await until(() => page.evaluate(() => [...document.querySelectorAll(".docs-context-menu [role='menuitem']")].some((e) => /Add to dictionary/.test(e.textContent))), 2500, 150);
  return page.evaluate(() => [...document.querySelectorAll(".docs-context-menu [role='menuitem']")].map((e) => e.textContent.trim()));
}
async function pickRow(page, word, label) {
  await menuRows(page, word);
  await page.locator(".docs-context-menu [role='menuitem']", { hasText: label }).first().click();
  await sleep(400);
}
/** The words the page tells the browser not to check. */
const unchecked = (page) => page.evaluate(() => [...document.querySelectorAll('.docs-prose [spellcheck="false"]')].map((e) => e.textContent));
/** Ctrl+' from the start of the page: the words it selects, in order. */
async function misspellingsFromStart(page, n) {
  await page.keyboard.press("Control+Home");
  await sleep(200);
  const out = [];
  for (let i = 0; i < n; i++) {
    await page.keyboard.press("Control+'");
    await sleep(400);
    out.push(await page.evaluate(() => {
      const { from, to } = window.__docsEditor.state.selection;
      return window.__docsEditor.state.doc.textBetween(from, to);
    }));
  }
  return out;
}

GROUPS.SPELLING = async () => {
  const G = "SPELLING";
  const first = await blankDocument("Spelling one", ["Unitos keeps every note beside its source.", "The crew counted birds at Wexcombe before noon.", "Teh count from Unitos is due on Friday.", "The code name is Qqqqzzz."]);
  const second = await blankDocument("Spelling two", ["Wexcombe again, and Unitos again."]);
  const { page, errors, close } = await newPage();
  await openEditor(page, first, "Qqqqzzz");
  await sleep(600);

  // 1. The menu on a misspelled word: its suggestions, then Add to dictionary and Ignore all.
  let rows = await menuRows(page, "Wexcombe");
  await shot(page, "spelling-1-menu");
  await page.keyboard.press("Escape");
  const at = (label) => rows.findIndex((r) => r === label);
  check(G, at("Add to dictionary") > 0 && at("Ignore all") === at("Add to dictionary") + 1 && rows.indexOf("Welcome") >= 0 && rows.indexOf("Welcome") < at("Add to dictionary"), "a misspelled word offers its suggestions, then Add to dictionary and Ignore all", JSON.stringify(rows.slice(0, 4)));
  rows = await menuRows(page, "Qqqqzzz");
  await page.keyboard.press("Escape");
  check(G, rows[0] === "Add to dictionary" && rows[1] === "Ignore all", "a word the dictionary has no suggestion for still offers Add to dictionary and Ignore all", JSON.stringify(rows.slice(0, 3)));
  const before = await misspellingsFromStart(page, 3);
  check(G, before.includes("Unitos") && before.includes("Wexcombe"), "before: the next misspelling stops at both unknown words", JSON.stringify(before));

  // 2. Add to dictionary: every place the word stands, now and typed later.
  await pickRow(page, "Unitos", "Add to dictionary");
  let spans = await unchecked(page);
  rows = await menuRows(page, "Unitos");
  await page.keyboard.press("Escape");
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("unitos-docs-typing") ?? "{}").dictionary ?? []);
  check(G, spans.filter((w) => w === "Unitos").length === 2 && !rows.includes("Add to dictionary") && stored.includes("Unitos"), "Add to dictionary: the page stops checking the word everywhere, and the menu offers nothing for it", `unchecked ${JSON.stringify(spans)}; rows ${JSON.stringify(rows.slice(0, 2))}; stored ${JSON.stringify(stored)}`);
  const end = await wordPoint(page, "noon.");
  await page.mouse.click(end.x + 30, end.y);
  await page.keyboard.press("End");
  await page.keyboard.type(" Unitos counted too.");
  await sleep(400);
  spans = await unchecked(page);
  check(G, spans.filter((w) => w === "Unitos").length === 3, "a word typed after it was added is not checked either", JSON.stringify(spans));

  // 3. Ignore all: this document only.
  await pickRow(page, "Wexcombe", "Ignore all");
  spans = await unchecked(page);
  const next = await misspellingsFromStart(page, 2);
  await shot(page, "spelling-3-after-add-and-ignore");
  check(G, spans.includes("Wexcombe") && next[0] === "Teh", "Ignore all: the page stops checking the word, and the next misspelling passes both words", `unchecked ${JSON.stringify(spans)}; next ${JSON.stringify(next)}`);
  await openEditor(page, second, "again.");
  await sleep(600);
  spans = await unchecked(page);
  rows = await menuRows(page, "Wexcombe");
  await page.keyboard.press("Escape");
  check(G, spans.includes("Unitos") && !spans.includes("Wexcombe") && rows.includes("Ignore all"), "in another document the dictionary holds and the ignored word does not", `unchecked ${JSON.stringify(spans)}; rows ${JSON.stringify(rows.slice(0, 3))}`);

  // 4. The Personal dictionary dialog: add a word, remove one.
  await openEditor(page, first, "Qqqqzzz");
  await sleep(600);
  await clickIn(page, "The code");
  await page.keyboard.press("Alt+/");
  await sleep(300);
  await page.keyboard.type("personal dictionary", { delay: 30 });
  await sleep(500);
  await page.keyboard.press("Enter");
  const dialog = page.locator(".docs-dictionary");
  await dialog.waitFor({ state: "visible", timeout: 10_000 });
  const listed = await dialog.locator(".docs-dictionary-row").allTextContents();
  await dialog.locator('[data-track="docs:dictionary:word"]').fill("Qqqqzzz");
  await page.keyboard.press("Enter");
  await sleep(300);
  await dialog.locator(".docs-dictionary-row", { hasText: "Unitos" }).locator('[data-track="docs:dictionary:remove"]').click();
  await sleep(300);
  const after = await dialog.locator(".docs-dictionary-row").allTextContents();
  await shot(page, "spelling-4-dialog");
  check(G, listed.join() === "Unitos" && after.join() === "Qqqqzzz", "the dialog lists the words, adds one, and removes one", `${JSON.stringify(listed)} → ${JSON.stringify(after)}`);
  await dialog.getByRole("button", { name: "OK" }).click();
  await sleep(400);
  spans = await unchecked(page);
  rows = await menuRows(page, "Unitos");
  await page.keyboard.press("Escape");
  check(G, spans.includes("Qqqqzzz") && !spans.includes("Unitos") && rows.includes("Add to dictionary"), "the page follows the dialog: the added word is not checked, the removed one is again", `unchecked ${JSON.stringify(spans)}; rows ${JSON.stringify(rows.slice(0, 2))}`);

  // 5. After a reload: the dictionary and the document's ignored words hold.
  await openEditor(page, first, "Qqqqzzz");
  await sleep(600);
  spans = await unchecked(page);
  check(G, spans.includes("Qqqqzzz") && spans.includes("Wexcombe") && !spans.includes("Unitos"), "after a reload the dictionary and the ignored words hold", JSON.stringify(spans));
  check(G, errors.length === 0, "no page errors", errors.slice(0, 2).join(" | "));
  await close();
};

// ── Insert > Chart ──────────────────────────────────────────────────────────

/** The chart images of the page: their data, address, size, and alt text. */
async function charts(page) {
  return page.evaluate(() => {
    const out = [];
    window.__docsEditor.state.doc.descendants((node, pos) => {
      if (node.type.name !== "image" || !node.attrs.chart) return true;
      out.push({ pos, chart: JSON.parse(node.attrs.chart), src: node.attrs.src, alt: node.attrs.alt, width: node.attrs.width, height: node.attrs.height, suggested: node.marks.some((m) => m.type.name === "insertion") });
      return false;
    });
    return out;
  });
}
const chartDialog = (page) => page.locator(".docs-chart-dialog");
/** The dialog's data as it stands: labels, series names, and values. */
async function dialogData(page) {
  const d = chartDialog(page);
  return {
    labels: await d.locator('[data-track="docs:chart:label"]').evaluateAll((els) => els.map((e) => e.value)),
    series: await d.locator('[data-track="docs:chart:series"]').evaluateAll((els) => els.map((e) => e.value)),
    values: await d.locator('[data-track="docs:chart:value"]').evaluateAll((els) => els.map((e) => e.value)),
    type: await d.locator('[aria-pressed="true"][data-track^="docs:chart:type:"]').getAttribute("data-track"),
  };
}
/** The caret in the table's cell that holds `text`, as a person puts it
    there: a click, again while the page is still coming to life. */
async function caretInCell(page, text) {
  for (let i = 0; i < 4; i++) {
    const at = await page.evaluate((text) => {
      const td = [...document.querySelectorAll(".docs-prose td, .docs-prose th")].find((c) => c.textContent.trim() === text);
      const r = td.getBoundingClientRect();
      return { x: r.left + 20, y: r.top + r.height / 2 };
    }, text);
    await page.mouse.click(at.x, at.y);
    const inside = await until(() => page.evaluate((text) => window.__docsEditor.state.selection.$from.parent.textContent === text, text), 1500, 100);
    if (inside) return true;
    await sleep(500);
  }
  return false;
}

GROUPS.CHART = async () => {
  const G = "CHART";
  const cell = (text) => ({ type: "tableCell", attrs: {}, content: [paragraph(text)] });
  const table = { type: "table", content: [["Station", "Spring", "Autumn"], ["East", "12", "18"], ["North", "30", "26"], ["West", "21", "24"]].map((r) => ({ type: "tableRow", content: r.map(cell) })) };
  const id = await richDocument("Chart", [paragraph("Birds counted at the three stations."), table, paragraph("The north station counted the most.")]);
  const { page, errors, close } = await newPage();
  await openEditor(page, id, "the most");

  // 1. Search the menus has the four charts (read, not run).
  await caretInCell(page, "North");
  await page.keyboard.press("Alt+/");
  await sleep(300);
  await page.keyboard.type("chart", { delay: 40 });
  await sleep(500);
  const rows = await page.evaluate(() => [...document.querySelectorAll("[data-docs-menu] [role='option']")].map((e) => e.textContent));
  await page.keyboard.press("Escape");
  check(G, ["Column chart", "Bar chart", "Line chart", "Pie chart"].every((name) => rows.some((r) => r.startsWith(name))), "Search the menus finds the column, bar, line, and pie charts", JSON.stringify(rows));
  await sleep(300);

  // 2. The table's right-click menu offers Chart from this table.
  await caretInCell(page, "West");
  const cellAt = await page.evaluate(() => {
    const td = [...document.querySelectorAll(".docs-prose td")].find((c) => c.textContent.trim() === "West");
    const r = td.getBoundingClientRect();
    return { x: r.left + 20, y: r.top + r.height / 2 };
  });
  await page.mouse.click(cellAt.x, cellAt.y, { button: "right" });
  const fromMenu = page.locator(".docs-context-menu [role='menuitem']", { hasText: "Chart from this table" }).first();
  const inMenu = await fromMenu.waitFor({ state: "visible", timeout: 5000 }).then(() => true, () => false);
  await shot(page, "chart-2-table-menu");
  if (inMenu) await fromMenu.click();
  const opened = await chartDialog(page).waitFor({ state: "visible", timeout: 5000 }).then(() => true, () => false);
  const menuData = opened ? await dialogData(page) : null;
  check(G, inMenu && opened && menuData?.labels.join() === "East,North,West", "a table's right-click menu offers Chart from this table, with the table's data", JSON.stringify(menuData));
  if (opened) {
    await page.keyboard.press("Escape");
    await chartDialog(page).waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
  }

  // 3. From the table the caret is in: the dialog takes its words and numbers.
  await caretInCell(page, "North");
  await searchMenus(page, "column chart");
  await chartDialog(page).waitFor({ state: "visible", timeout: 10_000 });
  const data = await dialogData(page);
  check(G, data.labels.join() === "East,North,West" && data.series.join() === "Spring,Autumn" && data.values.join() === "12,18,30,26,21,24" && data.type === "docs:chart:type:column", "from a table: the labels, the series, and the values are the table's", JSON.stringify(data));
  await shot(page, "chart-3-dialog-from-table");

  // 4. Insert: a chart image under the table that keeps its data.
  await chartDialog(page).locator('[data-track="docs:chart:insert"]').click();
  await chartDialog(page).waitFor({ state: "hidden", timeout: 20_000 });
  await page.waitForFunction(() => [...document.querySelectorAll(".docs-prose figure.docs-img img")].some((i) => i.complete && i.naturalWidth > 0), null, { timeout: 20_000 }).catch(() => {});
  let found = await charts(page);
  const order = await page.evaluate(() => {
    const out = [];
    window.__docsEditor.state.doc.forEach((n) => out.push(n.type.name));
    return out.join(" ");
  });
  const painted = await page.evaluate(() => document.querySelector(".docs-prose figure.docs-img img")?.naturalWidth ?? 0);
  const one = found[0];
  check(G, found.length === 1 && /^\/api\/images\//.test(one.src) && one.width === 600 && one.height === 371 && one.alt === "Column chart" && one.chart.series[0].values.join() === "12,30,21", "Insert puts the chart in the page as an image that keeps its data", JSON.stringify(one));
  check(G, /^paragraph table image/.test(order) && painted === 1200, "the chart lands under the table and its picture loads", `${order}; naturalWidth ${painted}`);
  await page.mouse.click(10, 880);
  await shot(page, "chart-4-in-page");

  // 5. Undo takes it out in one step; Redo puts it back.
  await clickIn(page, "Birds counted");
  await page.keyboard.press("Control+z");
  await sleep(300);
  const undone = (await charts(page)).length;
  await page.keyboard.press("Control+y");
  await sleep(300);
  check(G, undone === 0 && (await charts(page)).length === 1, "Undo takes the chart out in one step, Redo puts it back", `after undo ${undone}`);

  // 6. The image's bar and its right-click menu offer Edit chart on a chart.
  const img = await page.locator(".docs-prose figure.docs-img img").first().boundingBox();
  await page.mouse.click(img.x + img.width / 2, img.y + img.height / 2);
  const barButton = page.locator('.docs-img-toolbar [aria-label="Edit chart"]');
  const offered = await barButton.waitFor({ state: "visible", timeout: 5000 }).then(() => true, () => false);
  if (offered) await barButton.click();
  const fromBar = await chartDialog(page).waitFor({ state: "visible", timeout: 5000 }).then(() => true, () => false);
  await shot(page, "chart-6-bar-button");
  check(G, offered && fromBar, "the image's bar offers Edit chart on a chart, and it opens the chart's data");
  if (fromBar) {
    await page.keyboard.press("Escape");
    await chartDialog(page).waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
  }
  await page.mouse.click(img.x + img.width / 2, img.y + img.height / 2, { button: "right" });
  const editRow = await page.locator(".docs-context-menu [role='menuitem']", { hasText: "Edit chart" }).first().waitFor({ state: "visible", timeout: 5000 }).then(() => true, () => false);
  await page.keyboard.press("Escape");
  await sleep(300);
  check(G, editRow, "a chart's right-click menu offers Edit chart");

  // 7. A double-click edits it: another type, a chart title, a changed value.
  await page.mouse.dblclick(img.x + img.width / 2, img.y + img.height / 2);
  await chartDialog(page).waitFor({ state: "visible", timeout: 10_000 });
  const title = await chartDialog(page).locator("h2").textContent();
  await chartDialog(page).locator('[data-track="docs:chart:type:pie"]').click();
  await chartDialog(page).locator('[data-track="docs:chart:title"]').fill("Spring counts");
  await chartDialog(page).locator('[data-track="docs:chart:value"]').nth(2).fill("35");
  await shot(page, "chart-7-edit");
  await chartDialog(page).locator('[data-track="docs:chart:insert"]').click();
  await chartDialog(page).waitFor({ state: "hidden", timeout: 20_000 });
  await sleep(500);
  found = await charts(page);
  const edited = found[0];
  check(G, title === "Edit chart" && found.length === 1 && edited.chart.type === "pie" && edited.chart.title === "Spring counts" && edited.chart.series[0].values.join() === "12,35,21" && edited.src !== one.src && edited.alt === "Pie chart: Spring counts", "a double-click opens Edit chart, and Update draws the chart again in its place", `${title}; ${JSON.stringify(edited)}`);

  // 8. Saved, and the same after a reload.
  const ok = await saved(page);
  await openEditor(page, id, "the most");
  const reloaded = await charts(page);
  check(G, Boolean(ok) && reloaded.length === 1 && reloaded[0].chart.type === "pie" && reloaded[0].chart.title === "Spring counts", "saved, and after a reload the chart keeps its data", JSON.stringify(reloaded[0]?.chart ?? null));

  // 9. Outside a table: the dialog starts from three rows to type over.
  await clickIn(page, "The north");
  await page.keyboard.press("End");
  await searchMenus(page, "bar chart");
  await chartDialog(page).waitFor({ state: "visible", timeout: 10_000 });
  const fresh = await dialogData(page);
  check(G, fresh.labels.join() === "Item 1,Item 2,Item 3" && fresh.series.join() === "Series 1" && fresh.type === "docs:chart:type:bar", "outside a table the dialog starts from three rows to type over", JSON.stringify(fresh));
  await chartDialog(page).locator('[data-track="docs:chart:add-row"]').click();
  await chartDialog(page).locator('[data-track="docs:chart:label"]').nth(3).fill("Item 4");
  await chartDialog(page).locator('[data-track="docs:chart:value"]').nth(3).fill("8");
  await chartDialog(page).locator('[data-track="docs:chart:insert"]').click();
  await chartDialog(page).waitFor({ state: "hidden", timeout: 20_000 });
  await sleep(500);
  found = await charts(page);
  check(G, found.length === 2 && found[1].chart.type === "bar" && found[1].chart.labels.length === 4 && found[1].chart.series[0].values[3] === 8, "a row added in the dialog is in the chart", JSON.stringify(found[1]?.chart ?? null));

  // 10. The Word download holds both charts as pictures.
  await saved(page);
  const docx = await page.request.get(`${BASE}/api/documents/${id}/export?format=docx`);
  const media = docx.ok() ? Object.keys(unzipSync(new Uint8Array(await docx.body()))).filter((name) => name.startsWith("word/media/")) : [];
  check(G, media.length >= 2, "the Word download holds the charts as pictures", `HTTP ${docx.status()}; ${media.join(", ")}`);

  // 11. In Suggesting a new chart is a suggestion.
  await setMode(page, "suggesting");
  await clickIn(page, "Birds counted");
  await page.keyboard.press("End");
  await searchMenus(page, "line chart");
  await chartDialog(page).waitFor({ state: "visible", timeout: 10_000 });
  await chartDialog(page).locator('[data-track="docs:chart:insert"]').click();
  await chartDialog(page).waitFor({ state: "hidden", timeout: 20_000 });
  await sleep(500);
  found = await charts(page);
  const line = found.find((c) => c.chart.type === "line");
  check(G, Boolean(line?.suggested), "in Suggesting a new chart is a suggestion", JSON.stringify(found.map((c) => [c.chart.type, c.suggested])));
  await shot(page, "chart-11-suggested");

  // 12. In Viewing a double-click opens nothing.
  await setMode(page, "viewing");
  const pie = await page.locator(".docs-prose figure.docs-img img").first().boundingBox();
  await page.mouse.dblclick(pie.x + pie.width / 2, pie.y + pie.height / 2);
  await sleep(600);
  check(G, (await chartDialog(page).count()) === 0, "in Viewing a double-click on a chart opens nothing");
  check(G, errors.length === 0, "no page errors", errors.slice(0, 2).join(" | "));
  await close();
};

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const nb = await api("/api/notebooks", "POST", { title: `QA docs parity ${STAMP}` });
  if (!nb.body?.id) throw new Error(`project: HTTP ${nb.status}`);
  ctx.notebookId = nb.body.id;
  console.log(`project ${ctx.notebookId} · shots in ${SHOT}`);
  browser = await chromium.launch({ executablePath: CHROME });
  for (const name of Object.keys(GROUPS)) {
    if (ONLY.size && !ONLY.has(name)) continue;
    try {
      await GROUPS[name]();
    } catch (err) {
      record("FAIL", name, "crashed", String(err?.stack ?? err).split("\n").slice(0, 3).join(" | "));
    }
  }
}

main()
  .catch((err) => record("FAIL", "RUN", "crashed", String(err?.stack ?? err).split("\n").slice(0, 3).join(" | ")))
  .finally(async () => {
    const n = (level) => results.filter((r) => r.level === level).length;
    console.log(`\n${n("PASS")} passed, ${n("FAIL")} failed`);
    writeFileSync(join(SHOT, `results-${STAMP}.json`), JSON.stringify(results, null, 1));
    await browser?.close().catch(() => {});
    if (!KEEP) {
      for (const id of ctx.documents) await api(`/api/documents/${id}`, "DELETE").catch(() => {});
      if (ctx.notebookId) await api(`/api/notebooks/${ctx.notebookId}`, "DELETE").catch(() => {});
    }
    await db.$disconnect();
    process.exit(n("FAIL") > 0 ? 1 : 0);
  });
