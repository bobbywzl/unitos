import { NextResponse } from "next/server";
import { documentAccess } from "@/lib/collab";
import { buildCollapse, currentCores, readCollapse } from "@/lib/collapse";
import { db } from "@/lib/db";
import { featureConfigured } from "@/lib/feature-models";
import { serverT } from "@/lib/i18n/server";

export const maxDuration = 300;

// Collapse (SPEC.md §28). GET answers the cores the document has for its
// current blocks (viewer), and whether every collapsible block has one.
// POST (editor) writes the cores the document lacks — one model call per
// window of the missing blocks, under the cached prefix of the whole
// document — and answers every current core. A failed call is a 422 the
// reader shows; no model configured is a 503.
async function stored(documentId: string) {
  const document = await db.document.findUnique({
    where: { id: documentId },
    select: {
      collapse: true,
      blocks: { orderBy: { order: "asc" }, select: { id: true, type: true, text: true } },
    },
  });
  if (!document) return null;
  const { cores, missing } = currentCores(readCollapse(document.collapse), document.blocks);
  return { cores, complete: missing.length === 0 };
}

export async function GET(_req: Request, ctx: { params: Promise<{ documentId: string }> }) {
  const t = await serverT();
  const { documentId } = await ctx.params;
  const access = await documentAccess(documentId, "viewer");
  if (access instanceof NextResponse) return access;
  const answer = await stored(documentId);
  if (!answer) return NextResponse.json({ error: t("api.documentNotFound") }, { status: 404 });
  return NextResponse.json({ ok: true, ...answer });
}

export async function POST(req: Request, ctx: { params: Promise<{ documentId: string }> }) {
  const t = await serverT();
  const { documentId } = await ctx.params;
  const access = await documentAccess(documentId, "editor");
  if (access instanceof NextResponse) return access;
  const before = await stored(documentId);
  if (!before) return NextResponse.json({ error: t("api.documentNotFound") }, { status: 404 });
  if (before.complete) return NextResponse.json({ ok: true, ...before });
  // The cores the document has stand whatever the build does: with no model,
  // or a failed call, they are answered with the reason, and the reader
  // reads the blocks without one as they are. With none at all, the reason
  // is the answer.
  const has = Object.keys(before.cores).length > 0;
  if (!(await featureConfigured("collapse"))) {
    const error = t("api.collapseNeedsKey");
    return has
      ? NextResponse.json({ ok: true, ...before, error })
      : NextResponse.json({ error }, { status: 503 });
  }
  try {
    const cores = await buildCollapse(documentId, access.user.id, req.signal);
    const after = await stored(documentId);
    return NextResponse.json({ ok: true, cores, complete: after?.complete ?? false });
  } catch (err) {
    console.error("Collapse failed:", err);
    const error = t("api.collapseFailed");
    return has
      ? NextResponse.json({ ok: true, ...before, error })
      : NextResponse.json({ error }, { status: 422 });
  }
}
