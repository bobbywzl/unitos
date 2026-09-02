import type { Browser, Page } from "playwright-core";
import { parseJson3, parseXml, pickTrack, trackUrl, type TrackList } from "@/lib/video/captions";
import { normalizeSegments, type TranscriptSegment } from "@/lib/video/segments";
import { parseTimeInput } from "@/lib/video/types";
import { youtubeWatchUrl } from "@/lib/video/youtube";

// The browser rung (SPEC.md §11): a real browser opens the watch page and
// reads the transcript the way a person does — the page's own caption track
// first, then the Show transcript panel. It runs only where a browser is
// configured: BROWSER_WS_ENDPOINT, the CDP websocket of a browser service
// (Browserless, Browserbase, a Chromium started with --remote-debugging-port),
// or CHROMIUM_PATH, a Chromium binary on the server (CHROMIUM_ARGS adds
// flags). YouTube answers a browser on a datacenter IP with the same captcha
// it gives a plain fetch, so on Vercel the rung needs the service; on a
// desktop or a self-hosted server a local Chromium is enough.

const BROWSER_TIMEOUT_MS = 75_000;
const NAVIGATION_TIMEOUT_MS = 30_000;
const STEP_TIMEOUT_MS = 15_000;

const reason = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function browserConfigured(): boolean {
  return Boolean(process.env.BROWSER_WS_ENDPOINT || process.env.CHROMIUM_PATH);
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** The transcript YouTube shows, read by a browser. Throws with the reason
    when no browser is configured, the page is a captcha, or nothing loads. */
export async function browserCaptions(youtubeId: string): Promise<TranscriptSegment[]> {
  const endpoint = process.env.BROWSER_WS_ENDPOINT;
  const executable = process.env.CHROMIUM_PATH;
  if (!endpoint && !executable) {
    throw new Error("BROWSER_WS_ENDPOINT and CHROMIUM_PATH are not set");
  }
  const { chromium } = await import("playwright-core");
  const browser: Browser = endpoint
    ? await chromium.connectOverCDP(endpoint, { timeout: 20_000 })
    : await chromium.launch({
        executablePath: executable,
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-dev-shm-usage",
          "--mute-audio",
          ...(process.env.CHROMIUM_ARGS?.split(/\s+/).filter(Boolean) ?? []),
        ],
      });
  try {
    return await withTimeout(
      readInBrowser(browser, youtubeId),
      BROWSER_TIMEOUT_MS,
      "the browser ran out of time",
    );
  } finally {
    await browser.close().catch(() => {});
  }
}

