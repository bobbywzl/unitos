import { createHash } from "node:crypto";
import type { ModelMessage } from "ai";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { buildContents, contentsEntries, headingContents, type ContentsEntry } from "@/lib/contents";
import {
  SKELETON_EFFORT,
  SKELETON_MAX_OUTPUT_TOKENS,
  SKELETON_STALE_FRACTION,
  SKELETON_STALE_MS,
  SKELETON_WINDOW_CHARS,
} from "@/lib/derive/config";
import { documentPrefix } from "@/lib/derive/context";
import { callForJson } from "@/lib/derive/json-call";
import { featureCall, featureConfigured } from "@/lib/feature-models";
import { skeletonPrompt } from "@/lib/prompts/skeleton";
import type { UsageMeta } from "@/lib/usage";

// The skeleton of a document (SPEC.md §22): the document collapsed for
// Stitch — a gist, one summary per part of the contents, and one line per
// block that keeps every claim and number and drops the wording, at about a
// tenth of the length. Stitch reads skeletons where it read whole documents
// before, picks blocks by alias from the lines, and then reads the real
// text of the picked blocks only, so every quote and link still resolves
// against the stored block (SPEC.md §1). Stored on Document.skeleton,
// keyed by the hash of every block's text: a block whose text changed
// reads as its own first words until the skeleton is rebuilt, and a
// document more than a tenth changed is rebuilt — in the background after
// an edit or an add (refreshSkeleton), and at once when Stitch needs it
// (ensureSkeleton). Built one call per window of SKELETON_WINDOW_CHARS,
// the windows at once, each under its own cached prefix.

export const SKELETON_VERSION = 1;
const LINE_MAX = 400;
const SUMMARY_MAX = 800;
const GIST_MAX = 400;
const FALLBACK_LINE = 200; // chars of a block's own text that stand in for a missing line

export type SkeletonLine = { blockId: string; hash: string; text: string };
export type SkeletonPart = { blockId: string; title: string; summary: string };
export type Skeleton = {
  v: number;
  gist: string;
  parts: SkeletonPart[];
  lines: SkeletonLine[];
  chars: number; // the readable text's length when built
};

/** The document as the skeleton reads it: the block rows Stitch loads. */
export type SkeletonBlock = { id: string; type: string; text: string; startTime?: number | null; endTime?: number | null };

const windowSchema = z.object({
  gist: z.string().max(GIST_MAX).default(""),
  parts: z.array(z.object({ blockId: z.string().min(1), summary: z.string().trim().min(1).max(SUMMARY_MAX) })).max(200),
  lines: z.array(z.object({ blockId: z.string().min(1), text: z.string().trim().min(1).max(LINE_MAX) })).max(4000),
});

/** The hash of a block's text: what tells a stored line its block changed. */
export function blockHash(text: string): string {
  return createHash("md5").update(text).digest("hex").slice(0, 12);
}

/** The blocks a skeleton has a line for: text, never a page marker or the
    video block (the same rule as Stitch's readable blocks). */
export function skeletonBlocks<T extends SkeletonBlock>(blocks: T[]): T[] {
  return blocks.filter((b) => b.type !== "VIDEO" && b.type !== "PAGE" && b.text.trim().length > 0);
}

/** The stored skeleton, or null when there is none or it is of an older
    version. */
export function readSkeleton(value: unknown): Skeleton | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (row.v !== SKELETON_VERSION || !Array.isArray(row.lines) || !Array.isArray(row.parts)) return null;
  const lines: SkeletonLine[] = [];
  for (const raw of row.lines) {
    if (!raw || typeof raw !== "object") continue;
    const l = raw as Record<string, unknown>;
    if (typeof l.blockId === "string" && typeof l.hash === "string" && typeof l.text === "string") {
      lines.push({ blockId: l.blockId, hash: l.hash, text: l.text });
    }
  }
  const parts: SkeletonPart[] = [];
  for (const raw of row.parts) {
    if (!raw || typeof raw !== "object") continue;
    const p = raw as Record<string, unknown>;
    if (typeof p.blockId === "string" && typeof p.title === "string" && typeof p.summary === "string") {
      parts.push({ blockId: p.blockId, title: p.title, summary: p.summary });
    }
  }
  return {
    v: SKELETON_VERSION,
    gist: typeof row.gist === "string" ? row.gist : "",
    parts,
    lines,
    chars: typeof row.chars === "number" ? row.chars : 0,
  };
}

/** How much of the document changed since the skeleton was built: the
    characters of blocks that are new or whose text changed, plus the
    characters the removed blocks' lines stood for, over the characters the
    document has now. 1 with no skeleton. */
