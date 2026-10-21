import { JSDOM, VirtualConsole } from "jsdom";
import { browserConfigured, launchBrowser, sessionLengthOf, withTimeout } from "@/lib/browser";
import { db } from "@/lib/db";
import type { TFunc } from "@/lib/i18n/dictionaries";
import { serverT } from "@/lib/i18n/server";
import { captureAnimatedCharts, type CaptureResult, type CaptureStore } from "@/lib/parse/capture-animation";
import { captureInteractiveFigures, type CaptureInteractiveResult } from "@/lib/parse/capture-interactive";
import type { FetchedPage } from "@/lib/parse/fetch-page";
import { isEmptyChart } from "@/lib/parse/figures";
import type { OnIngestProgress } from "@/lib/parse/ingest";

// A page whose figures are drawn by its scripts (a chart svg empty in the
// server's HTML, a canvas, a figure whose image a lazy loader puts in) has
// no figure to parse in the static page. Where a browser is configured
// (BROWSER_WS_ENDPOINT or CHROMIUM_PATH, the same browser SPEC.md §11 uses
// for transcripts; lib/browser.ts), the page renders in it at 1280×900,
// scrolls through so scroll-revealed figures draw, and the rendered DOM
// parses in the static page's place. Without a browser the static page
// stands.
//
// A chart the page's scripts animate settles first (lib/parse/capture-animation.ts):
// the page's clock is paused and stepped, a one-shot animation is drawn to
// its end, and a loop — when the render stores images — is recorded as a
// GIF, stored as an ImageAsset, and takes the svg's place as an <img> of the
// reader's own /api/images/<id> path.
//
// A figure with no media the parse can keep — a canvas, a box the page
// labels as a picture and draws by script, a frame from a host the
// sanitizer refuses, a video that plays on a click — is pictured in its
// place (lib/parse/capture-interactive.ts), stored the same way, and takes
// the element's place as an <img data-captured>: the figure then says it is
// a picture of the page's interactive figure (lib/parse/figures.ts).

const RENDER_TIMEOUT_MS = 180_000;
const NAVIGATION_TIMEOUT_MS = 30_000;
const IDLE_TIMEOUT_MS = 10_000;
const STEP_TIMEOUT_MS = 15_000;
// One viewport per step, a short wait for the charts that draw on scroll.
const SCROLL_STEPS = 40;
const SCROLL_WAIT_MS = 150;
const SETTLE_MS = 500;
// The charts get this much of the render's time — less when the browser's
// session ends sooner (lib/browser.ts sessionLengthOf): the capture must be
// stored before the service closes the page, with this much to spare. The
// pictures of the interactive figures get their own share first, and both
// end before the render's own time is up (RENDER_MARGIN_MS to spare for
// the page's serialization).
const CAPTURE_BUDGET_MS = 110_000;
const PICTURES_BUDGET_MS = 60_000;
const SESSION_MARGIN_MS = 6_000;
const RENDER_MARGIN_MS = 12_000;

// What the render did, saved with the document (Document.figureRenderAt,
// figureRenderError) and reported with the save stage, so the reader can
// say why a caption still has no figure and try again (SPEC.md §15).
export type RenderReport = {
  // The page needed a browser and one is configured: a render ran.
  attempted: boolean;
  // Why the render, or its chart capture, did not deliver — the connection
  // refused, the time up, a loop not found — or null when nothing failed.
  error: string | null;
  charts: CaptureResult | null;
  // The interactive figures pictured in their place, and those not.
  pictures?: CaptureInteractiveResult | null;
};

export type RenderResult = { page: FetchedPage; render: RenderReport };

const NO_RENDER: RenderReport = { attempted: false, error: null, charts: null };

export type RenderOptions = {
  // Store the loops of animated charts as GIFs (an ingest or a re-parse);
  // the account the images are recorded under. Absent (the upload
  // assistant's review): animated charts settle, nothing is stored.
  store?: { userId: string | null };
};

/** A figure its scripts fill later: something inside, but no media and no
    words outside its caption — a lazy-loading image's placeholder. */
function isEmptyFigure(figure: Element): boolean {
  if (figure.children.length === 0) return false;
  if (figure.querySelector("img, picture, video, audio, iframe, svg, canvas, object, embed")) return false;
  const words = figure.cloneNode(true) as Element;
  for (const caption of words.querySelectorAll("figcaption")) caption.remove();
  return !words.textContent?.trim();
}

// Players the sanitizer embeds (sanitize.ts EMBED_HOSTS): a frame from one
// of them needs no picture.
const EMBED_HOST_RE = /^(?:www\.youtube\.com|www\.youtube-nocookie\.com|youtube\.com|player\.vimeo\.com)$/i;

