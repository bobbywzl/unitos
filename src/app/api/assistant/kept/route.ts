import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { notebookAccess } from "@/lib/collab";
import { db } from "@/lib/db";
import { serverT } from "@/lib/i18n/server";
import { parseBody } from "@/lib/validate";

// Kept conversations (SPEC.md §21, lib/kept-chat.ts): the turns of an
// assistant surface that keeps no note of its own, one row per account per
// project per place. GET reads the account's row, PUT replaces its turns,
// DELETE removes it — the one way a kept conversation goes (Clear
// conversation). Viewer access: a conversation is the account's own, not the
// project's, so a viewer keeps theirs too; no rev moves, nothing lands in the
// history, and no other account ever reads the row.

const PLACE = z.string().min(1).max(200).regex(/^[a-z]+(:[A-Za-z0-9_-]+)?$/);
const TURN_MAX_CHARS = 60_000;
const TURNS_MAX = 200;

const turnSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().max(TURN_MAX_CHARS),
  // What the surface draws under the turn (a Stitch result, a proposed
  // change to a note, the range an answer read); the surface reads it back.
  data: z.record(z.string(), z.json()).optional(),
});

const putSchema = z.object({
  notebookId: z.string().min(1),
  place: PLACE,
  turns: z.array(turnSchema).max(TURNS_MAX),
});

const deleteSchema = z.object({ notebookId: z.string().min(1), place: PLACE });

export async function GET(req: Request) {
  const t = await serverT();
  const params = new URL(req.url).searchParams;
  const notebookId = params.get("notebookId");
  const place = PLACE.safeParse(params.get("place"));
  if (!notebookId) return NextResponse.json({ error: t("api.missingNotebookId") }, { status: 400 });
  if (!place.success) return NextResponse.json({ error: t("api.validationFailed") }, { status: 400 });
  const access = await notebookAccess(notebookId, "viewer");
  if (access instanceof NextResponse) return access;
  const row = await db.keptChat.findUnique({
    where: { userId_notebookId_place: { userId: access.user.id, notebookId, place: place.data } },
    select: { turns: true, updatedAt: true },
  });
  const turns = z.array(turnSchema).safeParse(row?.turns ?? []);
  return NextResponse.json({
    turns: turns.success ? turns.data : [],
    updatedAt: row?.updatedAt.toISOString() ?? null,
  });
}

export async function PUT(req: Request) {
  const { data, error } = await parseBody(req, putSchema);
  if (error) return error;
  const access = await notebookAccess(data.notebookId, "viewer");
  if (access instanceof NextResponse) return access;
  const turns = data.turns as Prisma.InputJsonValue;
  const row = await db.keptChat.upsert({
    where: {
      userId_notebookId_place: { userId: access.user.id, notebookId: data.notebookId, place: data.place },
    },
    create: { userId: access.user.id, notebookId: data.notebookId, place: data.place, turns },
    update: { turns },
    select: { updatedAt: true },
  });
  return NextResponse.json({ ok: true, updatedAt: row.updatedAt.toISOString() });
}

export async function DELETE(req: Request) {
  const { data, error } = await parseBody(req, deleteSchema);
  if (error) return error;
  const access = await notebookAccess(data.notebookId, "viewer");
  if (access instanceof NextResponse) return access;
  await db.keptChat.deleteMany({
    where: { userId: access.user.id, notebookId: data.notebookId, place: data.place },
  });
  return NextResponse.json({ ok: true });
}
