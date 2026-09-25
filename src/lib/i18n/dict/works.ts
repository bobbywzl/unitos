// UI strings of the works surfaces, the guide dialog, and the feedback
// button. zh glossary: dict/common.ts. Every key exists in both languages —
// zh's type enforces it. In the guide dialog every tool and every side panel
// tab is one card: a name key and a body key that stands alone.

const en = {
  // Works shelf
  corpora: "Projects",
  newWork: "New project",
  untitledProject: "Untitled project",
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
  projectActions: "Project actions",
  notes: "Notes",
  rename: "Rename",
  // Offline copy (SPEC.md §17, Unitos Ultra): the menu item, the card's badge
  saveOffline: "Save for offline",
  removeOffline: "Remove offline copy",
  savingOffline: "Saving for offline…",
  savingOfflinePages: "Saving pages…",
  savingOfflineFiles: "Saving images…",
  offlineBadge: "Offline",
  offlineNeedsUltra: "Save for offline is Unitos Ultra.",
  offlineSaved: "Saved for offline. It opens without a connection.",
  offlineSaveFailed: "Save for offline failed. Try again.",
  // Welcome flow (first visit): the splash, then the nudges — the onboarding
  // feature look: the target glows, one small translucent caption beside it
  welcomeName: "Welcome {name}",
  welcomeTagline: "Unitos Notebook, your all-powerful notemaker",
  nudgeProject: "Start here: press New project. A project binds documents and notes.",
  nudgeDocument: "Add more documents with +: a PDF, a web page, a video, or Google Drive.",
  nudgeSelect: "Select any passage of the text. A toolbar appears: the Assistant, Explain, Simplify, Comment, and colors.",
  nudgeRail:
    "The side panel: Assistant, Graph, Notes, Annotations, Extract, Edit history. Open one and explore.",
  nudgeTools:
    "Extract answers one question with quotes. Contents, top left, jumps to any part of the article.",
  nudgeMerge: "Hold a note over another note until the ring closes. The two join into one note.",
  nudgeFloat: "Hold a note and drag it onto the article. The note floats there while you read.",
  nudgeFullPage: "The four arrows open the notes full page: every note of the project, and each section as a board.",
  nudgeBoard: "Click a section's title to open it as a board: its notes side by side, filling the screen.",

  // Companions (SPEC.md §23): the web apps for the steps around dissecting a
  // document that Unitos does not do, under Projects on the dashboard.
  companions: "Companions",
  companionsIntro:
    "Web apps for the steps around a document that Unitos does not do. Each opens in a new tab.",
  companionsBefore: "Before the reading",
  companionsAfter: "After the reading",
  companionSponsored: "Sponsored",
  companionMathpix:
    "A photo of handwriting or maths becomes text and LaTeX. Unitos converts a whole handwritten PDF; this is for one formula.",
  companionPdf24:
    "Split, merge, rotate, and OCR a PDF before it goes into a project. Unitos takes a PDF whole.",
  companionConnectedPapers:
    "The papers around one paper, for deciding what is worth dissecting in the first place.",
  companionDeepl:
    "Translate loose text and whole files. Unitos translates an open document's blocks, not a file you are sending on.",
  companionOverleaf: "Write the LaTeX the notes feed, with the notes beside it.",
  companionZotero: "Keep and cite the references a project's documents rest on.",
  companionAnki: "Turn the notes into cards that come back until they stick.",
  nudgeSettings: "Settings live under More. Open it to connect Google Drive.",
  nudgeDrive: "Link Google Drive: add a file straight from your Drive, no download.",
  nudgeDone: "Got it",
  // Guide dialog
  guideLabel: "Guide",
  guideTitle: "How to dissect a document",
  guideDistillHeader: "Extract — ask the article one question",
  guideDistillBody:
    "Press Extract at the top right and ask one question. The AI scans the whole document and opens the extract page: your question at the top, under it the quotes that answer it, each with a caption saying how it answers the question.",
  guideDistillNotesBody:
    "Click a quote to jump to its exact words. Add to notes files a quote as a pending note. The Extract tab in the side panel lists every extraction of the open document.",
  guideCircleHeader: "Circle & ask — draw on anything",
  guideCircleBody:
    "Hold and circle any part of a figure or equation. The Assistant reads the visual and answers; Analyze reads a figure or table in three sections; Explain deciphers the visual; a color marks it; Comment and Link work as on text.",
  guideCirclePagesBody:
    "Handwritten PDFs import as pages, and every page is a figure: circle a formula, a sketch, or a margin note, then Ask, Explain, Comment, or pick a color.",
  guideSelectHeader: "Select text and use the AI toolbar",
  guideDefine: "Define",
  guideDefineBody:
    "Shows when the selection is one word or one phrase: the first row, under the highlight colors. The meaning the word has in this sentence, in plain words, tuned to your background. A key term shows the glossary's definition. Nothing is saved.",
  guideAssistant: "Assistant",
  guideAssistantBody:
    "Type or speak a question or a command about the selection. A question is answered from the passages across the article that match the selection, each cited with a ¶ chip that jumps to it. A command proposes a plan: Ask mode waits for your approval, Auto mode runs it. The reply opens a chat beside the article; every turn applies to the selection.",
  guideExplain: "Explain",
  guideExplainBody:
    "A short explanation of the selection, tuned to your background. Saved under Annotations; click the highlight to reopen it.",
  guideSimplify: "Simplify",
  guideSimplifyBody:
    "Rewrites the selection in plain words in a bubble beside the article. Press a sentence to light up the original it restates. Saved under Annotations.",
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
  guideDistill: "Extract",
  guidePanelHeader: "Side panel",
  guidePanelNotesBody:
    "The open document's notes: the notes written in it and the notes that quote it, under your sections, with the pending queue on top. Hold a note to pick it up and drag it; a line says where it lands. Hold it over another note: a ring draws around that note, and at the full ring the two join into one note. Drop a note on the article to float it there. Select notes with the circle at their top right to merge, pin, or delete them together. The four arrows open the notes full page: every note of the project, and By document — the notes as a grid, one column per document, one row per section, to compare across documents.",
  guidePanelAssistantBody:
    "Ask about this page or the whole project, and run checks (contradictions, gaps). Conversations, at the top, lists your conversations of the project; click one to open it. New conversation starts an empty one and keeps the old one. Right above the box: the scope, then Fast Thinking or Deep Thinking, and Web.",
  guidePanelDistillBody: "Every extraction of the open document; open one to read it.",
  guidePanelSummary: "Summary",
  guidePanelSummaryBody:
    "The whole document summarized at the depth you pick: layman, intermediate, or professional. Each depth is kept once generated.",
  guidePanelAnnotations: "Annotations",
  guidePanelAnnotationsBody:
    "Highlights, comments, explanations, links; Jump scrolls to the source. Every kind carries one color everywhere — the mark in the text, the card, the tab: comment blue, explain red, simplify green, analyze teal, visualize magenta, assistant violet; a highlight keeps its own hue. Drag an annotation by its grip onto a note: the note gets the quote, a row that opens the annotation, and its text. The four arrows open the annotations full page: every annotation of the project, grouped by document.",
  guidePanelEdits: "Edits",
  guidePanelEditsBody: "The edit history.",
  // Collapse (SPEC.md §28) and Contents (SPEC.md §26): the article's own controls.
  guideCollapseHeader: "Collapse — every block to its core",
  guideCollapseBody:
    "The Collapse button at the top right of the article, beside Extract. Every paragraph, list, figure, table, and equation shows its core: what it really says, in plain words, at a tenth to a third of its length, written in the light of the whole article.",
  guideCollapseWholeBody:
    "Click a collapsed block to read it whole; the chip under it folds it again. Press Collapse again to show the article whole. Contents, at the top left, lists the article's parts and stays there as you scroll.",
  // The release notifications (SPEC.md §18, lib/releases.ts): one per release, on the dashboard.
  release20260924Title: "New: Collapse, the annotations full page, By document, Conversations",
  release20260924Body:
    "- **Collapse** — the button at the top right of the article, beside Extract. Every block shows its core: what it really says, in plain words. Click a collapsed block to read it whole.\n- **Annotations full page** — the four arrows in the Annotations tab: every annotation of the project, grouped by document. Every kind of annotation now carries one color everywhere: comment blue, explain red, simplify green, analyze teal, visualize magenta, assistant violet.\n- **By document** — on the notes full page: the project's notes as a grid, one column per document, one row per section. The notes tray now shows the open document's notes only.\n- **Conversations** — at the top of the Assistant tab: your conversations of the project, one click to open each. New conversation keeps the old one. The scope and thinking rows sit right above the box.\n- **Drag an annotation onto a note** — the note gets the quote, a row that opens the annotation, and the annotation's text.\n- **Contents** stays at the top left as you scroll.\n\nThe controls that are new glow until you press them. Press ? at the top of the reader for the guide.",
  release20260925Title: "New: Define",
  release20260925Body:
    "- **Define** — select one word or one phrase in any document: an article, a PDF, a transcript, slides, a sheet. Define is the first row of the AI toolbar, under the highlight colors. It gives the meaning the word has in that sentence, in plain words, tuned to your background. A key term shows the glossary's definition at once. Nothing is saved.\n\nThe controls that are new glow until you press them. Press ? at the top of the reader for the guide.",
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
  // Photos and links on feedback (SPEC.md §18)
  feedbackAddPhoto: "Add photo",
  feedbackAddPhotoTitle: "Attach a photo: a screenshot of what happened",
  feedbackAddLink: "Add link",
  feedbackLinkPlaceholder: "Paste a link, then press Enter",
  feedbackLinkInvalid: "That is not a link. It must start with http:// or https://.",
  feedbackPhotoFailed: "The photo did not upload. Try again.",
  feedbackPhotoLimit: "At most {n} photos.",
  feedbackLinkLimit: "At most {n} links.",
  feedbackRemovePhoto: "Remove this photo",
  feedbackRemoveLink: "Remove this link",
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
  newWork: "新建项目",
  untitledProject: "未命名项目",
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
  projectActions: "项目操作",
  notes: "笔记",
  rename: "重命名",
  // Offline copy (SPEC.md §17, Unitos Ultra): the menu item, the card's badge
  saveOffline: "离线保存",
  removeOffline: "移除离线副本",
  savingOffline: "正在离线保存…",
  savingOfflinePages: "正在保存页面…",
  savingOfflineFiles: "正在保存图片…",
  offlineBadge: "离线",
  offlineNeedsUltra: "离线保存是 Unitos Ultra 功能。",
  offlineSaved: "已离线保存。无网络时也能打开。",
  offlineSaveFailed: "离线保存失败。请重试。",
  // Guide dialog
  welcomeName: "欢迎，{name}",
  welcomeTagline: "Unitos Notebook，你的全能笔记本",
  nudgeProject: "从这里开始：按“新建项目”。一个项目绑定文档和笔记。",
  nudgeDocument: "用 + 添加更多文档：PDF、网页、视频或 Google Drive。",
  nudgeSelect: "选中正文中的任意一段。工具栏随即出现：助手、解释、简化、评论和颜色。",
  nudgeRail: "侧栏：助手、图谱、笔记、批注、提取、编辑记录。打开一个，开始探索。",
  nudgeTools: "提取用引文回答一个问题。左上角的目录可跳转到文章的任何部分。",
  nudgeMerge: "把一条笔记压在另一条上按住，直到合并环合拢。两条会合并成一条。",
  nudgeFloat: "按住一条笔记，拖到文章上。笔记会浮在文章上，边读边写。",
  nudgeFullPage: "四向箭头打开整页笔记：项目的每条笔记，以及每个章节的看板。",
  nudgeBoard: "点击章节标题即以看板打开它：笔记并排铺满屏幕。",

  companions: "配套应用",
  companionsIntro: "围绕文档、但 Unitos 不做的那些环节所用的网页应用。每个都在新标签页打开。",
  companionsBefore: "阅读之前",
  companionsAfter: "阅读之后",
  companionSponsored: "赞助",
  companionMathpix:
    "把手写或数学公式的照片变成文本和 LaTeX。Unitos 转换整份手写 PDF；这个用来处理单个公式。",
  companionPdf24: "在 PDF 加入项目之前拆分、合并、旋转、OCR。Unitos 整份接收 PDF。",
  companionConnectedPapers: "围绕某篇论文的相关论文，用来先判断值得剖析哪一篇。",
  companionDeepl:
    "翻译零散文本和整个文件。Unitos 翻译已打开文档的块，不翻译你要转发出去的文件。",
  companionOverleaf: "把笔记支撑的 LaTeX 写出来，笔记就在旁边。",
  companionZotero: "保存并引用项目文档所依据的参考文献。",
  companionAnki: "把笔记变成反复出现、直到记住的卡片。",
  nudgeSettings: "设置在“更多”里。打开它，连接 Google Drive。",
  nudgeDrive: "连接 Google Drive：直接从云端硬盘添加文件，无需下载。",
  nudgeDone: "知道了",
  guideLabel: "指南",
  guideTitle: "如何拆解一篇文档",
  guideDistillHeader: "提取——向文章提出一个问题",
  guideDistillBody:
    "按右上角的“提取”，提出一个问题。AI 扫描整篇文档并打开提取页：你的问题居顶，下方是回答它的引文，每条配有说明，讲它如何回答问题。",
  guideDistillNotesBody:
    "点击引文可跳到它的原文字句。“添加到笔记”把一条引文存为待定笔记。侧栏的“提取”页签列出当前文档的每次提取。",
  guideCircleHeader: "圈选并提问——在任何内容上画圈",
  guideCircleBody:
    "按住并在插图或公式的任意部分画圈。助手解读图像并回答；“分析”分三段解读插图或表格；“解释”解读图像；颜色标记它；“评论”和“链接”与文本上相同。",
  guideCirclePagesBody:
    "手写 PDF 按页面导入，每一页都是一张插图：圈出公式、草图或旁注，然后提问、解释、评论，或选颜色。",
  guideSelectHeader: "选中文本，使用 AI 工具栏",
  guideDefine: "定义",
  guideDefineBody:
    "选中一个词或一个短语时出现：第一行，在高亮颜色下方。用大白话给出这个词在这句话里的意思，贴合你的背景。关键术语显示术语表里的定义。不保存。",
  guideAssistant: "助手",
  guideAssistantBody:
    "对选中内容输入或说出一个问题或一条指令。问题会根据全文中与选中内容匹配的片段作答，每处片段带一个 ¶ 标记，点击即可跳转。指令会提出计划：“询问”模式等你批准，“自动”模式直接执行。回复在文章旁打开聊天；每一轮都作用于选中内容。",
  guideExplain: "解释",
  guideExplainBody: "对选中内容的简短解释，贴合你的背景。保存在批注下；点击高亮可重新打开。",
  guideSimplify: "简化",
  guideSimplifyBody:
    "用平实的话改写选中内容，显示在文章旁的气泡里。点击一句，它复述的原文就会亮起。保存在批注下。",
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
  guideDistill: "提取",
  guidePanelHeader: "侧栏",
  guidePanelNotesBody:
    "当前文档的笔记：在它里面写下的笔记和引用它的笔记，按你的章节排列，待定队列在最上面。按住一条笔记即可拿起并拖动；落位线说明它会落在哪里。把它压在另一条笔记上按住：那条笔记周围会画出合并环，合拢时两条合并为一条。把笔记放到文章上即浮动。用笔记右上角的圆圈选中笔记，可一起合并、置顶或删除。四个箭头打开整页笔记：项目的每一条笔记，以及按文档——笔记排成网格，每个文档一列，每个章节一行，用来跨文档对比。",
  guidePanelAssistantBody:
    "就此页面或整个项目提问，并运行检查（矛盾、疏漏）。顶部的对话列表列出你在此项目中的对话；点击一段即可打开。新对话会开始一段空对话，并保留当前对话。输入框正上方：范围，然后是快速思考或深度思考，以及联网。",
  guidePanelDistillBody: "当前文档的每次提取；打开一条即可阅读。",
  guidePanelSummary: "摘要",
  guidePanelSummaryBody: "整篇文档按你选的深度摘要：通俗、进阶或专业。每个深度生成后即保留。",
  guidePanelAnnotations: "批注",
  guidePanelAnnotationsBody:
    "高亮、评论、解释、链接；“跳转”滚动到出处。每类批注在各处都用同一种颜色——文本中的标记、卡片、页签：评论蓝、解释红、简化绿、分析青、可视化品红、助手紫；高亮保留自己的色调。拖动批注的把手放到笔记上：笔记会得到引文、一条打开批注的批注链接和批注内容。四个箭头打开整页批注：项目里的每条批注，按文档分组。",
  guidePanelEdits: "编辑记录",
  guidePanelEditsBody: "编辑历史。",
  guideCollapseHeader: "折叠——每个块折叠为核心",
  guideCollapseBody:
    "文章右上角、提取旁边的折叠按钮。每个段落、列表、插图、表格和公式都显示为它的核心：它真正要说的，用大白话，长度是原文的十分之一到三分之一，结合整篇文章写成。",
  guideCollapseWholeBody:
    "点击折叠后的块可读全文；块下方的小标签把它重新折叠。再按一次折叠，文章恢复完整。左上角的目录列出文章的各个部分，滚动时一直停在原处。",
  release20260924Title: "新功能：折叠、整页批注、按文档、对话列表",
  release20260924Body:
    "- **折叠**——文章右上角、提取旁边的按钮。每个块显示为它的核心：它真正要说的，用大白话。点击折叠后的块可读全文。\n- **整页批注**——批注页签里的四个箭头：项目里的每条批注，按文档分组。每类批注现在在各处都用同一种颜色：评论蓝、解释红、简化绿、分析青、可视化品红、助手紫。\n- **按文档**——整页笔记上：项目的笔记排成网格，每个文档一列，每个章节一行。笔记栏现在只显示当前文档的笔记。\n- **对话列表**——助手页签顶部：你在此项目中的对话，点击即可打开。新对话会保留当前对话。范围和思考两行就在输入框正上方。\n- **把批注拖到笔记上**——笔记会得到引文、一条打开批注的批注链接和批注内容。\n- **目录**在滚动时一直停在左上角。\n\n新功能的按钮会发光，直到你按下它。按阅读器顶部的 ? 打开指南。",
  release20260925Title: "新功能：定义",
  release20260925Body:
    "- **定义**——在任何文档里选中一个词或一个短语：文章、PDF、逐字稿、幻灯片、工作表。定义是 AI 工具栏的第一行，在高亮颜色下方。它用大白话给出这个词在这句话里的意思，贴合你的背景。关键术语会立即显示术语表里的定义。不保存。\n\n新功能的按钮会发光，直到你按下它。按阅读器顶部的 ? 打开指南。",
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
  feedbackAddPhoto: "添加图片",
  feedbackAddPhotoTitle: "附上一张图片：问题的截图",
  feedbackAddLink: "添加链接",
  feedbackLinkPlaceholder: "粘贴链接，然后按 Enter",
  feedbackLinkInvalid: "这不是链接。必须以 http:// 或 https:// 开头。",
  feedbackPhotoFailed: "图片没有上传成功。请重试。",
  feedbackPhotoLimit: "最多 {n} 张图片。",
  feedbackLinkLimit: "最多 {n} 个链接。",
  feedbackRemovePhoto: "移除此图片",
  feedbackRemoveLink: "移除此链接",
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
