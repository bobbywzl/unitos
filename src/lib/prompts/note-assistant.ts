import type { Lang } from "@/lib/i18n/config";
import {
  ANSWER_LENGTH,
  answerLanguage,
  CORE_RULE,
  profileLines,
  readerNotesText,
  SPECIFICITY_RULE,
  STYLE_RULE,
  WEB_LINES,
  type ReaderProfileCtx,
} from "@/lib/prompts/types";

// The note's assistant (SPEC.md §6, `/api/notes/[noteId]/assistant`): the
// panel docked at the bottom of an open note. The reader's message is about
// the note: a question about it, or a change to make to it. The document the
// note belongs to, when it has one, is the cached system prefix; the turns so
// far go in as messages before this one; this is the current message with
// the rules. The answer is JSON: the reply, and the note as it should read
// when the message asks for a change. Nothing changes until the reader
// applies it in the editor. Not in promptTemplates: the route is the note's.
export type NoteAssistantCtx = {
  profile: ReaderProfileCtx;
  lang: Lang;
  // The note as the editor holds it now: its title line, then its body.
  note: string;
  section: string;
  // The note's sources: the document's words its quotes point back to.
  sources: { documentTitle: string; quotedText: string }[];
  // The title of the document above, when there is one.
  documentTitle: string | null;
  // The reader's other notes in the project (section: note).
  otherNotes: { sectionTitle: string; content: string }[];
  message: string;
  continued: boolean;
  web: boolean;
};

export function noteAssistantPrompt(ctx: NoteAssistantCtx): string {
  return [
    "The reader has a note open and asks the assistant about it. Answer the message; when it asks for a change to the note, write the note as it should read. The reader sees the change and applies it, or not.",
    "",
    profileLines(ctx.profile),
    "",
    ctx.documentTitle
      ? `The note belongs to the document "${ctx.documentTitle}", which is above, whole. Every block starts with its id as [block <id>].`
      : "The note belongs to no document.",
    "",
    `The note, in section "${ctx.section}" (markdown; "# " is its title line, "> " lines are quotes of the document):`,
    "=== note ===",
    ctx.note || "(empty)",
    "=== end of note ===",
    ...(ctx.sources.length > 0
      ? [
          "",
          "The note's sources (the document's words its quotes point back to):",
          ...ctx.sources.map((s) => `- ${s.documentTitle}: "${s.quotedText}"`),
        ]
      : []),
    "",
    `The reader's other notes in the project (section: note):\n${readerNotesText(ctx.otherNotes)}`,
    ...(ctx.continued
      ? [
          "",
          "This message continues the conversation above. Answer it in that context; never repeat what an earlier reply said. A message that confirms a change an earlier reply proposed (\"yes\", \"do it\", \"apply it\") asks for that change: write it in content.",
        ]
      : []),
    "",
    `Message: ${ctx.message}`,
    "",
    "Rules:",
    "1. A message that asks a question about the note (what it means, whether it is right, what the document says about it, what is missing): answer it in reply, and content is null.",
    "2. A message that asks for a change to the note (rewrite, organize, group by theme, shorten, expand, add, remove, fix, translate, turn into a list or a table, add the document's evidence): content is the whole note as it should read after the change, its title line first. reply says in one or two sentences what changed and why.",
    "3. Change only what the message asks to change. Every line the message does not touch stays word for word, in its place.",
    "4. Every \"> \" quote line stays word for word unless the message asks to remove or change quotes: a quote's words are the document's, and a quote taken out loses its link back to the document. A new quote is the document's exact words, copied from one block, at most three sentences.",
    "5. Never add a fact, a number, a name, or a claim that neither the note, the document, the reader's notes, nor a web source you cite states. A web source is cited as a markdown link where it is used.",
    "6. Never write an id in the note or in reply: no [block <id>], no [note <id>], no bare ids. Name a passage by its words.",
    "7. The markup: \"# \" for the title line, \"## \" for a heading, \"- \" for a bullet, \"+ \" for a dash, \"1. \" for a numbered item, \"- [ ] \" for a checklist item, \"> \" for a quote, **bold**, *italic*. Keep the markup the note already uses unless the message asks for another shape.",
    `8. reply is markdown. ${ANSWER_LENGTH}`,
    CORE_RULE,
    SPECIFICITY_RULE,
    STYLE_RULE,
    ...(ctx.web ? ["", ...WEB_LINES] : []),
    answerLanguage(ctx.lang),
    "The note's own words keep the note's language unless the message asks to translate them.",
    "",
    'Return ONLY JSON: {"reply": "<markdown>", "content": "<the whole note as markdown>" or null}',
  ].join("\n");
}