async function readInBrowser(browser: Browser, youtubeId: string): Promise<TranscriptSegment[]> {
  const context = await browser.newContext({ locale: "en-US", viewport: { width: 1280, height: 900 } });
  // The transcript is text: media, images, and fonts never load.
  await context.route("**/*", (route) => {
    const request = route.request();
    const type = request.resourceType();
    if (
      type === "media" ||
      type === "image" ||
      type === "font" ||
      request.url().includes("googlevideo.com")
    ) {
      return route.abort();
    }
    return route.continue();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(STEP_TIMEOUT_MS);

  // The panel's own answer, caught on the wire: millisecond cues, exactly
  // what the panel renders. Lands after the Show transcript click.
  const wire: TranscriptSegment[][] = [];
  page.on("response", (res) => {
    if (!res.url().includes("/youtubei/v1/get_transcript")) return;
    res
      .json()
      .then((body: unknown) => {
        const segments = panelSegments(body);
        if (segments.length > 0) wire.push(segments);
      })
      .catch(() => {});
  });

  await page.goto(`${youtubeWatchUrl(youtubeId)}&hl=en`, {
    waitUntil: "domcontentloaded",
    timeout: NAVIGATION_TIMEOUT_MS,
  });
  if (/\/sorry\//.test(page.url())) throw new Error("YouTube asked this browser for a captcha");
  // The consent dialog some regions get.
  await clickIfPresent(page, 'button:has-text("Accept all")');

  const failures: string[] = [];
  try {
    const segments = await pageCaptionTrack(page);
    if (segments.length > 0) return segments;
    failures.push("page track: no cues");
  } catch (err) {
    failures.push(`page track: ${reason(err)}`);
  }
  try {
    const segments = await transcriptPanel(page, wire);
    if (segments.length > 0) return segments;
    failures.push("panel: no segments");
  } catch (err) {
    failures.push(`panel: ${reason(err)}`);
  }
  throw new Error(failures.join("; "));
}

async function clickIfPresent(page: Page, selector: string): Promise<boolean> {
  const target = page.locator(selector).first();
  if ((await target.count()) === 0) return false;
  await target.click({ timeout: 5_000 }).catch(() => {});
  return true;
}

// 1. The page's own player response names the caption tracks; the picked one
// fetches from inside the page, with the page's cookies and origin.
async function pageCaptionTrack(page: Page): Promise<TranscriptSegment[]> {
  const found = await page.evaluate((): { list: TrackList | null; status: string } => {
    type Track = { baseUrl?: unknown; languageCode?: unknown; kind?: unknown };
    type Renderer = {
      captionTracks?: Track[];
      audioTracks?: { defaultCaptionTrackIndex?: unknown }[];
      defaultAudioTrackIndex?: number;
    };
    const w = window as unknown as {
      ytInitialPlayerResponse?: {
        playabilityStatus?: { status?: unknown; reason?: unknown };
        captions?: { playerCaptionsTracklistRenderer?: Renderer };
      };
    };
    const response = w.ytInitialPlayerResponse;
    const playability = response?.playabilityStatus;
    const status =
      typeof playability?.reason === "string"
        ? playability.reason
        : typeof playability?.status === "string"
          ? playability.status
          : response
            ? "no playability status"
            : "no player response";
    const renderer = response?.captions?.playerCaptionsTracklistRenderer;
    if (!renderer || !Array.isArray(renderer.captionTracks)) return { list: null, status };
    const tracks = renderer.captionTracks
      .filter((t) => typeof t?.baseUrl === "string")
      .map((t) => ({
        baseUrl: t.baseUrl as string,
        languageCode: typeof t.languageCode === "string" ? t.languageCode : undefined,
        kind: typeof t.kind === "string" ? t.kind : undefined,
      }));
    if (tracks.length === 0) return { list: null, status };
    const index = renderer.audioTracks?.[renderer.defaultAudioTrackIndex ?? 0]?.defaultCaptionTrackIndex;
    return { list: { tracks, defaultIndex: typeof index === "number" ? index : null }, status };
  });
  const list = found.list;
  // The page names no tracks: for a video that has them, the page is
  // YouTube's bot-check variant, and its playability reason says so.
  if (!list) throw new Error(`the page names no caption tracks (${found.status})`);
  const body = await page.evaluate(async (url: string) => {
    const res = await fetch(url, { credentials: "include" });
    return res.ok ? res.text() : "";
  }, trackUrl(pickTrack(list).baseUrl, "json3"));
  return parseJson3(body) ?? parseXml(body) ?? [];
}

// 2. The Show transcript panel: "...more" under the title expands the
// description, the button lives there, and the panel lists one row per cue.
async function transcriptPanel(page: Page, wire: TranscriptSegment[][]): Promise<TranscriptSegment[]> {
  await clickIfPresent(page, "#description-inline-expander #expand");
  const button = page
    .locator('ytd-video-description-transcript-section-renderer button, button[aria-label="Show transcript"]')
    .first();
  await button.waitFor({ state: "visible" });
  await button.click();
  await page.waitForSelector("ytd-transcript-segment-renderer");
  // The wire answer lands with the rows; use it when it came.
  await page.waitForTimeout(500);
  if (wire.length > 0) return wire[0];

  const rows = await page.$$eval("ytd-transcript-segment-renderer", (elements) =>
    elements.map((el) => ({
      time: el.querySelector(".segment-timestamp")?.textContent?.trim() ?? "",
      text: el.querySelector(".segment-text")?.textContent?.trim() ?? "",
    })),
  );
  // A row carries its start; it ends where the next row begins.
  const starts = rows.map((row) => parseTimeInput(row.time));
  const segments: TranscriptSegment[] = [];
  rows.forEach((row, i) => {
    const start = starts[i];
    if (start === null || row.text === "") return;
    const next = starts.slice(i + 1).find((s): s is number => s !== null && s > start);
    segments.push({ start, end: next ?? start + 4, text: row.text });
  });
  return normalizeSegments(segments);
}

// The get_transcript answer: every transcriptSegmentRenderer in it, wherever
// the panel nests them.
function panelSegments(body: unknown): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (typeof node !== "object" || node === null) return;
    const record = node as Record<string, unknown>;
    const renderer = record.transcriptSegmentRenderer;
    if (typeof renderer === "object" && renderer !== null) {
      const r = renderer as { startMs?: unknown; endMs?: unknown; snippet?: { runs?: { text?: unknown }[] } };
      const start = Number(r.startMs);
      const end = Number(r.endMs);
      const text = (Array.isArray(r.snippet?.runs) ? r.snippet.runs : [])
        .map((run) => (typeof run?.text === "string" ? run.text : ""))
        .join("")
        .replace(/\s+/g, " ")
        .trim();
      if (Number.isFinite(start) && text !== "") {
        segments.push({ start: start / 1000, end: (Number.isFinite(end) ? end : start + 4000) / 1000, text });
      }
      return;
    }
    Object.values(record).forEach(walk);
  };
  walk(body);
  return normalizeSegments(segments);
}
