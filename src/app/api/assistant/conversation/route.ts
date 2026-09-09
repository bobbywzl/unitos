import { NextResponse } from "next/server";
import { z } from "zod";
import {
  conversationTurnSchema,
  embedAttachments,
  parseTurnContent,
} from "@/lib/assistant/attachments";
import { bumpNotebook, notebookAccess } from "@/lib/collab";
import { parseTranscript, renderTranscript } from "@/lib/conversation";
import { db } from "@/lib/db";
import { ANNOTATIONS_SECTION_TITLE } from "@/lib/derive/config";
import { annotationsSection } from "@/lib/derive/context";
import { serverT } from "@/lib/i18n/server";
import { parseBody } from "@/lib/validate";

export const maxDuration = 30;

// The sidebar assistant's own conversation persists like every other one
// (SPEC.md §21): one note per reader per project, in the hidden Annotations
// section, no sources — it is not anchored to a passage, so it renders in
// the digest under "Annotations not anchored in an attached document"
// (lib/digest/render.ts) and nowhere else in the reader (a hidden section
// stays out of the outline, the notes tray, and the notes full page). The
// note's content is the same "**Reader:** … **Assistant:** …" transcript a
// tool or selection-popover conversation writes (lib/conversation.ts); a
// reader's turn carries its attachments as trailing lines
// (embedAttachments/parseTurnContent) so a reload renders the same bubbles,
// images included.

/** The note this reader's sidebar conversation lives on for this project, if
    they have started one. */
async function findConversationNote(notebookId: string, userId: string) {
  const section = await db.section.findFirst({
    where: { notebookId, hidden: true, title: ANNOTATIONS_SECTION_TITLE },
    select: { id: true },
  });
  if (!section) return null;
  return db.note.findFirst({
    where: {
      sectionId: section.id,
      derivationType: "SYNTHESIS",
      createdById: userId,
      sources: { none: {} },
    },
    orderBy: { updatedAt: "desc" },
    select: { id: true, content: true },
  });
}

const turnsToClient = (content: string) =>
  parseTranscript(content).map((turn) =>
    turn.role === "user"
      ? { role: turn.role, ...parseTurnContent(turn.content) }
      : { role: turn.role, content: turn.content },
  );

export async function GET(req: Request) {
  const t = await serverT();
  const notebookId = new URL(req.url).searchParams.get("notebookId");
  if (!notebookId) return NextResponse.json({ error: t("api.missingNotebookId") }, { status: 400 });
  const access = await notebookAccess(notebookId, "viewer");
  if (access instanceof NextResponse) return access;

  const note = await findConversationNote(notebookId, access.user.id);
  return NextResponse.json({
    conversationNoteId: note?.id ?? null,
    turns: note ? turnsToClient(note.content) : [],
  });
}

const saveSchema = z.object({
  notebookId: z.string().min(1),
  conversationNoteId: z.string().nullish(),
  turns: z.array(conversationTurnSchema).max(200),
});

export async function POST(req: Request) {
  const { data, error } = await parseBody(req, saveSchema);
  if (error) return error;
  const access = await notebookAccess(data.notebookId, "editor");
  if (access instanceof NextResponse) return access;

  const transcript = renderTranscript(
    data.turns.map((turn) => ({
      role: turn.role,
      content:
        turn.role === "user"
          ? embedAttachments(
              turn.content,
              (turn.images ?? []).map((img) => ({ id: img.id, name: img.name ?? "image" })),
              turn.files ?? [],
            )
          : turn.content,
    })),
  );

  if (data.conversationNoteId) {
    const updated = await db.note.updateMany({
      where: {
        id: data.conversationNoteId,
        createdById: access.user.id,
        section: { notebookId: data.notebookId },
      },
      data: { content: transcript },
    });
    if (updated.count > 0) {
      await bumpNotebook(data.notebookId);
      return NextResponse.json({ conversationNoteId: data.conversationNoteId });
    }
    // The note was deleted from under it (New conversation, elsewhere) —
    // fall through and start a fresh one.
  }

  const section = await annotationsSection(data.notebookId);
  const count = await db.note.count({ where: { sectionId: section.id } });
  const note = await db.note.create({
    data: {
      sectionId: section.id,
      content: transcript,
      status: "ACCEPTED",
      derivationType: "SYNTHESIS",
      createdById: access.user.id,
      order: count,
    },
    select: { id: true },
  });
  await bumpNotebook(data.notebookId);
  return NextResponse.json({ conversationNoteId: note.id });
}

const clearSchema = z.object({
  notebookId: z.string().min(1),
  conversationNoteId: z.string().min(1),
});

// New conversation (SPEC.md §7): the persisted note is gone, not just the
// screen — the sidebar keeps no other trace of an emptied conversation.
export async function DELETE(req: Request) {
  const t = await serverT();
  const { data, error } = await parseBody(req, clearSchema);
  if (error) return error;
  const access = await notebookAccess(data.notebookId, "editor");
  if (access instanceof NextResponse) return access;

  const deleted = await db.note.deleteMany({
    where: {
      id: data.conversationNoteId,
      createdById: access.user.id,
      section: { notebookId: data.notebookId },
    },
  });
  if (deleted.count === 0) return NextResponse.json({ error: t("api.noteNotFound") }, { status: 404 });
  await bumpNotebook(data.notebookId);
  return NextResponse.json({ ok: true });
}
