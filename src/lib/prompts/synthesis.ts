import { actionLines, NEAREST_CHANGE_RULE, TRANSCRIPT_RULE, type DocumentEdits } from "@/lib/assistant/plan";
import type { Lang } from "@/lib/i18n/config";
import {
  ANSWER_LENGTH,
  answerLanguage,
  CONNECTION_RULE,
  CORE_RULE,
  GROUNDING_RULE,
  languageName,
  profileLines,
  SPECIFICITY_RULE,
  STYLE_RULE,
  WEB_LINES,
  type ReaderProfileCtx,
} from "@/lib/prompts/types";

// SYNTHESIS: notebook-scope assistant output (SPEC.md §7). Free questions stream text;
// contradiction/gap/unsourced tasks return JSON issue cards.

// The conversation (SPEC.md §7): the first question opens it, every later
// message continues it. The turns so far go in as messages before this one;
// this prompt is the current message with the rules, so the rules sit next
// to the answer whatever the window holds.
//
// web: the assistant can search the web (SPEC.md §7). The material stays the
// first source; the web checks it and fills what it lacks, and every web
// source is cited as a link so the reader can verify it.
//
// files and images: what the reader attached to this message. A file's text
// is in the prompt; an image is a part of the same message.
//
// What makes an answer worth reading: it answers the question in its first
// sentence, every claim in it rests on a cited block or note the reader can
// open, it says what the material does not answer instead of filling the
// gap, and nothing in it could have been written without this material.
export function synthesisAskPrompt(params: {
  profile: ReaderProfileCtx;
  lang: Lang;
  scopeLabel: string;
  question: string;
  web?: boolean;
  continued?: boolean;
  files?: { name: string; text?: string }[];
  imageCount?: number;
  // This page scope (SPEC.md §7): the assistant may propose actions on the
  // open document and the notes, which the reader approves in the plan card.
  // edits: how the document changes (lib/assistant/plan.ts); caretBlockId:
  // the block the caret stands in.
  act?: PageActions;
}): string {
  const files = params.files ?? [];
  const imageCount = params.imageCount ?? 0;
  return [
    profileLines(params.profile),
    "",
    `Scope: ${params.scopeLabel}. The material is above.`,
    ...(params.continued
      ? [
          "",
          "This message continues the conversation above. Answer it in the conversation's context. Never repeat what an earlier answer already said; add to it. A message that confirms a change an earlier answer proposed is the exception: write that change's actions in full.",
        ]
      : []),
    ...(files.length > 0
      ? [
          "",
          "The reader attached these files to this message:",
          ...files.flatMap((f) => [
            `=== file: ${f.name} ===`,
            f.text ?? "(text not sent)",
            "=== end of file ===",
          ]),
        ]
      : []),
    ...(imageCount > 0
      ? [
          "",
          `The reader attached ${imageCount === 1 ? "one image" : `${imageCount} images`} to this message. The images are in this message.`,
        ]
      : []),
    "",
    params.question
      ? `Question: ${params.question}`
      : "The reader sent the attachments without a question. Say what they contain and how they relate to the material.",
    "",
    "Answer from the material above.",
    "1. Start with the answer, in one or two sentences: the core. A lookup (rule 6) ends there: no reasoning, no limit, no warning, and no sentence on the reader's purpose. A question of who, which, when, where, how many, or whether that the material answers in its own words is a lookup, however it is worded: the passage that answers it, with its block, and the reason that passage gives, in a clause, never a paragraph of reasons unless the message asks why. Any other question then gives the reasoning that earns it, each step on the passage it rests on, cited as [block <id>]; quote the exact words only where the wording carries the point. For such a question, find before you write the passage that limits the answer itself or cuts against it (an exception to it, a condition on it, a risk to it, what happened next): the answer names it in one sentence with its block. A passage that only frames the topic (why it matters, what the author thinks of it) is not a limit. A number keeps what the material attaches to it, with that passage's block: what it measures, the condition it was measured under, its qualifier (on average, at most), and an exception the material states for it (a cap that can be raised). A condition or a test keeps the material's own word for it, never a near word that changes the test.",
    "2. A question about a passage, a term, or a claim: first gather the passages across the material that deal with it, from anywhere in the material, then answer from them as one answer: passages that make the same point are one point with each cited. A passage that disagrees with the others is named as disagreeing, never dropped.",
    "3. A question the material answers only in part: answer the part it answers, then say in one sentence what it does not answer. Never fill the gap with what is generally known unless the reader asked for that, and then say which sentences come from outside the material.",
    "3a. Cite with the tags alone: [block <id>] and [note <id>] render as links. Never write an id in your own words (\"note cmuo…\"), and never write a tag where you mean the words: name the note by what it says. Each tag goes right after the claim it supports. A claim that rests on several blocks takes each block's tag, side by side: tags side by side render as one chip with their count.",
    "4. A question about counts, spread, or absence (how many, where, does it ever): the material is complete except where a cut is declared, so answer with the count and cite each instance. When the document never states the count itself, the answer says so in two words (\"by my count, three\"), and nothing more on how it was counted. Figures that look like the ones counted but are left out (a price beside a total) are named in one short sentence that says why they do not count.",
    "5. Fit the answer to the reader context above: explain what the reader is least likely to know, skip what they know, connect to their purpose when the connection is real.",
    "6. Stop at the answer. After the sentences that answer and the reasoning they rest on, nothing follows: no aside on a passage that neither answers nor contradicts, no context the question did not ask for, no figure derived from the document's figures, no mistake the reader might make, no advice, no closing lesson or verdict, and at most one sentence that ties the answer to the reader's purpose. A point is made once, never restated in other words. Never say how the answer was found (the blocks read, the checks made): say what is so. A lookup ends with its one to three sentences, in one paragraph. Every sentence holds one claim and stays under 25 words: a second claim starts a new sentence.",
    ANSWER_LENGTH,
    CORE_RULE,
    CONNECTION_RULE,
    GROUNDING_RULE,
    SPECIFICITY_RULE,
    ...(files.length > 0 || imageCount > 0
      ? [
          "An attached file or image is material too: answer from it together with the material above, and name the file when you cite it.",
        ]
      : []),
    STYLE_RULE,
    ...(params.act ? actLines(params.act) : [ACT_ELSEWHERE_LINE]),
    ...(params.web ? ["", ...WEB_LINES] : []),
    answerLanguage(params.lang),
  ].join("\n");
}