export function skeletonDrift(skeleton: Skeleton | null, blocks: SkeletonBlock[]): number {
  const readable = skeletonBlocks(blocks);
  const total = readable.reduce((sum, b) => sum + b.text.length, 0);
  if (!skeleton) return 1;
  if (total === 0) return skeleton.lines.length > 0 ? 1 : 0;
  const stored = new Map(skeleton.lines.map((l) => [l.blockId, l]));
  let changed = 0;
  const seen = new Set<string>();
  for (const b of readable) {
    seen.add(b.id);
    const line = stored.get(b.id);
    if (!line || line.hash !== blockHash(b.text)) changed += b.text.length;
  }
  // A removed block's line stood for text of about the skeleton's share
  // of the block; count it at a line's worth, since the text is gone.
  for (const line of skeleton.lines) if (!seen.has(line.blockId)) changed += line.text.length * 10;
  return Math.min(1, changed / total);
}

/** A stored skeleton is stale when more than SKELETON_STALE_FRACTION of
    the document changed since it was built. */
export function skeletonStale(skeleton: Skeleton | null, blocks: SkeletonBlock[]): boolean {
  return skeletonDrift(skeleton, blocks) > SKELETON_STALE_FRACTION;
}

// A block's own first words, cut at a sentence end when one falls in the
// first FALLBACK_LINE characters, else at a word: the line for a block the
// skeleton has no current line for.
function fallbackLine(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= FALLBACK_LINE) return t;
  const head = t.slice(0, FALLBACK_LINE);
  const sentence = Math.max(head.lastIndexOf(". "), head.lastIndexOf("。"), head.lastIndexOf("! "), head.lastIndexOf("? "));
  if (sentence > FALLBACK_LINE / 2) return head.slice(0, sentence + 1);
  const word = head.lastIndexOf(" ");
  return word > FALLBACK_LINE / 2 ? head.slice(0, word) : head;
}

/** The skeleton as Stitch reads it now: one line per current readable
    block, in the document's order — the stored line where the block is
    unchanged, the block's own first words where it is new or changed or
    the skeleton is missing — and the parts whose block still exists. */
export function currentSkeleton(skeleton: Skeleton | null, blocks: SkeletonBlock[]): Skeleton {
  const readable = skeletonBlocks(blocks);
  const stored = new Map(skeleton?.lines.map((l) => [l.blockId, l]) ?? []);
  const lines: SkeletonLine[] = readable.map((b) => {
    const hash = blockHash(b.text);
    const line = stored.get(b.id);
    return line && line.hash === hash ? line : { blockId: b.id, hash, text: fallbackLine(b.text) };
  });
  const ids = new Set(readable.map((b) => b.id));
  return {
    v: SKELETON_VERSION,
    gist: skeleton?.gist ?? "",
    parts: (skeleton?.parts ?? []).filter((p) => ids.has(p.blockId)),
    lines,
    chars: readable.reduce((sum, b) => sum + b.text.length, 0),
  };
}

// The document's parts for the skeleton's summaries: the stored contents,
// else built now, else the headings; none for a document too short to have
// parts (the whole document is then one part).
async function partsFor(
  documentId: string,
  userId: string | null,
  contents: unknown,
  blocks: (SkeletonBlock & { order: number; html: string | null })[],
): Promise<ContentsEntry[]> {
  const stored = contentsEntries(contents);
  if (stored.length > 0) return stored;
  try {
    const built = await buildContents(documentId, userId);
    if (built.length > 0) return built;
  } catch (err) {
    console.warn("[skeleton] contents failed, using headings:", err);
  }
  return headingContents(blocks);
}

/** Build the skeleton now: one call per window, the windows at once, and
    store it. Returns the skeleton, or null when the document has nothing
    to read or no model is configured. Throws on a failed model call. */
