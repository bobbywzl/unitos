// UI strings of the works surfaces, the guide dialog, and the feedback
// button. zh glossary: dict/common.ts. Every key exists in both languages —
// zh's type enforces it. Body keys that follow a bold term carry their own
// leading separator (" — " en, "——" zh) and, where segments join, their own
// trailing space, so en output stays byte-identical to the old copy.

const en = {
  // Works shelf
  corpora: "Corpora",
  newCorpusTitle: "New corpus title",
  create: "Create",
  newWork: "New work",
  deleteCorpusConfirm: "Delete this corpus and all its notes?",
  corpusTitle: "Corpus title",
  renameCorpus: "Rename corpus",
  // Work card
  sectionCountOne: "{n} section",
  sectionCountOther: "{n} sections",
  documentCountOne: "{n} document",
  documentCountOther: "{n} documents",
  pendingCount: "{n} pending",
  moreActionsFor: "More actions for {title}",
  notes: "Notes",
  rename: "Rename",
  // Guide dialog
  guideLabel: "Guide",
  guideTitle: "How to dissect a document",
  guideSelectHeader: "Select text — the tools appear on the left",
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
    " (top left) — floats open at the top of the page: Summarize article, Key takeaways, and Explain simply send the question to the assistant, which reads the whole document and answers in a chat beside the article; Ask the assistant opens the same chat for your own question; Distill opens the distilled page. The menu hides while you scroll and returns when you are back at the top.",
  guideContext: "Context",
  guideContextBody:
    " (top bar) — who you are, why you read, what the notes feed. Injected into every AI prompt: notes, distillation, analysis. Every field is optional; edit any time. Save it everywhere or for this corpus only.",
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
    " — ask questions at document, corpus, or corpora scope, and run checks (contradictions, gaps). ",
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
};

