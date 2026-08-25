import { NextResponse } from "next/server";
import { z } from "zod";
import { adminApiGuard } from "@/lib/admin-auth";
import { db } from "@/lib/db";
import { ensureAllDigests, ensureDigest, rebuildDigest } from "@/lib/digest/ensure";
import { corporaSystem, corpusSystem } from "@/lib/digest/render";
import { serverT } from "@/lib/i18n/server";
import { parseBody } from "@/lib/validate";

export const maxDuration = 120;

// The digest as the assistant reads it: exact text, same budgets. With
// notebookId, the Corpus scope; without, the Corpora scope (SPEC.md §7).
export async function GET(req: Request) {
  const t = await serverT();
  const denied = await adminApiGuard();
  if (denied) return denied;
  const notebookId = new URL(req.url).searchParams.get("notebookId");
  const headers = { "Content-Type": "text/plain; charset=utf-8" };
  if (notebookId) {
    const digest = await ensureDigest(notebookId);
    if (!digest) return NextResponse.json({ error: t("api.corpusNotFound") }, { status: 404 });
    return new Response(corpusSystem(digest.parts), { headers });
  }
  const digests = await ensureAllDigests();
  return new Response(corporaSystem(digests.map((d) => d.parts)), { headers });
}

const rebuildSchema = z.object({ notebookId: z.string().min(1).optional() });

// Force a rebuild: one corpus with notebookId, every corpus without.
export async function POST(req: Request) {
  const t = await serverT();
  const denied = await adminApiGuard();
  if (denied) return denied;
  const { data, error } = await parseBody(req, rebuildSchema);
  if (error) return error;
  if (data.notebookId) {
    const row = await rebuildDigest(data.notebookId);
    if (!row) return NextResponse.json({ error: t("api.corpusNotFound") }, { status: 404 });
    return NextResponse.json({ ok: true, rebuilt: 1 });
  }
  const notebooks = await db.notebook.findMany({ select: { id: true } });
  let rebuilt = 0;
  for (const nb of notebooks) {
    if (await rebuildDigest(nb.id)) rebuilt++;
  }
  return NextResponse.json({ ok: true, rebuilt });
}
