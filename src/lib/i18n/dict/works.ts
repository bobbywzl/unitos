// UI strings of the works surfaces, the guide dialog, and the feedback
// button. zh glossary: dict/common.ts. Every key exists in both languages —
// zh's type enforces it. Body keys that follow a bold term carry their own
// leading separator (" — " en, "——" zh) and, where segments join, their own
// trailing space, so en output stays byte-identical to the old copy.

const en = {
  // Works shelf
  corpora: "Projects",
  newCorpusTitle: "New project title",
  create: "Create",
  newWork: "New project",
  deleteCorpusConfirm: "Delete this project and all its notes?",
  corpusTitle: "Project title",
  renameCorpus: "Rename project",
  // Work card
  sectionCountOne: "{n} section",
  sectionCountOther: "{n} sections",
  documentCountOne: "{n} document",
  documentCountOther: "{n} documents",
  pendingCount: "{n} pending",
  moreActionsFor: "More actions for {title}",
  notes: "Notes",
  rename: "Rename",
  // Welcome flow (first visit): the splash, then the nudges, one bubble at a time
  welcomeName: "Welcome {name}",
  welcomeTagline: "Unitos Notebook, your all-powerful notemaker",
  nudgeProject: "Start here: name a project and press Create. A project binds documents and notes.",
  nudgeDocument: "Add an article with +: a PDF, a web page, a video, or Google Drive.",
  nudgeGuide: "Press ? any time. It explains every function, Distill first.",
  nudgeRail:
    "The sidebar: Assistant, Notes, Distill, Graph, Annotations, Edit history. Open one and explore.",
  nudgeDone: "Got it",
  // Guide dialog
  guideLabel: "Guide",
  guideTitle: "How to dissect a document",
  guideDistillHeader: "Distill — ask the article one question",
  guideDistillBody:
    "Press Distill at the top right and ask one question. The AI scans the whole document and opens the distilled page: your question at the top, under it the quotes that answer it, each with a caption saying how it answers the question.",
  guideDistillNotesBody:
    "Click a quote to jump to its exact words. Add to notes files a quote as a pending note. The Distill tab in the side panel lists every distillation of the open document.",
  guideCircleHeader: "Circle & ask — draw on anything",
  guideCircleBody:
    "Hold and circle any part of a figure or equation. Explain reads the visual; a color marks it; Comment and Link work as on text.",
  guideCirclePagesBody:
    "Handwritten PDFs import as pages, and every page is a figure: circle a formula, a sketch, or a margin note, then Ask, Explain, Comment, or pick a color.",
  guideSelectHeader: "Select text and use the AI toolbar",
  guideAssistant: "Assistant",
  guideAssistantBody:
    "Type or speak a command about the selection. It proposes a plan: Ask mode waits for your approval, Auto mode runs it. The reply opens a chat beside the article; every turn applies to the selection.",
  guideExplain: "Explain",
  guideExplainBody:
    "A short explanation of the selection, tuned to your background. Saved under Annotations; click the highlight to reopen it.",
  guideSimplify: "Simplify",
  guideSimplifyBody:
    "Rewrites the selection in plain words in a bubble beside the article. Press a sentence to light up the original it restates. Saved under Annotations.",
  guideExtract: "Extract",
  guideExtractBody:
    "Highlights every passage in the article that reveals what the selection focuses on. Each gets a label chip (E1, E2, …) that jumps back to the selection.",
  guideColors: "Colors",
  guideColorsBody: "Highlight the selection. Type a comment first and it rides on the highlight.",
  guideComment: "Comment",
  guideCommentBody:
    "Attach a comment to the selection without a highlight. Click the comment icon beside the text to open it.",
  guideAddTo: "Add to",
  guideAddToBody: "File the selection verbatim as a note in a section you pick. No AI.",
  guideLink: "Link across texts",
  guideLinkBody:
    "Connect this passage to one in this or another document. Select the other end and press Link here.",
  guideVoice: "Voice",
  guideVoiceBody:
    "The round bubble under the tools reads the selection aloud, Chinese and English alike. Press it again to stop.",
  guideDistill: "Distill",
  guidePanelHeader: "Side panel",
  guidePanelNotesBody: " — your sections and the pending queue. ",
  guidePanelAssistantBody:
    " — ask questions at document, project, or projects scope, and run checks (contradictions, gaps). ",
  guidePanelDistillBody: " — every distillation of the open document; open one to read its quotes. ",
  guidePanelSummary: "Summary",
  guidePanelSummaryBody:
    " — the whole document summarized at the depth you pick: layman, intermediate, or professional. Each depth is kept once generated. ",
  guidePanelAnnotations: "Annotations",
  guidePanelAnnotationsBody:
    " — highlights, comments, explanations, links; Jump scrolls to the source. ",
  guidePanelEdits: "Edits",
  guidePanelEditsBody: " — the edit history.",
  // Feedback button
  feedback: "Feedback",
  sendFeedback: "Send feedback",
  feedbackBug: "bug",
  feedbackIdea: "idea",
  feedbackOther: "other",
  feedbackPlaceholder: "What happened, or what would help?",
  feedbackFailed: "Send failed. Try again.",
  feedbackSent: "Sent ✓",
  feedbackSending: "Sending…",
  feedbackSend: "Send",
  // A reply to feedback: a notification on the dashboard (SPEC.md §18). The
  // card reads this title, the feedback's message, then the reply.
  feedbackReplyTitle: "Reply to your feedback",
  // Share target: /share, where a shared URL or file lands
  shareAddTitle: "Add to a project",
  shareAddChoose: "Choose a project",
  shareAddNothing: "Nothing to add. Share a link or a PDF to Unitos from another app.",
  shareAddNoProjects: "No projects yet. Create one first.",
  shareAddGoHome: "Go to Projects",
  // Shared with you shelf
  sharedWithYou: "Shared with you",
  byOwner: "by {name}",
  sharedBadge: "Shared · {n}",
  // Notifications from the admin (SPEC.md §18), above the shelf
  notifications: "Notifications",
  dismiss: "Dismiss",
};

