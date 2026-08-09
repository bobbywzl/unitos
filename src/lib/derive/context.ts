import type { Block } from "@prisma/client";
import { db } from "@/lib/db";
import { ANNOTATIONS_SECTION_TITLE } from "@/lib/derive/config";
import { USER_ID } from "@/lib/constants";
import type { PromptCtx, ReaderProfileCtx } from "@/lib/prompts/types";

// The document rendered as the cached prompt prefix (SPEC.md §2). Byte-identical across
// every derivation on the same document, so all types reuse one cache entry.
// Block ids are included so EXTRACT and SALIENCE can reference them.
export function documentPrefix(title: string, blocks: Pick<Block, "id" | "type" | "text">[]): string {
  const rendered = blocks
    .map((b) => `[block ${b.id}] (${b.type})\n${b.text}`)
    .join("\n\n");
  return [
    "You assist a reader dissecting a document. The full document follows.",
    "Each block starts with its id in the form [block <id>]. Reference block ids exactly as given when asked for them.",
    "",
    `Document title: ${title}`,
    "",
    rendered,
  ].join("\n");
}

export async function loadProfile(notebookId: string): Promise<ReaderProfileCtx> {
  const notebook = await db.notebook.findUnique({ where: { id: notebookId } });
  const override = notebook?.profile as ReaderProfileCtx | null;
  if (override && override.background) return override;
  const profile = await db.readerProfile.findUnique({ where: { userId: USER_ID } });
  if (!profile) return null;
  return {
    background: profile.background,
    purpose: profile.purpose,
    application: profile.application,
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
