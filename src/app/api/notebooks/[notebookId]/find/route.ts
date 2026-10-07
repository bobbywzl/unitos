import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { notebookAccess } from "@/lib/collab";
import { db } from "@/lib/db";
import {
  FIND_MAX,
  FIND_MIN,
  FIND_MORE,
  FIND_SNIPPETS,
  FIND_TOP,
  isCjk,
  likePattern,
  normalizeQuery,
  passageQuote,
  snippet,
  wordStartPattern,
  type FindResult,
} from "@/lib/graph/find";

// Find across the project (SPEC.md §13): the passages of the project's
// documents that hold the words, counted per document, no model call. A
// blank document's or an import's rows are its paragraph index, which the
// AI tools read too. Without documentId: every document with a hit and its
// count, most passages first; the first FIND_TOP of them carry their first
// FIND_SNIPPETS passages, the rest none (COST4-02: 125 kB → 18 kB for "the"
// on 200 documents). With documentId and after: that document's next
// FIND_MORE passages, or limit (after = 0, limit = 1: the passage of a row
// sent without one, when it scrolls into view).

const querySchema = z.object({
  q: z
    .string()
    .transform(normalizeQuery)
    .pipe(z.string().min(FIND_MIN).max(FIND_MAX)),
  documentId: z.string().min(1).max(64).optional(),
  after: z.coerce.number().int().min(0).max(100_000).optional(),
  limit: z.coerce.number().int().min(1).max(FIND_MORE).optional(),
});

export async function GET(req: Request, ctx: { params: Promise<{ notebookId: string }> }) {
  const { notebookId } = await ctx.params;
  const access = await notebookAccess(notebookId, "viewer");
  if (access instanceof NextResponse) return access;
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: `Type ${FIND_MIN} to ${FIND_MAX} characters.` }, { status: 400 });
  }
  const { q, documentId, after = 0, limit = FIND_MORE } = parsed.data;
  const match = isCjk(q)
    ? Prisma.sql`b.text ILIKE ${likePattern(q)}`
    : Prisma.sql`b.text ~* ${wordStartPattern(q)}`;
  type Row = { id: string | null; documentId: string; text: string | null; n: bigint };
  const hits = Prisma.sql`
    SELECT b.id, b."documentId", b.text,
      row_number() OVER (PARTITION BY b."documentId" ORDER BY b."order") AS rn,
      count(*) OVER (PARTITION BY b."documentId") AS n
    FROM "Block" b
    JOIN "NotebookDocument" nd ON nd."documentId" = b."documentId"
    WHERE nd."notebookId" = ${notebookId} ${documentId ? Prisma.sql`AND b."documentId" = ${documentId}` : Prisma.empty} AND ${match}
  `;
  const rows = documentId
    ? await db.$queryRaw<Row[]>(Prisma.sql`
        WITH hits AS (${hits})
        SELECT id, "documentId", text, n FROM hits WHERE rn > ${after} AND rn <= ${after + limit} ORDER BY rn
      `)
    : // Every document's count; the passages, and so the text, only for the top FIND_TOP.
      await db.$queryRaw<Row[]>(Prisma.sql`
        WITH hits AS (${hits}),
        docs AS (
          SELECT "documentId", n, row_number() OVER (ORDER BY n DESC, "documentId") AS dr FROM hits WHERE rn = 1
        )
        SELECT CASE WHEN d.dr <= ${FIND_TOP} THEN h.id END AS id, d."documentId",
          CASE WHEN d.dr <= ${FIND_TOP} THEN h.text END AS text, d.n
        FROM docs d
        JOIN hits h ON h."documentId" = d."documentId" AND (h.rn = 1 OR (d.dr <= ${FIND_TOP} AND h.rn <= ${FIND_SNIPPETS}))
        ORDER BY d.dr, h.rn
      `);
  const byDocument = new Map<string, FindResult["documents"][number]>();
  for (const r of rows) {
    const entry = byDocument.get(r.documentId) ?? { id: r.documentId, count: Number(r.n), passages: [] };
    if (r.id !== null && r.text !== null) entry.passages.push({ blockId: r.id, ...snippet(r.text, q), quote: passageQuote(r.text, q) });
    byDocument.set(r.documentId, entry);
  }
  const result: FindResult = {
    q,
    documents: [...byDocument.values()],
  };
  return NextResponse.json(result);
}
