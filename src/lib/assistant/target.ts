import type { Block } from "@prisma/client";
import type { ModelMessage } from "ai";
import { z } from "zod";
import type { ChatTurn } from "@/lib/conversation";
import { SUGGEST_EFFORT, SUGGEST_MAX_OUTPUT_TOKENS } from "@/lib/derive/config";
import { documentPrefix, type PageName } from "@/lib/derive/context";
import { callForJson } from "@/lib/derive/json-call";
import { featureCall } from "@/lib/feature-models";
import { targetPrompt } from "@/lib/prompts/target";
import type { ReaderProfileCtx } from "@/lib/prompts/types";

// The target pass (SPEC.md §7): a command whose scope runs past the windows
// one command takes (SUGGEST_MAX_WINDOWS) names the blocks it changes first,
// in one call over the whole document under the windows' cached prefix, and
// the windows run over those blocks alone. "Erase the commentary next to the
// quotes" in a long document then reaches every commentary block, not the
// first windows' worth. A pass that fails, or names nothing in the scope,
// leaves the scope as it was.

type Row = Pick<Block, "id" | "type" | "text"> & Partial<Pick<Block, "page">> & { cell?: unknown };

const targetSchema = z.object({
  blocks: z.array(z.unknown()).catch([]).transform((items) => items.filter((x): x is string => typeof x === "string" && x.trim().length > 0)),
});

/** The model's names as row ids of the scope, in document order: an id, or a
    range "<first>..<last>" of the scope's rows between the two (either
    order). Ids outside the scope are passed over. */
export function targetRows(names: string[], scope: string[]): string[] {
  const at = new Map(scope.map((id, i) => [id, i]));
  const picked = new Set<number>();
  for (const name of names) {
    const [from, to] = name.split("..").map((s) => s.trim().replace(/^\[block\s+|\]$/g, ""));
    const a = at.get(from);
    if (a === undefined) continue;
    const b = to === undefined ? a : at.get(to);
    if (b === undefined) {
      picked.add(a);
      continue;
    }
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) picked.add(i);
  }
  return [...picked].sort((x, y) => x - y).map((i) => scope[i]);
}

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

/** The rows of the scope the command changes, or null: the pass failed or
    named nothing, and the scope stays as it was. */
export async function runTargetPass(run: {
  userId: string;
  document: { title: string; references: unknown; rows: Row[]; pageName: PageName | null };
  scope: string[];
  whole: boolean;
  profile: ReaderProfileCtx;
  command: string;
  instruction: string | null;
  history: ChatTurn[];
  signal?: AbortSignal;
}): Promise<string[] | null> {
  const { document } = run;
  const messages: ModelMessage[] = [
    {
      role: "system",
      content: documentPrefix(document.title, document.rows, document.references, document.pageName),
      providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
    },
    {
      role: "user",
      content: targetPrompt({
        profile: run.profile,
        command: run.command,
        instruction: run.instruction,
        scope: run.whole ? { whole: true } : { whole: false, runs: runsOf(document.rows, new Set(run.scope)) },
        history: run.history,
      }),
    },
  ];
  // A reading, not a rewrite: low effort, whatever the reader's thinking.
  const call = await featureCall("suggest", SUGGEST_EFFORT.fast);
  const result = await callForJson({
    model: call.model,
    messages,
    maxOutputTokens: SUGGEST_MAX_OUTPUT_TOKENS,
    providerOptions: call.providerOptions,
    schema: targetSchema,
    label: "TARGET",
    usage: { userId: run.userId, feature: "suggest", model: call.modelId },
    abortSignal: run.signal,
  });
  if (!result.ok) {
    console.warn("[target] pass failed, keeping the scope:", result.error);
    return null;
  }
  const rows = targetRows(result.data.blocks, run.scope);
  return rows.length > 0 ? rows : null;
}
