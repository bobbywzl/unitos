import type { Block } from "@prisma/client";
import type { ModelMessage } from "ai";
import { z } from "zod";
import { planOrder, scopeUnits, type OrderEntry, type OrderPlan, type OrderUnit } from "@/lib/assistant/reorder";
import type { Thinking } from "@/lib/assistant/thinking";
import type { ChatTurn } from "@/lib/conversation";
import { ONE_PASS_MAX_CHARS, SUGGEST_EFFORT, SUGGEST_MAX_NEW_CHARS, SUGGEST_MAX_OUTPUT_TOKENS } from "@/lib/derive/config";
import { documentPrefix, type PageName } from "@/lib/derive/context";
import { callForJson } from "@/lib/derive/json-call";
import { checkOps } from "@/lib/derive/suggest";
import type { ResolvedOp } from "@/lib/docs/assistant-suggestions";
import { groundingOf, ungrounded } from "@/lib/docs/grounding";
import { cleanMarkdown, readOps, resolveOps, type BlockPlace, type ServerSkip, type SuggestOp } from "@/lib/docs/suggest-ops";
import { featureCall } from "@/lib/feature-models";
import type { Lang } from "@/lib/i18n/config";
import type { TFunc, TKey } from "@/lib/i18n/dictionaries";
import { onePassPrompt } from "@/lib/prompts/one-pass";
import type { ReaderProfileCtx } from "@/lib/prompts/types";

// The one pass (SPEC.md §7): a command over a document that fits one call,
// done as a chat with the whole document would do it — one model call reads
// the whole document and answers with it as it should read, by reference
// (lib/prompts/one-pass.ts). A block named by its id alone is never retyped;
// a block with new words, a block taken away, a new block, and a new order
// are each checked (grounding, the check) and become the same ops the
// windows make, and the same moves the order pass makes: the page editor's
// suggestions, or the plan card's block actions. A block the answer leaves
// out and does not remove stays where it was. A document past
// ONE_PASS_MAX_CHARS in its scope goes by the windows.

type Row = Pick<Block, "id" | "type" | "text">;

const WHY_MAX = 240;

/** The scope's rows fit one pass. */
export function fitsOnePass(rows: Row[], scopeRowIds: string[]): boolean {
  const wanted = scopeRowIds.length > 0 ? new Set(scopeRowIds) : null;
  let chars = 0;
  for (const row of rows) if (!wanted || wanted.has(row.id)) chars += row.text.length;
  return chars <= ONE_PASS_MAX_CHARS;
}

/** One entry of the answer's document, as the model writes it. */
type Entry = { id: string; text?: string } | { markdown: string };

const id = z.string().trim().min(1).max(64);
// New blocks first: an object with no id reads as one of them or as nothing.
const entrySchema = z.union([
  id.transform((blockId): Entry => ({ id: blockId })),
  z.object({ new: z.string().min(1).max(20_000) }).transform((e): Entry => ({ markdown: e.new })),
  z.object({ markdown: z.string().min(1).max(20_000) }).transform((e): Entry => ({ markdown: e.markdown })),
  z.object({ id: id.optional(), blockId: id.optional(), text: z.string().max(20_000).optional() }).transform((e): Entry | null => {
    const blockId = e.id ?? e.blockId;
    return blockId ? { id: blockId, ...(e.text !== undefined ? { text: e.text } : {}) } : null;
  }),
]);

/** The model's answer, read leniently: an entry, a removal, or a format op
    that does not read is left out, and the block it named stays as it is. */
export const onePassAnswerSchema = z.object({
  summary: z.string().catch("").transform((s) => s.trim().slice(0, 400)),
  why: z.string().catch("").optional().transform((s) => (s ?? "").trim().slice(0, WHY_MAX)),
  document: z.array(z.unknown()).catch([]).transform((items) =>
    items.flatMap((item) => {
      const parsed = entrySchema.safeParse(item);
      return parsed.success && parsed.data ? [parsed.data] : [];
    }),
  ),
  remove: z.array(z.unknown()).catch([]).optional().transform((ids) => (ids ?? []).filter((v): v is string => typeof v === "string" && v.length > 0)),
  formats: z.array(z.unknown()).catch([]).optional().transform((items) => readOps(items ?? [])),
});
export type OnePassAnswer = z.infer<typeof onePassAnswerSchema>;

