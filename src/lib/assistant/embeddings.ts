import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { outboundFetch } from "@/lib/outbound-fetch";

// Voyage AI embeddings on notes, stored via pgvector (SPEC.md §2).
export const EMBEDDING_MODEL = "voyage-3.5";

export function embeddingsConfigured(): boolean {
  return Boolean(process.env.VOYAGE_API_KEY);
}

async function embed(texts: string[]): Promise<number[][]> {
  const baseUrl = process.env.VOYAGE_BASE_URL ?? "https://api.voyageai.com";
  const res = await outboundFetch(`${baseUrl}/v1/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
    },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: texts, output_dimension: 1024 }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`Embeddings request failed (${res.status})`);
  const json = (await res.json()) as { data: { index: number; embedding: number[] }[] };
  return [...json.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

function toVectorLiteral(vec: number[]): string {
  return `[${vec.map((v) => Number.isFinite(v) ? v.toFixed(6) : "0").join(",")}]`;
}

// Embed accepted notes that have no embedding yet. Content edits null the embedding,
// so this also re-embeds after edits. Batched; call before corpus search and after accept.
export async function ensureNoteEmbeddings(): Promise<number> {
  if (!embeddingsConfigured()) return 0;
  const notes = await db.$queryRaw<{ id: string; content: string }[]>(
    Prisma.sql`SELECT id, content FROM "Note" WHERE status = 'ACCEPTED' AND embedding IS NULL LIMIT 96`,
  );
  if (notes.length === 0) return 0;
  const vectors = await embed(notes.map((n) => n.content.slice(0, 8000)));
  for (let i = 0; i < notes.length; i++) {
    await db.$executeRaw(
      Prisma.sql`UPDATE "Note" SET embedding = ${toVectorLiteral(vectors[i])}::vector WHERE id = ${notes[i].id}`,
    );
  }
  return notes.length;
}

export async function clearNoteEmbedding(noteId: string) {
  await db.$executeRaw(Prisma.sql`UPDATE "Note" SET embedding = NULL WHERE id = ${noteId}`);
}

export type CorpusMatch = {
  id: string;
  content: string;
  notebookId: string;
  notebookTitle: string;
  sectionTitle: string;
  similarity: number;
};

// Corpus scope without an embeddings key: Postgres full-text search over
// accepted notes. Weaker recall than embeddings, but corpus questions work
// out of the box; set VOYAGE_API_KEY for semantic search.
async function corpusSearchLexical(query: string, k: number): Promise<CorpusMatch[]> {
  if (!query.trim()) return [];
  return db.$queryRaw<CorpusMatch[]>(
    Prisma.sql`
      SELECT n.id,
             n.content,
             s."notebookId" AS "notebookId",
             nb.title AS "notebookTitle",
             s.title AS "sectionTitle",
             ts_rank(to_tsvector('english', n.content), websearch_to_tsquery('english', ${query}))::float8 AS similarity
      FROM "Note" n
      JOIN "Section" s ON n."sectionId" = s.id
      JOIN "Notebook" nb ON s."notebookId" = nb.id
      WHERE n.status = 'ACCEPTED'
        AND to_tsvector('english', n.content) @@ websearch_to_tsquery('english', ${query})
      ORDER BY similarity DESC
      LIMIT ${k}`,
  );
}

// Corpus scope: nearest accepted notes across all notebooks (SPEC.md §7).
export async function corpusSearch(query: string, k = 12): Promise<CorpusMatch[]> {
  if (!embeddingsConfigured()) return corpusSearchLexical(query, k);
  const [vector] = await embed([query]);
  const literal = toVectorLiteral(vector);
  return db.$queryRaw<CorpusMatch[]>(
    Prisma.sql`
      SELECT n.id,
             n.content,
             s."notebookId" AS "notebookId",
             nb.title AS "notebookTitle",
             s.title AS "sectionTitle",
             1 - (n.embedding <=> ${literal}::vector) AS similarity
      FROM "Note" n
      JOIN "Section" s ON n."sectionId" = s.id
      JOIN "Notebook" nb ON s."notebookId" = nb.id
      WHERE n.status = 'ACCEPTED' AND n.embedding IS NOT NULL
      ORDER BY n.embedding <=> ${literal}::vector
      LIMIT ${k}`,
  );
}
