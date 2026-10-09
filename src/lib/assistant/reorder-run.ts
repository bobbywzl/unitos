import type { Block } from "@prisma/client";
import type { ModelMessage } from "ai";
import { moveRuns, orderAnswerSchema, planOrder, scopeUnits, type OrderPlan, type OrderUnit, type SequenceItem } from "@/lib/assistant/reorder";
import type { Thinking } from "@/lib/assistant/thinking";
import { blockTakes, type DocumentShape } from "@/lib/block-takes";
import type { ChatTurn } from "@/lib/conversation";
import { SUGGEST_EFFORT, SUGGEST_MAX_OUTPUT_TOKENS } from "@/lib/derive/config";
import { documentPrefix, type PageName } from "@/lib/derive/context";
import { callForJson } from "@/lib/derive/json-call";
import { isAssistantSuggestion, type ResolvedOp } from "@/lib/docs/assistant-suggestions";
import { withoutSuggestions } from "@/lib/docs/blocks";
import { INDEXED_NODE_TYPES, type RichNode } from "@/lib/docs/schema";
import { featureCall } from "@/lib/feature-models";
import type { Lang } from "@/lib/i18n/config";
import type { TFunc } from "@/lib/i18n/dictionaries";
import { reorderPrompt } from "@/lib/prompts/reorder";
import type { ReaderProfileCtx } from "@/lib/prompts/types";
import type { AssistantAction } from "@/lib/types";
import type { BlockKind } from "@/lib/block-kind";

// The order pass on the server (SPEC.md §7, lib/assistant/reorder.ts): one
// model call over the whole document, under the same cached document prefix
// as the windows of the command, so it runs beside them. Its order becomes
// the plan card's moves in a document without rich text, and the page
// editor's move suggestions in a document with rich text.

type Row = Pick<Block, "id" | "type" | "text">;

/** A document without rich text: each block is a unit. A block that never
    moves (a page, a slide, a transcript line) keeps its place. */
export function blockUnits(blocks: Row[], shape: DocumentShape): OrderUnit[] {
  return blocks.map((b) => ({ rowIds: [b.id], fixed: !blockTakes.move(b.type, shape), heading: b.type === "HEADING" }));
}

// What keeps a top-level node of a rich text in its place: a figure or an
// image (its media is one object), the footnotes and their numbers (they
// count in the text's order), a bookmark (a link points at it), a page break.
const STAYS = new Set(["figure", "image", "footnotes", "footnoteReference", "bookmark", "pageBreak", "tableOfContents"]);

/** A document with rich text: each top-level node is a unit (a list or a
    table moves whole), its index rows in order, read the way the paragraph
    index reads it: the assistant's suggestions as not made, and a block a
    person's suggestion removes left out. A node with no row is no unit. */
export function richTextUnits(doc: RichNode, rows: Row[]): OrderUnit[] {
  const indexed = new Set(rows.map((r) => r.id));
  const [readable] = withoutSuggestions([doc], isAssistantSuggestion);
  const units: OrderUnit[] = [];
  for (const top of readable?.content ?? []) {
    const rowIds: string[] = [];
    let stays = STAYS.has(top.type);
    const walk = (node: RichNode) => {
      if (node.marks?.some((m) => m.type === "deletion")) return;
      if (STAYS.has(node.type)) stays = true;
      if (INDEXED_NODE_TYPES.has(node.type)) {
        const id = node.attrs?.blockId;
        if (typeof id === "string" && indexed.has(id)) rowIds.push(id);
      }
      for (const child of node.content ?? []) walk(child);
    };
    walk(top);
    if (rowIds.length > 0) units.push({ rowIds, fixed: stays, heading: top.type === "heading" && rowIds.length === 1 });
  }
  return units;
}

export type OrderRun = {
  userId: string;
  document: { title: string; references: unknown; rows: Row[]; pageName: PageName | null };
  units: OrderUnit[];
  // The rows the command covers; empty: the whole document.
  scopeRowIds: string[];
  profile: ReaderProfileCtx;
  lang: Lang;
  t: TFunc;
  command: string;
  instruction: string | null;
  material: string | null;
  history: ChatTurn[];
  thinking: Exclude<Thinking, "auto">;
  signal?: AbortSignal;
};

export type OrderResult = { plan: OrderPlan | null; scope: number[]; summary: string; why: string; warnings: string[] };

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

/** One model call: the scope's new order, or null with the reason. Throws
    with the reason when the call fails. */
