import { NextResponse } from "next/server";
import { z } from "zod";
import { notebookAccess } from "@/lib/collab";
import { db } from "@/lib/db";
import {
  backfillEmbeddings,
  embeddingsEnabled,
  searchEmbeddings,
  type SearchHit,
} from "@/lib/embeddings";
import { parseBody } from "@/lib/validate";

export const maxDuration = 60;

const searchSchema = z.object({
  notebookId: z.string().min(1),
  query: z.string().min(1).max(500),
});

// Search across the project: the query is embedded and matched against every
// block of every attached document by meaning, best passages first. Without
// OPENAI_API_KEY the route matches by substring instead.
export async function POST(req: Request) {
  const { data, error } = await parseBody(req, searchSchema);
  if (error) return error;
  const access = await notebookAccess(data.notebookId, "viewer");
  if (access instanceof NextResponse) return access;

  const attached = await db.notebookDocument.findMany({
    where: { notebookId: data.notebookId },
    select: { documentId: true },
  });
  const documentIds = attached.map((a) => a.documentId);
  if (documentIds.length === 0) return NextResponse.json({ hits: [], semantic: false });

  if (embeddingsEnabled()) {
    try {
      await backfillEmbeddings(documentIds, access.user.id);
      const hits = await searchEmbeddings(documentIds, data.query.trim(), access.user.id);
      return NextResponse.json({ hits, semantic: true });
    } catch (err) {
      // Fall through to substring matching; search must answer either way.
      console.error("[search] semantic search failed:", err);
    }
  }

  const rows = await db.block.findMany({
    where: {
      documentId: { in: documentIds },
      text: { contains: data.query.trim(), mode: "insensitive" },
      type: { notIn: ["VIDEO", "SEPARATOR"] },
    },
    take: 8,
    select: { id: true, documentId: true, text: true, document: { select: { title: true } } },
  });
  const hits: SearchHit[] = rows.map((r) => ({
    blockId: r.id,
    documentId: r.documentId,
    documentTitle: r.document.title,
    text: r.text,
    score: null,
  }));
  return NextResponse.json({ hits, semantic: false });
}
