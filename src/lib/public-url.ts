import { lookup as dnsLookup } from "node:dns";
import { lookup as dnsLookupAll } from "node:dns/promises";
import { isIP, type LookupFunction } from "node:net";
import type { OutboundInit, OutboundResponse } from "@/lib/outbound-fetch";

// The fetch for an address a reader or a web page gave (a pasted link, a
// page's stylesheet, a page's image). The server reads public web addresses
// only: a link to this machine, to the private network, or to a cloud
// metadata address is refused before any request leaves, and so is every
// redirect that leads to one. Addresses the app itself wrote (a model
// provider, Google, Stripe) keep lib/outbound-fetch.ts.

export type PublicUrlRefusal =
  | "scheme" // not http or https
  | "private"; // this machine, a private network, or a reserved address

export class PublicUrlError extends Error {
  readonly refusal: PublicUrlRefusal;
  readonly host: string;

  constructor(refusal: PublicUrlRefusal, host: string) {
    super(`Refused address: ${refusal} at ${host}`);
    this.name = "PublicUrlError";
    this.refusal = refusal;
    this.host = host;
  }
}

const MAX_REDIRECTS = 8;

function v4Private(ip: string): boolean {
  const [a, b, c] = ip.split(".").map(Number);
  if (a === 0 || a === 10 || a === 127) return true; // this network, private, loopback
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a === 169 && b === 254) return true; // link-local, cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true; // protocol assignments, documentation
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 198 && b === 51 && c === 100) return true; // documentation
  if (a === 203 && b === 0 && c === 113) return true; // documentation
  return a >= 224; // multicast, reserved, broadcast
}

