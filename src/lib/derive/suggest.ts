import type { Block } from "@prisma/client";
import type { ModelMessage } from "ai";
import type { Thinking } from "@/lib/assistant/thinking";
import type { ChatTurn } from "@/lib/conversation";
import { SUGGEST_EFFORT, SUGGEST_MAX_OUTPUT_TOKENS } from "@/lib/derive/config";
import { documentPrefix } from "@/lib/derive/context";
import { callForJson } from "@/lib/derive/json-call";
import type { SuggestResult } from "@/lib/docs/assistant-suggestions";
import type { RichNode } from "@/lib/docs/schema";
import {
  assistantSuggestionsIn,
  blockPlaces,
  resolveOps,
  suggestAnswerSchema,
  type BlockPlace,
  type IndexRow,
  type ServerSkip,
  type SuggestScope,
} from "@/lib/docs/suggest-ops";
import { featureCall } from "@/lib/feature-models";
import type { Lang } from "@/lib/i18n/config";
import type { TFunc, TKey } from "@/lib/i18n/dictionaries";
import { suggestPrompt } from "@/lib/prompts/suggest";
import type { ReaderProfileCtx } from "@/lib/prompts/types";

// The assistant's suggestions (SPEC.md §29), the one code path: the command
// and its scope → lib/prompts/suggest.ts under the cached document prefix →
// the feature `suggest` → ops validated (suggestAnswerSchema) and resolved
// against the paragraph index (lib/docs/suggest-ops.ts). The page editor
// lands them as suggestions authored by the assistant. The selection chat
// (/api/assistant/act) runs it once; the document's suggest route once per
// window.

const SKIPPED: Record<ServerSkip, TKey> = {
  outside: "api.suggestSkipOutside",
  notFound: "api.suggestSkipNotFound",
  ambiguous: "api.suggestSkipAmbiguous",
  overlap: "api.suggestSkipOverlap",
  notText: "api.suggestSkipNotText",
  limit: "api.suggestSkipLimit",
};

/** A document with rich text as the suggestions read it: its paragraph index
    (the Block rows, for the prefix and the offsets), and its rich text. */
export type SuggestDocument = {
  title: string;
  references: unknown;
  rows: Pick<Block, "id" | "type" | "text">[];
  places: Map<string, BlockPlace>;
  richText: RichNode;
};

export function suggestDocument(document: {
  title: string;
  references: unknown;
  richText: unknown;
  blocks: Pick<Block, "id" | "type" | "text">[];
}): SuggestDocument {
  const richText = document.richText as RichNode;
  return { title: document.title, references: document.references, rows: document.blocks, places: blockPlaces(richText), richText };
}

export type SuggestRun = {
  userId: string;
  document: SuggestDocument;
  profile: ReaderProfileCtx;
  lang: Lang;
  t: TFunc;
  command: string;
  instruction: string | null;
  material: string | null;
  history: ChatTurn[];
  scope: SuggestScope;
  // A command over blocks: this window's place (1 of n) and whether the command covers the whole document.
  window: { n: number; of: number; whole: boolean } | null;
  caretBlockId: string | null;
  thinking: Thinking;
  // The new text the command has left (SUGGEST_MAX_NEW_CHARS), shared by its windows.
  budget: { chars: number };
  signal?: AbortSignal;
};

/** The scope's blocks as runs of consecutive rows. */
function runsOf(rows: IndexRow[], blockIds: string[]): { from: string; to: string }[] {
  const wanted = new Set(blockIds);
  const runs: { from: string; to: string }[] = [];
  let open: { from: string; to: string } | null = null;
  for (const row of rows) {
    if (!wanted.has(row.id)) open = null;
    else if (open) open.to = row.id;
    else runs.push((open = { from: row.id, to: row.id }));
  }
  return runs;
}

/** One model call: the ops for the scope, resolved, with a reason for each
    op skipped. Throws with the reason when the call fails. */
export async function runSuggest(run: SuggestRun): Promise<SuggestResult> {
  const { document, scope } = run;
  const rowById = new Map(document.rows.map((r) => [r.id, r]));
  const blockIds = scope.kind === "words" ? scope.segments.map((s) => s.blockId) : scope.blockIds;
  const prompt = suggestPrompt({
    profile: run.profile,
    lang: run.lang,
    command: run.command,
    instruction: run.instruction,
    material: run.material,
    scope:
      scope.kind === "words"
        ? { kind: "words", words: scope.segments.map((s) => ({ blockId: s.blockId, text: (rowById.get(s.blockId)?.text ?? "").slice(s.start, s.end) })) }
        : { kind: "blocks", runs: runsOf(document.rows, scope.blockIds), window: run.window?.n ?? 1, windows: run.window?.of ?? 1, whole: run.window?.whole ?? false },
    styles: blockIds.flatMap((blockId) => {
      const place = document.places.get(blockId);
      const code = rowById.get(blockId)?.type === "CODE";
      return place && (place.style || code) ? [{ blockId, style: place.style ?? "code", where: place.where }] : [];
    }),
    caretBlockId: run.caretBlockId,
    pending: assistantSuggestionsIn(document.richText, run.userId, new Set(blockIds)),
    history: run.history,
  });
  // The document is the cached system prefix: every window and every command
  // on the same document reads it from the cache.
  const messages: ModelMessage[] = [
    {
      role: "system",
      content: documentPrefix(document.title, document.rows, document.references),
      providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
    },
    { role: "user", content: prompt },
  ];
  const call = await featureCall("suggest", SUGGEST_EFFORT[run.thinking]);
  const result = await callForJson({
    model: call.model,
    messages,
    maxOutputTokens: SUGGEST_MAX_OUTPUT_TOKENS,
    providerOptions: call.providerOptions,
    schema: suggestAnswerSchema,
    label: run.window && run.window.of > 1 ? `SUGGEST ${run.window.n}/${run.window.of}` : "SUGGEST",
    usage: { userId: run.userId, feature: "suggest", model: call.modelId },
    abortSignal: run.signal,
  });
  if (!result.ok) throw new Error(run.t("api.suggestFailed", { reason: result.error }));
  const { ops, skipped } = resolveOps(result.data.ops, { rows: document.rows, places: document.places, scope, budget: run.budget });
  return {
    ops,
    warnings: skipped.map((s) => run.t(SKIPPED[s.reason], { why: s.why })),
    summary: result.data.summary.trim(),
  };
}