export async function buildSkeleton(
  documentId: string,
  userId: string | null,
  signal?: AbortSignal,
): Promise<Skeleton | null> {
  if (!(await featureConfigured("skeleton"))) return null;
  const document = await db.document.findUnique({
    where: { id: documentId },
    select: {
      title: true,
      contents: true,
      references: true,
      blocks: {
        orderBy: { order: "asc" },
        select: { id: true, type: true, text: true, order: true, html: true, startTime: true, endTime: true, cell: true },
      },
    },
  });
  if (!document) return null;
  const readable = skeletonBlocks(document.blocks);
  if (readable.length === 0) return null;
  const parts = await partsFor(documentId, userId, document.contents, document.blocks);
  const partAt = new Map(parts.map((p) => [p.blockId, p]));

  // Windows: readable blocks in order, cut at a block boundary past the
  // window's chars.
  const windows: (typeof readable)[] = [];
  let current: typeof readable = [];
  let used = 0;
  for (const block of readable) {
    if (current.length > 0 && used + block.text.length > SKELETON_WINDOW_CHARS) {
      windows.push(current);
      current = [];
      used = 0;
    }
    current.push(block);
    used += block.text.length;
  }
  if (current.length > 0) windows.push(current);

  const skeletonCall = await featureCall("skeleton", SKELETON_EFFORT);
  const model = skeletonCall.model;
  const usage = { userId, feature: "skeleton", model: skeletonCall.modelId } satisfies UsageMeta;
  const results = await Promise.all(
    windows.map(async (blocks, i) => {
      const windowParts = blocks.filter((b) => partAt.has(b.id)).map((b) => partAt.get(b.id)!);
      const messages: ModelMessage[] = [
        { role: "system", content: documentPrefix(document.title, blocks, i === 0 ? document.references : undefined) },
        {
          role: "user",
          content: skeletonPrompt({
            parts: windowParts.map((p) => ({ blockId: p.blockId, title: p.title })),
            window: i + 1,
            windows: windows.length,
            blockCount: blocks.length,
          }),
        },
      ];
      const result = await callForJson({
        model,
        messages,
        maxOutputTokens: SKELETON_MAX_OUTPUT_TOKENS,
        providerOptions: skeletonCall.providerOptions,
        schema: windowSchema,
        label: windows.length > 1 ? `SKELETON ${i + 1}/${windows.length}` : "SKELETON",
        usage,
        abortSignal: signal,
      });
      if (!result.ok) throw new Error(result.error);
      return result.data;
    }),
  );

  // Every line against the stored blocks: the model's line where it named
  // the block, the block's own first words where it did not.
  const lineFor = new Map<string, string>();
  const summaryFor = new Map<string, string>();
  let gist = "";
  for (const r of results) {
    for (const l of r.lines) if (!lineFor.has(l.blockId)) lineFor.set(l.blockId, l.text);
    for (const p of r.parts) if (partAt.has(p.blockId) && !summaryFor.has(p.blockId)) summaryFor.set(p.blockId, p.summary);
    if (!gist && r.gist.trim()) gist = r.gist.trim();
  }
  const skeleton: Skeleton = {
    v: SKELETON_VERSION,
    gist,
    parts: parts.map((p) => ({ blockId: p.blockId, title: p.title, summary: summaryFor.get(p.blockId) ?? "" })),
    lines: readable.map((b) => ({ blockId: b.id, hash: blockHash(b.text), text: lineFor.get(b.id) ?? fallbackLine(b.text) })),
    chars: readable.reduce((sum, b) => sum + b.text.length, 0),
  };
  await db.document.update({
    where: { id: documentId },
    data: { skeleton: skeleton as unknown as Prisma.InputJsonValue, skeletonStartedAt: null },
  });
  return skeleton;
}

/** The skeleton Stitch reads for a document it has loaded: the stored one
    when under a tenth of the document changed, with the changed blocks as
    their own first words; built now when stale or missing. A failed build
    answers the current lines — every block as its own first words — so a
    command still runs. */
export async function ensureSkeleton(
  document: { id: string; skeleton: unknown; blocks: SkeletonBlock[] },
  userId: string | null,
  signal?: AbortSignal,
): Promise<Skeleton> {
  const stored = readSkeleton(document.skeleton);
  if (!skeletonStale(stored, document.blocks)) return currentSkeleton(stored, document.blocks);
  try {
    const built = await buildSkeleton(document.id, userId, signal);
    if (built) return currentSkeleton(built, document.blocks);
  } catch (err) {
    if (signal?.aborted) throw err;
    console.warn(`[skeleton] build of ${document.id} failed, reading first words:`, err);
  }
  return currentSkeleton(stored, document.blocks);
}

/** The background refresh, after an add or an edit: builds the skeleton
    when the document has none or more than a tenth of it changed, and
    leaves it alone otherwise. One build at a time per document: a build
    started under SKELETON_STALE_MS ago is running, and this one yields. */
export async function refreshSkeleton(documentId: string, userId: string | null): Promise<void> {
  if (!(await featureConfigured("skeleton"))) return;
  const document = await db.document.findUnique({
    where: { id: documentId },
    select: {
      skeleton: true,
      skeletonStartedAt: true,
      blocks: { orderBy: { order: "asc" }, select: { id: true, type: true, text: true } },
    },
  });
  if (!document) return;
  if (!skeletonStale(readSkeleton(document.skeleton), document.blocks)) return;
  if (document.skeletonStartedAt && Date.now() - document.skeletonStartedAt.getTime() < SKELETON_STALE_MS) return;
  await db.document.update({ where: { id: documentId }, data: { skeletonStartedAt: new Date() } });
  try {
    await buildSkeleton(documentId, userId);
  } catch (err) {
    console.error(`[skeleton] refresh of ${documentId} failed:`, err);
    await db.document.update({ where: { id: documentId }, data: { skeletonStartedAt: null } }).catch(() => {});
  }
}
