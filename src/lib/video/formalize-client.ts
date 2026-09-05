import { runDerivation } from "@/lib/derive/heartbeat-client";
import type { FormalizedArticle, FormalizeFormat } from "@/lib/types";

// Run FORMALIZE and read its heartbeat stream (lib/derive/heartbeat-client.ts).
// format article answers {article}; format notes answers {noteCount,
// sectionTitle}. Throws with the server's reason on failure.
export type FormalizeResult = {
  article?: FormalizedArticle;
  noteCount?: number;
  sectionTitle?: string;
};

export function runFormalize(
  input: {
    documentId: string;
    notebookId: string;
    format: FormalizeFormat;
    sectionId?: string;
  },
  signal?: AbortSignal,
): Promise<FormalizeResult> {
  return runDerivation<FormalizeResult>({ type: "FORMALIZE", ...input }, signal);
}
