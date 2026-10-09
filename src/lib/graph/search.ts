// The block index for Stitch's targeted path (SPEC.md §22, STITCH_INDEX): a
// Postgres full-text search over Block.text. The generated column
// Block.search (migration block_search) holds to_tsvector('simple', …) of
// the text with every CJK character spaced to its own token, so a Chinese
// command finds Chinese blocks by character bigram, as lib/graph/rank.ts
// does in memory; the GIN index on it answers a query over a project's
// documents in a few milliseconds at 200 documents. A generated column is
// never stale: an edit rewrites it with the row. The query is the same
// tokenizer as the ranker's (tokenize): Latin words OR'ed, each CJK bigram a
// phrase (<->), so a block that shares one word with the command is a
// candidate and ts_rank_cd puts the ones that share more first. No model.

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { tokenize } from "@/lib/graph/rank";

const CJK = /[぀-ヿ㐀-䶿一-鿿가-힯]/u;

// The command's function words: every block shares them, so OR'ed into the
// query they make every block a candidate (at 200 documents 19,000 of
// 24,500 blocks, 300–500 ms) and say nothing of what it is about. The
// ranker's idf drops them in effect; the index drops them here.
const STOP = new Set(
  "what which who whom whose when where why how does do did is are was were has have had be been the a an and or of in on to for from with about at by as into than then i my me we our you your he his she her they their it its this that these those can could would will should say says said".split(" "),
);

/** The tsquery for a command (and its earlier commands and expansion
    words): the ranker's tokens, Latin words as lexemes OR'ed (function
    words dropped), CJK bigrams as phrases; a CJK single character only
    when the text has no bigram. Null when the text has no token. */
export function searchQuery(text: string): string | null {
  const latin = new Set<string>();
  const bigrams = new Set<string>();
  const singles = new Set<string>();
  for (const t of tokenize(text)) {
    if (!CJK.test(t)) {
      if (!STOP.has(t)) latin.add(t);
      continue;
    }
    const chars = [...t];
    if (chars.length === 2) bigrams.add(t);
    else if (chars.length === 1) singles.add(t);
  }
  const lexeme = (w: string) => `'${w.replace(/'/g, "''")}'`;
  const parts = [...latin].map(lexeme);
  for (const bg of bigrams) {
    const [a, b] = [...bg];
    parts.push(`(${lexeme(a)} <-> ${lexeme(b)})`);
  }
  if (bigrams.size === 0) for (const s of singles) parts.push(lexeme(s));
  return parts.length > 0 ? parts.join(" | ") : null;
}

export type SearchHit = { id: string; documentId: string; score: number };

/** The blocks of the documents most like the query, best first, up to
    `limit`: the index's candidates for the select pass. Empty when the
    query has no token or no block shares one with it. */
export async function searchBlocks(documentIds: string[], query: string, limit: number): Promise<SearchHit[]> {
  const tsq = searchQuery(query);
  if (!tsq || documentIds.length === 0) return [];
  const rows = await db.$queryRaw<{ id: string; documentId: string; score: number }[]>(Prisma.sql`
    SELECT b.id, b."documentId", ts_rank_cd(b.search, q)::float8 AS score
    FROM "Block" b, to_tsquery('simple', ${tsq}) q
    WHERE b."documentId" IN (${Prisma.join(documentIds)})
      AND b.type NOT IN ('VIDEO', 'PAGE')
      AND b.search @@ q
    ORDER BY score DESC, b."documentId", b."order"
    LIMIT ${limit}`);
  return rows;
}
