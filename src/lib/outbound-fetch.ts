// Fetch for outbound HTTP (URL ingest). When HTTPS_PROXY/HTTP_PROXY
// is set (hosts that route egress through a proxy), load undici and use its
// EnvHttpProxyAgent. Global fetch otherwise. undici loads lazily so it stays out of
// route module graphs on serverless hosts.

export type OutboundInit = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
};

export type OutboundResponse = {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
  json(): Promise<unknown>;
  arrayBuffer(): Promise<ArrayBuffer>;
};

type Outbound = (url: string, init: OutboundInit) => Promise<OutboundResponse>;

let proxied: Outbound | undefined;

export async function outboundFetch(
  url: string,
  init: OutboundInit = {},
): Promise<OutboundResponse> {
  if (!process.env.HTTPS_PROXY && !process.env.HTTP_PROXY) return fetch(url, init);
  if (!proxied) {
    const { fetch: undiciFetch, EnvHttpProxyAgent } = await import("undici");
    const dispatcher = new EnvHttpProxyAgent();
    proxied = (u, i) => undiciFetch(u, { ...i, dispatcher });
  }
  return proxied(url, init);
}