// Project scope cannot change a page: the message says where a change runs.
const ACT_ELSEWHERE_LINE =
  "You cannot change a document or the notes from this scope. When the message asks for a change, answer it, then say in one sentence that changes run from the This page scope with the document open.";

type PageActions = {
  sections: { id: string; title: string; parentTitle: string | null }[];
  otherDocuments: { id: string; title: string }[];
  edits?: DocumentEdits;
  caretBlockId?: string | null;
  // What each sheet of the document keeps as it is (sheetKeepLines).
  sheets?: string[];
  // A handwritten document's pages and the blocks that hold each page's
  // words (lib/assistant/pages.ts).
  pages?: string[];
  // A video's or an audio's document: its voices and who speaks from which
  // line (lib/assistant/transcript.ts); null for any other document.
  transcript?: string[] | null;
};

// This page scope: the actions the assistant may propose, and the fence the
// answer ends with when the message asks for a change. The server holds the
// fence back from the stream, validates every action against the real
// document (lib/assistant/plan.ts), and sends the plan after the answer; the
// reader approves it in the plan card before anything runs. A suggest action
// goes to the page instead: its changes land as the assistant's suggestions.
function actLines(act: PageActions): string[] {
  return [
    "",
    "You can propose changes to the open document and the notes. The reader approves every action before it runs.",
    `Sections in the project (id — title):\n${act.sections.length > 0 ? act.sections.map((s) => `${s.id} — ${s.parentTitle ? `${s.parentTitle} / ` : ""}${s.title}`).join("\n") : "none yet"}`,
    `Other attached documents (id — title):\n${act.otherDocuments.length > 0 ? act.otherDocuments.map((d) => `${d.id} — ${d.title}`).join("\n") : "none"}`,
    ...(act.sheets?.length ? [`Sheets (what each keeps as it is):\n${act.sheets.join("\n")}`] : []),
    ...(act.pages?.length ? [`Pages (each page's picture, then the blocks that hold its words):\n${act.pages.join("\n")}`] : []),
    ...(act.transcript ?? []),
    ...(act.caretBlockId ? [`The caret stands in [block ${act.caretBlockId}]. "Here" means right after it.`] : []),
    "Action types (each action is a JSON object whose \"type\" is the type's name, with the fields its line names):",
    ...actionLines(act.edits ?? "blocks", Boolean(act.transcript)),
    "Rules for actions:",
    "1. A message that asks for a change to the document or the notes: write the answer, then end with a fenced block that opens with the line ```actions and holds a JSON array of the actions, one action too. Every action has its \"type\". Nothing after the block. To reorganize, format, restructure, rewrite, fix, shorten, simplify, or translate the open document is a change to it, and so is a change to \"my notes\" or \"these notes\" when the open document holds the reader's own notes. Example of the block's shape:\n```actions\n[{\"type\": \"comment\", \"blockId\": \"<id>\", \"quote\": \"<exact words>\", \"comment\": \"<note>\", \"description\": \"<one sentence>\"}]\n```",
    "JSON strings escape a backslash: write \\\\ for every \\ (TeX \\frac is \"\\\\frac\", \\text is \"\\\\text\").",
    "1a. A message that confirms a change an earlier answer proposed (\"implement\", \"ok do it\", \"go ahead\", \"yes\", \"apply it\") asks for that change: answer in one sentence, then end with the actions block for it, written in full again. Never answer a confirmation with words alone.",
    "2. A message that asks for analysis, an answer, or a summary, and no change: no block. Never write the actions as JSON anywhere but the actions block.",
    "3. Use block ids exactly as given in the [block <id>] tags. Every quote must be an exact substring of the named block's text.",
    "4. Use the smallest set of actions that fulfils the message. Never change text the message did not ask to change.",
    "5. description: one plain sentence of what the action does, for the reader's approval list. It names the block by its opening words (\"the paragraph that starts 'Fuel is'\"); an action on a quote (a note, a highlight, a comment, a style, a link) whose quote does not open its block names the quote by its own first words instead (\"the sentence that starts 'Routing adds one pass'\"), and by what it is: the sentence, the two sentences, the line; \"the paragraph\" only when the quote is the whole paragraph.",
    "5a. When one of the reader's tools does the job better than an action (Simplify, Explain, Visualize, Define, Extract, Stitch), name the tool in the answer and say in one sentence what it will do.",
    "6. FIGURE and VIDEO blocks cannot be edited or removed. A TABLE block's words change with edit_block within its cells: the new text is the whole table, a line per row and a tab between cells, and keeps every line and every tab. In a document of handwritten pages a TABLE is the conversion's: there edit_block writes its text anew, the first line its header row, and may add or remove rows and columns, and remove_block removes it. There a PAGE block is its page's picture and keeps its text; a page's words are the blocks listed under Pages: edit_block changes them, and a new block after one of them joins its page. A SLIDE block changes with edit_block: the new text is the whole slide, a line per line of its text; an edit changes words within lines and adds or removes lines of its text boxes and of its speaker notes. A new line opens with the bullet of the lines beside it; every bullet, a table's rows, and the line Speaker notes: stay, and speaker notes a slide lacks come at its end, under the line Speaker notes:. A SHEET block changes with edit_block: the new text is the whole sheet, a line per row and a tab between cells, every row with as many cells as the first; an edit changes words in cells and adds or removes rows or columns, never rows and columns both. A line break in a cell's words stays in its cell. A formula's cell follows the cells it reads: leave its value as it is, and the sheet computes it. What a sheet keeps as it is (its frozen rows and columns, the cells formulas compute, its merged cells, a chart's data) is listed under Sheets. A SLIDE, a SHEET, or any other TABLE block is never removed, and the HEADING before a SHEET is its sheet's name and stays. A document of slides or sheets, or with a VIDEO block, takes no new block, and no block moves in it.",
    NEAREST_CHANGE_RULE("6a"),
    act.edits === "suggestions"
      ? "7. A change to the document's words, styles, or order is one suggest action, whatever its size: the whole document, a section, or a paragraph. A change of order (group by theme, organize, put in order) sets reorder: true on it; a message that asks for both an order and word changes (organize, then shorten the descriptions) is still one suggest action. The answer is one sentence that names the change in the message's own words and where it runs; old and new words the message itself gives may be named. Words the pass will write (corrections, rewrites, translations) are never named, and no example of the change is given: the suggestions show them in the page. A page draws TeX only in an equation block: an inline formula ($…$) in a paragraph shows as its raw characters, so a command to fix it, clean it up, or make it readable asks for the same words as plain text (Unicode subscripts, arrows, and Greek letters), with no dollar signs, backslashes, or braces. A command that asks for the math in words (in plain words, in English, spelled out) asks for words: each formula as the fewest plain words that say it, with the sentence's own subject (\"the cost grows with the square of the length\"); a symbol that only names a thing keeps its name, with a Unicode subscript (Bank_2 becomes Bank₂), the same in every block."
      : act.edits === "blocks"
        ? "7. A change to the words of more than five blocks (the spelling or grammar across the document, its register, a section rewritten) is one revise action, whatever its size; never more than five edit_block actions. A change of order of more than two blocks (group by theme, organize, put in order) is a revise action with reorder: true, never move_block actions; a message that asks for both an order and word changes is still one revise action. For a revise action, the answer is one sentence on what will change: the plan card carries the edits."
        : "7. The answer names what each action changes. The reader reads the actions in the plan card.",
    ...(act.edits === "none"
      ? [
          "8. The document's words and styles cannot be changed: a project of another account holds the document too. When the message asks to change them, say so in one sentence, and propose no action for the change. Then give what the reader can still have: when the message asks for new words for a passage (a rewrite, a shorter version, a fix), write the new words in the answer, so the reader can use them; when it asks for a mark or a style on a passage, offer in one sentence to highlight the passage (\"I can highlight that sentence instead.\"), name no other mark, and propose no action unasked. Cite the passage's block.",
        ]
      : act.transcript
        ? [`8. ${TRANSCRIPT_RULE}`]
        : []),
    "9. The answer to a message that asks for a change is one sentence, under 30 words, that names what changes and where: the block, the words, the section, the note, with the verb of the message (bolds, renames, moves, cuts). It claims no more than the plan does: never \"every mistake\" when the action's own instruction leaves some as they are. When a few words change in a block action, the old words and the new ones (\"This changes 'the numbers' to 'these numbers' in the risks paragraph\"); a suggest action follows rule 7. New text of a sentence or more is never pasted: say in a few words what it says (\"adds a closing paragraph that weighs the cost against the 90,000 homes\"); the plan card shows the text. Written as a statement of what the plan does, never as an offer (\"I can…\", \"I could…\") and never the message's own words said back. Nothing else: not what stays as it is, not the blocks the plan leaves alone, not the plan card's words again (the new text, a description), not the document's content around the change, not advice on the document. Three things get one clause each, inside the sentence, when they apply: what the message asked to keep, said as kept and never restated (\"every figure stays\"); an earlier change the message calls off in full (\"the paragraph stays\"), while a message that narrows an earlier change gets \"only\" before what it keeps (\"makes only the first two headings level one\") and no clause on the rest; and a pointing word (that, this, these, the above) that the move or the cut leaves aimed at the wrong paragraph, named with its block, with no action for it. A line that answers the line before it is not a pointing word. A block is named once, by the words the reader used for it, else by its heading or what it is (\"the Recommendation paragraph\", \"Priya's line at 7:32\"), and by its opening words in quotes only when nothing else tells it apart; a heading's own words, when they name it, go in quotes (\"the 'Risks' heading\"). Its [block <id>] tag goes right after the name, and the tag renders as a chip that jumps to the block and shows none of its words. Several blocks are named by kind and count (\"both headings and both Evidence paragraphs\"), never each by its opening words, and every block the plan changes, marks, or quotes takes its own tag, side by side right after the words that name them (\"both Evidence paragraphs [block a] [block b]\"): tags side by side render as one chip with their count. A change to the whole document names the document and takes no tag, and a block the plan leaves alone takes none. Never by an ordinal the reader did not use (\"the third paragraph\"). A confirmation gets one sentence. The reader approves the change in the plan card; the answer only names it.",
    "10. A message that asks for a new document (make, create, or write a document, a page, or a doc: a summary, a study guide, action items, an outline, a glossary) is one create_document action, never notes or sections in its place, and never words added to the open document. Its markdown is the whole new document, written from the material: ## headings for its parts, the points in plain words with the material's own numbers and names, and under each point the passage that supports it as a > quote line: the one sentence that states the point, of one block, copied word for word. Each point is written from its quote: every fact the point states (a number, a name, a mechanism) is in that quote's words, and a fact from another sentence gets that sentence as its own quote line. A point holds the facts of one or two sentences, so it takes one or two quote lines; a point that would need more is two points, or loses the facts that matter least. A part that summarizes a named part of the document draws on every block under that heading and keeps every number of it. A summary's own words stay under a third of the length of what it sums up, and the whole summary, its quote lines too, under half: a point holds what several lines say, and a line that adds nothing to a point is left out. The steps of a process go in the order the process runs, which the steps' own words give, not the order the material lists them. An answer under a question (an FAQ, a study guide) is in the reader's words and shorter than its quote, never the quote retyped. A document for a named audience (the sales team, a client, a manager) holds only what that audience will say or do: test figures and the debate behind a decision stay out unless the message asks for them. The title names what the document is. The answer is one sentence that names the document and what it holds.",
    "11. A message that asks for one note, one mark, or one entry per X the document names (each risk, every limit, each decision, every term): before writing the plan, list every block of the whole document that states an X, under any heading, and write one action per X, even when two X share a block. A heading named X holds some of them, not all. The key X (key numbers, key terms) are the few the document's main point rests on, never every X it gives.",
  ];
}

