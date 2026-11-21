import type { OutboundResponse } from "@/lib/outbound-fetch";
import { PublicUrlError, publicFetch } from "@/lib/public-url";
import { decodePage } from "@/lib/parse/charset";
import type { OnIngestProgress } from "@/lib/parse/ingest";
import { serverT } from "@/lib/i18n/server";

// The page fetch behind every URL add (ingest, the upload assistant's review,
// re-parse). One fetch, one honest failure: when the page cannot be read, the
// error says why in one word, and lib/parse/ingest-error.ts turns that word
// into a sentence for the reader.

export type FetchFailure =
  | "blocked" // a bot wall or a sign-in wall: HTTP 401/403, or a human-check page
  | "wall" // the page fetched, but it is a consent, sign-in, subscription, or error page, not the article (lib/parse/page-kind.ts)
  | "notFound" // HTTP 404/410
  | "rateLimited" // HTTP 429
  | "serverError" // HTTP 5xx
  | "timeout" // no answer in time
  | "unreachable" // DNS, connection, or TLS failure
  | "scheme" // the link is not http or https
  | "private" // the link, or a redirect of it, points at this machine or a private network (lib/public-url.ts)
  | "image" // the link is an image file, not a page
  | "file" // the link is another file that is not a page or a PDF: audio, video, an archive, bytes
  | "tooLarge"; // the answer is larger than a document may be

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
// The largest page or PDF a link may answer with: the size limit of an upload.
const MAX_PAGE_BYTES = 50 * 1024 * 1024;
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

export function hostOf(url: string): string {
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

// What the bytes are when they are not a page: an image, or another file.
// The declared type first, then the first bytes (a server may send a PNG as
// text/html, or as nothing).
function fileKind(res: OutboundResponse, head: Uint8Array): "image" | "file" | null {
  const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (type.startsWith("image/")) return "image";
  if (/^(audio|video|font)\//.test(type)) return "file";
  const starts = (...bytes: number[]) => bytes.every((b, i) => head[i] === b);
  const ascii = (from: number, word: string) => [...word].every((ch, i) => head[from + i] === ch.charCodeAt(0));
  if (starts(0x89, 0x50, 0x4e, 0x47) || starts(0xff, 0xd8, 0xff) || ascii(0, "GIF8")) return "image";
  if (ascii(0, "RIFF") && ascii(8, "WEBP")) return "image";
  // A zip (a Word file, slides, sheets too), gzip, an old Office file, MP4, MP3, Ogg, Matroska.
  if (starts(0x50, 0x4b, 0x03, 0x04) || starts(0x1f, 0x8b) || starts(0xd0, 0xcf, 0x11, 0xe0)) return "file";
  if (ascii(4, "ftyp") || ascii(0, "ID3") || ascii(0, "OggS") || starts(0x1a, 0x45, 0xdf, 0xa3) || ascii(0, "RIFF")) return "file";
  // Text holds no NUL byte, except UTF-16 and UTF-32, which open with a mark
  // or say so in the header.
  const wide = /utf-?(16|32)/i.test(res.headers.get("content-type") ?? "") || starts(0xff, 0xfe) || starts(0xfe, 0xff);
  if (!wide && head.subarray(0, 1024).includes(0)) return "file";
  return null;
}

// The answer's bytes, read up to the size limit.
async function readBytes(res: OutboundResponse, host: string): Promise<Uint8Array<ArrayBuffer>> {
  const tooLarge = () => new FetchPageError("tooLarge", host, null);
  if (Number(res.headers.get("content-length") ?? "0") > MAX_PAGE_BYTES) {
    await res.body?.cancel().catch(() => {});
    throw tooLarge();
  }
  if (!res.body) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_PAGE_BYTES) {
      await reader.cancel().catch(() => {});
      throw tooLarge();
    }
    parts.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const part of parts) {
    bytes.set(part, at);
    at += part.length;
  }
  return bytes;
}

async function readPage(res: OutboundResponse, host: string): Promise<FetchedPage> {
  // A declared image, audio, or video file is refused before its bytes load.
  const declared = fileKind(res, new Uint8Array(0));
  if (declared) {
    await res.body?.cancel().catch(() => {});
    throw new FetchPageError(declared, host, null);
  }
  const bytes = await readBytes(res, host);
  if (isPdf(res, bytes)) return { kind: "pdf", bytes };
  const kind = fileKind(res, bytes);
  if (kind) throw new FetchPageError(kind, host, null);
  return { kind: "html", html: decodePage(bytes, res.headers.get("content-type")) };
}

// Every request goes through publicFetch: the link and each of its redirects
// must be a public web address.
async function request(url: string, timeoutMs: number): Promise<OutboundResponse> {
  return publicFetch(url, { headers: HEADERS, signal: AbortSignal.timeout(timeoutMs) });
}

// The archived copy on the Wayback Machine: the original bytes of the latest
// snapshot (id_ leaves the page unrewritten). Only tried when the site itself
// turned the request away; a missing snapshot answers 404.
async function fetchArchivedCopy(url: string): Promise<FetchedPage | null> {
  try {
    const res = await request(`https://web.archive.org/web/2id_/${url}`, ARCHIVE_TIMEOUT_MS);
    if (!res.ok) return null;
    const page = await readPage(res, "web.archive.org");
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
      const page = await readPage(res, host);
      if (page.kind === "pdf" || !isChallengePage(page.html)) return page;
      failure = "blocked";
    } else {
      status = res.status;
      failure = failureOfStatus(res.status);
    }
  } catch (err) {
    // The link is refused, or it is a file: nothing else is tried.
    if (err instanceof FetchPageError) throw err;
    if (err instanceof PublicUrlError) throw new FetchPageError(err.refusal, host, null);
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
