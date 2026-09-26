import type { ModelMessage } from "ai";
import { z } from "zod";
import { bumpDocument } from "@/lib/collab";
import { db } from "@/lib/db";
import { CONTENTS_EFFORT, CONTENTS_MAX_OUTPUT_TOKENS } from "@/lib/derive/config";
import { featureCall, featureConfigured } from "@/lib/feature-models";
import { documentPrefix } from "@/lib/derive/context";
import { callForJson } from "@/lib/derive/json-call";
import { contentsPrompt } from "@/lib/prompts/contents";
import type { UsageMeta } from "@/lib/usage";

// The contents of a document (SPEC.md §26): the parts a reader jumps
// between, each with the block it starts at. Built when the reader first
// opens Contents, never at ingest: one model call over the whole document,
// for a list many documents are never asked for. Stored on
// Document.contents as [{title, blockId, level}], in reading order. A
// re-parse replaces the blocks, so it clears the contents; the next open
// builds them again. When the model call fails, the document's headings
// stand in (headingContents): every HEADING block is a part, and nothing is
// stored, so the next open tries the model again.

const TITLE_MAX = 200;
const MAX_PARTS = 80;
const MIN_BLOCKS = 6; // under this a document has no parts

export type ContentsEntry = { title: string; blockId: string; level: 1 | 2 };

const contentsSchema = z.object({
  parts: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(TITLE_MAX),
        blockId: z.string().min(1),
        level: z.number().int().min(1).max(2).default(1),
      }),
    )
    .max(MAX_PARTS * 2),
});

type ContentsBlock = { id: string; type: string; text: string; order: number };

/** The stored contents as entries. A row without a title or block is skipped. */
export function contentsEntries(value: unknown): ContentsEntry[] {
  if (!Array.isArray(value)) return [];
  const entries: ContentsEntry[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    if (typeof row.title !== "string" || typeof row.blockId !== "string") continue;
    entries.push({ title: row.title, blockId: row.blockId, level: row.level === 2 ? 2 : 1 });
  }
  return entries;
}

// The blocks a part can start at: content, never the title block, a page
// marker, or the video block.
function startable(block: ContentsBlock, first: ContentsBlock | undefined): boolean {
  if (block.type === "PAGE" || block.type === "VIDEO") return false;
  if (first && block.id === first.id && block.type === "HEADING") return false;
  return block.text.trim().length > 0;
}

/** The model's parts against the stored blocks: an id that names no block
    drops, a part that starts before the previous one drops (reading order
    is the rule), and two parts at one block are one. A level 2 part with
    no level 1 part before it is level 1. */
function resolveParts(
  parts: { title: string; blockId: string; level: number }[],
  blocks: ContentsBlock[],
): ContentsEntry[] {
  const orderOf = new Map(blocks.map((b) => [b.id, b.order]));
  const first = blocks[0];
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const out: ContentsEntry[] = [];
  let last = -1;
  let hasTop = false;
  for (const part of parts) {
    const block = byId.get(part.blockId);
    const order = orderOf.get(part.blockId);
    if (!block || order === undefined || order <= last || !startable(block, first)) continue;
    const level: 1 | 2 = part.level === 2 && hasTop ? 2 : 1;
    if (level === 1) hasTop = true;
    out.push({ title: part.title.trim(), blockId: part.blockId, level });
    last = order;
    if (out.length >= MAX_PARTS) break;
  }
  return out;
}

/** The document's headings as its contents: what stands in when the model
    call fails, and the contents of a document with no model. Level from
    the heading's level in the html (h1, h2 → 1; deeper → 2). Nothing when
    the document has no headings past its title. */