/** An IPv6 address as its eight groups, or null when it does not parse. */
function v6Groups(ip: string): number[] | null {
  let text = ip.replace(/^\[|\]$/g, "").replace(/%.*$/, "").toLowerCase();
  // A dotted tail (::ffff:10.0.0.1) is its last two groups.
  const dotted = /^(.*:)(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (dotted) {
    const [, head, a, b, c, d] = dotted;
    text = `${head}${((Number(a) << 8) | Number(b)).toString(16)}:${((Number(c) << 8) | Number(d)).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string) => (part === "" ? [] : part.split(":").map((g) => parseInt(g, 16)));
  const head = parse(halves[0]);
  const tail = halves.length === 2 ? parse(halves[1]) : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0) return null;
  const groups = [...head, ...new Array<number>(fill).fill(0), ...tail];
  if (groups.length !== 8 || groups.some((g) => !Number.isInteger(g) || g < 0 || g > 0xffff)) return null;
  return groups;
}

function v6Private(ip: string): boolean {
  const g = v6Groups(ip);
  if (!g) return true; // an address that does not parse is not a public one
  const embedded = (hi: number, lo: number) => v4Private(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  if (g.slice(0, 6).every((x) => x === 0)) {
    // ::, ::1, and the old IPv4-compatible form.
    return g[6] === 0 && g[7] <= 1 ? true : embedded(g[6], g[7]);
  }
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return embedded(g[6], g[7]); // IPv4-mapped
  if (g[0] === 0x64 && g[1] === 0xff9b) return embedded(g[6], g[7]); // NAT64
  if (g[0] === 0x2002) return embedded(g[1], g[2]); // 6to4
  if ((g[0] & 0xfe00) === 0xfc00) return true; // unique local
  if ((g[0] & 0xffc0) === 0xfe80) return true; // link-local
  if ((g[0] & 0xff00) === 0xff00) return true; // multicast
  if (g[0] === 0x2001 && g[1] === 0xdb8) return true; // documentation
  return false;
}

/** Whether an IP address is this machine, a private network, or reserved. */
export function isPrivateAddress(ip: string): boolean {
  const bare = ip.replace(/^\[|\]$/g, "");
  const family = isIP(bare.replace(/%.*$/, ""));
  if (family === 4) return v4Private(bare);
  if (family === 6) return v6Private(bare);
  return true;
}

// Names that never leave the machine or the local network, whatever they
// resolve to.
function isLocalName(host: string): boolean {
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".lan") ||
    host.endsWith(".home.arpa") ||
    !host.includes(".")
  );
}

/** The address as a URL when the server may fetch it. Throws PublicUrlError
    when it is not http or https, names this machine or the private network,
    or resolves to an address of one. A name that does not resolve here
    passes: the fetch itself then fails, or the egress proxy resolves it. */
export async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new PublicUrlError("scheme", raw);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new PublicUrlError("scheme", url.host || raw);
  const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (isIP(host)) {
    if (isPrivateAddress(host)) throw new PublicUrlError("private", url.host);
    return url;
  }
  if (isLocalName(host)) throw new PublicUrlError("private", url.host);
  const addresses = await dnsLookupAll(host, { all: true }).catch(() => []);
  if (addresses.some((a) => isPrivateAddress(a.address))) throw new PublicUrlError("private", url.host);
  return url;
}

/** A DNS lookup for a socket that answers with public addresses only: the
    connection itself cannot land on a private address, even when the name's
    answer changed after assertPublicUrl read it. */
export function publicLookup(refuse: (ip: string) => boolean = isPrivateAddress): LookupFunction {
  return (hostname, options, callback) => {
    dnsLookup(hostname, { ...options, all: true }, (err, found) => {
      if (err) return callback(err, []);
      if (found.length === 0 || found.some((a) => refuse(a.address))) {
        const refused: NodeJS.ErrnoException = new Error(`Refused address: private at ${hostname}`);
        refused.code = "EPRIVATE";
        return callback(refused, []);
      }
      if (options.all) return callback(null, found);
      callback(null, found[0].address, found[0].family);
    });
  };
}

/** A check for a browser's requests (lib/parse/render-page.ts,
    lib/parse/vision-check.ts): whether the page may load this address. One
    DNS answer per host for the life of the check. data: and blob: addresses
    are the page's own bytes. */
export function publicRequestCheck(): (url: string) => Promise<boolean> {
  const hosts = new Map<string, Promise<boolean>>();
  return (url) => {
    if (/^(data|blob|about):/i.test(url)) return Promise.resolve(true);
    let host: string;
    try {
      host = new URL(url).host;
    } catch {
      return Promise.resolve(false);
    }
    let answer = hosts.get(host);
    if (!answer) {
      answer = assertPublicUrl(url).then(
        () => true,
        () => false,
      );
      hosts.set(host, answer);
    }
    return answer;
  };
}

type Fetcher = (url: string, init: OutboundInit & { redirect: "manual" }) => Promise<OutboundResponse>;

let fetcher: Promise<Fetcher> | undefined;

// One request, redirects not followed. Behind an egress proxy the proxy makes
// the connection; without one the socket's own lookup refuses a private
// address. undici loads lazily (lib/outbound-fetch.ts); where it will not
// load, the global fetch stands in and assertPublicUrl is the guard.
function loadFetcher(): Promise<Fetcher> {
  fetcher ??= (async (): Promise<Fetcher> => {
    try {
      const { fetch: undiciFetch, EnvHttpProxyAgent, Agent } = await import("undici");
      const dispatcher =
        process.env.HTTPS_PROXY || process.env.HTTP_PROXY
          ? new EnvHttpProxyAgent()
          : new Agent({ connect: { lookup: publicLookup() } });
      return (url, init) => undiciFetch(url, { ...init, dispatcher }) as Promise<OutboundResponse>;
    } catch (err) {
      console.warn("[public-url] undici did not load; using the global fetch:", err);
      return (url, init) => fetch(url, init as RequestInit);
    }
  })();
  return fetcher;
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

/** GET a reader's or a page's address. Every hop is checked: the address
    first, then each redirect's. Throws PublicUrlError on a refused hop. */
export async function publicFetch(url: string, init: Omit<OutboundInit, "method" | "body"> = {}): Promise<OutboundResponse> {
  const send = await loadFetcher();
  let next = (await assertPublicUrl(url)).toString();
  for (let hop = 0; ; hop++) {
    const res = await send(next, { ...init, redirect: "manual" });
    const location = REDIRECTS.has(res.status) ? res.headers.get("location") : null;
    if (!location) return res;
    await res.body?.cancel().catch(() => {});
    if (hop >= MAX_REDIRECTS) throw new Error("Too many redirects");
    next = (await assertPublicUrl(new URL(location, next).toString())).toString();
  }
}
