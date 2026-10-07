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
  isCjk,
  likePattern,
  normalizeQuery,
  snippet,
  wordStartPattern,
  type FindResult,
} from "@/lib/graph/find";

// Find across the project (SPEC.md §13): the passages of the project's
// documents that hold the words, counted per document, no model call. A
// blank document's or an import's rows are its paragraph index, which the
// AI tools read too. Without documentId: every document with a hit, most
// passages first, and its first FIND_SNIPPETS passages. With documentId and
// after: that document's next FIND_MORE passages.

const querySchema = z.object({
  q: z
    .string()
    .transform(normalizeQuery)
    .pipe(z.string().min(FIND_MIN).max(FIND_MAX)),
  documentId: z.string().min(1).max(64).optional(),
  after: z.coerce.number().int().min(0).max(100_000).optional(),
});

export async function GET(req: Request, ctx: { params: Promise<{ notebookId: string }> }) {
  const { notebookId } = await ctx.params;
  const access = await notebookAccess(notebookId, "viewer");
  if (access instanceof NextResponse) return access;
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: `Type ${FIND_MIN} to ${FIND_MAX} characters.` }, { status: 400 });
  }
  const { q, documentId, after = 0 } = parsed.data;
  const match = isCjk(q)
    ? Prisma.sql`b.text ILIKE ${likePattern(q)}`
    : Prisma.sql`b.text ~* ${wordStartPattern(q)}`;
  const onlyDocument = documentId ? Prisma.sql`AND b."documentId" = ${documentId}` : Prisma.empty;
  const from = documentId ? after : 0;
  const to = documentId ? after + FIND_MORE : FIND_SNIPPETS;
  const rows = await db.$queryRaw<{ id: string; documentId: string; text: string; n: bigint }[]>(Prisma.sql`
    WITH hits AS (
      SELECT b.id, b."documentId", b.text,
        row_number() OVER (PARTITION BY b."documentId" ORDER BY b."order") AS rn,
        count(*) OVER (PARTITION BY b."documentId") AS n
      FROM "Block" b
      JOIN "NotebookDocument" nd ON nd."documentId" = b."documentId"
      WHERE nd."notebookId" = ${notebookId} ${onlyDocument} AND ${match}
    )
    SELECT id, "documentId", text, n FROM hits WHERE rn > ${from} AND rn <= ${to} ORDER BY "documentId", rn
  `);
  const byDocument = new Map<string, FindResult["documents"][number]>();
  for (const r of rows) {
    const entry = byDocument.get(r.documentId) ?? { id: r.documentId, count: Number(r.n), passages: [] };
    entry.passages.push({ blockId: r.id, ...snippet(r.text, q) });
    byDocument.set(r.documentId, entry);
  }
  const result: FindResult = {
    q,
    documents: [...byDocument.values()].sort((a, b) => b.count - a.count),
  };
  return NextResponse.json(result);
}