/** Does the static HTML show figures its scripts draw later, or figures
    only a picture can keep (lib/parse/capture-interactive.ts)? An empty
    chart svg, a canvas, an empty figure, a box labeled as a picture with
    nothing in it, a frame from a host the sanitizer refuses or with no
    source, or a play button around a poster, outside the page's chrome. */
export function needsBrowserRender(html: string): boolean {
  if (!/<(?:svg|canvas|figure|iframe|button|a)\b|role="img"/i.test(html)) return false;
  try {
    const dom = new JSDOM(html, { virtualConsole: new VirtualConsole() });
    const { document } = dom.window;
    const inContent = (el: Element) => el.closest("nav, header, footer") === null;
    if ([...document.querySelectorAll("canvas")].some(inContent)) return true;
    if ([...document.querySelectorAll("figure")].some((figure) => isEmptyFigure(figure) && inContent(figure))) return true;
    if ([...document.querySelectorAll("[role='img']")].some((el) => inContent(el) && !el.querySelector("img, picture, svg, video, canvas"))) return true;
    const frameHost = (el: Element) => {
      try {
        return new URL(el.getAttribute("src") ?? "", "https://x/").hostname;
      } catch {
        return "";
      }
    };
    if ([...document.querySelectorAll("iframe")].some((el) => inContent(el) && !isEmptyFigure(el) && (!el.hasAttribute("src") || !EMBED_HOST_RE.test(frameHost(el))))) return true;
    if (
      [...document.querySelectorAll("button, a, [role='button']")].some(
        (el) => inContent(el) && /\b(?:play|video)\b/i.test(`${el.getAttribute("aria-label") ?? ""} ${el.getAttribute("title") ?? ""}`) && el.querySelector("img[src]") && !el.querySelector("video"),
      )
    )
      return true;
    return [...document.querySelectorAll("svg[viewBox]")].some(
      (svg) => isEmptyChart(svg) && inContent(svg) && svg.parentElement?.closest("svg") === null,
    );
  } catch {
    return false;
  }
}

/** The page as a browser renders it, when the static page needs it and a
    browser is configured; the page itself otherwise — with the report of
    what the render did. Never throws: a failed render leaves the static
    page standing and says why. */
export async function renderIfNeeded(
  page: FetchedPage,
  url: string,
  onProgress?: OnIngestProgress,
  options: RenderOptions = {},
): Promise<RenderResult> {
  if (page.kind !== "html" || !browserConfigured() || !needsBrowserRender(page.html)) {
    return { page, render: NO_RENDER };
  }
  try {
    const t = await serverT();
    // The render is the longest part of a URL ingest. It reports each phase
    // it enters — opening, scrolling, settling chart n of m — so the ingest
    // card keeps moving instead of standing on one line (SPEC.md §15).
    const report: RenderProgress = (detail) => onProgress?.("fetch", detail);
    report(t("api.renderingPage"));
    const store: CaptureStore | null = options.store ? imageStore(options.store.userId) : null;
    const rendered = await withTimeout(
      renderInBrowser(url, store, t, report),
      RENDER_TIMEOUT_MS,
      "the browser ran out of time",
    );
    const render: RenderReport = { attempted: true, error: rendered.error, charts: rendered.charts, pictures: rendered.pictures };
    return { page: rendered.html.trim() ? { kind: "html", html: rendered.html } : page, render };
  } catch (err) {
    // The static page stands; the report says why the figures did not render.
    console.warn(`[render] browser render failed for ${url}:`, err);
    return { page, render: { attempted: true, error: reasonOf(err), charts: null } };
  }
}

// A failure's first line, for the reader: a Playwright error carries its
// call log under the message.
const REASON_MAX = 200;
function reasonOf(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const line = message.split("\n").find((l) => l.trim()) ?? "unknown error";
  return line.trim().slice(0, REASON_MAX);
}

/** A captured GIF or picture as an ImageAsset row; the document it belongs
    to is set once the document is saved (lib/parse/ingest.ts). */
function imageStore(userId: string | null): CaptureStore {
  return async (bytes, mimeType) => {
    try {
      const image = await db.imageAsset.create({
        data: { mimeType, size: bytes.length, data: Buffer.from(bytes), userId },
        select: { id: true },
      });
      return `/api/images/${image.id}`;
    } catch (err) {
      console.warn("[render] captured figure not stored:", err);
      return null;
    }
  };
}

type Rendered = { html: string; error: string | null; charts: CaptureResult | null; pictures: CaptureInteractiveResult | null };

// One line for the ingest card, sent as the render enters each phase.
type RenderProgress = (detail: string) => void;

