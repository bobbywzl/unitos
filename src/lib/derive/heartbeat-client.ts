import { splitStreamError } from "@/lib/derive/config";
import { DEFAULT_LANG, isLang, LANG_COOKIE } from "@/lib/i18n/config";
import { translate, type TKey, type TParams } from "@/lib/i18n/dictionaries";

// The language on the client, outside React: the same cookie lib/api.ts reads.
function clientT(key: TKey, params?: TParams): string {
  if (typeof document === "undefined") return translate(DEFAULT_LANG, key, params);
  const value = document.cookie.match(new RegExp(`(?:^|; )${LANG_COOKIE}=([^;]+)`))?.[1];
  return translate(isLang(value) ? value : DEFAULT_LANG, key, params);
}

// Run a derivation that answers over the heartbeat stream (the DISTILL
// pattern): spaces while the model works, then the payload JSON or the
// in-band error token. FORMALIZE, COMPARE, and ANALYZE answer this way.
// Throws with the server's reason on failure.
export async function runDerivation<T extends object>(
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<T> {
  const res = await fetch("/api/derive", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    const detail = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(
      detail?.error ?? clientT("common.requestFailedStatus", { status: res.status }),
    );
  }
  const raw = await new Response(res.body).text();
  const { text, error } = splitStreamError(raw);
  if (error) throw new Error(error);
  try {
    const payload = JSON.parse(text.trim()) as { ok?: boolean } & T;
    if (!payload.ok) throw new Error();
    return payload;
  } catch {
    throw new Error(clientT("common.streamIncomplete"));
  }
}