export type OnePassRun = {
  userId: string;
  document: { title: string; references: unknown; rows: Row[]; pageName: PageName | null };
  units: OrderUnit[];
  places: Map<string, BlockPlace>;
  // The rows the command covers; empty: the whole document.
  scopeRowIds: string[];
  profile: ReaderProfileCtx;
  lang: Lang;
  t: TFunc;
  command: string;
  instruction: string | null;
  material: string | null;
  history: ChatTurn[];
  caretBlockId: string | null;
  thinking: Thinking;
  // A document without rich text: its ops become the plan card's block actions.
  plan: boolean;
  signal?: AbortSignal;
};

export type OnePassResult = {
  // The ops on words and blocks: new words, blocks taken away, formats.
  ops: ResolvedOp[];
  // The new order with the new blocks in it; null when the answer named no block.
  order: OrderPlan | null;
  scope: number[];
  summary: string;
  why: string;
  warnings: string[];
};

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

/** The scope's runs of consecutive rows, for the prompt. */
function runsOf(rows: Row[], ids: Set<string>): { from: string; to: string }[] {
  const runs: { from: string; to: string }[] = [];
  let open: { from: string; to: string } | null = null;
  for (const row of rows) {
    if (!ids.has(row.id)) open = null;
    else if (open) open.to = row.id;
    else runs.push((open = { from: row.id, to: row.id }));
  }
  return runs;
}

/** The answer as ops and an order (pure: the model's answer in, what lands
    out), each op checked as the windows' are and against the grounding;
    `dropped` names ops the check took out, by their index. */
export function readOnePass(
  answer: OnePassAnswer,
  ctx: {
    rows: Row[];
    units: OrderUnit[];
    places: Map<string, BlockPlace>;
    scope: number[];
    grounding: ReturnType<typeof groundingOf>;
    t: TFunc;
  },
): { ops: ResolvedOp[]; fresh: { i: number; markdown: string }[]; entries: (OrderEntry | { fresh: number })[]; warnings: string[]; why: string } {
  const { rows, units, places, scope, grounding, t } = ctx;
  const why = answer.why || answer.summary || "—";
  const scopeRows = new Set(scope.flatMap((u) => units[u].rowIds));
  const text = new Map(rows.map((r) => [r.id, r.text]));
  // A block's new words: the first the answer gives it.
  const rewrites = new Map<string, string>();
  const entries: (OrderEntry | { fresh: number })[] = [];
  const fresh: { i: number; markdown: string }[] = [];
  const warnings: string[] = [];
  for (const entry of answer.document) {
    if ("markdown" in entry) {
      const markdown = cleanMarkdown(entry.markdown);
      if (!markdown) continue;
      const fact = ungrounded(markdown, grounding);
      if (fact) {
        warnings.push(t(SKIPPED.unsupported, { why: `${fact} — ${why}` }));
        continue;
      }
      entries.push({ fresh: fresh.length });
      fresh.push({ i: -1, markdown });
      continue;
    }
    entries.push({ blockId: entry.id });
    if (entry.text !== undefined && scopeRows.has(entry.id) && !rewrites.has(entry.id) && entry.text.trim() !== (text.get(entry.id) ?? "").trim()) {
      rewrites.set(entry.id, entry.text);
    }
  }
  const named = new Set(answer.document.flatMap((e) => ("id" in e ? [e.id] : [])));
  const suggestOps: SuggestOp[] = [
    ...[...rewrites].map(([blockId, words]): SuggestOp => ({ op: "rewrite_block", blockId, text: words, why })),
    // A block goes only when the answer removes it and leaves it out of its document.
    ...answer.remove.filter((blockId) => scopeRows.has(blockId) && !named.has(blockId)).map((blockId): SuggestOp => ({ op: "remove_blocks", blockIds: [blockId], why })),
    ...answer.formats.ops,
  ];
  const resolved = resolveOps(suggestOps, {
    rows,
    places,
    scope: { kind: "blocks", blockIds: rows.filter((r) => scopeRows.has(r.id)).map((r) => r.id) },
    budget: { chars: SUGGEST_MAX_NEW_CHARS },
    grounding,
  });
  warnings.push(
    ...answer.formats.unreadable.map((w) => t(SKIPPED.unreadable, { why: w })),
    ...resolved.skipped.map((s) => t(SKIPPED[s.reason], { why: s.why })),
  );
  // The new blocks count on after the ops, for the check.
  let next = Math.max(-1, ...resolved.ops.map((op) => op.i)) + 1;
  for (const f of fresh) f.i = next++;
  return { ops: resolved.ops, fresh, entries, warnings, why };
}

