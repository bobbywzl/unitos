import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { notebookAccess } from "@/lib/collab";
import { db } from "@/lib/db";
import { serverT } from "@/lib/i18n/server";
import { parseBody } from "@/lib/validate";

// Kept conversations (SPEC.md §21, lib/kept-chat.ts): the turns of an
// assistant surface that keeps no note of its own, one row per account per
// project per place. GET reads the account's row, PUT replaces its turns
// when the row is still the one the browser built on (`base`, the row's
// updatedAt as GET or the last PUT answered; null = no row) and answers 409
// when it changed since — another tab, another device — so the browser merges
// instead of writing over turns it never saw (lib/kept-chat.ts). DELETE
// removes the row — the one way a kept conversation goes (Clear
// conversation). Viewer access: a conversation is the account's own, not the
// project's, so a viewer keeps theirs too; no rev moves, nothing lands in the
// history, and no other account ever reads the row.

const PLACE = z.string().min(1).max(200).regex(/^[a-z]+(:[A-Za-z0-9_-]+)?$/);
const TURN_MAX_CHARS = 60_000;
const TURNS_MAX = 2000;

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
  // The row the turns were built on: its updatedAt, or null for no row.
  base: z.iso.datetime().nullable(),
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
    // Whose conversation this is: the browser keeps an unsaved copy under it,
    // so another account signed in on the same browser never adopts it.
    account: access.user.id,
  });
}

export async function PUT(req: Request) {
  const { data, error } = await parseBody(req, putSchema);
  if (error) return error;
  const access = await notebookAccess(data.notebookId, "viewer");
  if (access instanceof NextResponse) return access;
  const turns = data.turns as Prisma.InputJsonValue;
  const key = { userId: access.user.id, notebookId: data.notebookId, place: data.place };
  const changed = () => NextResponse.json({ error: "changed" }, { status: 409 });
  if (data.base === null) {
    // No row read: create it; a row that exists already is one the browser never saw.
    try {
      const row = await db.keptChat.create({ data: { ...key, turns }, select: { updatedAt: true } });
      return NextResponse.json({ ok: true, updatedAt: row.updatedAt.toISOString() });
    } catch (err) {
      if ((err as { code?: string }).code === "P2002") return changed();
      throw err;
    }
  }
  // The stamp is set here, later than the base, so it names this write alone.
  const base = new Date(data.base);
  const stamp = new Date(Math.max(Date.now(), base.getTime() + 1));
  const updated = await db.keptChat.updateMany({
    where: { ...key, updatedAt: base },
    data: { turns, updatedAt: stamp },
  });
  if (updated.count === 0) return changed();
  return NextResponse.json({ ok: true, updatedAt: stamp.toISOString() });
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
