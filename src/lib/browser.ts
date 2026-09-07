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
// render with a chart capture (lib/parse/render-page.ts) — so an endpoint
// there that sets none gets this one; every other endpoint is used as given.
const SESSION_TIMEOUT_MS = 300_000;

function sessionEndpoint(endpoint: string): string {
  try {
    const url = new URL(endpoint);
    if (!/(^|\.)browserless\.io$/i.test(url.hostname) || url.searchParams.has("timeout")) return endpoint;
    url.searchParams.set("timeout", String(SESSION_TIMEOUT_MS));
    return url.toString();
  } catch {
    return endpoint;
  }
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
  if (endpoint) return chromium.connectOverCDP(sessionEndpoint(endpoint), { timeout: CONNECT_TIMEOUT_MS });
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
