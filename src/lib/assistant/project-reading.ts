import type { ModelMessage } from "ai";
import { ASSISTANT_WHOLE_THRESHOLD } from "@/lib/derive/config";
import type { loadProfile } from "@/lib/derive/context";
import type { DocumentPick } from "@/lib/digest/render";
import type { DigestDocument } from "@/lib/digest/types";
import { readSkeleton } from "@/lib/graph/skeleton";
import { commandKind, loadDocuments, pickBlocks, readingOf } from "@/lib/graph/stitch";

// The assistant at Project scope over a long project (SPEC.md §7). Under
// ASSISTANT_WHOLE_THRESHOLD of document text the digest goes whole, as it
// always did, and its prefix caches from message to message. Past it the
// project is read the way Stitch reads it (SPEC.md §22): the reading passes
// find the blocks the message needs from the documents' skeletons, at a
// tenth of the text's length, and the digest renders those blocks' real
// text under each document's gist, with every note and layer whole. So a
// message's cost follows what it needs, not the size of the project, and
// every quote and citation still comes from stored block text.

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
  const { length, ...reading } = readingOf(docs);
  if (length <= ASSISTANT_WHOLE_THRESHOLD || reading.read.length === 0) return null;
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
    // A question reads a question's budget, not a page's: the kind of the
    // message, by Stitch's rule.
    kind: commandKind(input.question),
  });
  const picks = new Map<string, DocumentPick>(
    reading.read.map((r) => [r.doc.id, { blockIds: new Set<string>(), gist: readSkeleton(r.doc.skeleton)?.gist ?? "" }]),
  );
  for (const alias of aliases) {
    const block = reading.blockByRef.get(alias);
    if (block) picks.get(block.documentId)?.blockIds.add(block.id);
  }
  return picks;
}
