// UI walk of images and GIFs dropped or pasted into the reader (SPEC.md §16,
// §29): a blank document and an import in the page editor, in Editing,
// Suggesting, and Viewing, and a document in the block reader. Every drag is
// the browser's own (CDP Input.dispatchDragEvent), so the page answers it as
// it answers a person's: a file from the computer (png, jpg, gif, webp), a
// file that is not an image, a file past the size rule, and a picture
// dragged from another page (its address and its <img>, no file; one site
// lets the browser read it, one does not). A paste is a ClipboardEvent that
// holds the file. TOAST checks that the reader's toast never sits under the
// Contents button. Each check prints PASS or FAIL with its evidence; every
// case leaves a screenshot (light theme, 1440×900).
//
// Usage:
//   node scripts/qa/ui-page-drop.mjs [BLANK IMPORT SUGGEST VIEW BLOCK TOAST] [--label after] [--keep]
// With no group named, every group runs. --label names the screenshots'
// folder under SHOT_DIR (default "run"). Env: BASE (default
// http://localhost:3111), SHOT_DIR (default <tmp>/ui-page-drop), CHROME
// (default /opt/pw-browsers/chromium), FIXTURE_PORT (default 3491),
// DATABASE_URL (read from .env when unset). Expects the dev server with
// sign-in off. The walk turns the Imports switch on for its run and puts it
// back; the project it makes is deleted at the end unless --keep.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { PrismaClient } from "@prisma/client";
import { chromium } from "playwright-core";

// ── Configuration ───────────────────────────────────────────────────────────

const ROOT = process.cwd();
if (!process.env.DATABASE_URL && existsSync(join(ROOT, ".env"))) {
  const m = /^DATABASE_URL="?([^"\n]+)"?/m.exec(readFileSync(join(ROOT, ".env"), "utf8"));
  if (m) process.env.DATABASE_URL = m[1];
}
const BASE = process.env.BASE ?? "http://localhost:3111";
const CHROME = process.env.CHROME ?? "/opt/pw-browsers/chromium";
const FIXTURE_PORT = Number(process.env.FIXTURE_PORT ?? 3491);
const FIXTURE = `http://localhost:${FIXTURE_PORT}`;
const args = process.argv.slice(2);
const LABEL = args.includes("--label") ? args[args.indexOf("--label") + 1] : "run";
const KEEP = args.includes("--keep");
const ONLY = new Set(args.filter((a, i) => /^[A-Z]+$/.test(a) && args[i - 1] !== "--label"));
const SHOT = join(process.env.SHOT_DIR ?? join(tmpdir(), "ui-page-drop"), LABEL);
const FILES = join(SHOT, "files");
const STAMP = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
mkdirSync(FILES, { recursive: true });

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

// ── Fixtures ────────────────────────────────────────────────────────────────

// A 48×48 GIF of two frames, 300 ms each, looping: clay, then sage.
const GIF = Buffer.from(
  "R0lGODlhMAAwAIAAAExpccR4WiH/C05FVFNDQVBFMi4wAwEAAAAh+QQFHgAAACwAAAAAMAAwAAACMYyPqcvtD6OctNqLs968+w+G4kiW5omm6sq27gvH8kzX9o3n+s73/g8MCofEovHoKQAAIfkEBR4AAAAsAAAAADAAMACATGlxWoxuAjGMj6nL7Q+jnLTai7PevPsPhuJIluaJpurKtu4Lx/JM1/aN5/rO9/4PDAqHxKLx6CkAADs=",
  "base64",
);
function picture(type, w, h, color) {
  const c = createCanvas(w, h);
  const g = c.getContext("2d");
  g.fillStyle = color;
  g.fillRect(0, 0, w, h);
  g.fillStyle = "#ffffff";
  g.fillRect(Math.round(w / 8), Math.round(h / 4), Math.round(w / 4), Math.round(h / 2));
  return c.toBuffer(type);
}
const FIXTURES = {
  png: { name: "clay.png", bytes: picture("image/png", 160, 90, "#c4785a"), width: 160 },
  jpg: { name: "sand.jpg", bytes: picture("image/jpeg", 200, 100, "#b89b72"), width: 200 },
  gif: { name: "blink.gif", bytes: GIF, width: 48 },
  webp: { name: "sage.webp", bytes: picture("image/webp", 120, 80, "#5a8c6e"), width: 120 },
  pdf: { name: "notes.pdf", bytes: Buffer.from("%PDF-1.4\n%%EOF\n"), width: 0 },
};
const CLOSED = picture("image/png", 140, 70, "#6a7fa0");
const path = (kind) => join(FILES, FIXTURES[kind].name);
for (const kind of Object.keys(FIXTURES)) writeFileSync(path(kind), FIXTURES[kind].bytes);
// Past the 25 MB rule: a PNG's first bytes, then zeros.
const BIG = join(FILES, "huge.png");
if (!existsSync(BIG)) writeFileSync(BIG, Buffer.concat([FIXTURES.png.bytes, Buffer.alloc(26 * 1024 * 1024)]));

/** Another site: a GIF the browser may read (it allows any origin), and a
    PNG it may not (no such header). */
