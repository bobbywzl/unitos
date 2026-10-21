import type { Page } from "playwright-core";
import type { CaptureStore } from "@/lib/parse/capture-animation";

// A figure the page draws with no media the parse can keep (SPEC.md §2 The
// picture of an interactive figure): a canvas (a 3D viewer, a WebGL plot),
// an element the page labels as a picture and draws by script
// (role="img" with nothing in it), a frame from a host the sanitizer
// refuses or with no source until a script sets one, and a video that
// plays on a click (a play button over a poster, the video's source set by
// the click). The browser render pictures each in its place on the page
// and stores the picture as an ImageAsset; the picture takes the element's
// place as an <img data-captured="…">, so the walk reads it as a figure
// with the caption the page set, and the figure says it is a picture of the
// page's interactive figure (lib/parse/figures.ts). The sanitizer keeps the
// mark. Without a browser the element stays as it is, and the figure audit
// reports the caption without its figure.

// The kinds of element pictured, as the mark names them.
export type CapturedKind = "interactive" | "frame" | "video";

// Players the sanitizer embeds as iframes (sanitize.ts EMBED_HOSTS): a
// frame from one of them stays a frame.
const EMBED_HOSTS = ["www.youtube.com", "www.youtube-nocookie.com", "youtube.com", "player.vimeo.com"];
// Smaller than this an element is a control or an icon, no figure.
const MIN_WIDTH = 160;
const MIN_HEIGHT = 90;
// The most elements pictured on one page, and the most time one gets.
const MAX_CAPTURES = 24;
// A viewer drawing in WebGL keeps the renderer busy: a screenshot may wait.
const CAPTURE_TIMEOUT_MS = 15_000;
const MARK = "data-unitos-capture";

export type CaptureInteractiveResult = { pictured: number; failed: number; found: number };

/** Mark the page's interactive figures, outermost first, and say how many:
    the elements with no media the parse keeps, drawn at a figure's size, in
    the page's content. A play button around a poster is the video's
    place, and the figure root an element stands in (its figure, or its
    labeled box) is what is pictured. The page runs the script as source
    (page.evaluate with a string): a function would carry the bundler's
    name helpers, which the page does not have. */
function markInteractive(page: Page): Promise<{ count: number; kinds: CapturedKind[] }> {
  const script = `(() => {
    const mark = ${JSON.stringify(MARK)};
    const minWidth = ${MIN_WIDTH};
    const minHeight = ${MIN_HEIGHT};
    const max = ${MAX_CAPTURES};
    const hosts = ${JSON.stringify(EMBED_HOSTS)};
    const chrome = (el) => el.closest("nav, header, footer, [role='navigation'], [aria-hidden='true']") !== null;
    const big = (el) => {
      const r = el.getBoundingClientRect();
      return r.width >= minWidth && r.height >= minHeight;
    };
    const hasMedia = (el) => el.querySelector("img[src]:not([src^='data:']), video[src], picture, svg[viewBox] *") !== null;
    const rootOf = (el) => {
      const figure = el.closest("figure, [role='img']");
      return figure && big(figure) ? figure : el;
    };
    const found = [];
    const add = (root, kind) => {
      if (found.some((f) => f.root === root || f.root.contains(root) || root.contains(f.root))) return;
      found.push({ root, kind });
    };
    for (const el of document.querySelectorAll("canvas")) {
      if (chrome(el) || !big(el)) continue;
      add(rootOf(el), "interactive");
    }
    for (const el of document.querySelectorAll("[role='img']")) {
      if (chrome(el) || !big(el) || hasMedia(el)) continue;
      add(el, "interactive");
    }
    for (const el of document.querySelectorAll("iframe")) {
      if (chrome(el) || !big(el)) continue;
      const src = el.getAttribute("src") || "";
      let embedded = false;
      try {
        embedded = src !== "" && hosts.includes(new URL(src, location.href).hostname);
      } catch {
        embedded = false;
      }
      if (embedded) continue;
      add(rootOf(el), "frame");
    }
    for (const el of document.querySelectorAll("button, a, [role='button']")) {
      if (chrome(el) || !big(el) || el.querySelector("video")) continue;
      const label = (el.getAttribute("aria-label") || "") + " " + (el.getAttribute("title") || "") + " " + el.className;
      if (!/\\b(?:play|video)\\b/i.test(label) || !el.querySelector("img[src]")) continue;
      add(rootOf(el), "video");
    }
    found.sort((a, b) => (a.root.compareDocumentPosition(b.root) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
    const kept = found.slice(0, max);
    kept.forEach((f, n) => f.root.setAttribute(mark, n + ":" + f.kind));
    return { count: kept.length, kinds: kept.map((f) => f.kind) };
  })()`;
  return page.evaluate(script) as Promise<{ count: number; kinds: CapturedKind[] }>;
}

