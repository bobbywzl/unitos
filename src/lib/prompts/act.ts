import { actionLines, TRANSCRIPT_RULE, type DocumentEdits } from "@/lib/assistant/plan";
import type { ChatTurn } from "@/lib/conversation";
import type { Lang } from "@/lib/i18n/config";
import { languageName, profileLines, STYLE_RULE, WEB_LINES, type ReaderProfileCtx } from "@/lib/prompts/types";

// ACT: the selection chat and the article menu (SPEC.md §7, `/api/assistant/act`).
// The reader's message becomes a plan: reply (the answer), actions (edits,
// highlights, notes the reader approves), and matches (the passages across
// the document that deal with the selection's topic, the work the old
// Match-it tool did). The document is the cached system prefix; this is the
// user message. Not in promptTemplates: the route is the assistant's, not
// /api/derive.
// What makes a reply worth reading: it answers in its first sentence, every
// claim in it rests on a cited block, the matches are the passages a reader
// would have found by reading the whole document with the selection in mind,
// and nothing in it could have been written without this document.
export type ActCtx = {
  profile: ReaderProfileCtx;
  lang: Lang;
  // What the reader selected, rendered by the route: the text, the figure,
  // or the circled spot of a video; "" = no selection.
  selectionBlock: string;
  // A tool conversation (SPEC.md §21): the tool's output the turns go
  // deeper on; "" = an assistant conversation.
  toolBlock: string;
  // True when the reader has a text or figure selection the matches can
  // start from.
  hasSelection: boolean;
  sections: { id: string; title: string; parentTitle: string | null }[];
  otherDocuments: { id: string; title: string }[];
  // The reader's accepted notes across the project, visible sections only.
  notes: { sectionTitle: string; content: string }[];
  history: ChatTurn[];
  command: string;
  // The reader's Web toggle is on: the model can search (SPEC.md §7).
  web?: boolean;
  // How the document changes: the block actions (absent), one suggest action
  // on a document with rich text (SPEC.md §29), or no change at all on an
  // import a project of another account holds too (SPEC.md §30).
  edits?: DocumentEdits;
  // What each sheet of the document keeps as it is (sheetKeepLines).
  sheets?: string[];
  // A handwritten document's pages and the blocks that hold each page's
  // words (lib/assistant/pages.ts).
  pages?: string[];
  // A video's or an audio's document: its voices and who speaks from which
  // line (lib/assistant/transcript.ts); null for any other document.
  transcript?: string[] | null;
};

/** The selection block for a text selection: what the route puts in the
    prompt, and what the eval (scripts/eval) puts there for a case. */
export function textSelectionBlock(blockId: string, text: string, core = false): string {
  // A core is the block collapsed to what it really says (SPEC.md §28): the
  // reader selected in the core, not in the block's own words.
  const where = core ? `the core of block ${blockId} (the block collapsed to what it really says, in plain words)` : `block ${blockId}`;
  return `The reader has selected this text in ${where}:\n"${text.slice(0, 2000)}"\nThe command applies to this selection unless it says otherwise.`;
}

