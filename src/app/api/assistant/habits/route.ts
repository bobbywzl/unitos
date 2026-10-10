import { NextResponse } from "next/server";
import { parseTurnContent } from "@/lib/assistant/attachments";
import { HABIT_DAYS, habitsOf, type Ask } from "@/lib/assistant/habits";
import { notebookAccess } from "@/lib/collab";
import { parseTranscript } from "@/lib/conversation";
import { db } from "@/lib/db";
import { ANNOTATIONS_SECTION_TITLE } from "@/lib/derive/config";
import { serverT } from "@/lib/i18n/server";

export const maxDuration = 15;

// The reader's habits (SPEC.md §7): the asks they repeat, read from their
// own conversation notes across their projects — the sidebar's and the
// selection chat's transcripts in the hidden Annotations sections — and
// never stored apart. lib/assistant/habits.ts sets what counts as a habit.

export async function GET(req: Request) {
  const t = await serverT();
  const notebookId = new URL(req.url).searchParams.get("notebookId");
  if (!notebookId) return NextResponse.json({ error: t("api.missingNotebookId") }, { status: 400 });
  const access = await notebookAccess(notebookId, "viewer");
  if (access instanceof NextResponse) return access;
  const since = new Date(Date.now() - HABIT_DAYS * 86_400_000);
  const notes = await db.note.findMany({
    where: {
      createdById: access.user.id,
      derivationType: "SYNTHESIS",
      updatedAt: { gte: since },
      section: { hidden: true, title: ANNOTATIONS_SECTION_TITLE },
    },
    select: {
      content: true,
      updatedAt: true,
      section: { select: { notebookId: true } },
      sources: { select: { documentId: true }, take: 1 },
    },
    orderBy: { updatedAt: "desc" },
    take: 300,
  });
  const asks: Ask[] = notes.flatMap((note) =>
    parseTranscript(note.content)
      .filter((turn) => turn.role === "user")
      .map((turn) => ({
        text: parseTurnContent(turn.content).content,
        notebookId: note.section.notebookId,
        documentId: note.sources[0]?.documentId ?? null,
        at: note.updatedAt,
      })),
  );
  return NextResponse.json({ habits: habitsOf(asks) });
}
