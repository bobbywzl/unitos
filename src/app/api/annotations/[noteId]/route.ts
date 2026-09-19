import { NextResponse } from "next/server";
import type { ReferencedAnnotation } from "@/lib/annotation-reference";
import { annotationKind } from "@/lib/annotations/kind";
import { noteAccess } from "@/lib/collab";
import { conversationTurns } from "@/lib/conversation";
import { db } from "@/lib/db";
import { serverT } from "@/lib/i18n/server";

// One annotation, for an annotation reference in a note (SPEC.md §6,
// lib/annotation-reference.ts): the notes full page shows it beside the
// note. ?doc= picks the anchor in that document; without it, the first.
export async function GET(req: Request, ctx: { params: Promise<{ noteId: string }> }) {
  const t = await serverT();
  const { noteId } = await ctx.params;
  const access = await noteAccess(noteId, "viewer");
  if (access instanceof NextResponse) return access;
  const doc = new URL(req.url).searchParams.get("doc");
  const note = await db.note.findUnique({
    where: { id: noteId },
    include: {
      section: { select: { hidden: true } },
      sources: { include: { document: { select: { id: true, title: true } } } },
    },
  });
  if (!note || !note.section.hidden) {
    return NextResponse.json({ error: t("api.noteNotFound") }, { status: 404 });
  }
  const source = note.sources.find((s) => s.documentId === doc) ?? note.sources[0] ?? null;
  const view: ReferencedAnnotation = {
    id: note.id,
    kind: annotationKind(note),
    content: note.content,
    gist: note.gist,
    color: note.color,
    sourceId: source?.id ?? null,
    quotedText: source?.quotedText ?? null,
    orphaned: source?.orphaned ?? false,
    documentId: source?.documentId ?? null,
    documentTitle: source?.document.title ?? null,
    conversation: conversationTurns(note),
  };
  return NextResponse.json(view);
}
