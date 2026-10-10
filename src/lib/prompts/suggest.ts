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
  styles: { blockId: string; style: string; where: "body" | "cell" | "footnote" | "words" }[];
  caretBlockId: string | null;
  // The asker's pending suggestions in the scope, one line each (lib/docs/suggest-ops.ts).
  pending: string[];
  history: ChatTurn[];
  // The command moves blocks too: the order pass does that (lib/assistant/reorder.ts).
  reorder?: boolean;
  // Where the ops land: the page editor, as the assistant's suggestions
  // (page); or the plan card, as the block edits of a document without rich
  // text (plan, lib/assistant/revise.ts).
  target: "page" | "plan";
};

export const OP_LINES = [
  '- replace_words {blockId, find, text, format?, why}: change words inside one block. find: the block\'s words exactly as written, long enough to occur once in it. text: the words that take their place; "" deletes them. format: bold, italic, underline, or strikethrough, when the new words take one.',
  "- rewrite_block {blockId, text, why}: one block's words written anew, whole, plain, one paragraph with no blank line. Use it when most of a block changes. The block keeps its style.",
  "- replace_blocks {blockIds, markdown, why}: consecutive blocks replaced by new blocks. Use it to turn a paragraph into a list, split one, join two, or reorder them.",
  "- insert_blocks {afterBlockId, markdown, why}: new blocks after a block; afterBlockId null puts them at the document's start.",
  "- remove_blocks {blockIds, why}: consecutive blocks deleted whole.",
  "- set_style {blockId, style, why}: normal, title, subtitle, h1 to h6, bulleted, numbered, checklist.",
  "- set_alignment {blockId, alignment, why}: left, center, right, or justify.",
  "- set_spacing {blockId, line?, before?, after?, why}: line spacing as a multiple (1 single, 1.15, 1.5, 2 double); the space before and after the paragraph in points.",
  "- set_indent {blockId, left?, firstLine?, right?, why}: a paragraph's or a heading's indents in points (36 is half an inch); 0 takes one off. A list line nests by replace_blocks, never by set_indent.",
  '- format_words {blockId, find, format, value?, why}: a format on exact words: bold, italic, underline, or strikethrough; link, value the address ("" takes the link off); color, value #rrggbb; highlight_color, value #rrggbb; font, value the font\'s name; size, value the size in points.',
  "- insert_row {blockId, where, cells, why}: a new table row above or below the row of the cell blockId names. cells: its words, one string per column, left to right.",
  "- remove_row {blockId, why}: the row of the cell blockId names, removed.",
  "- move_row {blockId, toBlockId, where, why}: the row of the cell blockId names, moved above or below the row of the cell toBlockId names, in the same table.",
  "- insert_column {blockId, where, cells, why}: a new column left or right of the column of the cell blockId names. cells: its words, one string per row, top to bottom.",
  "- remove_column {blockId, why}: the column of the cell blockId names, removed.",
  "- move_column {blockId, toBlockId, where, why}: the column of the cell blockId names, moved left or right of the column of the cell toBlockId names, in the same table.",
  "- insert_footnote {blockId, find, text, why}: a footnote whose number goes right after the words find. text: the footnote's words.",
  "markdown: # to ###### headings, - bulleted lines, 1. numbered lines, - [ ] checklist lines, **bold**, *italic*, [text](url), a new table as | cell | lines under a | --- | line, an image as ![what it shows](web address) on a line of its own.",
];

