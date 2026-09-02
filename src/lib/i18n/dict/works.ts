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
    "Hold the mouse and circle any part of a figure or equation: Explain deciphers the visual, a highlight color marks it, Comment and Link work like on text.",
  guideCirclePagesBody:
    "A PDF of rough handwritten notes imports as its pages, and every page is a figure: circle any part — a formula, a sketch, a margin note — then Ask a question about it in the context of the whole document, Explain it, Comment, or pick a color for a lasso highlight.",
  guideSelectHeader: "Select text — the tools appear on the left",
  guideSelectTouch:
    "On a tablet: hold a word and drag the handles to select text. The tools open under the selection, with the colors and Add to notes in the same box.",
  guideAssistant: "Assistant",
  guideAssistantBody:
    " — type or speak a command about the selection (“highlight the key claim and add a note to Thesis”). It proposes a plan; in Ask mode you approve each action before it runs, in Auto mode it runs immediately. Auto-mode notes still land pending for your review. The reply opens a small chat beside the article — keep talking in it; every turn still applies to your selection. Drag its corner to resize it freely.",
  guideExplain: "Explain",
  guideExplainBody:
    " — a short explanation of the selection, tuned to your context. Saved under Annotations; click the highlighted text any time to reopen the bubble. When the AI cites a block, the tag renders as a ¶ chip — click it to jump there.",
  guideSimplify: "Simplify",
  guideSimplifyBody:
    " — rewrites the selection in plain words, in a bubble beside the article. Each sentence in the bubble is lightly tinted: press one and it goes solid while the original sentences it restates light up in the text. The rewrite is saved under Simplified in the Annotations tab; click the highlighted text any time to reopen the bubble. Drag any bubble by its header to move it; a faint line ties each bubble to the text it came from.",
  guideExtract: "Extract",
  guideExtractBody:
    " — highlights the passages across the article that reveal what the selection focuses on. The selection keeps a solid underline; every found passage gets a dashed one plus a label chip (E1, E2, …) that jumps back to the selection. Click the selection's own chip for the extract card: the passage count and Delete.",
  guideColors: "Colors",
  guideColorsBody:
    " — highlight the selection. Type a comment first, then pick a color, and the note rides on the highlight.",
  guideComment: "Comment",
  guideCommentBody:
    " — attach a comment to the selection without a highlight. A small comment icon sits beside the text; click it to open the comment in a card.",
  guideAddTo: "Add to",
  guideAddToBody:
    " — file the selection verbatim as a note in a section you pick. No AI involved.",
  guideLink: "Link across texts",
  guideLinkBody:
    " — connect this passage to a passage in this or another document. Select the other end and press Link here. Both ends become clickable and are listed under Annotations.",
  guideVoice: "Voice",
  guideVoiceBody:
    " — the round bubble under the tools reads the highlighted text aloud, Chinese and English alike. The reading continues if you dismiss the selection; press the bubble again or the floating Stop reading control to stop.",
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
    " — a PDF of rough handwritten notes imports as its pages; AI converts them to text blocks below, keeping the notes' formatting. Say “do not convert” in the upload instructions to keep the pages as they are. Circle a spot on a page to ask about it, explain it, comment on it, or lasso highlight it.",
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
    "按住鼠标，在插图或公式的任意部分画圈：“解释”解读图像，高亮颜色标记它，“评论”和“链接”与文本上的用法相同。",
  guideCirclePagesBody:
    "粗略手写笔记的 PDF 按页面导入，每一页都是一张插图：圈出任意部分——一个公式、一幅草图、一条旁注——即可结合整篇文档提问、解释、评论，或选颜色圈选高亮。",
  guideSelectHeader: "选中文本——工具出现在左侧",
  guideSelectTouch:
    "平板上：长按一个词并拖动选择柄以选中文本。工具出现在选中内容下方，颜色和添加到笔记在同一个框内。",
  guideAssistant: "助手",
  guideAssistantBody:
    "——对选中内容输入或说出一条指令（“高亮关键论断，把笔记加到论点章节”）。它会先提出计划；“询问”模式下每个动作都由你批准后执行，“自动”模式下立即执行。“自动”模式产生的笔记仍为待定，等你审阅。回复会在文章旁打开一个小聊天——继续在里面对话即可；每一轮仍作用于你的选中内容。拖动它的一角可自由调整大小。",
  guideExplain: "解释",
  guideExplainBody:
    "——对选中内容的简短解释，贴合你的背景。保存在批注下；随时点击高亮文本可重新打开气泡。当 AI 引用某个块时，标记会显示为 ¶ 标签——点击即可跳转。",
  guideSimplify: "简化",
  guideSimplifyBody:
    "——用平实的话改写选中内容，显示在文章旁的气泡里。气泡里每个句子都有浅浅的底色：点击其中一句会变为实色，它复述的原文句子同时在文中亮起。改写保存在批注页签的“简化”下；随时点击高亮文本可重新打开气泡。按住气泡顶部可拖动它；一条淡线把每个气泡连到它来自的文本。",
  guideExtract: "提取",
  guideExtractBody:
    "——在全文中高亮揭示选中内容主旨的片段。选中内容保留实线下划线；每处找到的片段获得虚线下划线，外加一个跳回选中内容的标签（E1、E2……）。点击选中内容自己的标签可打开提取卡片：片段数与“删除”。",
  guideColors: "颜色",
  guideColorsBody: "——高亮选中内容。先输入评论，再选颜色，评论就附在高亮上。",
  guideComment: "评论",
  guideCommentBody:
    "——不加高亮，给选中内容附上评论。文本旁会出现一个小评论图标；点击它在卡片中打开评论。",
  guideAddTo: "添加到",
  guideAddToBody: "——把选中内容原样存为笔记，放进你选的章节。不涉及 AI。",
  guideLink: "跨文本链接",
  guideLinkBody:
    "——把这段文字与本文档或另一份文档中的片段连起来。选中另一端并按“链接到此”。两端都变为可点击，并列在批注下。",
  guideVoice: "语音",
  guideVoiceBody:
    "——工具下方的圆形气泡朗读选中的文本，中英文皆可。取消选中后朗读继续；再按一次气泡，或按悬浮的“停止朗读”控件即可停止。",
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
    "——粗糙手写笔记的 PDF 导入后显示页面；AI 将其转换为下方的文本块，保留笔记的格式。在上传要求中写明“不要转换”即可保持页面原样。在页面上圈选一处即可提问、解释、评论或圈选高亮。",
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
