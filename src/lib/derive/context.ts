import type { Block } from "@prisma/client";
import { db } from "@/lib/db";
import { ANNOTATIONS_SECTION_TITLE } from "@/lib/derive/config";
import { USER_ID } from "@/lib/constants";
import { documentReferences } from "@/lib/parse/types";
import type { PromptCtx, ReaderProfileCtx } from "@/lib/prompts/types";

// The document rendered as the cached prompt prefix (SPEC.md §2). Byte-identical across
// every derivation on the same document, so all types reuse one cache entry.
// Block ids are included so DISTILL and SALIENCE can reference them.
// Timed blocks tag their seconds — `(TRANSCRIPT 12.4s–18.2s)` — so FIND can
// resolve answers to time ranges (SPEC.md §11).
// The reference list is appended so in-text citations stay explainable — pass
// Document.references verbatim; parsing happens here so every caller builds
// the same prefix.
export function documentPrefix(
  title: string,
  blocks: (Pick<Block, "id" | "type" | "text"> & Partial<Pick<Block, "startTime" | "endTime">>)[],
  references?: unknown,
): string {
  const rendered = blocks
    .map((b) => {
      const tag =
        b.startTime != null && b.endTime != null
          ? `(${b.type} ${b.startTime.toFixed(1)}s–${b.endTime.toFixed(1)}s)`
          : `(${b.type})`;
      return `[block ${b.id}] ${tag}\n${b.text}`;
    })
    .join("\n\n");
  const referenceList = documentReferences(references ?? null);
  return [
    "You assist a reader dissecting a document. The full document follows.",
    "Each block starts with its id in the form [block <id>]. Reference block ids exactly as given when asked for them.",
    "",
    `Document title: ${title}`,
    "",
    rendered,
    ...(referenceList.length > 0
      ? [
          "",
          "References (in-text citations like [12] point at these entries):",
          ...referenceList.map((r) => `[${r.label}] ${r.text}${r.url ? ` — ${r.url}` : ""}`),
        ]
      : []),
  ].join("\n");
}

// Context is set when any field has content. Any field may be empty.
export function hasContext(
  profile: { background?: string; purpose?: string; application?: string } | null,
): boolean {
  if (!profile) return false;
  return Boolean(
    profile.background?.trim() || profile.purpose?.trim() || profile.application?.trim(),
  );
}

// The reader's context: notebook override wins over the global context (SPEC.md §3).
export async function loadProfile(notebookId: string): Promise<ReaderProfileCtx> {
  const notebook = await db.notebook.findUnique({ where: { id: notebookId } });
  const override = notebook?.profile as ReaderProfileCtx | null;
  if (hasContext(override)) {
    return {
      background: override?.background ?? "",
      purpose: override?.purpose ?? "",
      application: override?.application ?? "",
    };
  }
  const profile = await db.readerProfile.findUnique({ where: { userId: USER_ID } });
  if (!hasContext(profile)) return null;
  return {
    background: profile!.background,
    purpose: profile!.purpose,
    application: profile!.application,
  };
}

// Anchored text with ±2 blocks of context (SPEC.md §4).
export function anchorContext(
  blocks: Pick<Block, "id" | "text">[],
  blockId: string,
  startOffset: number,
  endOffset: number,
) {
  const index = blocks.findIndex((b) => b.id === blockId);
  if (index === -1) return null;
  const block = blocks[index];
  const anchoredText = block.text.slice(startOffset, endOffset);
  const before = blocks
    .slice(Math.max(0, index - 2), index)
    .map((b) => b.text)
    .join("\n\n");
  const after = blocks
    .slice(index + 1, index + 3)
    .map((b) => b.text)
    .join("\n\n");
  return {
    anchoredText,
    contextBefore: [before, block.text.slice(0, startOffset)].filter(Boolean).join("\n\n"),
    contextAfter: [block.text.slice(endOffset), after].filter(Boolean).join("\n\n"),
  };
}

export async function sectionSkeleton(notebookId: string): Promise<PromptCtx["sectionSkeleton"]> {
  const sections = await db.section.findMany({
    where: { notebookId, hidden: false },
    orderBy: { order: "asc" },
    include: { parent: { select: { title: true } } },
  });
  return sections.map((s) => ({
    id: s.id,
    title: s.title,
    parentTitle: s.parent?.title ?? null,
  }));
}

// Corpus context for anchored queries: the reader's other materials in this
// corpus, so an answer can reference them and draw analogies. Other documents
// contribute the blocks most related to the focus text (plain term overlap —
// deterministic, no model call); notes and annotations come in whole under a
// budget. Rendered as its own system message after the cached document prefix,
// so the prefix cache never breaks.
const CORPUS_EXCERPT_BUDGET = 18_000;
const CORPUS_NOTES_BUDGET = 14_000;
const CORPUS_ANNOTATIONS_BUDGET = 10_000;