// An earlier message of the reader, as the conversation replays it: the
// message, then each attachment it carried by name. A file's text was read
// when it was sent — its answer holds what mattered — so the name stands for
// it. An image still in the window rides beside this text as a part; one
// past the window is named here instead.
export function synthesisHistoryTurn(turn: {
  content: string;
  files?: { name: string }[];
  images?: { name?: string; shown: boolean }[];
}): string {
  const lines = [turn.content.trim() || "(no text)"];
  for (const f of turn.files ?? []) lines.push(`[attached file: ${f.name}]`);
  for (const img of turn.images ?? []) {
    lines.push(
      img.shown
        ? `[attached image${img.name ? `: ${img.name}` : ""}]`
        : `[attached image${img.name ? `: ${img.name}` : ""} — not shown again]`,
    );
  }
  return lines.join("\n");
}

const TASK_INSTRUCTIONS: Record<"contradictions" | "gaps" | "unsourced", string> = {
  contradictions: [
    "Find notes that contradict each other: incompatible claims, numbers that disagree,",
    "or conclusions that cannot both hold. Each issue lists the conflicting note ids.",
  ].join("\n"),
  gaps: [
    "Find gaps: sections that are thin for the reader's purpose, claims that lack support,",
    "and questions the notes raise but never answer. Each issue lists the related note ids",
    "(empty list when a gap is about a section with no notes; name the section in the issue).",
  ].join("\n"),
  unsourced: [
    "Find accepted notes with no source anchors (marked \"sources: none\") that state factual",
    "claims. Each issue lists the unsourced note ids.",
  ].join("\n"),
};

export function synthesisTaskPrompt(params: {
  profile: ReaderProfileCtx;
  lang: Lang;
  task: "contradictions" | "gaps" | "unsourced";
}): string {
  return [
    profileLines(params.profile),
    "",
    "The project is above: its documents, its notes (pending ones marked), and every annotation and layer on them.",
    "",
    TASK_INSTRUCTIONS[params.task],
    "",
    "Rules:",
    "1. Only report real issues. An empty list is a valid answer.",
    `2. issue: one sentence naming the problem. explanation: one or two sentences with the evidence. Write both in ${languageName(params.lang)}.`,
    "3. Use note ids exactly as they appear in [note <id>] markers.",
    `4. ${STYLE_RULE}`,
    "",
    'Return ONLY JSON: {"issues": [{"noteIds": ["<id>"], "issue": "<sentence>", "explanation": "<sentences>"}]}',
  ].join("\n");
}
