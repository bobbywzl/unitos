import type { ChatTurn } from "@/lib/conversation";
import type { Lang } from "@/lib/i18n/config";
import { OP_LINES, PLAN_OP_LINES } from "@/lib/prompts/suggest";
import { languageName, profileLines, type ReaderProfileCtx } from "@/lib/prompts/types";

// The format ops a command may need beside its words and its order: the
// windows' own ops (lib/prompts/suggest.ts), the ones that change no words.
const FORMAT_OPS = /^- (format_words|set_style|set_alignment|set_spacing|set_indent|insert_row|remove_row|move_row|insert_column|remove_column|move_column|insert_footnote) /;

// The one pass (SPEC.md §7, lib/assistant/one-pass.ts): the reader's command
// over a document that fits one call, done the way a chat with the whole
// document would do it, with the answer written by reference: every block of
// the scope by its id in the new order, the words of each block that
// changes, the new blocks where they go, and the blocks that go. A block the
// answer names by its id alone is never retyped, so nothing the command did
// not touch can drift. The whole document is the cached system prefix; this
// is the user message. Not in promptTemplates: it is no DerivationType.

export type OnePassCtx = {
  profile: ReaderProfileCtx;
  lang: Lang;
  // The reader's message.
  command: string;
  // What the assistant passed on: the change to make.
  instruction: string | null;
  // The assistant's answer, which the command may ask to use.
  material: string | null;
  scope: { whole: true } | { whole: false; runs: { from: string; to: string }[] };
  // Blocks that move as one (a list, a table): the first and the last of each.
  together: { from: string; to: string }[];
  // Blocks that keep their place and their words: a page, a figure, the footnotes.
  fixed: string[];
  // The caret's block: "here".
  caretBlockId: string | null;
  // A document without rich text: its new blocks are plain words in a few kinds.
  plan: boolean;
  history: ChatTurn[];
};

const span = (r: { from: string; to: string }) => (r.from === r.to ? `[block ${r.from}]` : `[block ${r.from}] to [block ${r.to}]`);

export function onePassPrompt(ctx: OnePassCtx): string {
  return [
    "Do the reader's command on the document above. Answer with the document as it should read after the command, written by reference: each block by its id, the new words of only the blocks that change.",
    "",
    profileLines(ctx.profile),
    "",
    `The reader's command: ${ctx.command}`,
    ...(ctx.instruction ? [`The assistant's instruction: ${ctx.instruction}`] : []),
    ...(ctx.material ? ["The assistant's answer, which the command may ask you to use:", ctx.material] : []),
    ctx.scope.whole ? "Scope: the whole document." : `Scope: ${ctx.scope.runs.map(span).join(", ")}.`,
    "Change only blocks in the scope. The rest of the document is context.",
    ...(ctx.together.length > 0 ? [`These blocks move as one (a table, a list line with the lines nested under it): ${ctx.together.map(span).join(", ")}.`] : []),
    ...(ctx.fixed.length > 0 ? [`These blocks keep their place and their words: ${ctx.fixed.map((id) => `[block ${id}]`).join(", ")}.`] : []),
    ...(ctx.caretBlockId ? [`The caret stands in [block ${ctx.caretBlockId}]. "Here" means right after it.`] : []),
    ...(ctx.history.length > 0
      ? ["The conversation so far:", ...ctx.history.map((m) => `${m.role === "user" ? "Reader" : "Assistant"}: ${m.content}`)]
      : []),
    "",
    "The answer:",
    '- document: every block id of the scope, once each, in order: the new order when the command asks for one (group, organize, put in order), else the order as it stands. A block that stays as it is: its id alone, "<id>". A block whose words change: {"id": "<id>", "text": "<the block\'s whole new words>"}. New blocks: {"new": "<markdown>"} where they go.',
    "- remove: the ids of the blocks the command asks to take away. Leave them out of document.",
    "- formats: the changes that are no words of a block's own, as ops (each an object whose \"op\" is its name, with the fields its line names), each with its why; an empty list when the command asks none:",
    ...(ctx.plan ? PLAN_OP_LINES : OP_LINES).filter((line) => FORMAT_OPS.test(line)).map((line) => `  ${line}`),
    "",
    "Rules:",
    "1. Do what the command asks and nothing else. A block the command does not ask to change stays as its id alone. Never retype a block to keep it.",
    "2. Remove a block only when the command asks for it: erase, delete, cut, remove, or keep only something else. When the command says to keep a kind of text (quotes, names, numbers, a part), every block and every word of that kind stays as it is.",
    "3. Keep the author's voice, terms, names, numbers, dates, citations, and links unless the command asks to change them. A quotation stays word for word. A change of register, tone, or wording changes the words that carry it and keeps every other word of the sentence as printed; a sentence with none of them stays word for word. A plain-words rewrite keeps a sentence that is already short and plain word for word.",
    "4. Keep every claim the document makes unless the command asks to cut it. New words may explain, connect, or restate; a new number, name, date, or finding appears only when the command asks for it or the material states it.",
    "5. text: one paragraph, plain words, no blank line. A LIST block's text is its lines, each with its marker (- or 1.) and two spaces more per level of nesting. To split a block, change it and add new blocks after it.",
    ctx.plan
      ? "6. new: markdown with # to ### headings, - bulleted lines, 1. numbered lines; plain words otherwise."
      : "6. new: markdown with # to ###### headings, - bulleted lines, 1. numbered lines, - [ ] checklist lines, **bold**, *italic*, [text](url).",
    '7. A group the command asks for gets a heading: {"new": "## <what the group has in common>"} before its blocks, a level below the heading of the scope. A heading of the document that the new order makes wrong goes in remove.',
    "8. Keep together what belongs together: a quote and the words that comment on it, a sentence and the list it introduces, steps in their order.",
    `9. Keep the document's language in text and new. Write summary and why in ${languageName(ctx.lang)}. summary: one or two sentences on what changes. why: one sentence on why.`,
    "10. When the command asks no change, return document as the blocks stand, remove empty, and say so in summary.",
    "",
    "JSON strings escape a backslash: write \\\\ for every \\ (TeX \\frac is \"\\\\frac\", \\text is \"\\\\text\").",
    'Return ONLY JSON: {"summary": "…", "why": "…", "document": ["<id>", {"id": "<id>", "text": "…"}, {"new": "…"}, …], "remove": ["<id>"], "formats": [ … ]}',
  ].join("\n");
}
