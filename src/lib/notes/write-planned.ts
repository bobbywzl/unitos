import { z } from "zod";
import { matchInTextLoose } from "@/lib/anchors/match";
import { db } from "@/lib/db";
import type { TFunc } from "@/lib/i18n/dictionaries";

// Notes an AI pass planned, written PENDING (SPEC.md §1): the voice command's
// (/api/notes/voice) and Save as note's (/api/notes/organize). Each note is
// markdown, the section it lands in, and the document's quotes it rests on;
// every quote resolves against the real block text and becomes a source.

export const plannedNoteSchema = z.object({
  content: z.string().min(1).max(50_000),
  sectionId: z.string().optional(),
  sectionTitle: z.string().max(200).optional(),
  // At most 30 quotes: more are cut, never a failed save (the prompt asks for 30 at most).
  quotes: z
    .array(z.object({ blockId: z.string().min(1), quote: z.string().min(1).max(2000) }))
    .transform((quotes) => quotes.slice(0, 30))
    .optional(),
});

export const notesPlanSchema = z.object({
  notes: z.array(plannedNoteSchema).max(12),
  warnings: z.array(z.string().max(300)).max(5).optional(),
});

export type NotesPlan = z.infer<typeof notesPlanSchema>;

type PlanNote = z.infer<typeof plannedNoteSchema>;
// The open document's blocks. A block that names its own documentId is
// another document's (a passage an answer at Project scope cited): its
// source points there, and the note stays nobody's document's.
type PlannedBlock = { id: string; text: string; documentId?: string };
type DocumentBlocks = { id: string | null; blocks: PlannedBlock[] } | null;

/** The notes land PENDING in their sections (SPEC.md §1). A named section
    must be the project's; a new title makes the section, or finds one with
    that title; anything else is the default section. Returns the ids of the
    notes written. Every quote resolves in its named block — exact, then
    whitespace-tolerant, then typography-tolerant (SPEC.md §5) — else in any
    block, and becomes a source; a quote that resolves nowhere is dropped,
    the note still lands. */
export async function writePlannedNotes(
  plan: NotesPlan,
  options: {
    // The section a note lands in unless it names another.
    section: { id: string; notebookId: string };
    document: DocumentBlocks;
    sections: { id: string; title: string }[];
    userId: string;
    derivationType: "VOICE" | "SYNTHESIS";
    t: TFunc;
  },
): Promise<string[]> {
  const { section: spoken, document, sections, userId, derivationType, t } = options;
  const sectionIds = new Set(sections.map((s) => s.id));
  const sectionByTitle = new Map(sections.map((s) => [s.title.trim().toLowerCase(), s.id]));
  const blockById = new Map((document?.blocks ?? []).map((b) => [b.id, b]));
  const written: string[] = [];
  for (const note of plan.notes) {
    const content = note.content.trim();
    if (!content) continue;
    const sectionId = await sectionFor(note, spoken, sectionIds, sectionByTitle, t);
    const sources = document
      ? (note.quotes ?? []).flatMap((q) => {
          const anchor = resolveQuote(q, blockById, document.blocks);
          const documentId = anchor?.documentId ?? document.id;
          return anchor && documentId ? [{ ...anchor, documentId }] : [];
        })
      : [];
    const count = await db.note.count({ where: { sectionId } });
    const created = await db.note.create({
      select: { id: true },
      data: {
        sectionId,
        content,
        status: "PENDING",
        derivationType,
        createdById: userId,
        order: count,
        // Written in the open document: the note is that document's (SPEC.md §6).
        ...(document?.id ? { documentId: document.id } : {}),
        ...(sources.length > 0 ? { sources: { create: sources } } : {}),
      },
    });
    written.push(created.id);
  }
  return written;
}

async function sectionFor(
  note: PlanNote,
  spoken: { id: string; notebookId: string },
  sectionIds: Set<string>,
  sectionByTitle: Map<string, string>,
  t: TFunc,
): Promise<string> {
  if (note.sectionId && sectionIds.has(note.sectionId)) return note.sectionId;
  const title = note.sectionTitle?.trim();
  if (!title) return spoken.id;
  const existing = sectionByTitle.get(title.toLowerCase());
  if (existing) return existing;
  const siblingCount = await db.section.count({ where: { notebookId: spoken.notebookId, parentId: null } });
  const created = await db.section.create({
    data: { notebookId: spoken.notebookId, title: title || t("reader.defaultSectionTitle"), parentId: null, order: siblingCount },
  });
  sectionIds.add(created.id);
  sectionByTitle.set(title.toLowerCase(), created.id);
  return created.id;
}

function resolveQuote(
  q: { blockId: string; quote: string },
  blockById: Map<string, PlannedBlock>,
  blocks: PlannedBlock[],
) {
  const selector = { quotedText: q.quote.trim(), prefix: "", suffix: "" };
  if (!selector.quotedText) return null;
  const named = blockById.get(q.blockId);
  let block = named;
  let hit = named ? matchInTextLoose(named.text, selector) : null;
  if (!hit) {
    block = undefined;
    for (const candidate of blocks) {
      const found = matchInTextLoose(candidate.text, selector);
      if (found) {
        block = candidate;
        hit = found;
        break;
      }
    }
  }
  if (!block || !hit) return null;
  return {
    documentId: block.documentId,
    blockId: block.id,
    startOffset: hit.start,
    endOffset: hit.end,
    quotedText: block.text.slice(hit.start, hit.end),
    prefix: block.text.slice(Math.max(0, hit.start - 32), hit.start),
    suffix: block.text.slice(hit.end, hit.end + 32),
  };
}
