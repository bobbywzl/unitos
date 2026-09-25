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
export type SuggestFormat = "bold" | "italic" | "underline" | "strikethrough";
export type ResolvedOp =
  | { i: number; op: "replace_words"; blockId: string; start: number; end: number; find: string; text: string; why: string }
  | { i: number; op: "format_words"; blockId: string; start: number; end: number; find: string; format: SuggestFormat; why: string }
  | { i: number; op: "rewrite_block"; blockId: string; base: string; text: string; why: string }
  | { i: number; op: "replace_blocks"; blockIds: string[]; base: string[]; markdown: string; why: string }
  | { i: number; op: "insert_blocks"; afterBlockId: string | null; markdown: string; why: string }
  | { i: number; op: "remove_blocks"; blockIds: string[]; base: string[]; why: string }
  | { i: number; op: "set_style"; blockId: string; style: SuggestStyle; baseStyle: SuggestStyle; why: string };
/** Why an op did not land. The page shows each reason in the reader's language. */
export type SkipReason = "outside" | "notFound" | "ambiguous" | "overlap" | "notText" | "changed" | "object" | "limit";
export type SuggestResult = { ops: ResolvedOp[]; warnings: string[]; summary: string };
export type SuggestEvent =
  | { stage: "read" }
  | { windows: number }
  | ({ window: number } & SuggestResult)
  | { window: number; error: string }
  | { done: true; summary: string; warnings: string[] }
  | { error: string };
