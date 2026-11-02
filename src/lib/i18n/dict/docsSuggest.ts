// UI strings of Suggesting mode in the page editor (SPEC.md §29), in Google
// Docs' words. zh glossary: dict/common.ts — suggestion 建议 · Suggesting 建议模式.

export const en = {
  suggestingMode: "Suggesting mode",
  // A suggestion's card
  suggestion: "Suggestion",
  add: "Add:",
  delete: "Delete:",
  replace: "Replace:",
  replaceWith: "with",
  addFootnote: "Add footnote:",
  move: "Move:",
  format: "Format:",
  formatOff: "remove {name}",
  acceptSuggestion: "Accept suggestion",
  rejectSuggestion: "Reject suggestion",
  indent: "Indent",
  checked: "Checked",
  unchecked: "Unchecked",
  otherFormat: "other formatting",
  // The assistant's suggestions: the card, in a shared project, and an op
  // the page skipped (suggest/assistant.ts)
  askedBy: "Asked by {name}",
  skipChanged: "Skipped: the words changed while the assistant worked. ({why})",
  pageClosed: "The suggestions did not land: the page closed before they arrived. Ask again.",
  streamEnded: "The connection ended before the assistant finished. The suggestions that landed stay; ask again for the rest.",
  skipObject: "Skipped: the words hold an object the assistant cannot change. ({why})",
  // Review suggested edits
  reviewSuggestedEdits: "Review suggested edits",
  oneSuggestion: "1 suggestion",
  suggestionCount: "{n} suggestions",
  noSuggestions: "No suggestions",
  assistantSuggestions: "Assistant suggestions",
  noneLanded: "No suggestion landed.",
  previousSuggestion: "Previous suggestion",
  nextSuggestion: "Next suggestion",
  acceptAll: "Accept all",
  rejectAll: "Reject all",
  acceptAllSuggestions: "Accept all suggestions",
  rejectAllSuggestions: "Reject all suggestions",
};
