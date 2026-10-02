import { suggestionAuthor } from "@/lib/docs/schema";

// The assistant's suggestions (SPEC.md §29): the author they carry and the
// ops the model answers with, resolved against the paragraph index. Shared
// by the server (lib/derive/suggest.ts, the routes) and the page editor
// (components/docs/suggest/assistant.ts).

/** The author of the assistant's suggestions made for one account. */
export const ASSISTANT_AUTHOR_PREFIX = "assistant-";
export const assistantAuthor = (userId: string): string => `${ASSISTANT_AUTHOR_PREFIX}${userId}`;
export const isAssistantAuthor = (author: string): boolean => author.startsWith(ASSISTANT_AUTHOR_PREFIX);
/** The account that asked ("" when the author is not the assistant). */
export const askerOf = (author: string): string => (isAssistantAuthor(author) ? author.slice(ASSISTANT_AUTHOR_PREFIX.length) : "");
/** A suggestion id ("<author>.<ms>") the assistant made. */
export const isAssistantSuggestion = (id: unknown): boolean => isAssistantAuthor(suggestionAuthor(id));

export type SuggestStyle = "normal" | "title" | "subtitle" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "bulleted" | "numbered" | "checklist";
/** A format that goes on or off words. */
export type SuggestMarkFormat = "bold" | "italic" | "underline" | "strikethrough";
/** A format that sets a value on words: the link's address ("" takes the
    link off), the text color and the highlight color (#rrggbb), the font's
    name, the size in points. */
export type SuggestValueFormat = "link" | "color" | "highlight_color" | "font" | "size";
export type SuggestFormat = SuggestMarkFormat | SuggestValueFormat;
export type SuggestAlignment = "left" | "center" | "right" | "justify";
export type ResolvedOp =
  | { i: number; op: "replace_words"; blockId: string; start: number; end: number; find: string; text: string; format?: SuggestMarkFormat; why: string }
  | { i: number; op: "format_words"; blockId: string; start: number; end: number; find: string; format: SuggestFormat; value?: string; why: string }
  | { i: number; op: "rewrite_block"; blockId: string; base: string; text: string; why: string }
  | { i: number; op: "replace_blocks"; blockIds: string[]; base: string[]; markdown: string; why: string }
  | { i: number; op: "insert_blocks"; afterBlockId: string | null; markdown: string; why: string }
  | { i: number; op: "remove_blocks"; blockIds: string[]; base: string[]; why: string }
  | { i: number; op: "set_style"; blockId: string; style: SuggestStyle; baseStyle: SuggestStyle; why: string }
  | { i: number; op: "set_alignment"; blockId: string; alignment: SuggestAlignment; why: string }
  // Line spacing as a multiple, the space before and after in points.
  | { i: number; op: "set_spacing"; blockId: string; line?: number; before?: number; after?: number; why: string }
  // Indents in points: left, right, and the first line's.
  | { i: number; op: "set_indent"; blockId: string; left?: number; right?: number; firstLine?: number; why: string }
  // A table's rows and columns, each named by one of its cells' blockId.
  | { i: number; op: "insert_row"; blockId: string; where: "above" | "below"; cells: string[]; why: string }
  | { i: number; op: "remove_row"; blockId: string; why: string }
  | { i: number; op: "move_row"; blockId: string; toBlockId: string; where: "above" | "below"; why: string }
  | { i: number; op: "insert_column"; blockId: string; where: "left" | "right"; cells: string[]; why: string }
  | { i: number; op: "remove_column"; blockId: string; why: string }
  | { i: number; op: "move_column"; blockId: string; toBlockId: string; where: "left" | "right"; why: string }
  // The order pass (lib/assistant/reorder.ts): top-level blocks, each named
  // by its rows and their words, and new headings (markdown), moved in this
  // order right after the top-level block that holds afterBlockId (null: the
  // document's start). The words go with their blocks, never written anew.
  | { i: number; op: "move_blocks"; afterBlockId: string | null; items: ({ blockIds: string[]; base: string[] } | { markdown: string })[]; why: string }
  // A footnote whose number goes right after the words find (at `end`).
  | { i: number; op: "insert_footnote"; blockId: string; start: number; end: number; find: string; text: string; why: string };
/** Why an op did not land. The page shows each reason in the reader's language. */
export type SkipReason = "outside" | "notFound" | "ambiguous" | "overlap" | "notText" | "changed" | "object" | "limit" | "unreadable" | "tex";
export type SuggestResult = { ops: ResolvedOp[]; warnings: string[]; summary: string };
export type SuggestEvent =
  | { stage: "read" }
  | { windows: number }
  | ({ window: number } & SuggestResult)
  | { window: number; error: string }
  | { done: true; summary: string; warnings: string[] }
  | { error: string };