function serveFixtures() {
  const server = createServer((req, res) => {
    const url = new URL(req.url, FIXTURE);
    if (url.pathname === "/open.gif") {
      res.writeHead(200, { "content-type": "image/gif", "access-control-allow-origin": "*" });
      res.end(GIF);
    } else if (url.pathname === "/closed.png") {
      res.writeHead(200, { "content-type": "image/png" });
      res.end(CLOSED);
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  return new Promise((resolve) => server.listen(FIXTURE_PORT, () => resolve(server)));
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
const PARAGRAPHS = [
  "The first paragraph opens the page.",
  "The second paragraph is where the images land when they are dropped on its words.",
  "The third paragraph closes the page.",
];

const ctx = { notebookId: null, importsWas: undefined, server: null, documents: [] };

async function blankDocument(title) {
  const blank = await api("/api/documents/blank", "POST", { notebookId: ctx.notebookId, title });
  const rt = await api(`/api/documents/${blank.body.id}/rich-text`);
  const para = (text) => ({ type: "paragraph", attrs: { blockId: blockId() }, content: [{ type: "text", text }] });
  const doc = { type: "doc", content: PARAGRAPHS.map(para) };
  const put = await api(`/api/documents/${blank.body.id}/rich-text`, "PUT", { richText: doc, rev: rt.body.rev });
  if (put.status !== 200) throw new Error(`blank document: HTTP ${put.status}`);
  ctx.documents.push(blank.body.id);
  return blank.body.id;
}

async function importDocument(tag) {
  const form = new FormData();
  form.set("notebookId", ctx.notebookId);
  const md = `# Drop notes ${STAMP} ${tag}\n\n${PARAGRAPHS.join("\n\n")}\n`;
  form.set("file", new File([md], `drop-${STAMP}-${tag}.md`, { type: "text/markdown" }));
  const res = await fetch(`${BASE}/api/documents`, { method: "POST", body: form });
  const lines = (await res.text()).split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const added = lines.findLast((l) => l.id || l.error);
  if (!added?.id) throw new Error(`import: ${added?.error ?? res.status}`);
  const row = await db.document.findUnique({ where: { id: added.id }, select: { richText: true, importRev: true } });
  ctx.documents.push(added.id);
  if (!row?.richText || row.importRev === null) throw new Error("import: not an import (is the Imports switch on?)");
  return added.id;
}

async function blockDocument(tag) {
  const doc = await db.document.create({
    data: {
      title: `Block drop ${STAMP} ${tag}`,
      blocks: { create: ["The first block of the article.", "The second block, where an image is dropped.", "The third block ends the article."].map((text, i) => ({ order: i, type: "PARAGRAPH", text })) },
    },
  });
  await db.notebookDocument.create({ data: { notebookId: ctx.notebookId, documentId: doc.id } });
  ctx.documents.push(doc.id);
  return doc.id;
}

async function prepare() {
  const was = await db.appSetting.findUnique({ where: { key: "imports" } });
  ctx.importsWas = was?.value ?? null;
  await db.appSetting.upsert({ where: { key: "imports" }, create: { key: "imports", value: "on" }, update: { value: "on" } });
  ctx.server = await serveFixtures();
  const nb = await api("/api/notebooks", "POST", { title: `QA page drop ${STAMP}` });
  if (!nb.body?.id) throw new Error(`project: HTTP ${nb.status}`);
  ctx.notebookId = nb.body.id;
  console.log(`project ${ctx.notebookId} · shots in ${SHOT}`);
}

// ── The browser ─────────────────────────────────────────────────────────────

let browser;
async function newPage({ width = 1440, height = 900 } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, colorScheme: "light" });
  context.setDefaultTimeout(60_000);
  context.setDefaultNavigationTimeout(120_000);
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  const posts = [];
  page.on("request", (r) => {
    const u = r.url();
    if (u.startsWith(BASE) && r.method() !== "GET" && !/\/api\/(clicks|funnel|active)/.test(u)) posts.push(`${r.method()} ${u.replace(BASE, "").split("?")[0]}`);
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // Every toast the page editor raises, and the reader's toast as drawn.
  await context.addInitScript(() => {
    window.__toasts = [];
    window.addEventListener("dissect:toast", (e) => window.__toasts.push(e.detail?.text ?? ""));
  });
  return { page, cdp, posts, errors, close: () => context.close() };
}

async function shot(page, name) {
  const file = join(SHOT, `${name}.png`);
  await page.screenshot({ path: file });
  return file;
}

async function openEditor(page, documentId) {
  await page.goto(`${BASE}/n/${ctx.notebookId}?doc=${documentId}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__docsEditor) && !window.__docsEditor.isDestroyed && document.querySelector(".docs-prose")?.textContent.includes("first paragraph"), null, { timeout: 120_000 });
  await sleep(800);
}

async function mode(page) {
  return page.evaluate(() => document.querySelector('[data-track="docs:mode"]')?.getAttribute("data-mode") ?? null);
}
async function setMode(page, to) {
  await page.click('[data-track="docs:mode"]');
  await page.locator(`[data-track="docs:mode:${to}"]`).click();
  await page.waitForFunction((m) => document.querySelector('[data-track="docs:mode"]')?.getAttribute("data-mode") === m, to, { timeout: 10_000 });
  await sleep(300);
}

/** A drag from outside the page to (x, y), as the browser delivers it:
    dragEnter, dragOver, then the drop (or a cancel, `drop: false`). */
async function drag(cdp, x, y, data, { drop = true } = {}) {
  await cdp.send("Input.dispatchDragEvent", { type: "dragEnter", x, y, data });
  await cdp.send("Input.dispatchDragEvent", { type: "dragOver", x, y, data });
  await sleep(120);
  await cdp.send("Input.dispatchDragEvent", { type: "dragOver", x, y, data });
  if (drop) await cdp.send("Input.dispatchDragEvent", { type: "drop", x, y, data });
}
async function cancel(cdp, x, y, data) {
  await cdp.send("Input.dispatchDragEvent", { type: "dragCancel", x, y, data });
}
const fileDrag = (...files) => ({ items: [], files, dragOperationsMask: 1 });
const pageDrag = (url, alt = "") => ({
  items: [
    { mimeType: "text/uri-list", data: url },
    { mimeType: "text/html", data: `<img src="${url}" alt="${alt}">` },
  ],
  dragOperationsMask: 3,
});

/** A paste of `kind`'s file at the focus, as the browser raises it. */
async function paste(page, kind) {
  const f = FIXTURES[kind];
  return page.evaluate(
    ({ b64, name, type }) => {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], name, { type }));
      const target = document.activeElement ?? document.body;
      const ev = new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: dt });
      target.dispatchEvent(ev);
      return { target: target.tagName, taken: ev.defaultPrevented };
    },
    { b64: f.bytes.toString("base64"), name: f.name, type: `image/${kind === "jpg" ? "jpeg" : kind}` },
  );
}

/** The page editor's document as a row of its top blocks: p(first words),
    img(where its address points), and what the images carry. */
async function shape(page) {
  return page.evaluate(() => {
    const ed = window.__docsEditor;
    const parts = [];
    const images = [];
    ed.state.doc.forEach((n) => {
      if (n.type.name === "image") {
        const src = String(n.attrs.src);
        parts.push(`img(${src.startsWith("/api/images/") ? "stored" : src.startsWith("blob:") ? "blob" : src})`);
        images.push({ src, marks: n.marks.map((m) => m.type.name) });
      } else parts.push(n.type.name === "paragraph" ? `p(${n.textContent.split(" ").slice(0, 2).join(" ")})` : n.type.name);
    });
    return { row: parts.join(" "), images };
  });
}

/** Watch the page for the images a drop puts in: every address an image
    shows, and whether one drew as uploading. */
async function watchImages(page) {
  await page.evaluate(() => {
    const seen = { srcs: [], uploading: false };
    window.__seen = seen;
    const prose = document.querySelector(".docs-prose");
    const look = () => {
      for (const img of prose.querySelectorAll("figure.docs-img img")) if (!seen.srcs.includes(img.src)) seen.srcs.push(img.src);
      if (prose.querySelector("figure.docs-img-uploading")) seen.uploading = true;
    };
    window.__seenObserver?.disconnect();
    window.__seenObserver = new MutationObserver(look);
    window.__seenObserver.observe(prose, { subtree: true, childList: true, attributes: true, attributeFilter: ["src", "class"] });
  });
}
const seen = (page) => page.evaluate(() => window.__seen);

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

/** A point on the words of the paragraph that starts with `words`, at `at`
    of its first line's width. */
async function wordsPoint(page, words, at = 0.5) {
  return page.evaluate(
    ({ words, at }) => {
      const p = [...document.querySelectorAll(".docs-prose p")].find((e) => e.textContent.startsWith(words));
      const range = document.createRange();
      range.selectNodeContents(p);
      const line = range.getClientRects()[0];
      return { x: line.left + line.width * at, y: (line.top + line.bottom) / 2 };
    },
    { words, at },
  );
}

async function toasts(page) {
  return page.evaluate(() => [...window.__toasts]);
}
async function readerToast(page) {
  return page.evaluate(() => document.querySelector("[data-reader-toast]")?.textContent ?? "");
}

async function imageBytes(page, src) {
  const res = await page.request.get(`${BASE}${src}`);
  return { type: res.headers()["content-type"], bytes: await res.body() };
}

/** The GIF plays: its picture on the page changes between frames. */
async function plays(page, src) {
  const img = page.locator(`.docs-prose img[src="${src}"], article img[src="${src}"]`).first();
  const shots = [];
  for (let i = 0; i < 5; i++) {
    shots.push((await img.screenshot()).toString("base64"));
    await sleep(170);
  }
  return new Set(shots).size > 1;
}

// ── The page editor ────────────────────────────────────────────────────────

/** Every page editor case on `documentId` in the mode it is in; `tag` names
    the screenshots. */
async function pageEditorCases(group, page, cdp, posts, documentId, tag) {
  const index = async () => (await db.block.findMany({ where: { documentId }, select: { type: true } })).filter((b) => b.type === "FIGURE").length;

  // 1. A PNG on the words of the second paragraph: after that paragraph.
  await watchImages(page);
  let p = await wordsPoint(page, "The second");
  await drag(cdp, p.x, p.y, fileDrag(path("png")), { drop: false });
  const line = await page.evaluate(() => {
    const el = document.querySelector(".docs-drop-line");
    const para = [...document.querySelectorAll(".docs-prose p")].find((e) => e.textContent.startsWith("The second"));
    return el ? { y: el.getBoundingClientRect().top, under: para.getBoundingClientRect().bottom } : null;
  });
  const lineShot = await shot(page, `${tag}-1-drop-line`);
  check(group, Boolean(line) && Math.abs(line.y - line.under) < 4, `${tag}: the drop line shows under the paragraph while a PNG is over its words`, line ? `line at ${Math.round(line.y)}, paragraph ends at ${Math.round(line.under)}; ${lineShot}` : `no drop line; ${lineShot}`);
  await cancel(cdp, p.x, p.y, fileDrag(path("png")));
  const before = posts.length;
  await drag(cdp, p.x, p.y, fileDrag(path("png")));
  const stored = await until(async () => (await shape(page)).images.find((i) => i.src.startsWith("/api/images/")), 15_000);
  let s = await shape(page);
  const w = await seen(page);
  check(group, /p\(The second\) img\(stored\) p\(\)/.test(s.row), `${tag}: a PNG dropped on the words lands after that paragraph and is stored`, s.row);
  check(group, w.srcs.some((src) => src.startsWith("blob:")) && w.uploading, `${tag}: the PNG shows at once and draws as uploading until stored`, `addresses seen ${w.srcs.map((x) => x.slice(0, 5)).join(",")}; uploading drawn ${w.uploading}`);
  check(group, posts.slice(before).includes("POST /api/images") && !posts.slice(before).includes("POST /api/documents"), `${tag}: the PNG is stored as an image, never added as a document`, posts.slice(before).join(", "));
  if (stored) {
    const got = await imageBytes(page, stored.src);
    check(group, got.type === "image/png" && Buffer.compare(got.bytes, FIXTURES.png.bytes) === 0, `${tag}: the stored PNG is the dropped file byte for byte`, `${got.type}, ${got.bytes.length} bytes`);
  }
  await shot(page, `${tag}-1-png-on-words`);

  // 2. Undo takes the drop back in one step; Redo puts it back.
  await page.keyboard.press("Control+z");
  await sleep(300);
  const undone = await shape(page);
  await page.keyboard.press("Control+y");
  await sleep(300);
  const redone = await shape(page);
  check(group, undone.images.length === s.images.length - 1 && redone.images.length === s.images.length && redone.images.every((i) => !i.src.startsWith("blob:")), `${tag}: Undo takes the dropped image out in one step, Redo puts the stored one back`, `${s.images.length} → ${undone.images.length} → ${redone.images.length}`);

  // 3. A GIF on the empty page under the text: at the document's end, and it plays.
  await watchImages(page);
  const under = await page.evaluate(() => {
    const prose = document.querySelector(".docs-prose").getBoundingClientRect();
    const pane = document.querySelector("[data-reader-root]").getBoundingClientRect();
    return { x: prose.left + prose.width / 2, y: Math.min(pane.bottom - 30, prose.bottom + 90), hit: document.elementFromPoint(prose.left + prose.width / 2, Math.min(pane.bottom - 30, prose.bottom + 90))?.className ?? "" };
  });
  await drag(cdp, under.x, under.y, fileDrag(path("gif")));
  const gif = await until(async () => (await shape(page)).images.find((i) => i.src.startsWith("/api/images/") && !s.images.some((o) => o.src === i.src)), 15_000);
  s = await shape(page);
  check(group, /p\(The third\) img\(stored\) p\(\)$/.test(s.row), `${tag}: a GIF dropped on the empty page under the text lands at the end`, `dropped on ${String(under.hit).slice(0, 30)}; ${s.row}`);
  if (gif) {
    const got = await imageBytes(page, gif.src);
    check(group, got.type === "image/gif" && Buffer.compare(got.bytes, GIF) === 0, `${tag}: the GIF is stored whole (both frames)`, `${got.type}, ${got.bytes.length} bytes`);
    await page.locator(`.docs-prose img[src="${gif.src}"]`).scrollIntoViewIfNeeded();
    check(group, await plays(page, gif.src), `${tag}: the GIF plays on the page`);
  }
  await shot(page, `${tag}-3-gif-under-text`);

  // 4. A JPEG in the left margin beside the first line: before that paragraph.
  await page.evaluate(() => document.querySelector("[data-reader-root]").scrollTo(0, 0));
  await sleep(300);
  p = await wordsPoint(page, "The first", 0);
  const margin = { x: p.x - 45, y: p.y };
  await drag(cdp, margin.x, margin.y, fileDrag(path("jpg")));
  await until(async () => (await shape(page)).images.filter((i) => i.src.startsWith("/api/images/")).length === s.images.length + 1, 15_000);
  s = await shape(page);
  check(group, /img\(stored\) p\(\) p\(The first\)/.test(s.row), `${tag}: a JPEG dropped in the margin beside the first line lands before that paragraph`, s.row);
  await shot(page, `${tag}-4-jpg-in-margin`);

  // 5. A WebP pasted at the end of the third paragraph: after it.
  p = await wordsPoint(page, "The third", 1);
  await page.mouse.click(p.x - 1, p.y);
  await sleep(200);
  const pasted = await paste(page, "webp");
  await until(async () => (await shape(page)).images.filter((i) => i.src.startsWith("/api/images/")).length === s.images.length + 1, 15_000);
  s = await shape(page);
  check(group, pasted.taken && /p\(The third\) img\(stored\) p\(\) img\(stored\)/.test(s.row), `${tag}: a WebP pasted at the caret lands after that paragraph`, s.row);

  // 6. A picture dragged from another page that lets the browser read it: stored.
  p = await wordsPoint(page, "The first", 0.6);
  await drag(cdp, p.x, p.y, pageDrag(`${FIXTURE}/open.gif`, "A blinking square"));
  const open = await until(async () => {
    const now = await shape(page);
    return now.images.length === s.images.length + 1 && now.images.every((i) => !i.src.startsWith(FIXTURE)) ? now : null;
  }, 15_000);
  s = await shape(page);
  check(group, Boolean(open) && /p\(The first\) img\(stored\) p\(\)/.test(s.row), `${tag}: a GIF dragged from another page (readable) lands after the paragraph and is stored`, s.row);

  // 7. One the browser may not read keeps its own address.
  p = await wordsPoint(page, "The second", 0.3);
  await drag(cdp, p.x, p.y, pageDrag(`${FIXTURE}/closed.png`));
  await until(async () => (await shape(page)).images.some((i) => i.src === `${FIXTURE}/closed.png`), 15_000);
  await sleep(800);
  s = await shape(page);
  check(group, s.images.some((i) => i.src === `${FIXTURE}/closed.png`), `${tag}: a picture from a page the browser may not read goes in with its own address`, s.row);
  await shot(page, `${tag}-7-from-other-page`);

  // 8. A PDF: nothing goes in, never a project document, and a plain message.
  const t0 = (await toasts(page)).length;
  const b8 = posts.length;
  const rows = s.row;
  p = await wordsPoint(page, "The second");
  await drag(cdp, p.x, p.y, fileDrag(path("pdf")));
  await sleep(1200);
  const said8 = (await toasts(page)).slice(t0);
  check(group, (await shape(page)).row === rows && !posts.slice(b8).some((x) => x.startsWith("POST /api/documents") || x === "POST /api/images") && said8.some((x) => x.includes("notes.pdf") && x.includes("not an image")), `${tag}: a PDF dropped on the page stays out, with the reason, and is not added as a document`, `said ${JSON.stringify(said8)}; requests ${posts.slice(b8).join(", ") || "none"}; ${await readerToast(page) ? "toast drawn" : "no toast drawn"}`);
  await shot(page, `${tag}-8-pdf-refused`);

  // 9. An image past 25 MB: refused before it uploads.
  const t9 = (await toasts(page)).length;
  const b9 = posts.length;
  await drag(cdp, p.x, p.y, fileDrag(BIG));
  await sleep(1200);
  const said9 = (await toasts(page)).slice(t9);
  check(group, !posts.slice(b9).includes("POST /api/images") && said9.some((x) => /25 MB/.test(x)), `${tag}: an image past 25 MB is refused before it uploads`, `said ${JSON.stringify(said9)}; requests ${posts.slice(b9).join(", ") || "none"}`);

  // 10. The drops are saved: after a reload every image is there and loads.
  const ok = await saved(page);
  const count = (await shape(page)).images.length;
  await openEditor(page, documentId);
  const back = await shape(page);
  const loaded = await page.evaluate(() => [...document.querySelectorAll(".docs-prose figure.docs-img img")].map((i) => i.complete && i.naturalWidth > 0));
  check(group, Boolean(ok) && back.images.length === count && back.images.every((i) => !i.src.startsWith("blob:")) && loaded.every(Boolean), `${tag}: saved, and after a reload every image is back and loads`, `${count} images before, ${back.images.length} after; loaded ${loaded.filter(Boolean).length}/${loaded.length}`);
  const figures = await until(async () => ((await index()) >= count ? await index() : null), 10_000);
  check(group, figures === count, `${tag}: the paragraph index holds a FIGURE row per image`, `${figures} FIGURE rows for ${count} images`);
  await shot(page, `${tag}-10-after-reload`);
}

const GROUPS = {};

GROUPS.BLANK = async () => {
  const id = await blankDocument("Drop in a blank document");
  const { page, cdp, posts, errors, close } = await newPage();
  await openEditor(page, id);
  check("BLANK", (await mode(page)) === "editing", "a blank document opens in Editing", String(await mode(page)));
  await pageEditorCases("BLANK", page, cdp, posts, id, "blank");
  check("BLANK", errors.length === 0, "no page errors", errors.slice(0, 2).join(" | "));
  await close();
};

GROUPS.IMPORT = async () => {
  const id = await importDocument("edit");
  const { page, cdp, posts, errors, close } = await newPage();
  await openEditor(page, id);
  await setMode(page, "editing");
  await pageEditorCases("IMPORT", page, cdp, posts, id, "import");
  check("IMPORT", errors.length === 0, "no page errors", errors.slice(0, 2).join(" | "));
  await close();
};

GROUPS.SUGGEST = async () => {
  const id = await importDocument("suggest");
  const { page, cdp, errors, close } = await newPage();
  await openEditor(page, id);
  await setMode(page, "suggesting");
  const p = await wordsPoint(page, "The second");
  await drag(cdp, p.x, p.y, fileDrag(path("png")));
  await until(async () => (await shape(page)).images.some((i) => i.src.startsWith("/api/images/")), 15_000);
  let s = await shape(page);
  const image = s.images.find((i) => i.src.startsWith("/api/images/"));
  check("SUGGEST", /p\(The second\) img\(stored\)/.test(s.row) && image?.marks.includes("insertion"), "a PNG dropped in Suggesting goes in as a suggestion to add it", `${s.row}; marks ${JSON.stringify(image?.marks)}`);
  await sleep(600);
  await shot(page, "suggest-1-png-suggested");
  // The suggestion's card rejects it, as it rejects any suggested words.
  const reject = page.locator('[data-track="suggestion-reject"]').first();
  if (await reject.count()) {
    await reject.click();
    await sleep(600);
    s = await shape(page);
    check("SUGGEST", !s.images.some((i) => i.src.startsWith("/api/images/")), "Reject on the suggestion's card takes the image out", s.row);
  } else check("SUGGEST", false, "Reject on the suggestion's card takes the image out", "no suggestion card with Reject");
  check("SUGGEST", errors.length === 0, "no page errors", errors.slice(0, 2).join(" | "));
  await close();
};

GROUPS.VIEW = async () => {
  const id = await importDocument("view");
  const { page, cdp, posts, errors, close } = await newPage();
  await openEditor(page, id);
  check("VIEW", (await mode(page)) === "viewing", "an import opens in Viewing", String(await mode(page)));
  const rows = (await shape(page)).row;
  const b = posts.length;
  let p = await wordsPoint(page, "The second");
  await drag(cdp, p.x, p.y, fileDrag(path("png")));
  await sleep(1500);
  const said = await toasts(page);
  const drawn = await readerToast(page);
  const action = await page.locator('[data-reader-toast] [data-track="toast-action"]').textContent().catch(() => null);
  check("VIEW", (await shape(page)).row === rows && !posts.slice(b).some((x) => x.startsWith("POST /api/images") || x.startsWith("POST /api/documents")), "a PNG dropped in Viewing changes nothing and adds no document", posts.slice(b).join(", ") || "no requests");
  check("VIEW", said.some((x) => /Viewing mode/.test(x)) && /Viewing mode/.test(drawn) && action === "Switch to Editing", "the reader is told the page is in Viewing mode, with Switch to Editing", `toast "${drawn}", action ${JSON.stringify(action)}`);
  await shot(page, "view-1-png-in-viewing");
  // Switch to Editing from the toast, then the same drop goes in.
  await page.click('[data-reader-toast] [data-track="toast-action"]');
  await page.waitForFunction(() => document.querySelector('[data-track="docs:mode"]')?.getAttribute("data-mode") === "editing", null, { timeout: 10_000 }).catch(() => {});
  check("VIEW", (await mode(page)) === "editing", "Switch to Editing turns the page to Editing", String(await mode(page)));
  p = await wordsPoint(page, "The second");
  await drag(cdp, p.x, p.y, fileDrag(path("png")));
  await until(async () => (await shape(page)).images.some((i) => i.src.startsWith("/api/images/")), 15_000);
  check("VIEW", /p\(The second\) img\(stored\)/.test((await shape(page)).row), "then the dropped PNG goes in", (await shape(page)).row);
  // A paste in Viewing says the same.
  await setMode(page, "viewing");
  p = await wordsPoint(page, "The third");
  await page.mouse.click(p.x, p.y);
  const t0 = (await toasts(page)).length;
  const pasted = await paste(page, "png");
  await sleep(800);
  check("VIEW", pasted.taken && (await toasts(page)).slice(t0).some((x) => /Viewing mode/.test(x)), "an image pasted in Viewing says the page is in Viewing mode", JSON.stringify((await toasts(page)).slice(t0)));
  check("VIEW", errors.length === 0, "no page errors", errors.slice(0, 2).join(" | "));
  await close();
};

// ── The block reader ────────────────────────────────────────────────────────

/** Edit mode, as a person enters it: a double-click on the block that starts
    with `words` (again, while the page is still coming to life), which
    takes the focus. */
async function editBlock(page, words) {
  for (let i = 0; i < 4; i++) {
    await page.locator("article.reader-prose [data-block-id], article.reader-prose [data-edit-block]").filter({ hasText: words }).first().dblclick();
    const on = await page.waitForSelector("[data-edit-block]:focus", { timeout: 4000 }).catch(() => null);
    if (on) return;
  }
  throw new Error(`no edit mode on "${words}"`);
}

GROUPS.BLOCK = async () => {
  const id = await blockDocument("read");
  const { page, cdp, posts, errors, close } = await newPage();
  const rows = async () => (await db.block.findMany({ where: { documentId: id }, orderBy: { order: "asc" }, select: { type: true, text: true, html: true } })).map((r) => (r.type === "FIGURE" ? `FIGURE(${/src="\/api\/images\//.test(r.html ?? "") ? "stored" : /src="([^"]+)"/.exec(r.html ?? "")?.[1] ?? "?"})` : `${r.type}(${r.text.split(" ").slice(0, 2).join(" ")})`)).join(" ");
  await page.goto(`${BASE}/n/${ctx.notebookId}?doc=${id}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("article.reader-prose [data-block-id]", { timeout: 120_000 });
  await sleep(1000);
  const blockPoint = async (words) =>
    page.evaluate((words) => {
      const el = [...document.querySelectorAll("article.reader-prose [data-block-id], article.reader-prose [data-edit-block]")].find((e) => e.textContent.startsWith(words));
      const r = el.getBoundingClientRect();
      return { x: r.left + Math.min(120, r.width / 2), y: r.top + r.height / 2, bottom: r.bottom };
    }, words);

  // 1. Reading: a PNG dropped on the second block lands right after it.
  let p = await blockPoint("The second");
  // The pane may still be coming to life: the drag goes over again until
  // the page answers it.
  let line = null;
  for (let i = 0; i < 4 && line === null; i++) {
    await drag(cdp, p.x, p.y, fileDrag(path("png")), { drop: false });
    line = await until(() => page.evaluate(() => document.querySelector("[data-reader-root] [data-drop-line]")?.getBoundingClientRect().top ?? null), 400, 50);
    if (line === null) await cancel(cdp, p.x, p.y, fileDrag(path("png")));
  }
  const lineShot = await shot(page, "block-1-drop-line");
  check("BLOCK", line !== null && Math.abs(line - p.bottom) < 8, "reading: the drop line shows under the block while a PNG is over it", `line at ${line === null ? "none" : Math.round(line)}, block ends at ${Math.round(p.bottom)}; ${lineShot}`);
  await cancel(cdp, p.x, p.y, fileDrag(path("png")));
  const b1 = posts.length;
  await drag(cdp, p.x, p.y, fileDrag(path("png")));
  const r1 = await until(async () => ((await rows()).includes("FIGURE") ? rows() : null), 15_000);
  check("BLOCK", /PARAGRAPH\(The second\) FIGURE\(stored\) PARAGRAPH\(The third\)/.test(r1 ?? ""), "reading: a PNG dropped on a block lands right after it as a figure", r1 ?? (await rows()));
  check("BLOCK", !posts.slice(b1).includes("POST /api/documents") && (await page.locator('[role="dialog"]').count()) === 0, "reading: the PNG is not added as a document", posts.slice(b1).join(", "));
  await page.waitForFunction(() => [...document.querySelectorAll("article.reader-prose img")].some((i) => i.src.includes("/api/images/") && i.complete && i.naturalWidth > 0), null, { timeout: 15_000 }).catch(() => {});
  await shot(page, "block-1-png-after-block");

  // 2. A GIF from another page that lets the browser read it, on the first block.
  p = await blockPoint("The first");
  await drag(cdp, p.x, p.y, pageDrag(`${FIXTURE}/open.gif`, "A blinking square"));
  const r2 = await until(async () => ((await rows()).startsWith("PARAGRAPH(The first) FIGURE") ? rows() : null), 15_000);
  check("BLOCK", /^PARAGRAPH\(The first\) FIGURE\(stored\)/.test(r2 ?? ""), "reading: a GIF dragged from another page lands after the block and is stored", r2 ?? (await rows()));
  await page.waitForFunction(() => [...document.querySelectorAll("article.reader-prose img")].filter((i) => i.src.includes("/api/images/")).length >= 2, null, { timeout: 15_000 }).catch(() => {});
  const gifSrc = await page.evaluate(() => [...document.querySelectorAll("article.reader-prose img")].map((i) => i.getAttribute("src")).find((s) => s?.startsWith("/api/images/") && s) ?? null);
  const gifInfo = r2 ? await page.evaluate(async () => {
    const srcs = [...document.querySelectorAll("article.reader-prose img")].map((i) => i.getAttribute("src")).filter((s) => s?.startsWith("/api/images/"));
    const out = [];
    for (const s of srcs) out.push({ s, type: (await fetch(s)).headers.get("content-type") });
    return out;
  }) : [];
  const gif = gifInfo.find((g) => g.type === "image/gif");
  check("BLOCK", Boolean(gif) && (await plays(page, gif.s)), "reading: the GIF plays in the article", JSON.stringify(gifInfo));
  void gifSrc;

  // 3. A PDF dropped on the text is the project's: the add box opens.
  const b3 = posts.length;
  p = await blockPoint("The third");
  await drag(cdp, p.x, p.y, fileDrag(path("pdf")));
  const box3 = await until(async () => (await page.locator('[role="dialog"]').count()) > 0, 8000);
  await shot(page, "block-3-pdf-to-project");
  check("BLOCK", Boolean(box3) && !(await rows()).includes("notes"), "reading: a PDF dropped on the text goes to the project's drop zone (the add box opens)", posts.slice(b3).join(", ") || "no requests");
  await page.keyboard.press("Escape");
  await sleep(600);
  if (await page.locator('[role="dialog"]').count()) {
    await page.mouse.click(10, 890);
    await sleep(600);
  }

  // 4. A PNG dropped beside the article, off the text: the project's drop zone.
  const beside = await page.evaluate(() => {
    const a = document.querySelector("article.reader-prose").getBoundingClientRect();
    const pane = document.querySelector("[data-reader-root]").getBoundingClientRect();
    return { x: Math.min(pane.right - 40, a.right + 60), y: pane.top + pane.height * 0.7 };
  });
  const before4 = await rows();
  await drag(cdp, beside.x, beside.y, fileDrag(path("png")));
  const box4 = await until(async () => (await page.locator('[role="dialog"]').count()) > 0, 8000);
  await shot(page, "block-4-png-beside-to-project");
  check("BLOCK", Boolean(box4) && (await rows()) === before4, "reading: a PNG dropped off the text goes to the project's drop zone", `dialog ${Boolean(box4)}`);
  await page.keyboard.press("Escape");
  await sleep(600);
  if (await page.locator('[role="dialog"]').count()) {
    await page.mouse.click(10, 890);
    await sleep(600);
  }

  // 5. Edit mode: a WebP pasted while the third block is edited lands after it.
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("article.reader-prose [data-block-id]", { timeout: 120_000 });
  await editBlock(page, "The third");
  const pasted = await paste(page, "webp");
  const r5 = await until(async () => (/PARAGRAPH\(The third\) FIGURE/.test(await rows()) ? rows() : null), 15_000);
  check("BLOCK", pasted.taken && /PARAGRAPH\(The third\) FIGURE\(stored\)/.test(r5 ?? ""), "edit mode: a WebP pasted in a block lands right after it", `${pasted.target}; ${r5 ?? (await rows())}`);
  await sleep(800);
  await shot(page, "block-5-paste-in-edit-mode");
  check("BLOCK", errors.length === 0, "no page errors", errors.slice(0, 2).join(" | "));
  await close();
};

// ── The toast and the Contents button ──────────────────────────────────────

const LONG_TOAST = "Skipped: A page keeps its text, which its annotations find it by: its words are in the blocks converted from it. (Edit the words on page 1)";

// A long message in the block reader's toast, in reading mode: Collapse,
// whose run the server refuses with that message.
GROUPS.TOAST = async () => {
  const id = await blockDocument("toast");
  for (const [width, height] of [[1440, 900], [1024, 768]]) {
    const { page, close } = await newPage({ width, height });
    await page.route("**/api/documents/*/collapse", (route) =>
      route.request().method() === "POST"
        ? route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: LONG_TOAST }) })
        : route.continue(),
    );
    await page.goto(`${BASE}/n/${ctx.notebookId}?doc=${id}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("article.reader-prose [data-block-id]", { timeout: 120_000 });
    await sleep(1200);
    const needle = LONG_TOAST.slice(0, 30);
    const find = (text) => [...document.querySelectorAll("span")].find((s) => s.textContent.includes(text) && s.className.includes("bg-ink"));
    let shown = null;
    for (let i = 0; i < 3 && !shown; i++) {
      await page.click('[data-track="collapse"]');
      shown = await until(() => page.evaluate(`(${find})(${JSON.stringify(needle)}) !== undefined`), 6000);
    }
    await sleep(400);
    const boxes = await page.evaluate(
      ({ needle, find }) => {
        const toastEl = new Function("text", `return (${find})(text)`)(needle);
        const contents = document.querySelector('[data-track-surface="article-menu"] button')?.getBoundingClientRect();
        const toast = toastEl?.getBoundingClientRect();
        const hit = toast ? document.elementFromPoint(toast.left + 14, toast.top + Math.min(10, toast.height / 2)) : null;
        return { contents: contents?.toJSON(), toast: toast?.toJSON(), firstWordsOnTop: Boolean(toastEl && hit && toastEl.contains(hit)) };
      },
      { needle, find: String(find) },
    );
    const overlap = boxes.contents && boxes.toast && !(boxes.toast.right <= boxes.contents.left || boxes.toast.left >= boxes.contents.right || boxes.toast.bottom <= boxes.contents.top || boxes.toast.top >= boxes.contents.bottom);
    const file = await shot(page, `toast-${width}`);
    const box = (b) => (b ? `${Math.round(b.left)}–${Math.round(b.right)} × ${Math.round(b.top)}–${Math.round(b.bottom)}` : "none");
    check("TOAST", Boolean(shown) && !overlap && boxes.firstWordsOnTop, `${width}×${height}: the toast never sits under the Contents button`, `toast ${box(boxes.toast)}; Contents ${box(boxes.contents)}; its first words on top ${boxes.firstWordsOnTop}; ${file}`);
    await close();
  }
};

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  await prepare();
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
    ctx.server?.close();
    if (!KEEP) {
      for (const id of ctx.documents) await api(`/api/documents/${id}`, "DELETE").catch(() => {});
      if (ctx.notebookId) await api(`/api/notebooks/${ctx.notebookId}`, "DELETE").catch(() => {});
    }
    if (ctx.importsWas === null) await db.appSetting.deleteMany({ where: { key: "imports" } }).catch(() => {});
    else if (ctx.importsWas !== undefined) await db.appSetting.update({ where: { key: "imports" }, data: { value: ctx.importsWas } }).catch(() => {});
    await db.$disconnect();
    process.exit(n("FAIL") > 0 ? 1 : 0);
  });
