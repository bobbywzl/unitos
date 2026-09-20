import { db } from "@/lib/db";
import { CORPUS_TEXT_BUDGET } from "@/lib/digest/render";
import type { DigestDocument } from "@/lib/digest/types";
import type { Skeleton } from "@/lib/graph/skeleton";
import { JEV_MODEL, jevEnabled, mapLimit, systemOne } from "@/lib/jev";

// The digest's cut, ranked (SPEC.md §7). Past the text budget the corpus
// digest cuts documents in attachment order: the oldest documents read
// whole, the newest lose blocks or go unread, whatever the question. With
// Jev configured and the documents past the budget, the documents are
// ordered by how likely each holds material the question needs — one
// yes/no per document, from its title, its skeleton's gist, and its parts'
// titles — so the cut falls on the documents the question does not need.
// Under the budget nothing is cut, so nothing is ranked and the digest
// stays byte-identical for the prompt cache. Over it, the system message
// already changed as documents were added; a message-shaped order is the
// better trade.

const RANK_MIN_DOCS = 2;
const DOCS_PER_CALL = 40;
const PART_TITLES = 12;
const FALLBACK_CHARS = 400;

function blockTagsStripped(text: string): string {
  return text.replace(/\[block [^\]]+\] \([^)]*\)\n?/g, "").slice(0, FALLBACK_CHARS);
}

/** The documents in the order the digest should render them for this
    question: unchanged under the budget, without Jev, or on failure. */
export async function rankDocumentsForQuestion(
  documents: DigestDocument[],
  question: string,
  userId: string | null,
): Promise<DigestDocument[]> {
  if (!jevEnabled() || !question.trim() || documents.length < RANK_MIN_DOCS) return documents;
  const total = documents.reduce((n, d) => n + d.chars, 0);
  if (total <= CORPUS_TEXT_BUDGET) return documents;
  const rows = await db.document.findMany({
    where: { id: { in: documents.map((d) => d.id) } },
    select: { id: true, skeleton: true },
  });
  const skeletons = new Map(rows.map((r) => [r.id, r.skeleton as Skeleton | null]));
  const views = documents.map((d, n) => {
    const skeleton = skeletons.get(d.id);
    return {
      n,
      title: d.title,
      gist: skeleton?.gist || blockTagsStripped(d.text),
      parts: (skeleton?.parts ?? []).slice(0, PART_TITLES).map((p) => p.title),
    };
  });
  const chunks: (typeof views)[] = [];
  for (let i = 0; i < views.length; i += DOCS_PER_CALL) chunks.push(views.slice(i, i + DOCS_PER_CALL));
  const scores = new Map<number, number>();
  let failed = false;
  await mapLimit(chunks, 4, async (chunk) => {
    const result = await systemOne({
      state: { question, documents: chunk },
      questions: Object.fromEntries(
        chunk.map((v) => [
          `doc_${v.n}`,
          {
            type: "noul" as const,
            instructions: `Document ${v.n} holds material the question needs.`,
            criteria: {
              true: "The document's title, gist, or parts cover something the question asks for, or evidence for it.",
              false: "The document is on another matter.",
            },
          },
        ]),
      ),
      usage: { userId, feature: "digest-rank", model: JEV_MODEL },
      label: "DIGEST_RANK",
    });
    if (!result.ok) {
      failed = true;
      console.warn("[digest] jev rank failed:", result.error);
      return;
    }
    for (const v of chunk) {
      const a = result.answers[`doc_${v.n}`];
      if (a?.type === "noul") scores.set(v.n, a.noul);
    }
  });
  if (failed) return documents;
  return documents
    .map((d, n) => ({ d, n, score: scores.get(n) ?? 0 }))
    .sort((a, b) => b.score - a.score || a.n - b.n)
    .map((x) => x.d);
}