const zh: Record<keyof typeof en, string> = {
  // Works shelf
  corpora: "全部文集",
  newCorpusTitle: "新文集标题",
  create: "创建",
  newWork: "新建文集",
  deleteCorpusConfirm: "删除该文集及其全部笔记？",
  corpusTitle: "文集标题",
  renameCorpus: "重命名文集",
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
  guideLabel: "指南",
  guideTitle: "如何拆解一篇文档",
  guideSelectHeader: "选中文本——工具出现在左侧",
  guideAssistant: "助手",
  guideAssistantBody:
    "——对选中内容输入或说出一条指令（“高亮关键论断，把笔记加到论点章节”）。它会先提出计划；Ask 模式下每个动作都由你批准后执行，Auto 模式下立即执行。Auto 模式产生的笔记仍为待定，等你审阅。回复会在文章旁打开一个小聊天——继续在里面对话即可；每一轮仍作用于你的选中内容。拖动它的一角可自由调整大小。",
  guideExplain: "解释",
  guideExplainBody:
    "——对选中内容的简短解释，贴合你的语境。保存在批注下；随时点击高亮文本可重新打开气泡。当 AI 引用某个块时，标记会显示为 ¶ 标签——点击即可跳转。",
  guideSimplify: "简化",
  guideSimplifyBody:
    "——用平实的话改写选中内容，显示在文章旁的气泡里。气泡里每个句子都有浅浅的底色：按下一句会变为实色，它复述的原文句子同时在文中亮起。改写保存在批注页签的“简化”下；随时点击高亮文本可重新打开气泡。按住气泡顶部可拖动它；一条淡线把每个气泡连到它来自的文本。",
  guideExtract: "提取",
  guideExtractBody:
    "——在全文中高亮揭示选中内容主旨的段落。选中内容保留实线下划线；每处找到的段落获得虚线下划线，外加一个跳回选中内容的标签（E1、E2……）。点击选中内容自己的标签可打开提取卡片：段落数与“删除”。",
  guideColors: "颜色",
  guideColorsBody: "——高亮选中内容。先输入评论，再选颜色，这条笔记就附在高亮上。",
  guideComment: "评论",
  guideCommentBody:
    "——不加高亮，给选中内容附上评论。文本旁会出现一个小评论图标；点击它在卡片中打开评论。",
  guideAddTo: "添加到",
  guideAddToBody: "——把选中内容原样存为笔记，放进你选的章节。不涉及 AI。",
  guideLink: "跨文本链接",
  guideLinkBody:
    "——把这段文字与本文档或另一份文档中的段落连起来。选中另一端并按“链接到此”。两端都变为可点击，并列在批注下。",
  guideVoice: "语音",
  guideVoiceBody:
    "——工具下方的圆形气泡朗读高亮文本，中英文皆可。取消选中后朗读继续；再按一次气泡，或按悬浮的“停止朗读”控件即可停止。",
  guideReadingHeader: "阅读",
  guideAddUrl: "添加 URL",
  guideAddUrlBody:
    "（顶栏中的 +）——在阅读器中重建页面：标题、列表、表格、图示、图片、视频、图表和公式，全部可编辑。进度卡片显示每一步，小猫在一旁跳舞。",
  guideAssistantMenu: "助手菜单",
  guideAssistantMenuBody:
    "（左上）——悬浮展开在页面顶部：“总结文章”“关键要点”“通俗解释”把问题发给助手，助手通读整篇文档，在文章旁的聊天中作答；“询问助手”打开同一个聊天，供你提自己的问题；“提炼”打开提炼页。滚动时菜单隐藏，回到顶部时再出现。",
  guideContext: "语境",
  guideContextBody:
    "（顶栏）——你是谁、为何而读、笔记的用途。注入每个 AI 提示词：笔记、提炼、分析。每个字段都可留空；随时可改。可保存为全局，或仅用于本文集。",
  guideKeyTerms: "术语",
  guideKeyTermsBody:
    "——虚线下划线标出文档的术语。悬停查看定义；点击在术语上打开工具栏，“提取”排在最前——推荐使用。",
  guideDistill: "提炼",
  guideDistillBody1:
    "（右上）——向文章提出一个问题。AI 扫描整篇文档并打开提炼页：你的问题大字居顶，下方是回答它的引文，每条配有说明，讲它如何回答问题、以及它在文档中的位置。点击引文可跳到它的原文字句。“添加到笔记”把一条引文连同锚点存为",
  guideDistillBody2:
    "笔记。“取消”停止正在运行的扫描并保留问题以便修改；“删除”移除已保存的提炼。关闭该页可继续阅读——提炼运行时按钮下方显示进度条，侧栏的“提炼”页签列出当前文档的每次提炼。",
  guideNotesTray: "笔记侧栏",
  guideNotesTrayBody:
    "（右侧）——待定笔记排成队列：j/k 移动，Enter 接受，Backspace 拒绝，“撤销”收回一次拒绝。",
  guideFigureTools: "图示工具",
  guideFigureToolsBody:
    "——在图示或公式上按住并画一个小圈：“解释”解读图像，高亮颜色加一个跳到批注的侧边标签，“评论”和“链接”与文本上的用法相同。",
  guidePrint: "打印文档",
  guidePrintBody:
    "（顶栏中的 +）——打印当前打开的文档，只含文章：无应用界面，完整长度，保留高亮。",
  guideEditingHeader: "编辑",
  guideDoubleClick: "双击",
  guideDoubleClickBody:
    "任意段落——页面变为可就地编辑：标题、加粗、斜体、下划线、无序和有序列表、增减缩进、字体、插入和删除段落。改过的词以编辑色显示。“完成”或 Esc 返回阅读。",
  guideEditSelect: "编辑时选中文本，仍会打开高亮和 AI 工具。",
  guideEditsTab: "编辑页签",
  guideEditsTabBody: "——每处改动，最新在前。可还原一次文本编辑；可恢复被删除的段落。",
  guideAnchors:
    "高亮、评论和链接会随你的编辑移动。如果它们指向的文字已不在，会显示“锚点未解析”——绝不指向错误的文字。",
  guidePanelHeader: "侧栏",
  guidePanelNotesBody: "——你的章节与待定队列。",
  guidePanelAssistantBody: "——在文档、文集或全部文集范围提问，并运行检查（矛盾、缺口）。",
  guidePanelDistillBody: "——当前文档的每次提炼；打开一条即可读它的引文。",
  guidePanelSummary: "摘要",
  guidePanelSummaryBody: "——整篇文档按你选的深度摘要：通俗、进阶或专业。每个深度生成后即保留。",
  guidePanelAnnotations: "批注",
  guidePanelAnnotationsBody: "——高亮、评论、解释、链接；“跳转”滚动到出处。",
  guidePanelEdits: "编辑",
  guidePanelEditsBody: "——编辑历史。",
  // Feedback button
  feedback: "反馈",
  sendFeedback: "发送反馈",
  feedbackBug: "问题",
  feedbackIdea: "想法",
  feedbackOther: "其他",
  feedbackPlaceholder: "发生了什么，或者什么会有帮助？",
  feedbackFailed: "发送失败。请重试。",
  feedbackSent: "已发送 ✓",
  feedbackSending: "发送中…",
  feedbackSend: "发送",
};

export const works = { en, zh } as const;
