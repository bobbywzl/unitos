import type { ChatTurn } from "@/lib/conversation";
import { profileLines, type ReaderProfileCtx } from "@/lib/prompts/types";

// The target pass (SPEC.md §7, lib/assistant/target.ts): a command over a
// document too long for the windows of one command names the blocks it
// changes first, and the windows run over those blocks alone. The whole
// document is the cached system prefix the windows read too; this is the
// user message. Not in promptTemplates: it is no DerivationType.

export type TargetCtx = {
  profile: ReaderProfileCtx;
  // The reader's message.
  command: string;
  // What the assistant passed on: the change to make.
  instruction: string | null;
  // The scope: the whole document, or runs of blocks.
  scope: { whole: true } | { whole: false; runs: { from: string; to: string }[] };
  history: ChatTurn[];
};

const span = (r: { from: string; to: string }) => (r.from === r.to ? `[block ${r.from}]` : `[block ${r.from}] to [block ${r.to}]`);

export function targetPrompt(ctx: TargetCtx): string {
  return [
    "Name the blocks of the document above that the reader's command changes. You name blocks; you never write their words.",
    "",
    profileLines(ctx.profile),
    "",
    `The reader's command: ${ctx.command}`,
    ...(ctx.instruction ? [`The assistant's instruction: ${ctx.instruction}`] : []),
    ctx.scope.whole ? "Scope: the whole document." : `Scope: ${ctx.scope.runs.map(span).join(", ")}.`,
    ...(ctx.history.length > 0
      ? ["The conversation so far:", ...ctx.history.map((m) => `${m.role === "user" ? "Reader" : "Assistant"}: ${m.content}`)]
      : []),
    "",
    "A second pass reads the blocks named here and makes the change. A block not named here is never changed.",
    "",
    "Rules:",
    "1. Name every block of the scope whose words the command changes, every block it removes, and every block after which it adds words.",
    "2. Name no block the command leaves as it is. When the command says to keep a kind of text (quotes, names, numbers, a part), a block of only that kind is not named; a block that holds it and words the command changes is named.",
    "3. When the command changes every block of the scope (rewrite all of it, shorten everything, translate), name every block.",
    "4. Use block ids exactly as given in the [block <id>] tags, in document order. Consecutive blocks go as one range: \"<first id>..<last id>\".",
    "5. When the command changes no block, return an empty list.",
    "",
    'Return ONLY JSON: {"blocks": ["<block id>", "<first id>..<last id>", …]}',
  ].join("\n");
}