function focusTerms(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9$%€£+.-]+/)
      .map((t) => t.replace(/^[.-]+|[.-]+$/g, ""))
      .filter((t) => t.length >= 4),
  );
}

export async function corpusSection(
  notebookId: string,
  currentDocumentId: string,
  focusText: string,
): Promise<string | null> {
  const [attachments, sections] = await Promise.all([
    db.notebookDocument.findMany({
      where: { notebookId, NOT: { documentId: currentDocumentId } },
      include: {
        document: {
          select: {
            id: true,
            title: true,
            blocks: { orderBy: { order: "asc" }, select: { id: true, text: true } },
          },
        },
      },
    }),
    db.section.findMany({
      where: { notebookId },
      orderBy: { order: "asc" },
      include: {
        notes: {
          where: { status: "ACCEPTED" },
          orderBy: { order: "asc" },
          include: { sources: { include: { document: { select: { title: true } } } } },
        },
      },
    }),
  ]);

  // Related blocks from the other documents, scored by shared terms with the
  // focus text. Deterministic and cheap; good enough to surface the passages
  // worth referencing.
  const terms = focusTerms(focusText);
  const excerpts: string[] = [];
  if (terms.size > 0) {
    const scored: { title: string; id: string; text: string; score: number }[] = [];
    for (const { document } of attachments) {
      for (const b of document.blocks) {
        if (b.text.length < 60) continue;
        let score = 0;
        for (const term of focusTerms(b.text)) if (terms.has(term)) score++;
        if (score >= 2) scored.push({ title: document.title, id: b.id, text: b.text, score });
      }
    }
    scored.sort((a, b) => b.score - a.score);
    const perDocument = new Map<string, number>();
    let budget = CORPUS_EXCERPT_BUDGET;
    for (const s of scored) {
      const used = perDocument.get(s.title) ?? 0;
      if (used >= 4 || excerpts.length >= 10) continue;
      const rendered = `[block ${s.id}] (from "${s.title}")\n${s.text.slice(0, 1200)}`;
      if (budget - rendered.length <= 0) break;
      budget -= rendered.length;
      perDocument.set(s.title, used + 1);
      excerpts.push(rendered);
    }
  }

  // Notes from the visible sections; annotations (highlights, comments,
  // explanations) from the hidden Annotations section.
  const notes: string[] = [];
  const annotations: string[] = [];
  let notesBudget = CORPUS_NOTES_BUDGET;
  let annotationsBudget = CORPUS_ANNOTATIONS_BUDGET;
  for (const s of sections) {
    for (const n of s.notes) {
      const sources = n.sources
        .map((src) => `"${src.quotedText.slice(0, 160)}" (${src.document.title})`)
        .join("; ");
      if (s.hidden) {
        const kind =
          n.derivationType === "EXPLAIN"
            ? "explanation"
            : n.derivationType === "SIMPLIFY"
              ? "simplified rewrite"
              : n.derivationType === "SYNTHESIS"
                ? "assistant conversation"
                : n.color
                  ? "highlight"
                  : "comment";
        const rendered = `[note ${n.id}] ${kind}${sources ? ` on ${sources}` : ""}\n${n.content.slice(0, 600)}`;
        if (annotationsBudget - rendered.length <= 0) continue;
        annotationsBudget -= rendered.length;
        annotations.push(rendered);
      } else {
        const rendered = `[note ${n.id}] (section: ${s.title})${sources ? `\nsources: ${sources}` : ""}\n${n.content.slice(0, 800)}`;
        if (notesBudget - rendered.length <= 0) continue;
        notesBudget -= rendered.length;
        notes.push(rendered);
      }
    }
  }

  if (excerpts.length === 0 && notes.length === 0 && annotations.length === 0) return null;

  return [
    "Corpus context — the reader's other materials in this corpus.",
    "When any of these clarifies the question, reference it by name — the document title, [block <id>], or [note <id>] — and draw the connection or analogy explicitly. Prefer the reader's own notes' framing when it exists. Never invent material that is not listed here or in the document above.",
    ...(excerpts.length > 0
      ? ["", "Related passages from other documents in this corpus:", ...excerpts]
      : []),
    ...(notes.length > 0 ? ["", "The reader's notes:", ...notes] : []),
    ...(annotations.length > 0
      ? ["", "The reader's annotations (highlights, comments, explanations):", ...annotations]
      : []),
  ].join("\n\n");
}

// The hidden Annotations section holds EXPLAIN output so it is searchable (SPEC.md §4).
export async function annotationsSection(notebookId: string) {
  const existing = await db.section.findFirst({
    where: { notebookId, hidden: true, title: ANNOTATIONS_SECTION_TITLE },
  });
  if (existing) return existing;
  return db.section.create({
    data: { notebookId, title: ANNOTATIONS_SECTION_TITLE, hidden: true, order: 9999 },
  });
}
