// The window events that open the typing area's windows (SPEC.md §29): the
// keys, the registered commands, and other areas raise them; the typing
// area (areas/typing.tsx) listens. Find and Word count keep the names
// DOCS_EVENT gives them (extensions.ts); this module stays free of that one,
// which loads the typing extension.
export const TYPING_EVENT = {
  find: "docs:find",
  findReplace: "docs:find-replace",
  preferences: "docs:preferences",
  shortcuts: "docs:shortcuts",
  voice: "docs:voice",
  spelling: "docs:spelling",
  wordCount: "docs:word-count",
} as const;

export function fireTyping(name: (typeof TYPING_EVENT)[keyof typeof TYPING_EVENT]): void {
  window.dispatchEvent(new CustomEvent(name));
}
