// UI strings of the assistant surfaces. zh glossary: dict/common.ts. Every key
// exists in both languages — zh's type enforces it.

const en = {
  // Recommended functions
  recommended: "Recommended",
  recInsightsLabel: "Insiders Insights",
  recInsightsHint: "Findings only an industry insider would catch — honest when there are none",
  recLaymanLabel: "Layman summary",
  recLaymanHint: "The core of the document, in plain words",
  recProfessionalLabel: "Professional summary",
  recProfessionalHint: "In the author's own industry wording",
  // Scope control
  scopeCorpusLabel: "Corpus",
  scopeCorpusHint:
    "This corpus: every document in full, plus every note, annotation, and distillation.",
  scopeCorporaLabel: "Corpora",
  scopeCorporaHint:
    "All your corpora: every document, note, annotation, and distillation across all works.",
  // Ask
  askPlaceholderCorpus: "Ask about this corpus",
  askPlaceholderCorpora: "Ask across your corpora",
  ask: "Ask",
  // Tasks: button labels, then the noun inside noTaskFound
  taskContradictions: "Contradictions",
  taskGaps: "Gaps",
  taskUnsourced: "Unsourced",
  taskNounContradictions: "contradictions",
  taskNounGaps: "gaps",
  taskNounUnsourced: "unsourced",
  noTaskFound: "No {task} found. Clean.",
  noteChip: "note {id}",
  // Errors
  emptyResponse: "The model returned an empty response. Try again.",
  requestFailedStatus: "Request failed ({status})",
  assistantFailed: "Assistant failed",
  assistantFailedStatus: "Assistant failed ({status})",
  taskFailed: "Task failed",
  taskFailedStatus: "Task failed ({status})",
};

const zh: Record<keyof typeof en, string> = {
  recommended: "推荐",
  recInsightsLabel: "行家洞见",
  recInsightsHint: "只有业内行家才能看出的发现——没有时如实说明",
  recLaymanLabel: "通俗摘要",
  recLaymanHint: "用大白话讲出文档的核心",
  recProfessionalLabel: "专业摘要",
  recProfessionalHint: "用作者所在行业的措辞",
  scopeCorpusLabel: "文集",
  scopeCorpusHint: "此文集：每篇文档的全文，以及每条笔记、批注和提炼。",
  scopeCorporaLabel: "全部文集",
  scopeCorporaHint: "你的全部文集：所有作品里的每篇文档、笔记、批注和提炼。",
  askPlaceholderCorpus: "就此文集提问",
  askPlaceholderCorpora: "跨全部文集提问",
  ask: "提问",
  taskContradictions: "矛盾",
  taskGaps: "疏漏",
  taskUnsourced: "无出处",
  taskNounContradictions: "矛盾",
  taskNounGaps: "疏漏",
  taskNounUnsourced: "无出处的笔记",
  noTaskFound: "未发现{task}。干净。",
  noteChip: "笔记 {id}",
  emptyResponse: "模型返回了空响应。请重试。",
  requestFailedStatus: "请求失败（{status}）",
  assistantFailed: "助手失败",
  assistantFailedStatus: "助手失败（{status}）",
  taskFailed: "任务失败",
  taskFailedStatus: "任务失败（{status}）",
};

export const assistant = { en, zh } as const;
