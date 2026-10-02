import type { ChatTurn } from "@/lib/conversation";
import type { Lang } from "@/lib/i18n/config";
import { languageName, profileLines, type ReaderProfileCtx } from "@/lib/prompts/types";

// The order pass (SPEC.md §7, lib/assistant/reorder.ts): the reader's command
// that moves blocks across the document — group by theme, put in order,
// organize — answered as the new order of the scope's blocks and the new
// headings between them. The whole document is the cached system prefix;
// this is the user message. The words change in the windows of the same
// command (lib/prompts/suggest.ts), never here. Not in promptTemplates: it is
// no DerivationType.

export type ReorderCtx = {
  profile: ReaderProfileCtx;
  lang: Lang;
  // The reader's message.
  command: string;
  // What the assistant passed on: the change to make.
  instruction: string | null;
  // The assistant's answer, which the command may ask to use.
  material: string | null;
  // The scope: the whole document, or runs of blocks.
  scope: { whole: true } | { whole: false; runs: { from: string; to: string }[] };
  // Blocks that move as one (a list, a table): the first and the last of each.
  together: { from: string; to: string }[];
  // Blocks that keep their place: a page, a figure, the footnotes.
  fixed: string[];
  history: ChatTurn[];
};

const span = (r: { from: string; to: string }) => (r.from === r.to ? `[block ${r.from}]` : `[block ${r.from}] to [block ${r.to}]`);

export function reorderPrompt(ctx: ReorderCtx): string {
  return [
    "Put the blocks of the document above in the order the reader's command asks for. You order blocks; you never write their words.",
    "",
    profileLines(ctx.profile),
    "",
    `The reader's command: ${ctx.command}`,
    ...(ctx.instruction ? [`The assistant's instruction: ${ctx.instruction}`] : []),
    ...(ctx.material ? ["The assistant's answer, which the command may ask you to use:", ctx.material] : []),
    ctx.scope.whole ? "Scope: the whole document." : `Scope: ${ctx.scope.runs.map(span).join(", ")}.`,
    "Order only blocks in the scope. The rest of the document is context and keeps its place.",
    ...(ctx.together.length > 0 ? [`These blocks move as one (a list, a table): ${ctx.together.map(span).join(", ")}. Name the first block of each.`] : []),
    ...(ctx.fixed.length > 0 ? [`These blocks keep their place: ${ctx.fixed.map((id) => `[block ${id}]`).join(", ")}. Leave them out of the order.`] : []),
    ...(ctx.history.length > 0
      ? ["The conversation so far:", ...ctx.history.map((m) => `${m.role === "user" ? "Reader" : "Assistant"}: ${m.content}`)]
      : []),
    "",
    "Rules:",
    "1. order: every block id of the scope, once each, in the new order. Use block ids exactly as given in the [block <id>] tags.",
    '2. A new heading goes in order as {"heading": "<words>", "level": 1, 2, or 3}, right before the blocks it names. Add headings when the command asks for groups, themes, or sections, one per group; a heading names what its group has in common in a few words. A group under a heading of the scope takes the level below that heading. Add no heading the command does not call for.',
    "3. A heading of the document that the new order makes wrong (it no longer names what follows it): put its id in removeHeadings and leave it out of order. Only a heading goes this way. Every other block stays in order.",
    "4. Keep together what belongs together: a quote and the words that comment on it, a sentence and the list it introduces, a figure's lead-in and what follows it, steps in their order. Move a block only when the command calls for it.",
    "5. Another pass changes the words the command asks to change: shorten, rewrite, remove, or erase. Do not plan for it: order the blocks as they are, and never leave a block out because the command will erase or shorten it.",
    "6. When the command asks for no new order, return order as the blocks stand and no headings.",
    `7. Write new headings in the document's language. Write summary and why in ${languageName(ctx.lang)}.`,
    "8. summary: one or two sentences on the new order, naming the groups. why: one sentence on why the blocks move.",
    "",
    'Return ONLY JSON: {"summary": "…", "why": "…", "order": ["<block id>", {"heading": "…", "level": 2}, "<block id>", …], "removeHeadings": ["<block id>"]}',
  ].join("\n");
}
