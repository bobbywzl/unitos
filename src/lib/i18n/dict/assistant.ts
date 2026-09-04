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
  scopeCorpusLabel: "Project",
  scopeCorpusHint:
    "This project: every document in full, plus every note, annotation, and distillation.",
  scopeCorporaLabel: "Projects",
  scopeCorporaHint:
    "All your projects: every document, note, annotation, and distillation across all works.",
  // Ask
  askPlaceholderCorpus: "Ask about this project",
  askPlaceholderCorpora: "Ask across your projects",
  ask: "Ask",
  stopAsk: "Stop. Whatever answered so far stays on screen.",
  // Tasks: button labels, then the noun inside noTaskFound
  taskContradictions: "Contradictions",
  taskGaps: "Gaps",
  taskUnsourced: "Unsourced",
  taskContradictionsTitle: "Find notes in this project that contradict each other",
  taskGapsTitle: "Find gaps in the notes: thin sections, claims without support, open questions",
  taskUnsourcedTitle: "Find accepted notes that state facts with no source",
  regenerateTitle: "Write this again; the current one is replaced",
  showNoteTitle: "Show this note in the notes tray",
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
  scopeCorpusLabel: "项目",
  scopeCorpusHint: "此项目：每篇文档的全文，以及每条笔记、批注和提炼。",
  scopeCorporaLabel: "全部项目",
  scopeCorporaHint: "你的全部项目：每个项目里的每篇文档、笔记、批注和提炼。",
  askPlaceholderCorpus: "就此项目提问",
  askPlaceholderCorpora: "跨全部项目提问",
  ask: "提问",
  stopAsk: "停止。已作答的部分保留在屏幕上。",
  taskContradictions: "矛盾",
  taskGaps: "疏漏",
  taskUnsourced: "无出处",
  taskContradictionsTitle: "找出此项目中相互矛盾的笔记",
  taskGapsTitle: "找出笔记的疏漏：内容单薄的章节、缺少支撑的论断、悬而未答的问题",
  taskUnsourcedTitle: "找出陈述事实却没有出处的已接受笔记",
  regenerateTitle: "重新生成；当前内容会被替换",
  showNoteTitle: "在笔记栏中显示此笔记",
  taskNounContradictions: "矛盾",
  taskNounGaps: "疏漏",
  taskNounUnsourced: "无出处的笔记",
  noTaskFound: "未发现{task}。很干净。",
  noteChip: "笔记 {id}",
  emptyResponse: "模型返回了空响应。请重试。",
  requestFailedStatus: "请求失败（{status}）",
  assistantFailed: "助手请求失败",
  assistantFailedStatus: "助手请求失败（{status}）",
  taskFailed: "任务失败",
  taskFailedStatus: "任务失败（{status}）",
};

export const assistant = { en, zh } as const;