/** The order the answer gives, with the new blocks that stand, the blocks
    that go in full left out of it. */
export function orderOf(
  units: OrderUnit[],
  scope: number[],
  read: { ops: ResolvedOp[]; fresh: { i: number; markdown: string }[]; entries: (OrderEntry | { fresh: number })[] },
  dropped: ReadonlySet<number>,
): OrderPlan | null {
  const removedRows = new Set(read.ops.flatMap((op) => (op.op === "remove_blocks" ? op.blockIds : [])));
  const gone = (unit: OrderUnit) => unit.rowIds.every((id) => removedRows.has(id));
  const order: OrderEntry[] = read.entries.flatMap((e) => {
    if (!("fresh" in e)) return [e];
    const f = read.fresh[e.fresh];
    return dropped.has(f.i) ? [] : [{ markdown: f.markdown }];
  });
  const removeHeadings = scope.flatMap((u) => (gone(units[u]) ? [units[u].rowIds[0]] : []));
  return planOrder(units, scope, { order, removeHeadings }, gone);
}

/** The one pass: one model call, its answer read, grounded, and checked. */
export async function runOnePass(run: OnePassRun): Promise<OnePassResult> {
  const { t, units, document } = run;
  const whole = run.scopeRowIds.length === 0;
  const scope = whole ? units.map((_, u) => u) : scopeUnits(units, run.scopeRowIds);
  const scopeRows = new Set(scope.flatMap((u) => units[u].rowIds));
  const prompt = onePassPrompt({
    profile: run.profile,
    lang: run.lang,
    command: run.command,
    instruction: run.instruction,
    material: run.material,
    scope: whole ? { whole: true } : { whole: false, runs: runsOf(document.rows, scopeRows) },
    together: scope.flatMap((u) => (units[u].rowIds.length > 1 && !units[u].fixed ? [{ from: units[u].rowIds[0], to: units[u].rowIds[units[u].rowIds.length - 1] }] : [])),
    fixed: scope.flatMap((u) => (units[u].fixed ? [units[u].rowIds[0]] : [])),
    caretBlockId: run.caretBlockId,
    plan: run.plan,
    history: run.history,
  });
  const prefix: ModelMessage = {
    role: "system",
    content: documentPrefix(document.title, document.rows, document.references, document.pageName),
    providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
  };
  const call = await featureCall("suggest", SUGGEST_EFFORT[run.thinking]);
  const result = await callForJson({
    model: call.model,
    messages: [prefix, { role: "user", content: prompt }],
    maxOutputTokens: SUGGEST_MAX_OUTPUT_TOKENS,
    providerOptions: call.providerOptions,
    schema: onePassAnswerSchema,
    label: run.plan ? "REVISE ONE PASS" : "SUGGEST ONE PASS",
    usage: { userId: run.userId, feature: "suggest", model: call.modelId },
    abortSignal: run.signal,
  });
  if (!result.ok) throw new Error(t("api.suggestFailed", { reason: result.error }));
  const grounding = groundingOf([
    ...document.rows.map((r) => r.text),
    document.title,
    run.command,
    run.instruction ?? "",
    run.material ?? "",
    ...run.history.map((m) => m.content),
  ]);
  const read = readOnePass(result.data, { rows: document.rows, units, places: run.places, scope, grounding, t });
  // The check reads the new blocks as new blocks after the one before them.
  const checked = await checkOps(run, prefix, [
    ...read.ops,
    ...read.fresh.map((f): ResolvedOp => ({ i: f.i, op: "insert_blocks", afterBlockId: null, markdown: f.markdown, why: read.why })),
  ]);
  const dropped = new Set(checked.keys());
  const ops = read.ops.filter((op) => !dropped.has(op.i));
  const order = orderOf(units, scope, { ...read, ops }, dropped);
  return {
    ops,
    order,
    scope,
    summary: result.data.summary,
    why: read.why,
    warnings: [...read.warnings, ...[...checked.values()].map((why) => t("api.suggestSkipChecked", { why }))],
  };
}
