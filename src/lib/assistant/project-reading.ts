import type { ModelMessage } from "ai";
import { lexicalPicks, lexicalQuery } from "@/lib/assistant/document-reading";
import { db } from "@/lib/db";
import { ASSISTANT_WHOLE_THRESHOLD, STITCH_SELECTED_BUDGET } from "@/lib/derive/config";
import type { loadProfile } from "@/lib/derive/context";
import type { DocumentPick } from "@/lib/digest/render";
import type { DigestDocument } from "@/lib/digest/types";
import { readSkeleton, refreshSkeleton, skeletonStale } from "@/lib/graph/skeleton";
import { loadDocuments, pickBlocks, readingOf } from "@/lib/graph/stitch";

// The assistant at Project scope over a long project (SPEC.md §7). Under
// ASSISTANT_WHOLE_THRESHOLD of document text the digest goes whole, as it
// always did, and its prefix caches from message to message. Past it the
// project is read the way Stitch reads it (SPEC.md §22): the reading passes
// find the blocks the message needs from the documents' skeletons, at a
// tenth of the text's length, and the digest renders those blocks' real
// text under each document's gist, with every note and layer whole. So a
// message's cost follows what it needs, not the size of the project, and
// every quote and citation still comes from stored block text.
// A document whose skeleton is not built yet, or no longer fits its text
// (the minutes after a PDF is added), is read by the lexical pass over its
// blocks (lib/assistant/document-reading.ts) instead of waiting for the
// build: the first question of a fresh project is answered at once, and the
// skeleton builds in the background for the next.

/** The blocks this message reads of each document, by document id, or null
    when the project is short enough to read whole. */
export async function projectPicks(input: {
  notebookId: string;
  documents: DigestDocument[];
  question: string;
  history: { role: "user" | "assistant"; content: string }[];
  profile: Awaited<ReturnType<typeof loadProfile>>;
  userId: string;
  signal?: AbortSignal;
}): Promise<Map<string, DocumentPick> | null> {
  const total = input.documents.reduce((n, d) => n + d.chars, 0);
  if (total <= ASSISTANT_WHOLE_THRESHOLD || !input.question.trim()) return null;
  const docs = await loadDocuments(input.notebookId, null);
  const { length, read } = readingOf(docs);
  if (length <= ASSISTANT_WHOLE_THRESHOLD || read.length === 0) return null;
  const readable = new Set(read.map((r) => r.doc.id));
  const fresh = docs.filter((d) => {
    if (!readable.has(d.id)) return false;
    const skeleton = readSkeleton(d.skeleton);
    return skeleton !== null && !skeletonStale(skeleton, d.blocks);
  });
  const stale = docs.filter((d) => readable.has(d.id) && !fresh.includes(d));
  const picks = new Map<string, DocumentPick>(
    read.map((r) => [r.doc.id, { blockIds: new Set<string>(), gist: readSkeleton(r.doc.skeleton)?.gist ?? "" }]),
  );
  // The documents with a skeleton: the reading passes, over them alone.
  if (fresh.length > 0) {
    const reading = readingOf(fresh);
    const history: ModelMessage[] = input.history
      .filter((turn) => turn.content.trim())
      .slice(-20)
      .map((turn) => ({ role: turn.role, content: turn.content }));
    const aliases = await pickBlocks({
      reading,
      command: input.question,
      history,
      profile: input.profile,
      userId: input.userId,
      feature: "assistant",
      signal: input.signal,
    });
    for (const alias of aliases) {
      const block = reading.blockByRef.get(alias);
      if (block) picks.get(block.documentId)?.blockIds.add(block.id);
    }
  }
  // The documents without one: the lexical pass, each with its share of
  // the budget; their skeletons build meanwhile.
  if (stale.length > 0) {
    const share = Math.floor(STITCH_SELECTED_BUDGET / read.length);
    const query = lexicalQuery(input.question, input.history);
    const headings = await db.block.findMany({ where: { documentId: { in: stale.map((d) => d.id) }, type: "HEADING" }, select: { id: true, html: true } });
    const depthById = new Map(headings.map((h) => [h.id, Number(/<h([1-6])/i.exec(h.html ?? "")?.[1] ?? 2)]));
    for (const d of stale) {
      const blocks = read.find((r) => r.doc.id === d.id)?.blocks ?? [];
      const own = lexicalPicks(blocks, query, { depthById, budget: share });
      const pick = picks.get(d.id);
      if (pick) for (const id of own) pick.blockIds.add(id);
      void refreshSkeleton(d.id, input.userId).catch((err: unknown) => {
        console.warn("[assistant] skeleton refresh failed:", err);
      });
    }
  }
  return picks;
}
