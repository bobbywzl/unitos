import { actionLines } from "@/lib/assistant/plan";
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
  // The document has rich text: a change to it is one suggest action
  // (SPEC.md §29), in place of the block actions.
  richText?: boolean;
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
    "",
    `The reader's notes across the corpus (section: note):\n${
      ctx.notes.length > 0
        ? ctx.notes.map((n) => `${n.sectionTitle}: ${n.content.slice(0, 200)}`).join("\n")
        : "none yet"
    }`,
    "",
    "Action types:",
    ...actionLines(ctx.richText ?? false),
    "",
    "Rules:",
    "1. Use block ids exactly as given. Every quote must be an exact substring of the named block's text.",
    "2. A command that only asks for analysis, an answer, or a summary: put it in reply and return no actions.",
    "3. Use the smallest set of actions that fulfils the command. Never change text the command did not ask to change.",
    "4. description: one plain sentence of what the action does, for the reader's approval list.",
    "5. TABLE and FIGURE blocks cannot be edited or removed.",
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
    ...(ctx.richText
      ? [
          "10. A command that asks to change the document's words or styles: one suggest action, reply null, and matches an empty list. The suggestions carry the change: never write the changed text in reply.",
        ]
      : []),
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
