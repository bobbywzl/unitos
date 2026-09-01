import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { notebookAccess } from "@/lib/collab";
import { serverT } from "@/lib/i18n/server";
import { progressResponse } from "@/lib/ingest-response";
import { parseBody } from "@/lib/validate";

export const maxDuration = 120;

// The upload assistant (SPEC.md §15). With url: review the page in a private
// sandbox before anything is saved — stream fetch, extract, review stages,
// then the review. With kind alone: answer the upload instructions for a PDF
// or video add, plain JSON. Neither writes anything.
const bodySchema = z
  .object({
    notebookId: z.string().min(1),
    url: z.url().optional(),
    kind: z.enum(["url", "pdf", "video"]).optional(),
    instructions: z.string().max(2_000).default(""),
  })
  .refine((d) => d.url !== undefined || d.kind !== undefined, {
    message: "url or kind is required",
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

  const instructions = data.instructions.trim();
  if (data.url === undefined) {
    const check = await assistant.checkInstructions(data.kind!, instructions, user?.id ?? null);
    return NextResponse.json({ check });
  }

  const url = data.url;
  return progressResponse(async (onProgress) => {
    try {
      const review = await assistant.reviewUpload(url, instructions, user?.id ?? null, onProgress);
      return { review };
    } catch (err) {
      console.error("Upload review failed:", err);
      throw new Error(t("api.reviewFailed"));
    }
  });
}