export function actPrompt(ctx: ActCtx): string {
  const language = languageName(ctx.lang);
  return [
    "Convert the reader's command into a plan of actions on this document and notebook. The reader approves the plan before anything runs.",
    "",
    profileLines(ctx.profile),
    "",
    ctx.selectionBlock || "The reader has no text selected. The command applies to the document.",
    ...(ctx.toolBlock ? ["", ctx.toolBlock] : []),
    "",
    `Sections in the corpus (id — title):\n${ctx.sections.length > 0 ? ctx.sections.map((s) => `${s.id} — ${s.parentTitle ? `${s.parentTitle} / ` : ""}${s.title}`).join("\n") : "none yet"}`,
    "",
    `Other attached documents (id — title):\n${ctx.otherDocuments.length > 0 ? ctx.otherDocuments.map((d) => `${d.id} — ${d.title}`).join("\n") : "none"}`,
    ...(ctx.sheets?.length ? ["", `Sheets (what each keeps as it is):\n${ctx.sheets.join("\n")}`] : []),
    ...(ctx.pages?.length ? ["", `Pages (each page's picture, then the blocks that hold its words):\n${ctx.pages.join("\n")}`] : []),
    ...(ctx.transcript?.length ? ["", ...ctx.transcript] : []),
    "",
    `The reader's notes across the corpus (section: note):\n${
      ctx.notes.length > 0
        ? ctx.notes.map((n) => `${n.sectionTitle}: ${n.content.slice(0, 200)}`).join("\n")
        : "none yet"
    }`,
    "",
    "Action types:",
    ...actionLines(ctx.edits ?? "blocks", Boolean(ctx.transcript)),
    "",
    "Rules:",
    "1. Use block ids exactly as given. Every quote must be an exact substring of the named block's text.",
    "2. A command that only asks for analysis, an answer, or a summary: put it in reply and return no actions.",
    "2a. A command that confirms a change the conversation proposed (\"implement\", \"ok do it\", \"go ahead\", \"yes\", \"apply it\") asks for that change: return its actions in full, and reply in one sentence. Never answer a confirmation with reply alone. A command that asks for a change never returns an empty actions list unless the change cannot be made; then reply says why.",
    "2b. When one of the reader's tools does the job better than an action (Simplify, Explain, Visualize, Define, Extract, Stitch), name the tool in reply and say in one sentence what it will do.",
    "3. Use the smallest set of actions that fulfils the command. Never change text the command did not ask to change.",
    "4. description: one plain sentence of what the action does, for the reader's approval list.",
    "5. FIGURE and VIDEO blocks cannot be edited or removed. A TABLE block's words change with edit_block within its cells: the new text is the whole table, a line per row and a tab between cells, and keeps every line and every tab. In a document of handwritten pages a TABLE is the conversion's: there edit_block writes its text anew, the first line its header row, and may add or remove rows and columns, and remove_block removes it. There a PAGE block is its page's picture and keeps its text; a page's words are the blocks listed under Pages: edit_block changes them, and a new block after one of them joins its page. A SLIDE block changes with edit_block: the new text is the whole slide, a line per line of its text; an edit changes words within lines and adds or removes lines of its text boxes and of its speaker notes. A new line opens with the bullet of the lines beside it; every bullet, a table's rows, and the line Speaker notes: stay, and speaker notes a slide lacks come at its end, under the line Speaker notes:. A SHEET block changes with edit_block: the new text is the whole sheet, a line per row and a tab between cells, every row with as many cells as the first; an edit changes words in cells and adds or removes rows or columns, never rows and columns both. A line break in a cell's words stays in its cell. A formula's cell follows the cells it reads: leave its value as it is, and the sheet computes it. What a sheet keeps as it is (its frozen rows and columns, the cells formulas compute, its merged cells, a chart's data) is listed under Sheets. A SLIDE, a SHEET, or any other TABLE block is never removed, and the HEADING before a SHEET is its sheet's name and stays. A document of slides or sheets, or with a VIDEO block, takes no new block, and no block moves in it.",
    "6. In reply, cite blocks as [block <id>] when you point at specific parts of the document — the tags render as links the reader can click.",
    `7. Write reply, every description, and every why in ${language}.`,
    `8. reply: start with the answer, in one sentence. Then the evidence: what the document says, each claim citing its block. As few words as the answer needs, under 100 unless the command needs more. ${STYLE_RULE} Say plainly when the document does not answer, then say what the document does say about it. Never add a fact the document does not state. A sentence that could be written about any other document is deleted; a sentence that restates the selection in other words is deleted.`,
    ...(ctx.hasSelection
      ? [
          "9. matches: the passages across the document that deal with what the selection focuses on. Do this before you write reply, and answer from them:",
          "   a. Name to yourself the topic the selection focuses on, in the context of the whole document.",
          "   b. Find 3 to 8 passages, from anywhere in the document, that reveal the most about that topic: a claim about it, its definition, evidence for it, a number about it, a counterpoint to it. Most revealing first. Never the selection itself. Skip passages that merely mention the topic.",
          "   c. quote: one contiguous verbatim span of one block, a sentence, at most two, copied exactly. blockId: the block it sits in. why: one sentence on what the passage says about the topic, with its number or its named mechanism, and how it bears on the reader's question when it does.",
          "   d. Every claim in reply that rests on a passage cites it as [block <id>].",
          ctx.history.length > 0
            ? "   e. This message continues the conversation: return matches only when the message asks where else the document deals with something. Otherwise return an empty list."
            : "   e. This is the first message of the conversation: always return matches.",
        ]
      : ["9. matches: return an empty list. The reader has no selection."]),
    ...(ctx.edits === "suggestions"
      ? [
          "10. A command that asks to change the document's words, styles, or order: one suggest action, reply null, and matches an empty list. A change of order (group by theme, organize, put in order) sets reorder: true on it. The suggestions carry the change: never write the changed text in reply.",
        ]
      : ctx.edits === "none"
        ? [
            "10. The document's words and styles cannot be changed: a project of another account holds the document too. A command that asks to change them: say so in reply, in one sentence, and return no action for the change.",
          ]
        : [
            "10. A change to the words of more than five blocks (the spelling or grammar of a long selection or of the document, its register, a section rewritten) is one revise action, whatever its size; never more than five edit_block actions. Its blockIds: the selected blocks when the command concerns the selection. A change of order of more than two blocks (group by theme, organize, put in order) is a revise action with reorder: true, never move_block actions. reply: one sentence on what will change: the plan carries the edits.",
            ...(ctx.transcript ? [`11. ${TRANSCRIPT_RULE}`] : []),
          ]),
    "",
    ...(ctx.history.length > 0
      ? [
          "Conversation so far. The command continues it:",
          ...ctx.history.map((m) => `${m.role === "user" ? "Reader" : "Assistant"}: ${m.content}`),
          "",
        ]
      : []),
    `Command: ${ctx.command}`,
    "",
    ...(ctx.web ? ["", ...WEB_LINES, ""] : []),
    'Return ONLY JSON: {"reply": string or null, "actions": [...], "matches": [{"blockId": "<id>", "quote": "<verbatim>", "why": "<sentence>"}]}',
  ].join("\n");
}