export function headingContents(
  blocks: (ContentsBlock & { html: string | null })[],
): ContentsEntry[] {
  const first = blocks[0];
  const out: ContentsEntry[] = [];
  let hasTop = false;
  for (const block of blocks) {
    if (block.type !== "HEADING" || !startable(block, first)) continue;
    const depth = Number(/<h([1-6])/i.exec(block.html ?? "")?.[1] ?? 2);
    const level: 1 | 2 = depth >= 3 && hasTop ? 2 : 1;
    if (level === 1) hasTop = true;
    out.push({ title: block.text.trim().slice(0, TITLE_MAX), blockId: block.id, level });
    if (out.length >= MAX_PARTS) break;
  }
  return out;
}

/** Build the contents: one model call over the whole document, stored on
    the document. Returns the entries; [] when the document is too short to
    have parts. Throws with the reason on a failed model call. */
export async function buildContents(documentId: string, userId: string | null): Promise<ContentsEntry[]> {
  if (!(await featureConfigured("contents"))) return [];
  const document = await db.document.findUnique({
    where: { id: documentId },
    include: {
      blocks: {
        orderBy: { order: "asc" },
        select: { id: true, type: true, text: true, order: true, startTime: true, endTime: true, cell: true },
      },
    },
  });
  if (!document) return [];
  const readable = document.blocks.filter((b) => b.type !== "PAGE" && b.text.trim().length > 0);
  if (readable.length < MIN_BLOCKS) return [];

  const messages: ModelMessage[] = [
    { role: "system", content: documentPrefix(document.title, document.blocks, document.references) },
    { role: "user", content: contentsPrompt({ blockCount: readable.length, maxParts: MAX_PARTS }) },
  ];
  const contentsCall = await featureCall("contents", CONTENTS_EFFORT);
  const result = await callForJson({
    model: contentsCall.model,
    messages,
    maxOutputTokens: CONTENTS_MAX_OUTPUT_TOKENS,
    providerOptions: contentsCall.providerOptions,
    schema: contentsSchema,
    label: "CONTENTS",
    usage: { userId, feature: "contents", model: contentsCall.modelId } satisfies UsageMeta,
  });
  if (!result.ok) throw new Error(result.error);

  const entries = resolveParts(result.data.parts, document.blocks);
  await db.document.update({ where: { id: documentId }, data: { contents: entries } });
  await bumpDocument(documentId);
  return entries;
}

/** A block's text as the carry compares it: one space between words, no case. */
function carryKey(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/** The stored contents carried onto a re-parse's new blocks (SPEC.md §26):
    the blocks are new, so the parts' block ids are stale, but the parts
    themselves are the reader's, written once and asked for. Each part finds
    the new block whose text is its old block's — the whole text, else its
    first 60 characters — in reading order past the part before it; a part
    whose text is gone drops, and a level 2 part left without a level 1 part
    before it is level 1. When fewer than half of the parts carry, the
    document changed too much for the list to stand: nothing carries, and
    the next Generate contents writes them anew. */
export function carryContents(
  contents: unknown,
  oldBlocks: { id: string; text: string }[],
  newBlocks: { id: string; text: string }[],
): ContentsEntry[] {
  const stored = contentsEntries(contents);
  if (stored.length === 0) return [];
  const oldText = new Map(oldBlocks.map((b) => [b.id, carryKey(b.text)]));
  const keys = newBlocks.map((b) => carryKey(b.text));
  const out: ContentsEntry[] = [];
  let from = 0;
  let hasTop = false;
  for (const part of stored) {
    const text = oldText.get(part.blockId);
    if (!text) continue;
    let index = keys.findIndex((key, i) => i >= from && key === text);
    if (index === -1) {
      const head = text.slice(0, 60);
      index = keys.findIndex((key, i) => i >= from && key.startsWith(head));
    }
    if (index === -1) continue;
    const level: 1 | 2 = part.level === 2 && hasTop ? 2 : 1;
    if (level === 1) hasTop = true;
    out.push({ title: part.title, blockId: newBlocks[index].id, level });
    from = index + 1;
  }
  return out.length * 2 >= stored.length ? out : [];
}
