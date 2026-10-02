import type { Block } from "@prisma/client";
import type { ModelMessage } from "ai";
import type { Thinking } from "@/lib/assistant/thinking";
import type { ChatTurn } from "@/lib/conversation";
import { SUGGEST_CHECK_MAX_OUTPUT_TOKENS, SUGGEST_EFFORT, SUGGEST_MAX_OUTPUT_TOKENS } from "@/lib/derive/config";
import { documentPrefix, pageNames, type PageName } from "@/lib/derive/context";
import { callForJson } from "@/lib/derive/json-call";
import type { ResolvedOp, SuggestResult } from "@/lib/docs/assistant-suggestions";
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
import { groundingOf } from "@/lib/docs/grounding";
import type { Lang } from "@/lib/i18n/config";
import type { TFunc, TKey } from "@/lib/i18n/dictionaries";
import { suggestPrompt } from "@/lib/prompts/suggest";
import { suggestCheckPrompt, type CheckedOp } from "@/lib/prompts/suggest-check";
import { z } from "zod";
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
  object: "api.suggestSkipFigure",
  limit: "api.suggestSkipLimit",
  unreadable: "api.suggestSkipUnreadable",
  tex: "api.suggestSkipTex",
  unsupported: "api.suggestSkipUnsupported",
};

/** A document with rich text as the suggestions read it: its paragraph index
    (the Block rows, for the prefix and the offsets), and its rich text. */
export type SuggestDocument = {
  title: string;
  references: unknown;
  /** An import's rows name their pages in the prefix. */
  pageName: PageName | null;
  rows: Pick<Block, "id" | "type" | "text">[];
  places: Map<string, BlockPlace>;
  /** Null for a document without rich text: its edits go to the plan card
      (lib/assistant/revise.ts), and it holds no suggestions. */
  richText: RichNode | null;
};

