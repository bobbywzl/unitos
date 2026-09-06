import { after, NextResponse } from "next/server";
import { documentAccess } from "@/lib/collab";
import { buildGlossary } from "@/lib/glossary";
import { runConversion } from "@/lib/handwritten/convert";
import { currentLang } from "@/lib/i18n/server";

// Conversion reads every page through the model; a long document takes minutes.
export const maxDuration = 300;

// Conversion starts on its own when a handwritten document is added (SPEC.md
// §16); this route runs the same job for Retry and Convert again.
export async function POST(_req: Request, ctx: { params: Promise<{ documentId: string }> }) {
  const { documentId } = await ctx.params;
  // Captured now: the after() scans below outlive the request and its cookies.
  const lang = await currentLang();
  const access = await documentAccess(documentId, "editor");
  if (access instanceof NextResponse) return access;
  const result = await runConversion(documentId, access.user.id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  // The converted text is new document text: rebuild the glossary from it.
  // after() keeps it alive past the response on serverless.
  after(() => buildGlossary(documentId, access.user.id, lang).catch(() => {}));
  return NextResponse.json({ ok: true, blocks: result.blocks });
}
