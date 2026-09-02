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
  // Welcome flow (first visit)
  welcomeTitle: "Welcome to your all-powerful notebook.",
  firstStepsTitle: "First steps",
  firstStepsProject:
    "Start a new project below — one project binds the documents you read and the notes you keep.",
  firstStepsAdd:
    "Add documents with the + in the project header: PDFs, web pages, videos, Google Drive. Rough handwritten PDFs import as pages.",
  firstStepsTools:
    "Select text, or circle a spot on a figure or a handwritten page, and the AI tools appear.",
  firstStepsGuide:
    "The ? at the top right of a project explains every function — Circle & ask first.",
  firstStepsDone: "Got it",
  // Guide dialog
  guideLabel: "Guide",
  guideTitle: "How to dissect a document",
  guideCircleHeader: "Circle & ask — draw on anything",
  guideCircleBody:
    "Hold and circle any part of a figure or equation. Explain reads the visual; a color marks it; Comment and Link work as on text.",
  guideCirclePagesBody:
    "Handwritten PDFs import as pages, and every page is a figure: circle a formula, a sketch, or a margin note, then Ask, Explain, Comment, or pick a color.",
  guideSelectHeader: "Select text — the tools appear on the left",
  guideSelectTouch: "On a tablet: hold a word and drag the handles. The tools open under the selection.",
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
  guideReadingHeader: "Reading",
  guideAddUrl: "Add URL",
  guideAddUrlBody:
    " (+ in the header) — rebuilds the page in the reader: headings, lists, tables, figures, images, videos, charts, and equations, all editable. A progress card shows each step while the cat dances.",
  guideAssistantMenu: "Assistant menu",
  guideAssistantMenuBody:
    " (top left) — the Assistant pill at the top of the page opens it: Summarize article, Key takeaways, and Explain simply send the question to the assistant, which reads the whole document and answers in a chat beside the article; Ask the assistant opens the same chat for your own question; Distill opens the distilled page. The pill hides while you scroll and returns when you are back at the top.",
  guideContext: "Context",
  guideContextBody:
    " (top bar) — who you are, why you read, what the notes feed. Injected into every AI prompt: notes, distillation, analysis. Every field is optional; edit any time. Save it everywhere or for this project only.",
  guideKeyTerms: "Key terms",
  guideKeyTermsBody:
    " — dotted underlines mark the document's key terms. Hover for the definition; click for the toolbar on the term, with Extract first — recommended.",
  guideDistill: "Distill",
  guideDistillBody1:
    " (top right) — ask the article one question. The AI scans the whole document and opens the distilled page: your question large at the top, under it the quotes that answer it, each with a caption saying how it answers the question and how it sits in the document. Click a quote to jump to its exact words. Add to notes files a quote as a ",
  guideDistillBody2:
    " note with its anchor. Cancel stops a running scan and keeps the question for editing; Delete removes a stored distillation. Close the page and keep reading — a progress bar under the button shows while a distillation runs, and the Distill tab in the side tray lists every distillation of the open document.",
  guideNotesTray: "Notes tray",
  guideNotesTrayBody:
    " (right) — pending notes wait in a queue: j/k to move, Enter to accept, Backspace to reject, Undo to take a rejection back.",
  guideFigureTools: "Figure tools",
  guideFigureToolsBody:
    " — hold and draw a small circle on a figure or equation: Explain deciphers the visual, a highlight color adds a side label that jumps to Annotations, Comment and Link work like on text.",
  guideHandwritten: "Handwritten notes",
  guideHandwrittenBody:
    " — a PDF of rough handwritten notes imports as its pages; AI converts them to text blocks below, keeping the notes' formatting. Pick the import in the upload assistant: judge automatically, pages as they are, or pages + convert to text. Circle a spot on a page to ask about it, explain it, comment on it, or lasso highlight it.",
  guidePrint: "Print document",
  guidePrintBody:
    " (+ in the header) — prints the open document, article only: no app chrome, full length, highlights kept.",
  guideEditingHeader: "Editing",
  guideDoubleClick: "Double-click",
  guideDoubleClickBody:
    " any paragraph — the page becomes editable in place: headings, bold, italic, underline, bulleted and numbered lists, indent and outdent, font, insert and remove paragraphs. Changed words show in the edited color. Done or Esc returns to reading.",
  guideEditSelect: "Selecting text while editing still opens the highlight and AI tools.",
  guideEditsTab: "Edits tab",
  guideEditsTabBody:
    " — every change, newest first. Revert a text edit; restore a removed paragraph.",
  guideAnchors:
    "Highlights, comments, and links move with your edits. If the words they pointed at are gone, they say “Anchor unresolved” — they never point at the wrong words.",
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
  welcomeTitle: "欢迎来到你的全能笔记本。",
  firstStepsTitle: "开始使用",
  firstStepsProject: "在下方新建项目——一个项目绑定你阅读的文档和记下的笔记。",
  firstStepsAdd:
    "用项目页顶部的 + 添加文档：PDF、网页、视频、Google Drive。粗略手写 PDF 按页面导入。",
  firstStepsTools: "选中文本，或在插图、手写页面上圈选一处，AI 工具随即出现。",
  firstStepsGuide: "项目右上角的 ? 介绍全部功能——圈选并提问排在最前。",
  firstStepsDone: "知道了",
  guideLabel: "指南",
  guideTitle: "如何拆解一篇文档",
  guideCircleHeader: "圈选并提问——在任何内容上画圈",
  guideCircleBody:
    "按住并在插图或公式的任意部分画圈。“解释”解读图像；颜色标记它；“评论”和“链接”与文本上相同。",
  guideCirclePagesBody:
    "手写 PDF 按页面导入，每一页都是一张插图：圈出公式、草图或旁注，然后提问、解释、评论，或选颜色。",
  guideSelectHeader: "选中文本——工具出现在左侧",
  guideSelectTouch: "平板上：长按一个词并拖动选择柄。工具出现在选中内容下方。",
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
  guideReadingHeader: "阅读",
  guideAddUrl: "添加 URL",
  guideAddUrlBody:
    "（顶栏中的 +）——在阅读器中重建页面：标题、列表、表格、插图、图片、视频、图表和公式，全部可编辑。进度卡片显示每一步，小猫在一旁跳舞。",
  guideAssistantMenu: "助手菜单",
  guideAssistantMenuBody:
    "（左上）——点击页面顶部的“助手”按钮展开菜单：“总结文章”“主要收获”“通俗解释”把问题发给助手，助手通读整篇文档，在文章旁的聊天中作答；“询问助手”打开同一个聊天，供你提自己的问题；“提炼”打开提炼页。滚动时按钮隐藏，回到顶部时再出现。",
  guideContext: "背景",
  guideContextBody:
    "（顶栏）——你是谁、为什么而读、笔记的用途。注入到每个 AI 提示词中：笔记、提炼、分析。每个字段都可留空；随时可改。可保存为全局，或仅用于本项目。",
  guideKeyTerms: "关键术语",
  guideKeyTermsBody:
    "——点状下划线标出文档的关键术语。悬停查看定义；点击关键术语打开工具栏，“提取”排在最前——推荐使用。",
  guideDistill: "提炼",
  guideDistillBody1:
    "（右上）——向文章提出一个问题。AI 扫描整篇文档并打开提炼页：你的问题大字居顶，下方是回答它的引文，每条配有说明，讲它如何回答问题、以及它在文档中的位置。点击引文可跳到它的原文字句。“添加到笔记”把一条引文连同锚点存为",
  guideDistillBody2:
    "笔记。“取消”停止正在运行的扫描并保留问题以便修改；“删除”移除已保存的提炼。关闭该页可继续阅读——提炼运行时按钮下方显示进度条，侧栏的“提炼”页签列出当前文档的每次提炼。",
  guideNotesTray: "笔记栏",
  guideNotesTrayBody:
    "（右侧）——待定笔记排成队列：j/k 移动，Enter 接受，Backspace 拒绝，“撤销”收回一次拒绝。",
  guideFigureTools: "插图工具",
  guideFigureToolsBody:
    "——在插图或公式上按住并画一个小圈：“解释”解读图像，高亮颜色加一个跳到批注的侧边标签，“评论”和“链接”与文本上的用法相同。",
  guideHandwritten: "手写笔记",
  guideHandwrittenBody:
    "——粗糙手写笔记的 PDF 导入后显示页面；AI 将其转换为下方的文本块，保留笔记的格式。在上传助手中选择导入方式：自动判断、页面原样，或页面 + 转换为文本。在页面上圈选一处即可提问、解释、评论或圈选高亮。",
  guidePrint: "打印文档",
  guidePrintBody:
    "（顶栏中的 +）——打印当前打开的文档，只含文章：无应用界面，完整长度，保留高亮。",
  guideEditingHeader: "编辑",
  guideDoubleClick: "双击",
  guideDoubleClickBody:
    "任意段落——页面变为可就地编辑：标题、加粗、斜体、下划线、无序和有序列表、增减缩进、字体、插入和删除段落。改过的词以编辑色显示。“完成”或 Esc 返回阅读。",
  guideEditSelect: "编辑时选中文本，仍会打开高亮和 AI 工具。",
  guideEditsTab: "编辑记录页签",
  guideEditsTabBody: "——每处改动，最新在前。可还原一次文本编辑；可恢复被删除的段落。",
  guideAnchors:
    "高亮、评论和链接会随你的编辑移动。如果它们指向的文字已不在，会显示“锚点无法定位”——绝不指向错误的文字。",
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
  shareAddTitle: "添加到项目",
  shareAddChoose: "选择一个项目",
  shareAddNothing: "没有可添加的内容。从其他应用把链接或 PDF 分享给 Unitos。",
  shareAddNoProjects: "还没有项目。请先创建一个。",
  shareAddGoHome: "前往全部项目",
  sharedWithYou: "与你共享",
  byOwner: "来自 {name}",
  sharedBadge: "已共享 · {n}",
};

export const works = { en, zh } as const;
