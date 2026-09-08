import type { Browser } from "playwright-core";

// The browser every rung that needs a real page shares (SPEC.md §11): the
// transcript rung (lib/video/browser-transcript.ts) and the page render for
// scripted figures (lib/parse/render-page.ts). It runs only where a browser
// is configured: BROWSER_WS_ENDPOINT, the CDP websocket of a browser service
// (Browserless, Browserbase, a Chromium started with --remote-debugging-port),
// or CHROMIUM_PATH, a Chromium binary on the server (CHROMIUM_ARGS adds
// flags).

const CONNECT_TIMEOUT_MS = 20_000;
// The longest a session may run. Browserless ends a session at its `timeout`
// query parameter — 60 s unless the endpoint sets one, shorter than a page
// render with a chart capture (lib/parse/render-page.ts) — and refuses one
// past the plan's maximum (400; 2 minutes on the free plan), so an endpoint
// there that sets none is tried with each of these in turn, then as given;
// every other endpoint is used as given.
const SESSION_TIMEOUTS_MS = [300_000, 120_000];
const BROWSERLESS_DEFAULT_SESSION_MS = 60_000;

// An endpoint to try, and how long its session lasts: null when nothing ends
// it that is known here.
type Candidate = { url: string; sessionMs: number | null };

function sessionEndpoints(endpoint: string): Candidate[] {
  try {
    const url = new URL(endpoint);
    if (!/(^|\.)browserless\.io$/i.test(url.hostname)) return [{ url: endpoint, sessionMs: null }];
    const given = url.searchParams.get("timeout");
    if (given !== null) return [{ url: endpoint, sessionMs: Number(given) > 0 ? Number(given) : null }];
    return [
      ...SESSION_TIMEOUTS_MS.map((ms) => {
        const withTimeout = new URL(url);
        withTimeout.searchParams.set("timeout", String(ms));
        return { url: withTimeout.toString(), sessionMs: ms };
      }),
      { url: endpoint, sessionMs: BROWSERLESS_DEFAULT_SESSION_MS },
    ];
  } catch {
    return [{ url: endpoint, sessionMs: null }];
  }
}

// The session length each connected browser got, for the render's time
// budget (lib/parse/render-page.ts).
const sessionLengths = new WeakMap<Browser, number>();

// The candidate the endpoint accepted last time, so the next connection on
// this server skips the ones the plan refuses: the free plan refused 300 s
// on every render before, one round trip to the service each time.
let acceptedCandidate: string | null = null;

/** How long the browser's session lasts from its connection, in ms; null
    when nothing known ends it (a local Chromium, another service). */
export function sessionLengthOf(browser: Browser): number | null {
  return sessionLengths.get(browser) ?? null;
}

export function browserConfigured(): boolean {
  return Boolean(process.env.BROWSER_WS_ENDPOINT || process.env.CHROMIUM_PATH);
}

/** The configured browser, connected or launched. Throws with the reason
    when none is configured or it will not start. The caller closes it. */
export async function launchBrowser(): Promise<Browser> {
  const endpoint = process.env.BROWSER_WS_ENDPOINT;
  const executable = process.env.CHROMIUM_PATH;
  if (!endpoint && !executable) {
    throw new Error("BROWSER_WS_ENDPOINT and CHROMIUM_PATH are not set");
  }
  const { chromium } = await import("playwright-core");
  if (endpoint) {
    const all = sessionEndpoints(endpoint);
    const known = all.findIndex((c) => c.url === acceptedCandidate);
    const candidates = known === -1 ? all : all.slice(known);
    for (let i = 0; i < candidates.length; i++) {
      try {
        const { url, sessionMs } = candidates[i];
        const browser = await chromium.connectOverCDP(url, { timeout: CONNECT_TIMEOUT_MS });
        if (sessionMs !== null) sessionLengths.set(browser, sessionMs);
        acceptedCandidate = url;
        return browser;
      } catch (err) {
        // A plan that caps the session shorter answers 400 to the timeout:
        // the next candidate asks for less; the endpoint as given is last,
        // and the capture reports if the session ends before it is done.
        const last = i === candidates.length - 1;
        if (last || !/\b400\b/.test(err instanceof Error ? err.message : String(err))) throw err;
        console.warn("[browser] the session timeout was refused; asking for less:", err);
      }
    }
  }
  const extra = process.env.CHROMIUM_ARGS?.split(/\s+/).filter(Boolean) ?? [];
  return chromium.launch({
    executablePath: executable,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--mute-audio", ...proxyArgs(extra), ...extra],
  });
}

/** The egress proxy every outbound fetch takes (HTTPS_PROXY,
    lib/outbound-fetch.ts), for a browser that does not read the variable;
    CHROMIUM_ARGS naming its own proxy wins. */
function proxyArgs(extra: string[]): string[] {
  const proxy = process.env.HTTPS_PROXY;
  if (!proxy || extra.some((arg) => arg.startsWith("--proxy-server"))) return [];
  const bypass = (process.env.NO_PROXY ?? process.env.no_proxy ?? "")
    .split(",")
    .map((host) => host.trim())
    .filter(Boolean);
  return [`--proxy-server=${proxy}`, ...(bypass.length > 0 ? [`--proxy-bypass-list=${bypass.join(";")}`] : [])];
}

/** The promise, or an error with the message when it takes longer. */
export function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
