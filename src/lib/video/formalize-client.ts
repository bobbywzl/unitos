import { splitStreamError } from "@/lib/derive/config";
import { DEFAULT_LANG, isLang, LANG_COOKIE } from "@/lib/i18n/config";
import { translate, type TKey, type TParams } from "@/lib/i18n/dictionaries";
import type { FormalizedArticle, FormalizeFormat } from "@/lib/types";

// The language on the client, outside React: the same cookie lib/api.ts reads.
function clientT(key: TKey, params?: TParams): string {
  if (typeof document === "undefined") return translate(DEFAULT_LANG, key, params);
  const value = document.cookie.match(new RegExp(`(?:^|; )${LANG_COOKIE}=([^;]+)`))?.[1];
  return translate(isLang(value) ? value : DEFAULT_LANG, key, params);
}

// Run FORMALIZE and read its heartbeat stream (the DISTILL pattern): spaces
// while the model works, then the payload JSON or the in-band error token.
// format article answers {article}; format notes answers {noteCount,
// sectionTitle}. Throws with the server's reason on failure.
export type FormalizeResult = {
  article?: FormalizedArticle;
  noteCount?: number;
  sectionTitle?: string;
};

export async function runFormalize(input: {
  documentId: string;
  notebookId: string;
  format: FormalizeFormat;
  sectionId?: string;
}): Promise<FormalizeResult> {
  const res = await fetch("/api/derive", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "FORMALIZE", ...input }),
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
    const payload = JSON.parse(text.trim()) as { ok?: boolean } & FormalizeResult;
    if (!payload.ok) throw new Error();
    return payload;
  } catch {
    throw new Error(clientT("common.streamIncomplete"));
  }
}
