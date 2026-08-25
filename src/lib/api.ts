import { DEFAULT_LANG, isLang, LANG_COOKIE, type Lang } from "@/lib/i18n/config";
import { translate } from "@/lib/i18n/dictionaries";

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
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
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
