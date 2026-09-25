import { NextResponse } from "next/server";
import { z } from "zod";
import { documentAccess } from "@/lib/collab";
import { buildContents, contentsEntries, headingContents } from "@/lib/contents";
import { db } from "@/lib/db";
import { serverT } from "@/lib/i18n/server";
import { jevEnabled } from "@/lib/jev";
import { kimiConfigured } from "@/lib/kimi";
import { buildChapters } from "@/lib/video/chapters";
import { parseBody } from "@/lib/validate";

export const maxDuration = 120;

// generate: true runs the model call that writes and stores the parts (the
// list's Generate contents button, editor role); absent or false reads
// what is stored, no model call.
const bodySchema = z.object({ generate: z.boolean().optional() });

// The contents of a document (SPEC.md §26). Stored: answered as they are,
// no model call, `fallback: false`. None stored: the document's headings,
// `fallback: true`; with `generate: true` from an editor, one model call
// builds and stores the parts and answers them — a failed call is an error
// (the list offers Try again), and a document too short to have parts
// answers no parts with `fallback: false`. A viewer reads what is stored
// and, with nothing stored, the headings; generate is not theirs.
export async function POST(req: Request, ctx: { params: Promise<{ documentId: string }> }) {
  const t = await serverT();
  const { documentId } = await ctx.params;
  const { data, error } = await parseBody(req, bodySchema);
  if (error) return error;
  const access = await documentAccess(documentId, "viewer");
  if (access instanceof NextResponse) return access;
  const document = await db.document.findUnique({
    where: { id: documentId },
    select: {
      contents: true,
      video: { select: { id: true } },
      blocks: {
        orderBy: { order: "asc" },
        select: { id: true, type: true, text: true, order: true, html: true },
      },
    },
  });
  if (!document) return NextResponse.json({ error: t("api.documentNotFound") }, { status: 404 });
  const stored = contentsEntries(document.contents);
  if (stored.length > 0) return NextResponse.json({ ok: true, parts: stored, fallback: false });
  const headings = headingContents(document.blocks);
  if (!data.generate || access.role === "viewer") {
    return NextResponse.json({ ok: true, parts: headings, fallback: true });
  }
  // A media document's contents are its chapters (SPEC.md §26): built on
  // Jev from the transcript, not by the contents prompt.
  if (document.video) {
    if (!jevEnabled()) return NextResponse.json({ error: t("api.chaptersNeedKey") }, { status: 503 });
    try {
      const parts = await buildChapters(documentId, access.user.id, req.signal);
      return NextResponse.json({ ok: true, parts, fallback: false });
    } catch (err) {
      console.error("Chapters failed:", err);
      return NextResponse.json({ error: t("api.contentsFailed") }, { status: 422 });
    }
  }
  if (!kimiConfigured()) {
    return NextResponse.json({ error: t("api.contentsNeedsKey") }, { status: 503 });
  }
  try {
    const parts = await buildContents(documentId, access.user.id, req.signal);
    return NextResponse.json({ ok: true, parts, fallback: false });
  } catch (err) {
    console.error("Contents failed:", err);
    return NextResponse.json({ error: t("api.contentsFailed") }, { status: 422 });
  }
}
