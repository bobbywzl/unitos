// Images dropped into a note and into the reader's edit mode (SPEC.md §16),
// driven in the built app: the note takes the image, the editor shows it
// rather than its markdown, the article takes it as a figure, and a file that
// is not an image is left for the window's document drop.
// Env: NB, DOC, NOTE, CHROME.
import { createCanvas } from "@napi-rs/canvas";
import { chromium } from "playwright-core";

const [NB, DOC, NOTE] = [process.env.NB, process.env.DOC, process.env.NOTE];
const PORT = process.env.PORT ?? "3311";
const SHOT = process.env.SHOT_DIR ?? ".";
const results = [];
const check = (name, ok, detail = "") => {
  const line = `${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`;
  results.push(line);
  if (process.env.VERBOSE) console.error(line);
};
const step = (s) => process.env.VERBOSE && console.error("··", s);

// A small, unmistakable image: a solid sage square.
function pngBase64(size = 120) {
  const c = createCanvas(size, size);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#6b8f71";
  ctx.fillRect(0, 0, size, size);
  return c.toBuffer("image/png").toString("base64");
}

const browser = await chromium.launch({ executablePath: process.env.CHROME });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(`http://localhost:${PORT}/n/${NB}?doc=${DOC}`, { waitUntil: "networkidle" });
await page.waitForSelector(`[data-note-id="${NOTE}"]`, { timeout: 20000 });

/** A DataTransfer carrying one file, for dragover and drop. */
async function fileTransfer(base64, name, type) {
  return page.evaluateHandle(
    ({ base64, name, type }) => {
      const bin = atob(base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], name, { type }));
      return dt;
    },
    { base64, name, type },
  );
}

async function dropOn(locator, base64, name, type) {
  const dataTransfer = await fileTransfer(base64, name, type);
  // The reader reads the drop's coordinates to find the block under it, so the
  // synthetic event carries the target's own centre.
  const box = await locator.boundingBox();
  const at = box ? { clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 } : {};
  await locator.dispatchEvent("dragover", { dataTransfer, ...at });
  await locator.dispatchEvent("drop", { dataTransfer, ...at });
}

try {
  await run();
} catch (e) {
  results.push(`CRASH ${String(e).split("\n")[0]}`);
  await page.screenshot({ path: `${SHOT}/image-drop-crash.png` }).catch(() => {});
}
check("no console errors", errors.length === 0, errors.slice(0, 2).join(" | "));
console.log(results.join("\n"));
await browser.close();
process.exit(results.some((r) => r.startsWith("FAIL") || r.startsWith("CRASH")) ? 1 : 0);

