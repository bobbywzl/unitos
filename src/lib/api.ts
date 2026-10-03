import { ACCOUNT_HEADER } from "@/lib/constants";
import { DEFAULT_LANG, isLang, LANG_COOKIE, type Lang } from "@/lib/i18n/config";
import { translate } from "@/lib/i18n/dictionaries";
import { newNoteId } from "@/lib/notes/client-id";
import { isAiCall } from "@/lib/offline/ai-routes";
import { isOffline, offlinePremium, queueWrite } from "@/lib/offline/queue";
import { beginWrite, endWrite } from "@/lib/save-state";
import { tabAccount } from "@/lib/tab-account";

// Offline work (SPEC.md §17, Unitos Premium): these writes replay cleanly and
// their callers never read the response body, so while offline they queue in
// IndexedDB and sync when the browser is back online. Everything else still
// fails offline — a queued response could not stand in for the real one.
const QUEUEABLE: { method: string; path: RegExp }[] = [
  { method: "POST", path: /^\/api\/notes$/ },
  { method: "PATCH", path: /^\/api\/notes\/[^/]+$/ },
  { method: "DELETE", path: /^\/api\/notes\/[^/]+$/ },
  { method: "PATCH", path: /^\/api\/sections\/[^/]+$/ },
  { method: "POST", path: /^\/api\/replies$/ },
  { method: "PATCH", path: /^\/api\/replies\/[^/]+$/ },
  { method: "DELETE", path: /^\/api\/replies\/[^/]+$/ },
  { method: "PATCH", path: /^\/api\/blocks\/[^/]+$/ },
  { method: "DELETE", path: /^\/api\/blocks\/[^/]+$/ },
  // Join text (Merge with AI needs a model and never queues: isAiCall).
  { method: "POST", path: /^\/api\/notes\/merge$/ },
  // Resolve and Reopen on a comment.
  { method: "PATCH", path: /^\/api\/annotations\/[^/]+$/ },
  { method: "PATCH", path: /^\/api\/links\/[^/]+$/ },
  { method: "DELETE", path: /^\/api\/links\/[^/]+$/ },
];

function queueable(path: string, method: string, body: unknown): boolean {
  return QUEUEABLE.some((q) => q.method === method && q.path.test(path)) && !isAiCall(path, body);
}

// A note write as it waits in the offline queue (SPEC.md §17). A create
// carries its id, so the tray draws the note while it waits and a replay
// never makes it twice. An edit made from a base text is put together with
// the stored text on replay (onConflict "keep"): a queued write cannot read
// a 409, and the queue drops a refused write — the words must land.
function queuedBody(path: string, method: string, body: unknown): unknown {
  if (!body || typeof body !== "object") return body;
  if (method === "POST" && path === "/api/notes" && !("id" in body)) return { ...body, id: newNoteId() };
  if (method === "PATCH" && /^\/api\/notes\/[^/]+$/.test(path) && "baseContent" in body) {
    return { ...body, onConflict: "keep" };
  }
  return body;
}

/** A refused call: the status and the body the route answered with. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly detail: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// The language on the client, outside React: the same cookie the layout reads.
export function clientLang(): Lang {
  if (typeof document === "undefined") return DEFAULT_LANG;
  const value = document.cookie.match(new RegExp(`(?:^|; )${LANG_COOKIE}=([^;]+)`))?.[1];
  return isLang(value) ? value : DEFAULT_LANG;
}

// Client-side fetch helper for JSON API routes. Every call counts in the
// save indicator (lib/save-state.ts): a call that needs a model too, so the
// line reads Saving… while the model works, and a stopped call counts as
// landed.
export async function api<T = unknown>(
  path: string,
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  body?: unknown,
  // signal: Stop aborts the request; the caller checks signal.aborted.
  init?: { signal?: AbortSignal },
): Promise<T> {
  beginWrite();
  try {
    const result = await send<T>(path, method, body, init);
    endWrite(true);
    return result;
  } catch (err) {
    endWrite(Boolean(init?.signal?.aborted));
    throw err;
  }
}

async function send<T>(
  path: string,
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  body: unknown,
  init?: { signal?: AbortSignal },
): Promise<T> {
  // The tab's rendered account rides along; the middleware rejects the call
  // when the browser has since signed into a different account (stale tab).
  const account = tabAccount();
  let res: Response;
  try {
    // Offline, a call that needs a model answers with the plain message
    // (SPEC.md §17): AI is off for every account until the network is back.
    if (isOffline() && isAiCall(path, body)) {
      throw new Error(translate(clientLang(), "common.offlineAi"));
    }
    if (isOffline()) throw new TypeError("offline");
    res = await fetch(path, {
      method,
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(account ? { [ACCOUNT_HEADER]: account } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: init?.signal,
    });
  } catch (err) {
    // Stopped, not failed: the caller reads signal.aborted.
    if (init?.signal?.aborted) throw err;
    if (err instanceof Error && !(err instanceof TypeError)) throw err;
    // Network failure. With Unitos Premium the queueable writes save offline
    // and sync later (SPEC.md §17); everything else reports plainly.
    if (offlinePremium() && queueable(path, method, body)) {
      const queued = queuedBody(path, method, body);
      await queueWrite(path, method as "POST" | "PATCH" | "DELETE", queued);
      const id = queued && typeof queued === "object" && "id" in queued ? queued.id : undefined;
      return (typeof id === "string" ? { queued: true, id } : { queued: true }) as T;
    }
    throw new Error(
      isOffline() ? translate(clientLang(), "common.offline") : err instanceof Error ? err.message : String(err),
    );
  }
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    const message =
      detail && typeof detail === "object" && "error" in detail && typeof detail.error === "string"
        ? detail.error
        : translate(clientLang(), "common.requestFailedStatus", { status: res.status });
    throw new ApiError(message, res.status, detail);
  }
  return res.json() as Promise<T>;
}