async function renderInBrowser(
  url: string,
  store: CaptureStore | null,
  t: TFunc,
  report: RenderProgress,
): Promise<Rendered> {
  const startedAt = Date.now();
  const browser = await launchBrowser("parse");
  const connectedAt = Date.now();
  const sessionMs = sessionLengthOf(browser);
  const sessionEnd = sessionMs === null ? Infinity : connectedAt + sessionMs - SESSION_MARGIN_MS;
  // The render's own end, whatever the session's: every phase stops there.
  const renderEnd = startedAt + RENDER_TIMEOUT_MS - RENDER_MARGIN_MS;
  const phases: string[] = [];
  let phaseAt = Date.now();
  const phase = (name: string) => {
    phases.push(`${name} ${((Date.now() - phaseAt) / 1000).toFixed(1)}s`);
    phaseAt = Date.now();
  };
  try {
    const context = await browser.newContext({ locale: "en-US", viewport: { width: 1280, height: 900 } });
    try {
      // Scripts and stylesheets draw the figures, and the pictures of the
      // interactive figures need the page's images and fonts; media (a
      // video's file) never loads.
      await context.route("**/*", (route) => {
        const type = route.request().resourceType();
        if (type === "media") return route.abort();
        return route.continue();
      });
      const page = await context.newPage();
      page.setDefaultTimeout(STEP_TIMEOUT_MS);
      // The page's clock, so an animated chart can be stepped after the
      // scroll; it runs with real time until then. A browser that refuses
      // the clock renders without it: the charts then stand as the scroll
      // left them.
      let clockError: string | null = null;
      const clock = await page.clock.install().then(
        () => true,
        (err: unknown) => {
          console.warn("[render] the page clock is unavailable:", err);
          clockError = `the page clock is unavailable: ${reasonOf(err)}`;
          return false;
        },
      );
      report(t("api.renderingOpening"));
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS });
      await page.waitForLoadState("networkidle", { timeout: IDLE_TIMEOUT_MS }).catch(() => {});
      phase("open");
      report(t("api.renderingScrolling"));
      for (let i = 0; i < SCROLL_STEPS; i++) {
        const atBottom = await page.evaluate(() => {
          const before = window.scrollY;
          window.scrollBy(0, window.innerHeight);
          return window.scrollY === before;
        });
        if (atBottom) break;
        await page.waitForTimeout(SCROLL_WAIT_MS);
      }
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(SETTLE_MS);
      phase("scroll");
      // The interactive figures, pictured in their place while the page
      // runs with real time (a 3D viewer draws on its own clock). A
      // picture that fails leaves its element as it is.
      let pictures: CaptureInteractiveResult | null = null;
      if (store) {
        report(t("api.renderingPictures"));
        pictures = await captureInteractiveFigures(page, { store, deadline: Math.min(Date.now() + PICTURES_BUDGET_MS, sessionEnd, renderEnd) });
        if (pictures.found > 0) console.info(`[render] interactive figures: ${pictures.pictured} pictured, ${pictures.failed} not, of ${pictures.found}`);
        phase("pictures");
      }
      // The page as the scroll left it is the render; the capture improves
      // on it. A capture that fails or runs out of time never costs the
      // render — the figures stay as they are.
      const serialize = async () => `<!DOCTYPE html>\n${await page.evaluate(() => document.documentElement.outerHTML)}`;
      let html = await serialize();
      if (!clock) return { html, error: clockError, charts: null, pictures };
      try {
        const deadline = Math.min(Date.now() + CAPTURE_BUDGET_MS, sessionEnd, renderEnd);
        if (deadline <= Date.now()) throw new Error("the browser's session is over before the charts");
        const capture = captureAnimatedCharts(page, {
          store,
          deadline,
          onChart: (n, total) => report(t("api.renderingChart", { n, total })),
        });
        // Past the time limit the capture keeps failing against a closing
        // page; nobody is waiting for it then.
        capture.catch(() => {});
        const charts = await withTimeout(capture, Math.max(1_000, deadline - Date.now() + 10_000), "the chart capture ran out of time");
        phase("charts");
        console.info(`[render] charts: ${charts.still} still, ${charts.settled} settled, ${charts.looped} looped, ${charts.undecided} undecided; ${phases.join(", ")}`);
        html = await serialize();
        // A chart that neither held still nor repeated in the time sampled
        // stands as the scroll left it: the reason a caption may still
        // have no figure.
        const error =
          charts.undecided > 0
            ? `${charts.undecided} animated chart${charts.undecided === 1 ? "" : "s"} neither settled nor looped in the time sampled`
            : null;
        return { html, error, charts, pictures };
      } catch (err) {
        console.warn("[render] chart capture failed; the scrolled page stands:", err);
        return { html, error: `the chart capture failed: ${reasonOf(err)}`, charts: null, pictures };
      }
    } finally {
      await context.close().catch(() => {});
    }
  } finally {
    await browser.close().catch(() => {});
  }
}
