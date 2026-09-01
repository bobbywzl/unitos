import { ACCOUNT_HEADER } from "@/lib/constants";
import { DEFAULT_LANG, isLang, LANG_COOKIE, type Lang } from "@/lib/i18n/config";
import { translate } from "@/lib/i18n/dictionaries";
import { isOffline, offlinePremium, queueWrite } from "@/lib/offline/queue";
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
];

function queueable(path: string, method: string): boolean {
  return QUEUEABLE.some((q) => q.method === method && q.path.test(path));
}

// The language on the client, outside React: the same cookie the layout reads.
function clientLang(): Lang {
  if (typeof document === "undefined") return DEFAULT_LANG;
  const value = document.cookie.match(new RegExp(`(?:^|; )${LANG_COOKIE}=([^;]+)`))?.[1];
  return isLang(value) ? value : DEFAULT_LANG;
}

// Client-side fetch helper for JSON API routes.
export async function api<T = unknown>(
  path: string,
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  body?: unknown,
): Promise<T> {
  // The tab's rendered account rides along; the middleware rejects the call
  // when the browser has since signed into a different account (stale tab).
  const account = tabAccount();
  let res: Response;
  try {
    if (isOffline()) throw new TypeError("offline");
    res = await fetch(path, {
      method,
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(account ? { [ACCOUNT_HEADER]: account } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    // Network failure. With Unitos Premium the queueable writes save offline
    // and sync later (SPEC.md §17); everything else reports plainly.
    if (offlinePremium() && queueable(path, method)) {
      await queueWrite(path, method as "POST" | "PATCH" | "DELETE", body);
      return { queued: true } as T;
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
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}
