import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { notebookAccess } from "@/lib/collab";
import { serverT } from "@/lib/i18n/server";
import { progressResponse } from "@/lib/ingest-response";
import { describeIngestError } from "@/lib/parse/ingest-error";
import { parseBody } from "@/lib/validate";

export const maxDuration = 120;

// The upload assistant (SPEC.md §15): review the page in a private sandbox
// before anything is saved — stream fetch, extract, review stages, then the
// review. Writes nothing.
const bodySchema = z.object({
  notebookId: z.string().min(1),
  url: z.url(),
});

export async function POST(req: Request) {
  const user = await currentUser();
  const t = await serverT();
  const { data, error } = await parseBody(req, bodySchema);
  if (error) return error;
  const notebook = await db.notebook.findUnique({ where: { id: data.notebookId } });
  if (!notebook) return NextResponse.json({ error: t("api.corpusNotFound") }, { status: 404 });
  const access = await notebookAccess(data.notebookId, "editor");
  if (access instanceof NextResponse) return access;

  // The lib pulls the parse chain (jsdom); load per request like /api/documents.
  let assistant: typeof import("@/lib/upload-assistant");
  try {
    assistant = await import("@/lib/upload-assistant");
  } catch (err) {
    console.error("Upload assistant module load failed:", err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: t("api.parsingUnavailable", { message }) },
      { status: 500 },
    );
  }

  const url = data.url;
  // The review's model call stops at the route's limit less a margin, so a
  // slow review degrades to the parsed facts instead of a cut stream; Cancel
  // in the box stops it too (SPEC.md §15).
  const budget = AbortSignal.any([req.signal, AbortSignal.timeout((maxDuration - 30) * 1000)]);
  return progressResponse(async (onProgress) => {
    try {
      const review = await assistant.reviewUpload(url, user?.id ?? null, onProgress, budget);
      return { review };
    } catch (err) {
      console.error("Upload review failed:", err);
      throw new Error(describeIngestError(err, t, "url"));
    }
  });
}
