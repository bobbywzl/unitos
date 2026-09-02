import { outboundFetch, type OutboundResponse } from "@/lib/outbound-fetch";
import type { OnIngestProgress } from "@/lib/parse/ingest";
import { serverT } from "@/lib/i18n/server";

// The page fetch behind every URL add (ingest, the upload assistant's review,
// re-parse). One fetch, one honest failure: when the page cannot be read, the
// error says why in one word, and lib/parse/ingest-error.ts turns that word
// into a sentence for the reader.

export type FetchFailure =
  | "blocked" // a bot wall or a sign-in wall: HTTP 401/403, or a human-check page
  | "notFound" // HTTP 404/410
  | "rateLimited" // HTTP 429
  | "serverError" // HTTP 5xx
  | "timeout" // no answer in time
  | "unreachable"; // DNS, connection, or TLS failure

export class FetchPageError extends Error {
  readonly failure: FetchFailure;
  readonly host: string;
  readonly status: number | null;

  constructor(failure: FetchFailure, host: string, status: number | null) {
    super(`Fetch failed: ${failure}${status === null ? "" : ` (HTTP ${status})`} at ${host}`);
    this.name = "FetchPageError";
    this.failure = failure;
    this.host = host;
    this.status = status;
  }
}

// A link to a PDF file reads as a PDF, not as a web page.
export type FetchedPage =
  | { kind: "html"; html: string }
  | { kind: "pdf"; bytes: Uint8Array<ArrayBuffer> };

const FETCH_TIMEOUT_MS = 30_000;
const ARCHIVE_TIMEOUT_MS = 20_000;

// A browser-shaped request. Sites that turn away "compatible; bot" agents
// serve a plain browser; the app still names itself at the end.
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 Unitos/1.0",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,application/pdf;q=0.8,*/*;q=0.7",
  "Accept-Language": "en-US,en;q=0.9,zh-CN;q=0.8",
};

// A human-check page instead of the article: DataDome, Cloudflare, Akamai,
// PerimeterX, Imperva, and plain "access denied" walls. Short pages only — a
// real article that mentions a captcha is long.
const CHALLENGE_MAX_CHARS = 20_000;
const CHALLENGE_SIGNS = [
  "please enable js",
  "enable javascript and cookies",
  "just a moment...",
  "attention required",
  "access denied",
  "verify you are human",
  "verify that you are human",
  "are you a robot",
  "captcha-delivery",
  "cf-chl",
  "px-captcha",
  "perimeterx",
  "_incapsula_",
  "datadome",
  "pardon our interruption",
  "request blocked",
];

export function isChallengePage(html: string): boolean {
  if (html.length > CHALLENGE_MAX_CHARS) return false;
  const lower = html.toLowerCase();
  return CHALLENGE_SIGNS.some((sign) => lower.includes(sign));
}

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function failureOfStatus(status: number): FetchFailure {
  if (status === 401 || status === 403) return "blocked";
  if (status === 404 || status === 410) return "notFound";
  if (status === 429) return "rateLimited";
  if (status >= 500) return "serverError";
  return "blocked";
}

function failureOfThrow(err: unknown): FetchFailure {
  const name = err instanceof Error ? err.name : "";
  if (name === "TimeoutError" || name === "AbortError") return "timeout";
  return "unreachable";
}

function isPdf(res: OutboundResponse, head: Uint8Array): boolean {
  const type = res.headers.get("content-type") ?? "";
  if (type.includes("application/pdf")) return true;
  return head.length >= 5 && String.fromCharCode(...head.slice(0, 5)) === "%PDF-";
}

async function readPage(res: OutboundResponse): Promise<FetchedPage> {
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (isPdf(res, bytes)) return { kind: "pdf", bytes };
  return { kind: "html", html: new TextDecoder().decode(bytes) };
}

async function request(url: string, timeoutMs: number): Promise<OutboundResponse> {
  return outboundFetch(url, { headers: HEADERS, signal: AbortSignal.timeout(timeoutMs) });
}

// The archived copy on the Wayback Machine: the original bytes of the latest
// snapshot (id_ leaves the page unrewritten). Only tried when the site itself
// turned the request away; a missing snapshot answers 404.
async function fetchArchivedCopy(url: string): Promise<FetchedPage | null> {
  try {
    const res = await request(`https://web.archive.org/web/2id_/${url}`, ARCHIVE_TIMEOUT_MS);
    if (!res.ok) return null;
    const page = await readPage(res);
    if (page.kind === "html" && isChallengePage(page.html)) return null;
    return page;
  } catch {
    return null;
  }
}

/** Fetch one page for reading. Throws FetchPageError with the reason. */
export async function fetchPage(url: string, onProgress?: OnIngestProgress): Promise<FetchedPage> {
  const host = hostOf(url);
  let failure: FetchFailure;
  let status: number | null = null;
  try {
    const res = await request(url, FETCH_TIMEOUT_MS);
    if (res.ok) {
      const page = await readPage(res);
      if (page.kind === "pdf" || !isChallengePage(page.html)) return page;
      failure = "blocked";
    } else {
      status = res.status;
      failure = failureOfStatus(res.status);
    }
  } catch (err) {
    failure = failureOfThrow(err);
  }

  if (failure === "blocked" || failure === "rateLimited") {
    const t = await serverT();
    onProgress?.("fetch", t("api.fetchArchivedCopy", { host }));
    const archived = await fetchArchivedCopy(url);
    if (archived) return archived;
  }
  throw new FetchPageError(failure, host, status);
}
