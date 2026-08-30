import { splitStreamError } from "@/lib/derive/config";
import type { FormalizedArticle, FormalizeFormat } from "@/lib/types";

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
    throw new Error(detail?.error ?? `request failed (${res.status})`);
  }
  const raw = await new Response(res.body).text();
  const { text, error } = splitStreamError(raw);
  if (error) throw new Error(error);
  try {
    const payload = JSON.parse(text.trim()) as { ok?: boolean } & FormalizeResult;
    if (!payload.ok) throw new Error();
    return payload;
  } catch {
    throw new Error("The answer did not arrive whole. Try again.");
  }
}
