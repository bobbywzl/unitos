import { NextResponse } from "next/server";
import { documentAccess } from "@/lib/collab";
import { buildGlossary } from "@/lib/glossary";
import { runConversion } from "@/lib/handwritten/convert";

// Conversion reads every page through the model; a long document takes minutes.
export const maxDuration = 300;

// Conversion starts on its own when a handwritten document is added (SPEC.md
// §14); this route runs the same job for Retry and Convert again.
export async function POST(_req: Request, ctx: { params: Promise<{ documentId: string }> }) {
  const { documentId } = await ctx.params;
  const access = await documentAccess(documentId, "editor");
  if (access instanceof NextResponse) return access;
  const result = await runConversion(documentId, access.user.id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  // The converted text is new document text: rebuild the glossary from it.
  await buildGlossary(documentId, access.user.id).catch(() => {});
  return NextResponse.json({ ok: true, blocks: result.blocks });
}