const zh: Record<keyof typeof en, string> = {
  // Works shelf
  corpora: "全部项目",
  newCorpusTitle: "新项目标题",
  create: "创建",
  newWork: "新建项目",
  deleteCorpusConfirm: "删除该项目及其全部笔记？",
  corpusTitle: "项目标题",
  renameCorpus: "重命名项目",
  // Work card
  sectionCountOne: "{n} 个章节",
  sectionCountOther: "{n} 个章节",
  documentCountOne: "{n} 份文档",
  documentCountOther: "{n} 份文档",
  pendingCount: "{n} 条待定",
  moreActionsFor: "{title}的更多操作",
  notes: "笔记",
  rename: "重命名",
  // Guide dialog
  welcomeName: "欢迎，{name}",
  welcomeTagline: "Unitos Notebook，你的全能笔记本",
  nudgeProject: "从这里开始：给项目起名并按“创建”。一个项目绑定文档和笔记。",
  nudgeDocument: "用 + 添加文章：PDF、网页、视频或 Google Drive。",
  nudgeGuide: "随时按 ?。它介绍全部功能，提炼排在最前。",
  nudgeRail: "侧栏：助手、笔记、提炼、图谱、批注、编辑记录。打开一个，开始探索。",
  nudgeDone: "知道了",
  guideLabel: "指南",
  guideTitle: "如何拆解一篇文档",
  guideDistillHeader: "提炼——向文章提出一个问题",
  guideDistillBody:
    "按右上角的“提炼”，提出一个问题。AI 扫描整篇文档并打开提炼页：你的问题居顶，下方是回答它的引文，每条配有说明，讲它如何回答问题。",
  guideDistillNotesBody:
    "点击引文可跳到它的原文字句。“添加到笔记”把一条引文存为待定笔记。侧栏的“提炼”页签列出当前文档的每次提炼。",
  guideCircleHeader: "圈选并提问——在任何内容上画圈",
  guideCircleBody:
    "按住并在插图或公式的任意部分画圈。“解释”解读图像；颜色标记它；“评论”和“链接”与文本上相同。",
  guideCirclePagesBody:
    "手写 PDF 按页面导入，每一页都是一张插图：圈出公式、草图或旁注，然后提问、解释、评论，或选颜色。",
  guideSelectHeader: "选中文本，使用 AI 工具栏",
  guideAssistant: "助手",
  guideAssistantBody:
    "对选中内容输入或说出一条指令。它会提出计划：“询问”模式等你批准，“自动”模式直接执行。回复在文章旁打开聊天；每一轮都作用于选中内容。",
  guideExplain: "解释",
  guideExplainBody: "对选中内容的简短解释，贴合你的背景。保存在批注下；点击高亮可重新打开。",
  guideSimplify: "简化",
  guideSimplifyBody:
    "用平实的话改写选中内容，显示在文章旁的气泡里。点击一句，它复述的原文就会亮起。保存在批注下。",
  guideExtract: "提取",
  guideExtractBody:
    "在全文中高亮揭示选中内容主旨的每处片段。每处都有一个标签（E1、E2……），点击跳回选中内容。",
  guideColors: "颜色",
  guideColorsBody: "高亮选中内容。先输入评论，评论就附在高亮上。",
  guideComment: "评论",
  guideCommentBody: "不加高亮，给选中内容附上评论。点击文本旁的评论图标即可打开。",
  guideAddTo: "添加到",
  guideAddToBody: "把选中内容原样存为笔记，放进你选的章节。不涉及 AI。",
  guideLink: "跨文本链接",
  guideLinkBody: "把这段文字与本文档或另一份文档中的片段连起来。选中另一端并按“链接到此”。",
  guideVoice: "语音",
  guideVoiceBody: "工具下方的圆形气泡朗读选中内容，中英文皆可。再按一次即停止。",
  guideDistill: "提炼",
  guidePanelHeader: "侧栏",
  guidePanelNotesBody: "——你的章节与待定队列。",
  guidePanelAssistantBody: "——在文档、项目或全部项目范围提问，并运行检查（矛盾、疏漏）。",
  guidePanelDistillBody: "——当前文档的每次提炼；打开一条即可读它的引文。",
  guidePanelSummary: "摘要",
  guidePanelSummaryBody: "——整篇文档按你选的深度摘要：通俗、进阶或专业。每个深度生成后即保留。",
  guidePanelAnnotations: "批注",
  guidePanelAnnotationsBody: "——高亮、评论、解释、链接；“跳转”滚动到出处。",
  guidePanelEdits: "编辑记录",
  guidePanelEditsBody: "——编辑历史。",
  // Feedback button
  feedback: "反馈",
  sendFeedback: "发送反馈",
  feedbackBug: "问题",
  feedbackIdea: "想法",
  feedbackOther: "其他",
  feedbackPlaceholder: "遇到了什么问题，或者希望有什么改进？",
  feedbackFailed: "发送失败。请重试。",
  feedbackSent: "已发送 ✓",
  feedbackSending: "发送中…",
  feedbackSend: "发送",
  feedbackReplyTitle: "对你反馈的回复",
  shareAddTitle: "添加到项目",
  shareAddChoose: "选择一个项目",
  shareAddNothing: "没有可添加的内容。从其他应用把链接或 PDF 分享给 Unitos。",
  shareAddNoProjects: "还没有项目。请先创建一个。",
  shareAddGoHome: "前往全部项目",
  sharedWithYou: "与你共享",
  byOwner: "来自 {name}",
  sharedBadge: "已共享 · {n}",
  // Notifications from the admin (SPEC.md §18), above the shelf
  notifications: "通知",
  dismiss: "关闭",
};

export const works = { en, zh } as const;