export function suggestDocument(document: {
  title: string;
  references: unknown;
  importRev: number | null;
  pageLabels: unknown;
  richText: unknown;
  blocks: Pick<Block, "id" | "type" | "text">[];
}): SuggestDocument {
  const richText = document.richText as RichNode;
  return {
    title: document.title,
    references: document.references,
    pageName: pageNames(document),
    rows: document.blocks,
    places: blockPlaces(richText),
    richText,
  };
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
  // Where the ops land (lib/prompts/suggest.ts); absent = the page editor.
  target?: "plan";
  // The order pass of the same command moves the blocks (lib/assistant/reorder.ts).
  reorder?: boolean;
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

/** What an op changes, for the check: the ops on words and blocks; a
    format, a style, or a table's row or column is not checked. */
function checkedOp(op: ResolvedOp, text: (id: string) => string): CheckedOp | null {
  switch (op.op) {
    case "replace_words":
      return { i: op.i, kind: "replace words", blockIds: [op.blockId], before: op.find, after: op.text, why: op.why };
    case "rewrite_block":
      return { i: op.i, kind: "rewrite", blockIds: [op.blockId], before: op.base, after: op.text, why: op.why };
    case "replace_blocks":
      return { i: op.i, kind: "replace blocks", blockIds: op.blockIds, before: op.base.join("\n"), after: op.markdown, why: op.why };
    case "remove_blocks":
      return { i: op.i, kind: "remove blocks", blockIds: op.blockIds, before: op.base.join("\n"), after: "", why: op.why };
    case "insert_blocks":
      return { i: op.i, kind: "new blocks after", blockIds: op.afterBlockId ? [op.afterBlockId] : [], before: "", after: op.markdown, why: op.why };
    case "insert_footnote":
      return { i: op.i, kind: "new footnote", blockIds: [op.blockId], before: "", after: op.text, why: op.why };
    case "insert_row":
    case "insert_column":
      return { i: op.i, kind: `new table ${op.op === "insert_row" ? "row" : "column"}`, blockIds: [op.blockId], before: "", after: op.cells.join(" | "), why: op.why };
    case "remove_row":
    case "remove_column":
      return { i: op.i, kind: `remove table ${op.op === "remove_row" ? "row" : "column"}`, blockIds: [op.blockId], before: text(op.blockId), after: "", why: op.why };
    default:
      return null;
  }
}

const checkAnswerSchema = z.object({
  drop: z.array(z.object({ i: z.number().int(), why: z.string().catch("") }).passthrough()).catch([]),
});

/** The check (lib/prompts/suggest-check.ts): a second model reads the ops
    against the command under the same cached document and names those that
    change what the command did not ask, drop what it said to keep, or state
    what the document does not. The ops it names, with its why. A check that
    fails keeps every op: the reader still accepts or rejects each one. */
export async function checkOps(
  run: Pick<SuggestRun, "userId" | "lang" | "command" | "instruction" | "signal"> & { document: { rows: Pick<Block, "id" | "text">[] } },
  prefix: ModelMessage,
  ops: ResolvedOp[],
): Promise<Map<number, string>> {
  const rows = new Map(run.document.rows.map((r) => [r.id, r.text]));
  const listed = ops.flatMap((op) => checkedOp(op, (id) => rows.get(id) ?? "") ?? []);
  if (listed.length === 0) return new Map();
  try {
    const call = await featureCall("suggest", SUGGEST_EFFORT.fast);
    const result = await callForJson({
      model: call.model,
      messages: [prefix, { role: "user", content: suggestCheckPrompt({ lang: run.lang, command: run.command, instruction: run.instruction, ops: listed }) }],
      maxOutputTokens: SUGGEST_CHECK_MAX_OUTPUT_TOKENS,
      providerOptions: call.providerOptions,
      schema: checkAnswerSchema,
      label: "SUGGEST CHECK",
      usage: { userId: run.userId, feature: "suggest", model: call.modelId },
      abortSignal: run.signal,
    });
    if (!result.ok) return new Map();
    const known = new Set(listed.map((op) => op.i));
    return new Map(result.data.drop.filter((d) => known.has(d.i)).map((d) => [d.i, d.why.trim() || (ops.find((op) => op.i === d.i)?.why ?? "")]));
  } catch {
    return new Map();
  }
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
    pending: document.richText ? assistantSuggestionsIn(document.richText, run.userId, new Set(blockIds)) : [],
    history: run.history,
    target: run.target ?? "page",
    reorder: run.reorder,
  });
  // The document is the cached system prefix: every window and every command
  // on the same document reads it from the cache.
  const messages: ModelMessage[] = [
    {
      role: "system",
      content: documentPrefix(document.title, document.rows, document.references, document.pageName),
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
    label: `${run.target === "plan" ? "REVISE" : "SUGGEST"}${run.window && run.window.of > 1 ? ` ${run.window.n}/${run.window.of}` : ""}`,
    usage: { userId: run.userId, feature: "suggest", model: call.modelId },
    abortSignal: run.signal,
  });
  if (!result.ok) throw new Error(run.t("api.suggestFailed", { reason: result.error }));
  // An op that did not read is skipped with its why; ops past the cap say
  // the command covered too much for one run.
  const read = result.data.ops;
  // A number or a quotation in new words must stand in what the model read:
  // the document, the command, the instruction, the answer, the conversation.
  const grounding = groundingOf([
    ...document.rows.map((r) => r.text),
    document.title,
    run.command,
    run.instruction ?? "",
    run.material ?? "",
    ...run.history.map((m) => m.content),
  ]);
  const resolved = resolveOps(read.ops, { rows: document.rows, places: document.places, scope, budget: run.budget, grounding });
  const { skipped } = resolved;
  const checked = await checkOps(run, messages[0], resolved.ops);
  const ops = resolved.ops.filter((op) => !checked.has(op.i));
  return {
    ops,
    warnings: [
      ...read.unreadable.map((why) => run.t(SKIPPED.unreadable, { why })),
      ...skipped.map((s) => run.t(SKIPPED[s.reason], { why: s.why })),
      ...[...checked.values()].map((why) => run.t("api.suggestSkipChecked", { why })),
      ...(read.over > 0 ? [run.t("api.suggestTooLong")] : []),
    ],
    summary: result.data.summary,
  };
}
