import type { Lang } from "@/lib/i18n/config";
import { languageName, profileLines, type ReaderProfileCtx } from "@/lib/prompts/types";

// VOICE: the voice command (SPEC.md §6, `/api/notes/voice`). The reader
// speaks in a section of the notes tray; the transcript is a command over
// the open document and the section's notes, and the answer is the notes
// the command asks for, each with the document's quotes as sources. The
// document is the cached system prefix; this is the user message. Not in
// promptTemplates: the route is the notes tray's, not /api/derive.
export type VoiceCtx = {
  profile: ReaderProfileCtx;
  lang: Lang;
  // False on the notes full page: no document is open, so nothing can be quoted.
  hasDocument: boolean;
  sections: { id: string; title: string; parentTitle: string | null }[];
  // The section the command was spoken in: notes land here unless the
  // command names another.
  section: { id: string; title: string };
  // The section's notes, so the command can build on them.
  sectionNotes: { id: string; content: string }[];
  // The reader's accepted notes across the project, visible sections only.
  notes: { sectionTitle: string; content: string }[];
  // The transcript of the recording.
  command: string;
};

export function voicePrompt(ctx: VoiceCtx): string {
  const language = languageName(ctx.lang);
  return [
    "The reader spoke a command in the notes tray. Write the notes the command asks for. Every note lands pending: the reader reads it over and accepts it.",
    "",
    profileLines(ctx.profile),
    "",
    ctx.hasDocument
      ? "The open document is above. The command applies to it and to the reader's notes."
      : "No document is open. The command applies to the reader's notes alone: quote nothing.",
    "",
    `Sections in the project (id — title):\n${ctx.sections.length > 0 ? ctx.sections.map((s) => `${s.id} — ${s.parentTitle ? `${s.parentTitle} / ` : ""}${s.title}`).join("\n") : "none yet"}`,
    "",
    `The command was spoken in section ${ctx.section.id} — ${ctx.section.title}. Its notes (id: note):\n${
      ctx.sectionNotes.length > 0
        ? ctx.sectionNotes.map((n) => `${n.id}: ${n.content.slice(0, 400)}`).join("\n")
        : "none yet"
    }`,
    "",
    `The reader's notes across the project (section: note):\n${
      ctx.notes.length > 0
        ? ctx.notes.map((n) => `${n.sectionTitle}: ${n.content.slice(0, 200)}`).join("\n")
        : "none yet"
    }`,
    "",
    "Rules:",
    "1. The command is speech, transcribed. Repeated words, false starts, and filler are the transcription's, not the reader's. Read the intent through them. Track every part of the command: what the note holds, how it is shaped, where it goes.",
    "2. A command that dictates a note (a statement, or \"note that …\"): write the reader's words as one note, filler removed, in the reader's order. Never add a fact the reader did not say.",
    "3. A command that asks for the document's words (quotes, evidence, passages, what the document says about something): find the passages in the document. A quote is one contiguous verbatim span of one block, copied exactly, at most three sentences. blockId: the block it sits in, exactly as given. Never invent a quote. Never write a fact the document does not state.",
    "4. Every quote goes in the note's content as its own \"> \" line, so it points back to the document. The reader's words around it — a caption, a point, a heading — go on their own lines.",
    "5. Shape the note as the command says. The markup: \"# \" for a title line, \"## \" for a heading, \"- \" for a bullet, \"1. \" for a numbered item, \"- [ ] \" for a checklist item, \"> \" for a quote, **bold**, *italic*. Bold exactly what the command says to bold, nothing else. A command that asks for the quotes as bullet points: one \"- \" line per quote with the point in the reader's words, and the quote's \"> \" line under it. A command that says nothing about shape: a caption line, then the quotes.",
    `6. Where the note goes: section ${ctx.section.id} unless the command names another section (its id from the list) or asks for a new one (sectionTitle). The reader's own words in the language they spoke; a caption in ${language}.`,
    "7. Several notes only when the command asks for several. A command that asks to add to a note of the section: write the addition as a new note under the same title; the reader merges them.",
    "8. When the document has nothing on what the command asks: write the note with no quotes and say so in one line at its end, and put the reason in warnings.",
    "",
    `Command: ${ctx.command}`,
    "",
    'Return ONLY JSON: {"notes": [{"content": "<markdown>", "sectionId": "<id or omit>", "sectionTitle": "<new title or omit>", "quotes": [{"blockId": "<id>", "quote": "<verbatim>"}]}], "warnings": ["<sentence>"]}',
  ].join("\n");
}
