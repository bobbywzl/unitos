import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { bumpNotebook, notebookAccess } from "@/lib/collab";
import { db } from "@/lib/db";
import { serverT } from "@/lib/i18n/server";
import { keptNoteOf, keptSectionOf, restoreNote, restoreSection } from "@/lib/notes/removed";
import { noteViewOf } from "@/lib/notes/view";
import { normalizeSectionOrders } from "@/lib/order";

// Restore from History (SPEC.md §12): a removed note comes back whole, with
// its sources, replies, edits, and side chats (lib/notes/removed.ts); a
// removed section comes back with every note it held. The
// event stays in History, marked restored; a second Restore answers 409.
export async function POST(_req: Request, ctx: { params: Promise<{ notebookId: string; eventId: string }> }) {
  const t = await serverT();
  const { notebookId, eventId } = await ctx.params;
  const access = await notebookAccess(notebookId, "editor");
  if (access instanceof NextResponse) return access;
  const event = await db.notebookEvent.findFirst({
    where: { id: eventId, notebookId, kind: { in: ["NOTE_REMOVE", "SECTION_REMOVE"] } },
  });
  // A removed section comes back with its notes (lib/notes/removed.ts).
  if (event?.kind === "SECTION_REMOVE") {
    const section = keptSectionOf(event.meta);
    if (!section) return NextResponse.json({ error: t("api.historyNotRestorable") }, { status: 404 });
    const back = await restoreSection(section, notebookId);
    if (!back.ok) {
      return NextResponse.json(
        { error: t(back.reason === "restored" ? "api.historySectionRestored" : "api.historyNotRestorable") },
        { status: back.reason === "restored" ? 409 : 404 },
      );
    }
    await normalizeSectionOrders(notebookId);
    await db.notebookEvent.update({
      where: { id: eventId },
      data: {
        meta: { ...(event.meta as Prisma.JsonObject), restoredAt: new Date().toISOString(), restoredById: access.user.id },
      },
    });
    await bumpNotebook(notebookId);
    return NextResponse.json({ ok: true, sectionId: back.sectionId });
  }
  const kept = keptNoteOf(event?.meta);
  if (!event || !kept) return NextResponse.json({ error: t("api.historyNotRestorable") }, { status: 404 });
  const meta = (event.meta ?? {}) as { sectionTitle?: unknown; restoredAt?: unknown };
  const result = await restoreNote(kept, notebookId, typeof meta.sectionTitle === "string" ? meta.sectionTitle : null);
  if (!result.ok) {
    return NextResponse.json(
      { error: t(result.reason === "restored" ? "api.historyRestored" : "api.historyNotRestorable") },
      { status: result.reason === "restored" ? 409 : 404 },
    );
  }
  await db.notebookEvent.update({
    where: { id: eventId },
    data: {
      meta: { ...(event.meta as Prisma.JsonObject), restoredAt: new Date().toISOString(), restoredById: access.user.id },
    },
  });
  await bumpNotebook(notebookId);
  // The note itself, as the outline draws it: the tray shows it at once
  // (lib/notes/undo-pill.ts tellNoteBack), and a refresh confirms.
  const back = await noteViewOf(result.noteId);
  return NextResponse.json({ ok: true, noteId: result.noteId, sectionId: back?.sectionId ?? result.sectionId, note: back?.note ?? null });
}
