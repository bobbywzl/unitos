import type { ModelMessage } from "ai";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { COLLAPSE_EFFORT, COLLAPSE_MAX_OUTPUT_TOKENS, COLLAPSE_WINDOW_CHARS } from "@/lib/derive/config";
import { documentPrefix } from "@/lib/derive/context";
import { callForJson } from "@/lib/derive/json-call";
import { featureCall, featureConfigured } from "@/lib/feature-models";
import { blockHash } from "@/lib/graph/skeleton";
import { collapsePrompt, type CollapseBlockCtx } from "@/lib/prompts/collapse";
import type { UsageMeta } from "@/lib/usage";

// Collapse (SPEC.md §28): every block of the article to its core — what the
// block really says, in plain words, at a tenth to a third of its length,
// written in the light of the whole document. The reader presses Collapse
// and reads the cores in place of the blocks; a click on a collapsed block
// reads it whole. Stored on Document.collapse as one core per block, each
// with the hash of the block text it was written from: a block whose text
// changed shows as it is until the next Collapse writes its core again, and
// a re-parse's new block with the same text keeps its core by the hash.
// Built one call per window of COLLAPSE_WINDOW_CHARS of block text, the
// windows at once, each under the cached prefix of the whole document.

export const COLLAPSE_VERSION = 1;
const CORE_MAX = 2000;
// A table's or a sheet's text past this is data, not prose: it shows as it is.
const TABLE_MAX_CHARS = 5_000;

export type Core = { blockId: string; hash: string; text: string };
export type Collapse = { v: number; cores: Core[] };

/** The document as Collapse reads it: the block rows the route loads. */
export type CollapseBlock = { id: string; type: string; text: string; startTime?: number | null; endTime?: number | null };

const windowSchema = z.object({
  cores: z.array(z.object({ blockId: z.string().min(1), text: z.string().trim().min(1).max(CORE_MAX) })).max(2000),
});

// The blocks that collapse: text, a figure with a caption, a table, an
// equation, a list, code, a transcript line, a slide, a sheet. Never a
// heading (short already), a separator, a page marker, or the video block.
const NEVER = new Set(["HEADING", "SEPARATOR", "PAGE", "VIDEO"]);

/** True when the block gets a core. */
export function collapsible(block: CollapseBlock): boolean {
  if (NEVER.has(block.type) || block.text.trim() === "") return false;
  if ((block.type === "TABLE" || block.type === "SHEET" || block.type === "SLIDE") && block.text.length > TABLE_MAX_CHARS) return false;
  return true;
}

/** The stored collapse, or null when there is none or it is of an older version. */
export function readCollapse(value: unknown): Collapse | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (row.v !== COLLAPSE_VERSION || !Array.isArray(row.cores)) return null;
  const cores: Core[] = [];
  for (const raw of row.cores) {
    if (!raw || typeof raw !== "object") continue;
    const c = raw as Record<string, unknown>;
    if (typeof c.blockId === "string" && typeof c.hash === "string" && typeof c.text === "string") {
      cores.push({ blockId: c.blockId, hash: c.hash, text: c.text });
    }
  }
  return { v: COLLAPSE_VERSION, cores };
}

/** The words of a text: Latin words, and CJK characters at two per word. */
export function wordCount(text: string): number {
  const cjk = text.match(/[぀-ヿ㐀-鿿豈-﫿]/g)?.length ?? 0;
  const latin = text.replace(/[぀-ヿ㐀-鿿豈-﫿]/g, " ").split(/\s+/).filter(Boolean).length;
  return latin + Math.ceil(cjk / 2);
}

/** The ceiling for a block's core: a third of the block, between 8 and 60
    words; a short block keeps up to seven tenths of its words, so a
    sentence stays one shorter sentence. */
export function coreCeiling(words: number): number {
  if (words <= 24) return Math.max(5, Math.ceil(words * 0.7));
  return Math.min(60, Math.max(8, Math.ceil(words / 3)));
}

// A core past its ceiling is cut at the last sentence end under it, else at
// the ceiling with an ellipsis: a core is never longer than the block.
function fitCore(text: string, ceiling: number): string {
  const core = text.replace(/\s+/g, " ").trim();
  if (wordCount(core) <= ceiling) return core;
  const words = core.split(" ");
  let cut = "";
  for (let i = 0; i < words.length; i++) {
    const next = cut ? `${cut} ${words[i]}` : words[i];
    if (wordCount(next) > ceiling) break;
    cut = next;
  }
  const sentence = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("。"), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  if (sentence > cut.length / 2) return cut.slice(0, sentence + 1).trim();
  return `${cut.replace(/[\s,;:—–-]+$/, "")}…`;
}

/** The cores the reader shows now: one per collapsible block whose stored
    core was written from the block's current text — by the block's id, else
    by the hash alone (a re-parse's new block with the same text) — and the
    blocks with no current core, which the next Collapse writes. */
