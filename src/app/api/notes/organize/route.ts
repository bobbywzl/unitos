import type { ModelMessage } from "ai";
import { NextResponse } from "next/server";
import { z } from "zod";
import { bumpNotebook, notebookAccess } from "@/lib/collab";
import { db } from "@/lib/db";
import { ORGANIZE_EFFORT, ORGANIZE_MAX_OUTPUT_TOKENS } from "@/lib/derive/config";
import { documentPrefix, loadProfile, pageNames, sectionSkeleton } from "@/lib/derive/context";
import { callForJson } from "@/lib/derive/json-call";
import { featureCall, featureConfigured } from "@/lib/feature-models";
import { currentLang, serverT } from "@/lib/i18n/server";
import { notesPlanSchema, writePlannedNotes } from "@/lib/notes/write-planned";
import { organizePrompt } from "@/lib/prompts/organize";
import { parseBody } from "@/lib/validate";

export const maxDuration = 120;

// Save as note (SPEC.md §7): an answer of the assistant, or a tool's output,
// organized into one note of the project. One model call (ORGANIZE_MODEL)
// reads the answer, the open document whole, and the passages the answer
// cites from other documents, and writes the note: a title, the key points
// with their reasoning, and under each the document's words as quotes. Every
// quote resolves against the real block text and becomes a source; the note
// lands PENDING (SPEC.md §1) — the reader reads it over and accepts it. The
// answer itself is not touched: Save as note only adds a note.
const ORIGINS = ["assistant", "explain", "simplify", "analyze", "ask", "act", "stitch"] as const;

const bodySchema = z.object({
  notebookId: z.string().min(1),
  documentId: z.string().min(1).optional(),
  origin: z.enum(ORIGINS),
  question: z.string().max(20_000).default(""),
  selection: z.string().max(20_000).default(""),
  answer: z.string().min(1).max(60_000),
});

// The name the prompt gives the answer's maker.
const ORIGIN_NAME: Record<(typeof ORIGINS)[number], string> = {
  assistant: "the assistant",
  explain: "Explain",
  simplify: "Simplify",
  analyze: "Analyze",
  ask: "the assistant on a range of a recording",
  act: "the assistant on a selection",
  stitch: "Stitch",
};

const BLOCK_TAG = /\[block ([a-zA-Z0-9]+)\]/g;
const CITED_MAX = 40;

