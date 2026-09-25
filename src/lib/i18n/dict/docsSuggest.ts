// UI strings of Suggesting mode in the page editor (SPEC.md §29), in Google
// Docs' words. zh glossary: dict/common.ts — suggestion 建议 · Suggesting 建议模式.

const en = {
  suggestingMode: "Suggesting mode",
  // A suggestion's card
  suggestion: "Suggestion",
  add: "Add:",
  delete: "Delete:",
  replace: "Replace:",
  replaceWith: "with",
  move: "Move:",
  format: "Format:",
  formatOff: "remove {name}",
  acceptSuggestion: "Accept suggestion",
  rejectSuggestion: "Reject suggestion",
  indent: "Indent",
  checked: "Checked",
  unchecked: "Unchecked",
  otherFormat: "other formatting",
  // The assistant's suggestion's card, in a shared project
  askedBy: "Asked by {name}",
  // Review suggested edits
  reviewSuggestedEdits: "Review suggested edits",
  oneSuggestion: "1 suggestion",
  suggestionCount: "{n} suggestions",
  noSuggestions: "No suggestions",
  previousSuggestion: "Previous suggestion",
  nextSuggestion: "Next suggestion",
  acceptAll: "Accept all",
  rejectAll: "Reject all",
  acceptAllSuggestions: "Accept all suggestions",
  rejectAllSuggestions: "Reject all suggestions",
};

const zh: Record<keyof typeof en, string> = {
  suggestingMode: "建议模式",
  suggestion: "建议",
  add: "添加：",
  delete: "删除：",
  replace: "替换：",
  replaceWith: "为",
  move: "移动：",
  format: "格式：",
  formatOff: "去除{name}",
  acceptSuggestion: "接受建议",
  rejectSuggestion: "拒绝建议",
  indent: "缩进",
  checked: "已勾选",
  unchecked: "未勾选",
  otherFormat: "其他格式",
  askedBy: "请求人：{name}",
  reviewSuggestedEdits: "审阅建议",
  oneSuggestion: "1 条建议",
  suggestionCount: "{n} 条建议",
  noSuggestions: "没有建议",
  previousSuggestion: "上一条建议",
  nextSuggestion: "下一条建议",
  acceptAll: "全部接受",
  rejectAll: "全部拒绝",
  acceptAllSuggestions: "接受所有建议",
  rejectAllSuggestions: "拒绝所有建议",
};

export const docsSuggest = { en, zh } as const;