/** The picture in the element's place: an <img> of the stored picture,
    the element's label as its alt, its drawn size as its width and height,
    and the mark the walk reads (data-captured). */
async function replaceWithPicture(page: Page, n: number, src: string, kind: CapturedKind, width: number, height: number): Promise<void> {
  const script = `(() => {
    const el = document.querySelector(${JSON.stringify(`[${MARK}^="${n}:"]`)});
    if (!el) return;
    const labeled = el.querySelector("[aria-label]");
    const frame = el.querySelector("iframe[title]");
    const label = el.getAttribute("aria-label") || el.getAttribute("title") || (labeled && labeled.getAttribute("aria-label")) || (frame && frame.getAttribute("title")) || "";
    const img = document.createElement("img");
    img.setAttribute("src", ${JSON.stringify(src)});
    img.setAttribute("alt", label);
    img.setAttribute("width", ${JSON.stringify(String(width))});
    img.setAttribute("height", ${JSON.stringify(String(height))});
    img.setAttribute("data-captured", ${JSON.stringify(kind)});
    el.replaceWith(img);
  })()`;
  await page.evaluate(script);
}

async function unmark(page: Page): Promise<void> {
  await page.evaluate(`(() => { for (const el of document.querySelectorAll(${JSON.stringify(`[${MARK}]`)})) el.removeAttribute(${JSON.stringify(MARK)}); })()`);
}

/** Picture every interactive figure of the page in its place and put the
    picture there (replaceWithPicture), until the deadline. Never throws: an
    element that fails stays as it is, and the result counts it. */
export async function captureInteractiveFigures(
  page: Page,
  opts: { store: CaptureStore | null; deadline: number },
): Promise<CaptureInteractiveResult> {
  const result: CaptureInteractiveResult = { pictured: 0, failed: 0, found: 0 };
  const { count, kinds } = await markInteractive(page);
  result.found = count;
  if (count === 0 || !opts.store) return result;
  // The page's animation loops stop here: a WebGL viewer drawing every
  // frame kept the renderer busy, and each picture waited on it (18 s for
  // one, the next out of time). Every viewer has drawn by now (the render
  // scrolled the whole page before), and its last frame stays on its
  // canvas for the picture.
  await page.evaluate("window.requestAnimationFrame = () => 0; window.cancelAnimationFrame = () => {};").catch(() => {});
  try {
    for (let n = 0; n < count; n++) {
      if (Date.now() > opts.deadline) {
        result.failed += count - n;
        break;
      }
      const selector = `[${MARK}^="${n}:"]`;
      try {
        // Scrolled into view by the page itself: a viewer that never holds
        // still (a 3D replay redrawn every frame) is no element Playwright
        // waits on. A viewer that draws on scroll, or a poster that loads
        // lazily, has a moment to draw.
        await page.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (el) el.scrollIntoView({ block: "center" }); })()`);
        await page.waitForTimeout(500);
        const box = (await page.evaluate(
          `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`,
        )) as { x: number; y: number; width: number; height: number } | null;
        if (!box || box.width < MIN_WIDTH || box.height < MIN_HEIGHT) throw new Error("no box on screen");
        // The viewport's part the element fills, as the page shows it now.
        const view = page.viewportSize() ?? { width: 1280, height: 900 };
        const clip = {
          x: Math.max(0, box.x),
          y: Math.max(0, box.y),
          width: Math.min(box.width, view.width - Math.max(0, box.x)),
          height: Math.min(box.height, view.height - Math.max(0, box.y)),
        };
        if (clip.width < MIN_WIDTH || clip.height < MIN_HEIGHT) throw new Error("off the screen");
        const png = await page.screenshot({ type: "png", clip, timeout: CAPTURE_TIMEOUT_MS, animations: "allow", caret: "hide" });
        const src = await opts.store(new Uint8Array(png), "image/png");
        if (!src) throw new Error("not stored");
        await replaceWithPicture(page, n, src, kinds[n], Math.round(clip.width), Math.round(clip.height));
        result.pictured += 1;
      } catch (err) {
        result.failed += 1;
        console.warn(`[render] interactive figure ${n + 1} of ${count} not pictured:`, err instanceof Error ? err.message : err);
      }
    }
  } finally {
    await unmark(page).catch(() => {});
  }
  return result;
}
