import { JSDOM, VirtualConsole } from "jsdom";
import { browserConfigured, launchBrowser, withTimeout } from "@/lib/browser";
import { serverT } from "@/lib/i18n/server";
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

const RENDER_TIMEOUT_MS = 60_000;
const NAVIGATION_TIMEOUT_MS = 30_000;
const IDLE_TIMEOUT_MS = 10_000;
const STEP_TIMEOUT_MS = 15_000;
// One viewport per step, a short wait for the charts that draw on scroll.
const SCROLL_STEPS = 40;
const SCROLL_WAIT_MS = 250;
const SETTLE_MS = 500;

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
    browser is configured; the page itself otherwise. Never throws: a failed
    render leaves the static page standing. */
export async function renderIfNeeded(
  page: FetchedPage,
  url: string,
  onProgress?: OnIngestProgress,
): Promise<FetchedPage> {
  if (page.kind !== "html" || !browserConfigured() || !needsBrowserRender(page.html)) return page;
  try {
    const t = await serverT();
    onProgress?.("fetch", t("api.renderingPage"));
    const html = await withTimeout(renderInBrowser(url), RENDER_TIMEOUT_MS, "the browser ran out of time");
    return html.trim() ? { kind: "html", html } : page;
  } catch {
    return page;
  }
}

async function renderInBrowser(url: string): Promise<string> {
  const browser = await launchBrowser();
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
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS });
      await page.waitForLoadState("networkidle", { timeout: IDLE_TIMEOUT_MS }).catch(() => {});
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
      const html = await page.evaluate(() => document.documentElement.outerHTML);
      return `<!DOCTYPE html>\n${html}`;
    } finally {
      await context.close().catch(() => {});
    }
  } finally {
    await browser.close().catch(() => {});
  }
}
