import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { recordUsage } from "@/lib/usage";

// Semantic search embeddings: OpenAI text-embedding-3-small at 1024 dims,
// stored on Block.embedding (pgvector). Without OPENAI_API_KEY the search
// route falls back to substring matching and never calls this.

const MODEL = "text-embedding-3-small";
const DIMS = 1024;
const BATCH = 96;
const MAX_CHARS = 6000; // per input; the model caps at 8191 tokens
// One backfill pass per search request; the next search continues where it left off.
const BACKFILL_LIMIT = 480;

export function embeddingsEnabled(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

/** Embed texts in batches. Returns one vector per input, in order. */
export async function embedTexts(texts: string[], userId: string | null): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH).map((t) => t.slice(0, MAX_CHARS));
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: MODEL, input: batch, dimensions: DIMS }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Embedding call failed (${res.status}): ${detail.slice(0, 200)}`);
    }
    const json = (await res.json()) as {
      data: { index: number; embedding: number[] }[];
      usage?: { prompt_tokens?: number };
    };
    const vectors = [...json.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
    out.push(...vectors);
    recordUsage(
      { userId, feature: "search", model: MODEL },
      { inputTokens: json.usage?.prompt_tokens ?? 0 },
    );
  }
  return out;
}

const vectorLiteral = (v: number[]) => `[${v.join(",")}]`;

// Block types worth searching; chrome-only types (VIDEO, SEPARATOR) are not.
const EMBEDDABLE_TYPES = ["PARAGRAPH", "HEADING", "LIST", "CODE", "TABLE", "TRANSCRIPT"];
const MIN_CHARS = 40;

/** Embed the given documents' blocks that have no vector yet. Best-effort:
    one capped pass per call; errors log and leave the rows for the next call. */
export async function backfillEmbeddings(documentIds: string[], userId: string | null): Promise<void> {
  if (!embeddingsEnabled() || documentIds.length === 0) return;
  try {
    const rows = await db.$queryRaw<{ id: string; text: string }[]>`
      SELECT "id", "text" FROM "Block"
      WHERE "documentId" IN (${Prisma.join(documentIds)})
        AND "embedding" IS NULL
        AND "type"::text IN (${Prisma.join(EMBEDDABLE_TYPES)})
        AND length("text") >= ${MIN_CHARS}
      ORDER BY "documentId", "order"
      LIMIT ${BACKFILL_LIMIT}`;
    if (rows.length === 0) return;
    const vectors = await embedTexts(rows.map((r) => r.text), userId);
    for (let i = 0; i < rows.length; i += 50) {
      await db.$transaction(
        rows.slice(i, i + 50).map((row, j) =>
          db.$executeRaw`UPDATE "Block" SET "embedding" = ${vectorLiteral(vectors[i + j])}::vector WHERE "id" = ${row.id}`,
        ),
      );
    }
  } catch (err) {
    console.error("[search] embedding backfill failed:", err);
  }
}

export type SearchHit = {
  blockId: string;
  documentId: string;
  documentTitle: string;
  text: string;
  score: number | null; // null = substring fallback
};

/** Nearest blocks to the query across the given documents, best first. */
export async function searchEmbeddings(
  documentIds: string[],
  query: string,
  userId: string | null,
  limit = 8,
): Promise<SearchHit[]> {
  const [vector] = await embedTexts([query], userId);
  const rows = await db.$queryRaw<
    { id: string; documentId: string; title: string; text: string; score: number }[]
  >`
    SELECT b."id", b."documentId", d."title", b."text",
           1 - (b."embedding" <=> ${vectorLiteral(vector)}::vector) AS score
    FROM "Block" b JOIN "Document" d ON d."id" = b."documentId"
    WHERE b."documentId" IN (${Prisma.join(documentIds)}) AND b."embedding" IS NOT NULL
    ORDER BY b."embedding" <=> ${vectorLiteral(vector)}::vector
    LIMIT ${limit}`;
  return rows
    .filter((r) => r.score >= 0.2)
    .map((r) => ({
      blockId: r.id,
      documentId: r.documentId,
      documentTitle: r.title,
      text: r.text,
      score: r.score,
    }));
}
