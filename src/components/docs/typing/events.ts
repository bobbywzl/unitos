// The window events that open the typing area's windows (SPEC.md §29),
// raised by keys, commands, and other areas; areas/typing.tsx and
// word-count.tsx listen.
export const TYPING_EVENT = {
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
