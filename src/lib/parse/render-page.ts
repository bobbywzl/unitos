import { JSDOM, VirtualConsole } from "jsdom";
import { browserConfigured, launchBrowser, sessionLengthOf, withTimeout } from "@/lib/browser";
import { db } from "@/lib/db";
import type { TFunc } from "@/lib/i18n/dictionaries";
import { serverT } from "@/lib/i18n/server";
import { captureAnimatedCharts, type CaptureResult, type CaptureStore } from "@/lib/parse/capture-animation";
import type { FetchedPage } from "@/lib/parse/fetch-page";
import { isEmptyChart } from "@/lib/parse/figures";
import type { OnIngestProgress } from "@/lib/parse/ingest";

// A page whose figures are drawn by its scripts (a chart svg empty in the
// server's HTML, a canvas) has no figure to parse in the static page. Where a
// browser is configured (BROWSER_WS_ENDPOINT or CHROMIUM_PATH, the same
// browser SPEC.md §11 uses for transcripts; lib/browser.ts), the page renders
// in it at 1280×900, scrolls through so scroll-revealed charts draw, and the
// rendered DOM parses in the static page's place. Without a browser the
// static page stands.
//
// A chart the page's scripts animate settles first (lib/parse/capture-animation.ts):
// the page's clock is paused and stepped, a one-shot animation is drawn to
// its end, and a loop — when the render stores images — is recorded as a
// GIF, stored as an ImageAsset, and takes the svg's place as an <img> of the
// reader's own /api/images/<id> path.

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
// stored before the service closes the page, with this much to spare.
const CAPTURE_BUDGET_MS = 110_000;
const SESSION_MARGIN_MS = 6_000;

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
};

export type RenderResult = { page: FetchedPage; render: RenderReport };

const NO_RENDER: RenderReport = { attempted: false, error: null, charts: null };

export type RenderOptions = {
  // Store the loops of animated charts as GIFs (an ingest or a re-parse);
  // the account the images are recorded under. Absent (the upload
  // assistant's review): animated charts settle, nothing is stored.
  store?: { userId: string | null };
};

/** Does the static HTML show figures its scripts draw later? An empty chart
    svg or a canvas outside the page's chrome. */
export function needsBrowserRender(html: string): boolean {
  if (!/<(?:svg|canvas)\b/i.test(html)) return false;
  try {
    const dom = new JSDOM(html, { virtualConsole: new VirtualConsole() });
    const { document } = dom.window;
    const inContent = (el: Element) => el.closest("nav, header, footer") === null;
    if ([...document.querySelectorAll("canvas")].some(inContent)) return true;
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
    const render: RenderReport = { attempted: true, error: rendered.error, charts: rendered.charts };
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

/** A captured GIF as an ImageAsset row; the document it belongs to is set
    once the document is saved (lib/parse/ingest.ts). */
function imageStore(userId: string | null): CaptureStore {
  return async (gif) => {
    try {
      const image = await db.imageAsset.create({
        data: { mimeType: "image/gif", size: gif.length, data: Buffer.from(gif), userId },
        select: { id: true },
      });
      return `/api/images/${image.id}`;
    } catch (err) {
      console.warn("[render] captured chart not stored:", err);
      return null;
    }
  };
}

type Rendered = { html: string; error: string | null; charts: CaptureResult | null };

// One line for the ingest card, sent as the render enters each phase.
type RenderProgress = (detail: string) => void;

async function renderInBrowser(
  url: string,
  store: CaptureStore | null,
  t: TFunc,
  report: RenderProgress,
): Promise<Rendered> {
  const browser = await launchBrowser();
  const connectedAt = Date.now();
  const sessionMs = sessionLengthOf(browser);
  const sessionEnd = sessionMs === null ? Infinity : connectedAt + sessionMs - SESSION_MARGIN_MS;
  try {
    const context = await browser.newContext({ locale: "en-US", viewport: { width: 1280, height: 900 } });
    try {
      // Scripts and stylesheets draw the figures; media, images, and fonts
      // never load.
      await context.route("**/*", (route) => {
        const type = route.request().resourceType();
        if (type === "media" || type === "image" || type === "font") return route.abort();
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
      // The page as the scroll left it is the render; the capture improves
      // on it. A capture that fails or runs out of time never costs the
      // render — the figures stay as they are.
      const serialize = async () => `<!DOCTYPE html>\n${await page.evaluate(() => document.documentElement.outerHTML)}`;
      let html = await serialize();
      if (!clock) return { html, error: clockError, charts: null };
      try {
        const deadline = Math.min(Date.now() + CAPTURE_BUDGET_MS, sessionEnd);
        if (deadline <= Date.now()) throw new Error("the browser's session is over before the charts");
        const capture = captureAnimatedCharts(page, {
          store,
          deadline,
          onChart: (n, total) => report(t("api.renderingChart", { n, total })),
        });
        // Past the time limit the capture keeps failing against a closing
        // page; nobody is waiting for it then.
        capture.catch(() => {});
        const charts = await withTimeout(capture, CAPTURE_BUDGET_MS + 10_000, "the chart capture ran out of time");
        console.info(`[render] charts: ${charts.still} still, ${charts.settled} settled, ${charts.looped} looped, ${charts.undecided} undecided`);
        html = await serialize();
        // A chart that neither held still nor repeated in the time sampled
        // stands as the scroll left it: the reason a caption may still
        // have no figure.
        const error =
          charts.undecided > 0
            ? `${charts.undecided} animated chart${charts.undecided === 1 ? "" : "s"} neither settled nor looped in the time sampled`
            : null;
        return { html, error, charts };
      } catch (err) {
        console.warn("[render] chart capture failed; the scrolled page stands:", err);
        return { html, error: `the chart capture failed: ${reasonOf(err)}`, charts: null };
      }
    } finally {
      await context.close().catch(() => {});
    }
  } finally {
    await browser.close().catch(() => {});
  }
}