async function run() {
  const png = pngBase64();
  const noteCard = page.locator(`aside[data-track-surface="tray"] [data-note-id="${NOTE}"]`).first();

  // The note starts from a known text, so every count below is this run's.
  await page.request.patch(`http://localhost:${PORT}/api/notes/${NOTE}`, {
    data: { content: "The floor is earned, the top is bought." },
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector(`[data-note-id="${NOTE}"]`, { timeout: 20000 });

  // Accepted notes fold to one line by default; the image shows when the note does.
  const openNote = async () => {
    if ((await noteCard.locator(".note-body").count()) === 0) {
      // A click through the DOM: the tooltip layer can sit over the chevron.
      await noteCard.locator('button[data-track="note-collapse"]').first().evaluate((el) => el.click());
      await page.waitForTimeout(400);
    }
  };
  await openNote();

  // ── A file that is not an image is not the note's ──
  step("pdf drop");
  await dropOn(noteCard, png, "notes.pdf", "application/pdf");
  await page.waitForTimeout(1200);
  check("a pdf dropped on a note adds no image", (await noteCard.locator("img").count()) === 0);

  // ── An image dropped on a note goes into the note ──
  step("image drop");
  await dropOn(noteCard, png, "sage-square.png", "image/png");
  await page.waitForTimeout(2000);
  await openNote();
  await page.waitForSelector(`[data-note-id="${NOTE}"] img`, { timeout: 15000 });
  check("the note takes exactly the dropped image", (await noteCard.locator("img").count()) === 1);
  const src = await noteCard.locator("img").first().getAttribute("src");
  check("the note points at the stored image", Boolean(src?.startsWith("/api/images/")), String(src));
  const served = await page.request.get(`http://localhost:${PORT}${src}`);
  check("the image URL serves the bytes", served.ok() && served.headers()["content-type"] === "image/png",
    `${served.status()} ${served.headers()["content-type"]}`);
  const painted = await noteCard.locator("img").first().evaluate((el) => el.naturalWidth);
  check("the image loads in the note", painted === 120, `naturalWidth ${painted}`);

  // ── The note editor shows the image, not its markdown ──
  step("editor");
  await noteCard.locator('button[data-track="note-edit"]').first().evaluate((el) => el.click());
  await page.waitForTimeout(800);
  const editable = page.locator('aside[data-track-surface="tray"] [role="textbox"].note-doc').first();
  check("the editor shows the image as an image",
    (await editable.locator("img.note-image").count()) === 1,
    `${await editable.locator("img.note-image").count()} note images`);
  check("the editor shows no image markdown", !(await editable.innerText()).includes("]("));
  // Done keeps it: the document reads back as the same markdown.
  await page
    .locator('aside[data-track-surface="tray"] button[data-track="note-save"]')
    .first()
    .evaluate((el) => el.click());
  await page.waitForTimeout(1500);
  await openNote();
  check("the image survives Done", (await noteCard.locator("img").count()) === 1);
  await page.screenshot({ path: `${SHOT}/image-note.png` });

  // ── An image dropped on the article while editing becomes a figure ──
  step("article drop");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  const para = page.locator("article.reader-prose p[data-block-id]").first();
  const blockId = await para.getAttribute("data-block-id");
  const figuresBefore = await page.locator("article.reader-prose .reader-figure").count();
  const storedBefore = await page
    .locator('article.reader-prose .reader-figure img[src^="/api/images/"]')
    .count();
  await para.dblclick({ force: true });
  await page.waitForTimeout(700);
  const target = page.locator(`[data-edit-block="${blockId}"]`);
  check("the article is in edit mode", (await target.count()) === 1);
  await dropOn(target, png, "sage-square.png", "image/png");
  await page.waitForTimeout(3000);
  const figuresAfter = await page.locator("article.reader-prose .reader-figure").count();
  check("the article takes the image as a figure", figuresAfter === figuresBefore + 1,
    `${figuresBefore} → ${figuresAfter}`);
  const dropped = page.locator('article.reader-prose .reader-figure img[src^="/api/images/"]');
  check("the figure points at the stored image", (await dropped.count()) === storedBefore + 1,
    `${storedBefore} → ${await dropped.count()} stored figures`);
  const figurePainted = await dropped.first().evaluate((el) => el.naturalWidth);
  check("the figure's image loads", figurePainted === 120, `naturalWidth ${figurePainted}`);
  // The figure lands right after the paragraph it was dropped on.
  const place = await page.evaluate((blockId) => {
    const article = document.querySelector("article.reader-prose");
    const kids = [...article.children];
    const target = kids.findIndex((k) => k.querySelector(`[data-edit-block="${blockId}"], [data-block-id="${blockId}"]`) || k.matches(`[data-edit-block="${blockId}"], [data-block-id="${blockId}"]`));
    // The newest stored figure: the one right after the target.
    const figure = kids.findIndex((k, i) => i > target && k.querySelector('img[src^="/api/images/"]'));
    return { target, figure };
  }, blockId);
  check("the figure follows the paragraph it was dropped on", place.figure === place.target + 1,
    `paragraph at ${place.target}, figure at ${place.figure}`);
  await page.screenshot({ path: `${SHOT}/image-article.png` });
}
