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
// candidate. The candidates come back unranked and unsorted: the caller
// (lib/graph/stitch.ts textMatches) ranks them with BM25 in memory, and
// ts_rank_cd with an ORDER BY over 2,600–7,800 rows was two thirds of the
// query's time at 200 documents (COST10-06: 77–130 ms → 9–10 ms). No model.
//
// The parser's tokens differ from the query's for dates and decimals: the
// column holds '-10', '-09' and '3.14' for "2026-10-09 3.14", the query
// asks '2026' | '10' | '09' | '3' | '14'. A year matches, a month-day or a
// decimal does not; harmless, since the in-memory rank runs on the
// candidates' text.

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { STITCH_INDEX_QUERY_TOKENS } from "@/lib/derive/config";
import { STOP_WORDS, tokenize } from "@/lib/graph/rank";

const CJK = /[぀-ヿ㐀-䶿一-鿿가-힯]/u;

// The command's function words: every block shares them, so OR'ed into the
// query they make every block a candidate (at 200 documents 19,000 of
// 24,500 blocks, 300–500 ms) and say nothing of what it is about. The
// ranker drops the same words from its query (STOP_WORDS, RankOptions.stop)
// and keeps "when" for the dated lines; here "when" is in every block too.
const STOP = new Set([...STOP_WORDS, "when"]);

/** The tsquery for a command (and its earlier commands and expansion
    words): the ranker's tokens, Latin words as lexemes OR'ed (function
    words dropped), CJK bigrams as phrases; a CJK single character only
    when the text has no bigram. Null when the text has no token. The last
    STITCH_INDEX_QUERY_TOKENS tokens only: the ranker's query puts the
    earlier commands first and the command and its expansion last, so a
    long paste in an earlier command drops before the words that matter
    (REV10-07: 20,000 OR'ed terms took 4.3–4.6 s for 0 hits). */
export function searchQuery(text: string): string | null {
  const latin = new Set<string>();
  const bigrams = new Set<string>();
  const singles = new Set<string>();
  for (const t of tokenize(text).slice(-STITCH_INDEX_QUERY_TOKENS)) {
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

export type SearchHit = { id: string; documentId: string };

// Whether the index can be queried in this process: the column exists
// (the migration block_search ran) and no query has failed. Probed once;
// a database without the column, or a failed query, turns the index off
// for the process with one log line, and the select pass ranks every
// block in memory as it does under STITCH_INDEX_PREFILTER_BLOCKS.
let available: Promise<boolean> | null = null;
export function searchAvailable(): Promise<boolean> {
  return (available ??= db
    .$queryRaw<{ ok: number }[]>(Prisma.sql`SELECT 1 AS ok FROM information_schema.columns WHERE table_name = 'Block' AND column_name = 'search'`)
    .then((rows) => {
      if (rows.length === 0) console.warn("[stitch] Block.search is missing (migration block_search not applied); ranking every block in memory");
      return rows.length > 0;
    })
    .catch((error) => {
      console.warn("[stitch] index probe failed; ranking every block in memory:", error);
      return false;
    }));
}

/** The blocks of the documents that share a token with the query, in no
    order, up to `limit`: the index's candidates for the select pass, which
    the caller ranks (textMatches). `limit` is a guard, not a filter: past
    it the first blocks the scan meets come back (the widest query at 200
    documents met 4,041 of 5,000). Empty when the query has no token or no
    block shares one with it; null when the index is not available (no
    column, or a failed query, logged once), so the caller ranks every
    block instead. A failed search never fails a command. */
export async function searchBlocks(documentIds: string[], query: string, limit: number): Promise<SearchHit[] | null> {
  if (!(await searchAvailable())) return null;
  const tsq = searchQuery(query);
  if (!tsq || documentIds.length === 0) return [];
  try {
    return await db.$queryRaw<{ id: string; documentId: string }[]>(Prisma.sql`
      SELECT b.id, b."documentId"
      FROM "Block" b
      WHERE b."documentId" IN (${Prisma.join(documentIds)})
        AND b.type NOT IN ('VIDEO', 'PAGE')
        AND b.search @@ to_tsquery('simple', ${tsq})
      LIMIT ${limit}`);
  } catch (error) {
    console.warn("[stitch] index query failed; ranking every block in memory from now on:", error);
    available = Promise.resolve(false);
    return null;
  }
}