// A document without rich text: its blocks take the plan card's edits
// (lib/assistant/revise.ts), so the ops are the ones those edits make.
export const PLAN_OP_LINES = [
  '- replace_words {blockId, find, text, format?, why}: change words inside one block. find: the block\'s words exactly as written, long enough to occur once in it. text: the words that take their place; "" deletes them. format: bold, italic, or underline, when the new words take one.',
  "- rewrite_block {blockId, text, why}: one block's words written anew, whole, with no blank line. Use it when most of a block changes. The block keeps its format.",
  "- replace_blocks {blockIds, markdown, why}: consecutive blocks replaced by new blocks. Use it to turn a paragraph into a list, split one, join two, or reorder them.",
  "- insert_blocks {afterBlockId, markdown, why}: new blocks after a block; afterBlockId null puts them at the document's start.",
  "- remove_blocks {blockIds, why}: consecutive blocks deleted whole.",
  "- set_style {blockId, style, why}: normal, h1, h2, h3, bulleted, numbered.",
  '- format_words {blockId, find, format, value?, why}: a format on exact words: bold, italic, or underline; link, value the web address ("" takes the link off); color, value #rrggbb; highlight_color, value #rrggbb.',
  "markdown: # to ### headings, - bulleted lines, 1. numbered lines, two spaces more per level of nesting. Plain words otherwise: no bold, italic, link, table, or image.",
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
  const plan = ctx.target === "plan";
  const rules = [
    "Do what the command asks and nothing else. Change no word the command does not ask you to change.",
    "Keep the author's voice, terms, names, numbers, dates, citations, and links unless the command asks to change them. A change of register, tone, or wording changes the words that carry it and keeps every other word of the sentence as printed; a sentence with none of them stays word for word. A plain-words rewrite keeps a sentence that is already short and plain word for word.",
    "Keep every claim the document makes. New words may explain, connect, or restate; a new number, name, date, or finding appears only when the command asks for it or the material states it.",
    "Copy find exactly, character for character. Never paraphrase it.",
    "One op per change. Use the smallest op: replace_words for a word, a phrase, or a sentence; rewrite_block when most of a block changes.",
    ...(plan
      ? [
          "A LIST block's words are its lines, each with its marker (- or 1.) and two spaces more per level of nesting: a line nests or unnests by its spaces. An EQUATION block's words are its TeX: rewrite_block changes them. Write TeX that KaTeX draws.",
          "A SLIDE block's words are its lines: its title, each line of its text, the line Speaker notes:, and each line of the notes. replace_words changes words within a line. Never add or remove a line, and never change a bullet or the line Speaker notes:.",
          "A SHEET block's words are its rows, a line per row and a tab between cells. replace_words changes words within a cell. Never add or remove a tab or a line, and never change a cell a formula computes.",
          "A TABLE block's words are its rows, a line per row and a tab between cells. replace_words changes words within a cell. Never add or remove a tab or a line.",
          "A TRANSCRIPT block is one line of a recording, said by one voice at its times: replace_words, rewrite_block, and format_words change its words, and its times stay. Never add, remove, join, or split a line.",
          "Never change a FIGURE, PAGE, or VIDEO block, and never remove or replace an equation, a slide, a sheet, a table, or a transcript line.",
        ]
      : [
          "An EQUATION block's words are its TeX, a FIGURE block's words its caption: rewrite_block changes them. A FIGURE block with no words is an image: its caption is a new line under it (insert_blocks after it). An inline formula stands in its block's words as $TeX$ and shows as its raw characters (a page draws TeX only in an equation block): replace_words with find the whole $TeX$ changes it. A command to fix it, clean it up, or make it readable asks for the same words as plain text: Unicode subscripts, arrows, and Greek letters, with no dollar signs, backslashes, or braces. In an equation block, write TeX that KaTeX draws.",
          "Never remove, move, or replace a figure, an image, an equation, a smart chip, or a footnote number. A table cell's words change with replace_words, a table's rows and columns with the row and column ops.",
        ]),
    `Keep the document's language. Write summary and every why in ${languageName(ctx.lang)}.`,
    "why: one sentence on what the op changes and why.",
    "summary: one sentence on what the suggestions change, without the new words and without what stays as it is. When the command asks no change, return no ops and say so in summary.",
    ...(ctx.reorder
      ? [
          "Another pass of this command moves the blocks and adds a heading for each group. Never move, reorder, or group blocks, and add no heading for a group. Change only the words the command asks to change; when the command asks for nothing but a new order, return no ops.",
        ]
      : []),
    ...(ctx.scope.kind === "blocks" && ctx.scope.windows > 1
      ? ["When the command concerns one place in the document, only the window that holds it changes it; the other windows return no ops."]
      : []),
    `At most ${SUGGEST_MAX_OPS} ops.`,
  ];
  const styles = ctx.styles.map((s) => `[block ${s.blockId}] ${s.style}${s.where === "cell" ? " (table cell)" : s.where === "footnote" ? " (footnote)" : ""}`);
  return [
    plan
      ? "Suggest edits to the document above. Each op becomes an edit in the plan card; the reader applies the edits they keep."
      : "Suggest edits to the document above. Each op becomes a suggestion the reader accepts or rejects.",
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
    "Ops (each an object whose \"op\" is its name, with the fields its line names):",
    ...(plan ? PLAN_OP_LINES : OP_LINES),
    "",
    "Rules:",
    ...rules.map((rule, n) => `${n + 1}. ${rule}`),
    "",
    "JSON strings escape a backslash: write \\\\ for every \\ (TeX \\frac is \"\\\\frac\", \\text is \"\\\\text\").",
    'Return ONLY JSON: {"summary": "…", "ops": [ … ]}',
  ].join("\n");
}