export async function runOrderPass(run: OrderRun): Promise<OrderResult> {
  const { t, units, document } = run;
  const whole = run.scopeRowIds.length === 0;
  const scope = whole ? units.map((_, u) => u) : scopeUnits(units, run.scopeRowIds);
  const movable = scope.filter((u) => !units[u].fixed);
  if (movable.length < 2) return { plan: null, scope, summary: "", why: "", warnings: [t("api.reorderNothing")] };
  const scopeRows = new Set(scope.flatMap((u) => units[u].rowIds));
  const prompt = reorderPrompt({
    profile: run.profile,
    lang: run.lang,
    command: run.command,
    instruction: run.instruction,
    material: run.material,
    scope: whole ? { whole: true } : { whole: false, runs: runsOf(document.rows, scopeRows) },
    together: scope.flatMap((u) => (units[u].rowIds.length > 1 && !units[u].fixed ? [{ from: units[u].rowIds[0], to: units[u].rowIds[units[u].rowIds.length - 1] }] : [])),
    fixed: scope.flatMap((u) => (units[u].fixed ? [units[u].rowIds[0]] : [])),
    history: run.history,
  });
  // The document is the cached system prefix the windows read too.
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
    schema: orderAnswerSchema,
    label: "REORDER",
    usage: { userId: run.userId, feature: "suggest", model: call.modelId },
    abortSignal: run.signal,
  });
  if (!result.ok) throw new Error(t("api.reorderFailed", { reason: result.error }));
  const plan = planOrder(units, scope, result.data);
  const warnings: string[] = [];
  if (!plan) warnings.push(result.data.summary || t("api.reorderNothing"));
  else if (plan.missing > 0) warnings.push(t("api.reorderMissing", { count: plan.missing }));
  return { plan, scope, summary: result.data.summary, why: result.data.why || result.data.summary, warnings };
}

/** The unit just before the scope's first unit, or null at the document's start. */
const unitBefore = (scope: number[]): number | null => (scope.length > 0 && scope[0] > 0 ? scope[0] - 1 : null);

const KINDS = { 1: "h1", 2: "h2", 3: "h3" } as const;

/** The order as the plan card's block actions, for a document without rich
    text (each unit one block): the moves of each run, each block after the
    block before it in the run; then each new heading after the block before
    it (new headings after one block follow each other); then the headings
    that go. The plan card runs them in this order, and Undo takes them back
    newest first. */
export function orderBlockActions(
  units: OrderUnit[],
  scope: number[],
  plan: OrderPlan,
  why: string,
  // New blocks written as markdown, as the blocks of a document without rich text (revise.ts markdownBlocks).
  newBlocks: (markdown: string) => { kind: BlockKind; text: string }[] = () => [],
): AssistantAction[] {
  const id = (u: number) => units[u].rowIds[0];
  const moves: AssistantAction[] = [];
  const headings: AssistantAction[] = [];
  for (const run of moveRuns(plan.sequence, unitBefore(scope))) {
    let after: string | null = run.after === null ? null : id(run.after);
    for (const item of run.items) {
      if ("unit" in item) {
        moves.push({ type: "move_block", blockId: id(item.unit), afterBlockId: after, description: why });
        after = id(item.unit);
      } else if ("heading" in item) {
        headings.push({ type: "insert_paragraph", afterBlockId: after, text: item.heading, kind: KINDS[item.level], description: why });
      } else {
        for (const block of newBlocks(item.markdown)) {
          headings.push({ type: "insert_paragraph", afterBlockId: after, text: block.text, ...(block.kind === "paragraph" ? {} : { kind: block.kind }), description: why });
        }
      }
    }
  }
  const removals: AssistantAction[] = plan.removed.map((u) => ({ type: "remove_block", blockId: id(u), description: why }));
  return [...moves, ...headings, ...removals];
}

/** The order as the page editor's ops, for a document with rich text: one
    move_blocks op per run (its units and new headings, right after the unit
    before it, which stays), then a remove_blocks op per heading that goes.
    `i` counts on from `first`. */
export function orderSuggestOps(units: OrderUnit[], scope: number[], plan: OrderPlan, rows: Row[], why: string, first = 0): ResolvedOp[] {
  const text = new Map(rows.map((r) => [r.id, r.text]));
  const base = (u: number) => units[u].rowIds.map((id) => text.get(id) ?? "");
  const item = (entry: SequenceItem) =>
    "unit" in entry
      ? { blockIds: units[entry.unit].rowIds, base: base(entry.unit) }
      : "heading" in entry
        ? { markdown: `${"#".repeat(entry.level)} ${entry.heading}` }
        : { markdown: entry.markdown };
  let i = first;
  const ops: ResolvedOp[] = moveRuns(plan.sequence, unitBefore(scope)).map((run) => ({
    i: i++,
    op: "move_blocks",
    afterBlockId: run.after === null ? null : units[run.after].rowIds[0],
    items: run.items.map(item),
    why,
  }));
  for (const u of plan.removed) ops.push({ i: i++, op: "remove_blocks", blockIds: units[u].rowIds, base: base(u), why });
  return ops;
}