export async function POST(req: Request) {
  const t = await serverT();
  const { data, error } = await parseBody(req, bodySchema);
  if (error) return error;
  const access = await notebookAccess(data.notebookId, "editor");
  if (access instanceof NextResponse) return access;
  if (!(await featureConfigured("organize"))) {
    return NextResponse.json({ error: t("api.organizeNeedsKey") }, { status: 503 });
  }

  // The open document, when it is one of the project's: the note quotes it
  // and belongs to it.
  const document = data.documentId
    ? await db.document.findFirst({
        where: { id: data.documentId, notebooks: { some: { notebookId: data.notebookId } } },
        include: {
          blocks: { orderBy: { order: "asc" }, select: { id: true, type: true, text: true, cell: true, page: true } },
        },
      })
    : null;

  // The passages the answer cites from the project's other documents, so a
  // Project scope answer keeps its quotes too.
  const own = new Set(document?.blocks.map((b) => b.id) ?? []);
  const citedIds = [...new Set([...data.answer.matchAll(BLOCK_TAG)].map((m) => m[1]))]
    .filter((id) => !own.has(id))
    .slice(0, CITED_MAX);
  const cited =
    citedIds.length > 0
      ? await db.block.findMany({
          where: {
            id: { in: citedIds },
            document: { notebooks: { some: { notebookId: data.notebookId } } },
          },
          select: { id: true, text: true, documentId: true, document: { select: { title: true } } },
        })
      : [];

  const [profile, sections, lang] = await Promise.all([
    loadProfile(data.notebookId),
    sectionSkeleton(data.notebookId),
    currentLang(),
  ]);
  const defaultSection = await sectionForSave(data.notebookId, access.user.id, sections, t("reader.defaultSectionTitle"));

  const messages: ModelMessage[] = [
    ...(document
      ? [
          {
            role: "system" as const,
            content: documentPrefix(document.title, document.blocks, document.references, pageNames(document)),
            providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
          },
        ]
      : []),
    {
      role: "user",
      content: organizePrompt({
        profile,
        lang,
        origin: ORIGIN_NAME[data.origin],
        question: data.question,
        selection: data.selection,
        answer: data.answer,
        sections,
        defaultSection,
        hasDocument: document !== null,
        citedPassages: cited.map((b) => ({ blockId: b.id, documentTitle: b.document.title, text: b.text.slice(0, 4000) })),
      }),
    },
  ];
  const call = await featureCall("organize", ORGANIZE_EFFORT);
  const result = await callForJson({
    model: call.model,
    messages,
    maxOutputTokens: ORGANIZE_MAX_OUTPUT_TOKENS,
    providerOptions: call.providerOptions,
    schema: notesPlanSchema,
    label: "ORGANIZE",
    usage: { userId: access.user.id, feature: "organize", model: call.modelId },
    abortSignal: req.signal,
  });
  if (!result.ok) {
    return NextResponse.json({ error: t("api.organizeFailed", { reason: result.error }) }, { status: 422 });
  }

  // One note: the first the answer came to. A new section is never made.
  const note = result.data.notes[0];
  if (!note) return NextResponse.json({ error: t("api.organizeFailed", { reason: "" }).trim() }, { status: 422 });
  const ids = await writePlannedNotes(
    { notes: [{ ...note, sectionTitle: undefined }] },
    {
      section: { id: defaultSection.id, notebookId: data.notebookId },
      document: {
        id: document?.id ?? null,
        blocks: [
          ...(document?.blocks ?? []),
          ...cited.map((b) => ({ id: b.id, text: b.text, documentId: b.documentId })),
        ],
      },
      sections,
      userId: access.user.id,
      derivationType: "SYNTHESIS",
      t,
    },
  );
  const noteId = ids[0];
  if (!noteId) return NextResponse.json({ error: t("api.organizeFailed", { reason: "" }).trim() }, { status: 422 });
  // A Stitch answer saved with no quote that resolved: each block the answer
  // cites becomes a whole-block source, so the note sits on the documents
  // it came from and the graph finds it (SPEC.md §22). Real text, never
  // invented.
  if (data.origin === "stitch" && cited.length > 0 && (await db.source.count({ where: { noteId } })) === 0) {
    const order = new Map(citedIds.map((id, i) => [id, i]));
    await db.source.createMany({
      data: [...cited]
        .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
        .filter((b) => b.text.length > 0)
        .map((b) => ({
          noteId,
          documentId: b.documentId,
          blockId: b.id,
          startOffset: 0,
          endOffset: b.text.length,
          quotedText: b.text,
          prefix: "",
          suffix: "",
        })),
    });
  }
  await bumpNotebook(data.notebookId);
  const saved = await db.note.findUnique({ where: { id: noteId }, select: { section: { select: { id: true, title: true } } } });
  return NextResponse.json({
    noteId,
    sectionId: saved?.section.id ?? defaultSection.id,
    sectionTitle: saved?.section.title ?? defaultSection.title,
    warnings: result.data.warnings ?? [],
  });
}

// The section a saved answer lands in: the visible section the reader last
// wrote a note in, else the project's first, else a new one.
async function sectionForSave(
  notebookId: string,
  userId: string,
  sections: { id: string; title: string }[],
  defaultTitle: string,
): Promise<{ id: string; title: string }> {
  const recent = await db.note.findFirst({
    where: { createdById: userId, section: { notebookId, hidden: false } },
    orderBy: { updatedAt: "desc" },
    select: { section: { select: { id: true, title: true } } },
  });
  if (recent) return recent.section;
  if (sections[0]) return { id: sections[0].id, title: sections[0].title };
  const count = await db.section.count({ where: { notebookId, parentId: null } });
  return db.section.create({
    data: { notebookId, title: defaultTitle, parentId: null, order: count },
    select: { id: true, title: true },
  });
}
