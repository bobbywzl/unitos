import { NextResponse } from "next/server";
import { z } from "zod";
import {
  conversationTurnSchema,
  embedAttachments,
  parseTurnContent,
} from "@/lib/assistant/attachments";
import { bumpNotebook, noteAccess, notebookAccess } from "@/lib/collab";
import { parseTranscript, renderTranscript } from "@/lib/conversation";
import { db } from "@/lib/db";
import { ANNOTATIONS_SECTION_TITLE } from "@/lib/derive/config";
import { annotationsSection } from "@/lib/derive/context";
import { serverT } from "@/lib/i18n/server";
import { parseBody } from "@/lib/validate";

export const maxDuration = 30;

// The sidebar assistant's own conversations persist like every other one
// (SPEC.md §21): one note per conversation, as many as the reader started
// in the project (the panel's Conversations lists them), in the hidden
// Annotations section, no sources — a conversation is not anchored to a
// passage, so it renders in
// the digest under "Annotations not anchored in an attached document"
// (lib/digest/render.ts) and in the Assistant group of every document's
// Annotations tab, with the comments on its answers under it (a hidden
// section stays out of the outline, the notes tray, and the notes full
// page). The
// note's content is the same "**Reader:** … **Assistant:** …" transcript a
// tool or selection-popover conversation writes (lib/conversation.ts); a
// reader's turn carries its attachments as trailing lines
// (embedAttachments/parseTurnContent) so a reload renders the same bubbles,
// images included.

/** This reader's sidebar conversations of the project (SPEC.md §7): the
    notes of the hidden Annotations section that hold their transcripts. A
    side chat is a conversation note of its own with no sources, so it is
    excluded: a sidebar conversation belongs to no other. */
function sidebarConversations(sectionId: string, userId: string) {
  return {
    sectionId,
    derivationType: "SYNTHESIS" as const,
    createdById: userId,
    sideChatOfId: null,
    sources: { none: {} },
  };
}

async function annotationsSectionId(notebookId: string) {
  const section = await db.section.findFirst({
    where: { notebookId, hidden: true, title: ANNOTATIONS_SECTION_TITLE },
    select: { id: true },
  });
  return section?.id ?? null;
}

/** The note a sidebar conversation lives on: the one asked for by id, else
    the reader's newest one for this project; null with none started. */
async function findConversationNote(notebookId: string, userId: string, id?: string) {
  const sectionId = await annotationsSectionId(notebookId);
  if (!sectionId) return null;
  return db.note.findFirst({
    where: { ...sidebarConversations(sectionId, userId), ...(id ? { id } : {}) },
    orderBy: { updatedAt: "desc" },
    select: { id: true, content: true },
  });
}

const TITLE_MAX = 80;

/** The conversations list (SPEC.md §7): every sidebar conversation of this
    reader in the project, newest first — its title (the note's gist, else
    the first message's words), when it last changed, and its message
    count. */
async function conversationList(notebookId: string, userId: string) {
  const sectionId = await annotationsSectionId(notebookId);
  if (!sectionId) return [];
  const notes = await db.note.findMany({
    where: sidebarConversations(sectionId, userId),
    orderBy: { updatedAt: "desc" },
    select: { id: true, content: true, gist: true, updatedAt: true },
  });
  return notes.map((n) => {
    const turns = parseTranscript(n.content);
    const first = turns.find((turn) => turn.role === "user");
    const words = first ? parseTurnContent(first.content).content.replace(/\s+/g, " ").trim() : "";
    const title = n.gist?.trim() || (words.length > TITLE_MAX ? `${words.slice(0, TITLE_MAX - 1)}…` : words);
    return { id: n.id, title, updatedAt: n.updatedAt.toISOString(), turns: turns.length };
  });
}

/** The side chats of one conversation (SPEC.md §7), oldest first: each one's
    quote and its turns. They open from their own chat box alone. */
async function sideChatsOf(noteId: string) {
  const notes = await db.note.findMany({
    where: { sideChatOfId: noteId },
    orderBy: { createdAt: "asc" },
    select: { id: true, content: true, sideChatQuote: true, updatedAt: true },
  });
  return notes.map((n) => ({
    id: n.id,
    quote: n.sideChatQuote ?? "",
    turns: turnsToClient(n.content),
    updatedAt: n.updatedAt.toISOString(),
  }));
}

const turnsToClient = (content: string) =>
  parseTranscript(content).map((turn) =>
    turn.role === "user"
      ? { role: turn.role, ...parseTurnContent(turn.content) }
      : { role: turn.role, content: turn.content },
  );

export async function GET(req: Request) {
  const t = await serverT();
  const params = new URL(req.url).searchParams;
  // noteId: the side chats of one conversation, for a chat box that already
  // knows its note — the reader's card, reopened from its mark.
  const noteId = params.get("noteId");
  if (noteId) {
    const access = await noteAccess(noteId, "viewer");
    if (access instanceof NextResponse) return access;
    return NextResponse.json({ sideChats: await sideChatsOf(noteId) });
  }
  const notebookId = params.get("notebookId");
  if (!notebookId) return NextResponse.json({ error: t("api.missingNotebookId") }, { status: 400 });
  const access = await notebookAccess(notebookId, "viewer");
  if (access instanceof NextResponse) return access;

  // list: the conversations list, for the panel's Conversations.
  if (params.get("list")) {
    return NextResponse.json({ conversations: await conversationList(notebookId, access.user.id) });
  }
  // conversationNoteId: one conversation, opened from the list; absent, the
  // newest, which the panel opens on.
  const wanted = params.get("conversationNoteId") ?? undefined;
  const note = await findConversationNote(notebookId, access.user.id, wanted);
  if (wanted && !note) return NextResponse.json({ error: t("api.noteNotFound") }, { status: 404 });
  return NextResponse.json({
    conversationNoteId: note?.id ?? null,
    turns: note ? turnsToClient(note.content) : [],
    sideChats: note ? await sideChatsOf(note.id) : [],
  });
}

const saveSchema = z.object({
  notebookId: z.string().min(1),
  conversationNoteId: z.string().nullish(),
  turns: z.array(conversationTurnSchema).max(200),
  // A side chat (SPEC.md §7): the conversation it was started from, and the
  // words it was started on. Set on the first save; the note carries them.
  sideChatOf: z.string().min(1).optional(),
  quote: z.string().min(1).max(2000).optional(),
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
      sideChatOfId: data.sideChatOf ?? null,
      sideChatQuote: data.sideChatOf ? (data.quote ?? "") : null,
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

// Delete, from the conversations list (SPEC.md §7): the persisted note is
// gone, its side chats and comments with it. New conversation deletes
// nothing: the conversation on screen stays in the list.
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
