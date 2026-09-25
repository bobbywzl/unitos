import type { ChatTurn } from "@/lib/conversation";
import { SUGGEST_MAX_OPS } from "@/lib/derive/config";
import type { Lang } from "@/lib/i18n/config";
import { languageName, profileLines, type ReaderProfileCtx } from "@/lib/prompts/types";

// SUGGEST: the assistant's suggestions (SPEC.md §29, lib/derive/suggest.ts).
// The reader's command becomes ops keyed to the paragraph index of a rich
// text; the page editor lands each op as a suggestion the reader accepts or
// rejects. The document is the cached system prefix; this is the user
// message. Not in promptTemplates: it is no DerivationType, and its routes
// are the selection chat's and the document's.

/** The seven commands on selected words, by the chip's name. */
export const SUGGEST_COMMANDS = {
  rephrase: "Rephrase the selected words: the same meaning in other words.",
  shorten: "Shorten the selected words: keep every point, cut the words that carry none.",
  elaborate: "Elaborate on the selected words: explain and connect what the document supports.",
  formal: "Make the selected words more formal: the same points in a formal register.",
  casual: "Make the selected words more casual: the same points in plain, everyday words.",
  bulleted: "Turn the selected words into a bulleted list, one point per line.",
  fix: "Fix the spelling and grammar of the selected words. Change nothing else.",
} as const;
export type SuggestCommand = keyof typeof SUGGEST_COMMANDS;

export type SuggestCtx = {
  profile: ReaderProfileCtx;
  lang: Lang;
  // The reader's command: their message, or a chip's fixed command.
  command: string;
  // What the chat or the panel passed on when it decided the command asks for a change.
  instruction: string | null;
  // The panel's answer, which the command may ask to use.
  material: string | null;
  scope:
    | { kind: "words"; words: { blockId: string; text: string }[] }
    | { kind: "blocks"; runs: { from: string; to: string }[]; window: number; windows: number; whole: boolean };
  // The scope's text blocks: each one's paragraph style ("code" for code), and a table cell or a footnote.
  styles: { blockId: string; style: string; where: "body" | "cell" | "footnote" }[];
  caretBlockId: string | null;
  // The asker's pending suggestions in the scope, one line each (lib/docs/suggest-ops.ts).
  pending: string[];
  history: ChatTurn[];
};

const OP_LINES = [
  '- replace_words {blockId, find, text, why}: change words inside one block. find: the block\'s words exactly as written, long enough to occur once in it. text: the words that take their place; "" deletes them.',
  "- rewrite_block {blockId, text, why}: one block's words written anew, whole, plain, one paragraph with no blank line. Use it when most of a block changes. The block keeps its style.",
  "- replace_blocks {blockIds, markdown, why}: consecutive blocks replaced by new blocks. Use it to turn a paragraph into a list, split one, join two, or reorder them.",
  "- insert_blocks {afterBlockId, markdown, why}: new blocks after a block; afterBlockId null puts them at the document's start.",
  "- remove_blocks {blockIds, why}: consecutive blocks deleted whole.",
  "- set_style {blockId, style, why}: normal, title, subtitle, h1 to h6, bulleted, numbered, checklist.",
  "- format_words {blockId, find, format, why}: bold, italic, underline, or strikethrough on exact words.",
  "markdown: # to ###### headings, - bulleted lines, 1. numbered lines, - [ ] checklist lines, **bold**, *italic*, [text](url). No images, no tables.",
];

function scopeLines(scope: SuggestCtx["scope"]): string[] {
  if (scope.kind === "words") {
    return [
      "Scope: the selected words.",
      ...scope.words.map((w) => `[block ${w.blockId}] "${w.text.length > 2000 ? `${w.text.slice(0, 2000)}…` : w.text}"`),
      "Change only the selected words. rewrite_block, replace_blocks, and remove_blocks only on blocks whose words are all selected. The rest of the document is context.",
    ];
  }
  const runs = scope.runs.map((r) => (r.from === r.to ? `[block ${r.from}]` : `[block ${r.from}] to [block ${r.to}]`)).join(", ");
  const where =
    scope.windows > 1
      ? `${runs}, window ${scope.window} of ${scope.windows}${scope.whole ? " of the whole document" : ""}`
      : scope.whole
        ? "the whole document"
        : runs;
  return [`Scope: ${where}.`, "Change only blocks in the scope. The rest of the document is context."];
}

export function suggestPrompt(ctx: SuggestCtx): string {
  const rules = [
    "Do what the command asks and nothing else. Change no word the command does not ask you to change.",
    "Keep the author's voice, terms, names, numbers, dates, citations, and links unless the command asks to change them.",
    "Keep every claim the document makes. New words may explain, connect, or restate; a new number, name, date, or finding appears only when the command asks for it or the material states it.",
    "Copy find exactly, character for character. Never paraphrase it.",
    "One op per change. Use the smallest op: replace_words for a word, a phrase, or a sentence; rewrite_block when most of a block changes.",
    "Never touch figures, equations, tables' structure, smart chips, footnote numbers, or images. Words inside a table cell can change.",
    `Keep the document's language. Write summary and every why in ${languageName(ctx.lang)}.`,
    "why: one sentence on what the op changes and why.",
    "summary: one or two sentences on what the suggestions change. When the command asks no change, return no ops and say so in summary.",
    ...(ctx.scope.kind === "blocks" && ctx.scope.windows > 1
      ? ["When the command concerns one place in the document, only the window that holds it changes it; the other windows return no ops."]
      : []),
    `At most ${SUGGEST_MAX_OPS} ops.`,
  ];
  const styles = ctx.styles.map((s) => `[block ${s.blockId}] ${s.style}${s.where === "cell" ? " (table cell)" : s.where === "footnote" ? " (footnote)" : ""}`);
  return [
    "Suggest edits to the document above. Each op becomes a suggestion the reader accepts or rejects.",
    "",
    profileLines(ctx.profile),
    "",
    `The reader's command: ${ctx.command}`,
    ...(ctx.instruction ? [`The assistant's instruction: ${ctx.instruction}`] : []),
    ...(ctx.material ? ["The assistant's answer, which the command may ask you to use:", ctx.material] : []),
    ...scopeLines(ctx.scope),
    ...(styles.length > 0 ? [`Paragraph styles in the scope: ${styles.join(" · ")}`] : []),
    ...(ctx.caretBlockId ? [`The caret stands in [block ${ctx.caretBlockId}]. "Here" means right after it.`] : []),
    ...(ctx.pending.length > 0
      ? ["The assistant's suggestions on these blocks that no one has accepted or rejected yet. A new op on their words takes their place:", ...ctx.pending]
      : []),
    ...(ctx.history.length > 0
      ? ["The conversation so far:", ...ctx.history.map((m) => `${m.role === "user" ? "Reader" : "Assistant"}: ${m.content}`)]
      : []),
    "",
    "Ops:",
    ...OP_LINES,
    "",
    "Rules:",
    ...rules.map((rule, n) => `${n + 1}. ${rule}`),
    "",
    'Return ONLY JSON: {"summary": "…", "ops": [ … ]}',
  ].join("\n");
}
