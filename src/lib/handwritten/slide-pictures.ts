import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { db } from "@/lib/db";
import { browserConfigured, launchBrowser } from "@/lib/browser";
import { renderSlidePictures, storeSlidePictureSizes } from "@/lib/handwritten/page-images";
import { PAGE_IMAGE_QUALITY, PAGE_IMAGE_WIDTH } from "@/lib/handwritten/pages";
import { OFFICE_CSS } from "@/lib/office-css";
import { googleFontsUrl, parseFontList, webFontFamilies } from "@/lib/office-fonts";

// Pictures for an uploaded slides document (SPEC.md §27). A Google Slides
// import brings Drive's PDF export; an uploaded .pptx brings nothing, so
// the picture is made here, after the response, by the best means the
// deployment has: LibreOffice, where it is installed (SOFFICE_PATH, or
// soffice on the PATH), converts the .pptx to a PDF and the pages render
// like Drive's; else the configured browser (lib/browser.ts) draws each
// slide's replica with its web fonts and photographs it. Neither
// available: the slides show their replicas alone. Once the pictures are
// stored the slide frames are marked data-picture, so the reader asks for
// them.

const execFileAsync = promisify(execFile);
const SOFFICE_TIMEOUT_MS = 180_000;
const SOFFICE_CANDIDATES = [
  "/usr/bin/soffice",
  "/usr/local/bin/soffice",
  "/opt/libreoffice/program/soffice",
  "/Applications/LibreOffice.app/Contents/MacOS/soffice",
  "/snap/bin/libreoffice",
];

/** The LibreOffice binary to run, or null when none is configured or found. */
export async function sofficePath(): Promise<string | null> {
  const configured = process.env.SOFFICE_PATH;
  const candidates = configured ? [configured] : SOFFICE_CANDIDATES;
  for (const path of candidates) {
    try {
      await access(path);
      return path;
    } catch {
      // Not here.
    }
  }
  return null;
}

/** The .pptx converted to a PDF by LibreOffice, one page per slide. Null
    when LibreOffice is not available or the conversion fails. */
export async function convertWithLibreOffice(bytes: Uint8Array, extension: string): Promise<Uint8Array | null> {
  const soffice = await sofficePath();
  if (!soffice) return null;
  const dir = await mkdtemp(join(tmpdir(), "unitos-office-"));
  try {
    const input = join(dir, `document.${extension}`);
    await writeFile(input, bytes);
    // A profile of its own: LibreOffice refuses to start against a locked
    // or unwritable profile, and a server has no user profile to share.
    const profile = `file://${join(dir, "profile")}`;
    await execFileAsync(
      soffice,
      [`-env:UserInstallation=${profile}`, "--headless", "--norestore", "--nologo", "--convert-to", "pdf", "--outdir", dir, input],
      { timeout: SOFFICE_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 },
    );
    const pdf = await readFile(join(dir, "document.pdf"));
    return pdf.length > 0 ? new Uint8Array(pdf) : null;
  } catch (err) {
    console.warn("[slides] LibreOffice conversion failed:", err);
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Pictures for every slide of an uploaded slides document, by the best
    means available, then the frames marked so the reader draws them. */
export async function renderUploadedSlidePictures(documentId: string, bytes: Uint8Array): Promise<void> {
  const pdf = await convertWithLibreOffice(bytes, "pptx");
  if (pdf) {
    await storeSlidePictureSizes(documentId, pdf);
    await renderSlidePictures(documentId, pdf);
    await markSlidePictures(documentId);
    return;
  }
  if (!browserConfigured()) return;
  await renderReplicaPictures(documentId);
  await markSlidePictures(documentId);
}

/** The slide frames of the document marked data-picture, for every SLIDE
    block with a stored picture. */
async function markSlidePictures(documentId: string): Promise<void> {
  const blocks = await db.block.findMany({
    where: { documentId, type: "SLIDE", pageImage: { data: { not: null } } },
    select: { id: true, html: true },
  });
  for (const block of blocks) {
    if (!block.html || block.html.includes('data-picture="1"')) continue;
    await db.block.update({
      where: { id: block.id },
      data: { html: block.html.replace('<div class="slide-frame"', '<div class="slide-frame" data-picture="1"') },
    });
  }
}

/** Every slide's replica drawn in the configured browser — its web fonts
    loaded, its pictures served from the database — and photographed at
    the page image width. */
async function renderReplicaPictures(documentId: string): Promise<void> {
  const blocks = await db.block.findMany({
    where: { documentId, type: "SLIDE" },
    select: { id: true, html: true },
    orderBy: { order: "asc" },
  });
  if (blocks.length === 0) return;
  const stored = await db.pageImage.findMany({
    where: { blockId: { in: blocks.map((b) => b.id) }, data: { not: null } },
    select: { blockId: true },
  });
  const done = new Set(stored.map((r) => r.blockId));
  const todo = blocks.filter((b) => b.html && !done.has(b.id));
  if (todo.length === 0) return;

  const fonts = new Set<string>();
  for (const block of todo) {
    const match = /data-fonts="([^"]*)"/.exec(block.html ?? "");
    for (const f of parseFontList(match?.[1].replace(/&quot;/g, '"'))) fonts.add(f);
  }
  const links = webFontFamilies(fonts)
    .map((family) => `<link rel="stylesheet" href="${googleFontsUrl(family).replace(/&/g, "&amp;")}">`)
    .join("");

  const browser = await launchBrowser("slides");
  try {
    const context = await browser.newContext({ viewport: { width: PAGE_IMAGE_WIDTH + 40, height: 1200 }, deviceScaleFactor: 1 });
    try {
      // The replica's pictures are the app's own image route: served from
      // the database, since the browser has no session with the app.
      await context.route("**/api/images/*", async (route) => {
        const id = route.request().url().split("/").pop() ?? "";
        const image = await db.imageAsset.findUnique({ where: { id }, select: { data: true, mimeType: true } });
        if (!image) return route.fulfill({ status: 404 });
        return route.fulfill({ status: 200, contentType: image.mimeType, body: Buffer.from(image.data) });
      });
      const page = await context.newPage();
      for (const block of todo) {
        const html = (block.html ?? "").replace(/<div class="slide-notes">[\s\S]*$/, "</div>");
        const doc = `<!DOCTYPE html><html><head><meta charset="utf-8">${links}<style>${OFFICE_CSS}body{margin:0;background:#fff}.reader-slide{width:${PAGE_IMAGE_WIDTH}px}.reader-slide .slide{border-radius:0;box-shadow:none}.reader-slide .slide-number{display:none}</style></head><body><div class="reader-slide">${html}</div></body></html>`;
        await page.setContent(doc, { waitUntil: "load" });
        await page.evaluate(() => document.fonts.ready).catch(() => {});
        await page.waitForTimeout(150);
        const slide = page.locator(".slide").first();
        const box = await slide.boundingBox();
        if (!box) continue;
        const shot = await slide.screenshot({ type: "jpeg", quality: PAGE_IMAGE_QUALITY });
        // A fresh ArrayBuffer-backed copy: the driver wants one.
        const jpeg = new Uint8Array(shot.byteLength);
        jpeg.set(shot);
        await db.pageImage.upsert({
          where: { blockId: block.id },
          create: { blockId: block.id, width: Math.round(box.width), height: Math.round(box.height), data: jpeg },
          update: { width: Math.round(box.width), height: Math.round(box.height), data: jpeg },
        });
      }
    } finally {
      await context.close().catch(() => {});
    }
  } finally {
    await browser.close().catch(() => {});
  }
}