export function currentCores(
  collapse: Collapse | null,
  blocks: CollapseBlock[],
): { cores: Record<string, string>; missing: CollapseBlock[] } {
  const wanted = blocks.filter(collapsible);
  const byId = new Map(collapse?.cores.map((c) => [c.blockId, c]) ?? []);
  const byHash = new Map<string, Core>();
  for (const c of collapse?.cores ?? []) if (!byHash.has(c.hash)) byHash.set(c.hash, c);
  const cores: Record<string, string> = {};
  const missing: CollapseBlock[] = [];
  for (const block of wanted) {
    const hash = blockHash(block.text);
    const stored = byId.get(block.id);
    const core = stored && stored.hash === hash ? stored : byHash.get(hash);
    if (core) cores[block.id] = core.text;
    else missing.push(block);
  }
  return { cores, missing };
}

/** Build the cores the document lacks: one call per window of the missing
    blocks, the windows at once, each under the cached prefix of the whole
    document; the cores the document already has stand. Returns every
    current core. Throws with the reason on a failed model call. */
export async function buildCollapse(
  documentId: string,
  userId: string | null,
  signal?: AbortSignal,
): Promise<Record<string, string>> {
  const document = await db.document.findUnique({
    where: { id: documentId },
    select: {
      title: true,
      collapse: true,
      references: true,
      blocks: {
        orderBy: { order: "asc" },
        select: { id: true, type: true, text: true, startTime: true, endTime: true },
      },
    },
  });
  if (!document) return {};
  const stored = readCollapse(document.collapse);
  const { cores, missing } = currentCores(stored, document.blocks);
  if (missing.length === 0) return cores;
  if (!(await featureConfigured("collapse"))) throw new Error("No model is configured for Collapse");

  // Windows: the missing blocks in order, cut at a block boundary past the
  // window's chars.
  const windows: CollapseBlock[][] = [];
  let current: CollapseBlock[] = [];
  let used = 0;
  for (const block of missing) {
    if (current.length > 0 && used + block.text.length > COLLAPSE_WINDOW_CHARS) {
      windows.push(current);
      current = [];
      used = 0;
    }
    current.push(block);
    used += block.text.length;
  }
  if (current.length > 0) windows.push(current);

  const prefix = documentPrefix(document.title, document.blocks, document.references);
  const collapseCall = await featureCall("collapse", COLLAPSE_EFFORT);
  const usage = { userId, feature: "collapse", model: collapseCall.modelId } satisfies UsageMeta;
  const ceilingOf = new Map(missing.map((b) => [b.id, coreCeiling(wordCount(b.text))]));
  const results = await Promise.all(
    windows.map(async (blocks, i) => {
      const listed: CollapseBlockCtx[] = blocks.map((b) => ({
        blockId: b.id,
        type: b.type,
        words: wordCount(b.text),
        maxWords: ceilingOf.get(b.id) ?? 8,
      }));
      const messages: ModelMessage[] = [
        { role: "system", content: prefix },
        { role: "user", content: collapsePrompt({ blocks: listed, window: i + 1, windows: windows.length }) },
      ];
      const result = await callForJson({
        model: collapseCall.model,
        messages,
        maxOutputTokens: COLLAPSE_MAX_OUTPUT_TOKENS,
        providerOptions: collapseCall.providerOptions,
        schema: windowSchema,
        label: windows.length > 1 ? `COLLAPSE ${i + 1}/${windows.length}` : "COLLAPSE",
        usage,
        abortSignal: signal,
      });
      if (!result.ok) throw new Error(result.error);
      return result.data;
    }),
  );

  // Every core against the blocks it was asked for: the model's core where
  // it named a missing block, fitted under the block's ceiling; a block the
  // model skipped stays without one and shows as it is.
  const missingById = new Map(missing.map((b) => [b.id, b]));
  const written = new Map<string, Core>();
  for (const r of results) {
    for (const c of r.cores) {
      const block = missingById.get(c.blockId);
      if (!block || written.has(c.blockId)) continue;
      const text = fitCore(c.text, ceilingOf.get(c.blockId) ?? 8);
      if (text) written.set(c.blockId, { blockId: c.blockId, hash: blockHash(block.text), text });
    }
  }
  // The stored cores that still stand — by id and hash, or by hash alone —
  // plus the new ones; the rest is dropped, so the row never grows past
  // the document.
  const hashes = new Set(document.blocks.map((b) => blockHash(b.text)));
  const kept = (stored?.cores ?? []).filter((c) => hashes.has(c.hash) && !written.has(c.blockId));
  const next: Collapse = { v: COLLAPSE_VERSION, cores: [...kept, ...written.values()] };
  await db.document.update({
    where: { id: documentId },
    data: { collapse: next as unknown as Prisma.InputJsonValue },
  });
  for (const core of written.values()) cores[core.blockId] = core.text;
  return cores;
}
