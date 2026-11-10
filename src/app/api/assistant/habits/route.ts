import { NextResponse } from "next/server";
import { parseTurnContent } from "@/lib/assistant/attachments";
import { GENERAL_KINDS, HABIT_DAYS, habitAsks, habitsOf, habitStamp, type Ask, type Habit } from "@/lib/assistant/habits";
import { writeHabits } from "@/lib/assistant/write-habits";
import { notebookAccess } from "@/lib/collab";
import { parseTranscript } from "@/lib/conversation";
import { db } from "@/lib/db";
import { ANNOTATIONS_SECTION_TITLE } from "@/lib/derive/config";
import type { TFunc, TKey } from "@/lib/i18n/dictionaries";
import { currentLang, serverT } from "@/lib/i18n/server";

export const maxDuration = 30;

// The reader's habits (SPEC.md §7): how they ask, read from their own
// conversation notes across their projects — the sidebar's and the
// selection chat's transcripts in the hidden Annotations sections — and
// never stored on the server. The assistant writes the asks from them, fit
// to the open project (lib/assistant/write-habits.ts); the kinds of
// lib/assistant/habits.ts stand in where no model answers. The answer
// carries a stamp: the panel keeps the asks with it and sends it back as
// `have`, and while the stamp stands nothing is written again.

// The dictionary key of a kind's general ask.
const KIND_KEY: Record<string, TKey> = {
  proofread: "assistant.habitKindProofread",
  "study guide": "assistant.habitKindStudyGuide",
  flashcards: "assistant.habitKindFlashcards",
  faq: "assistant.habitKindFaq",
  "action items": "assistant.habitKindActionItems",
  glossary: "assistant.habitKindGlossary",
  outline: "assistant.habitKindOutline",
  summary: "assistant.habitKindSummary",
  "plain words": "assistant.habitKindPlainWords",
  notes: "assistant.habitKindNotes",
  contradictions: "assistant.habitKindContradictions",
};

/** The kinds' habits in general words: "Summarize this document", not the
    reader's last summary ask with another project's subject in it. */
function generalWords(habits: Habit[], t: TFunc, place: string): Habit[] {
  return habits.map((h) => (GENERAL_KINDS.has(h.kind) && KIND_KEY[h.kind] ? { ...h, text: t(KIND_KEY[h.kind], { place }) } : h));
}

export async function GET(req: Request) {
  const t = await serverT();
  const params = new URL(req.url).searchParams;
  const notebookId = params.get("notebookId");
  if (!notebookId) return NextResponse.json({ error: t("api.missingNotebookId") }, { status: 400 });
  const documentId = params.get("documentId");
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
  const read = habitAsks(asks, notebookId);
  const lang = await currentLang();
  // The panel's language and whether a document is open change the words.
  const stamp = `${habitStamp(notebookId, read.total)}:${lang}:${documentId ? "document" : "project"}`;
  if (params.get("have") === stamp) return NextResponse.json({ stamp, unchanged: true });
  const written = await writeHabits({
    notebookId,
    documentId,
    here: read.here,
    elsewhere: read.elsewhere,
    language: lang === "zh" ? "Chinese" : "English",
    userId: access.user.id,
  });
  const place = t(documentId ? "assistant.habitPlaceDocument" : "assistant.habitPlaceProject");
  const habits = written ?? generalWords(habitsOf(asks, new Date(), undefined, notebookId), t, place);
  return NextResponse.json({ habits, stamp });
}
