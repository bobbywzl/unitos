// UI strings of the notes and the link replies on the graph (SPEC.md §13):
// note chips on the nodes, the notes that join two documents, the replies on
// a link, Note on this link, and the Notes list beside the canvas. zh
// glossary: dict/common.ts — note 笔记 · section 章节 · source 出处 ·
// link 链接 · reply 回复 · resolve 解决 · pending 待定 · graph 图谱.

const en = {
  // Replies on a link (link-replies.tsx)
  replyCountOne: "1 reply",
  replyCountMany: "{n} replies",
  openRepliesTitle: "Open replies on the links between these documents",

  // Notes on the nodes and between them (node-notes.tsx)
  nodeNotesOne: "1 note",
  nodeNotesMany: "{n} notes",
  nodeNotesPending: "{n} pending",
  nodeNotesTitle: "Notes written in this document or quoting it",
  nodeNotesMore: "+ {n} more",
  pairNotes: "Notes quoting both",
  pairNotesTitle: "Notes that quote both documents",
  noteCurveHint: "A note quotes both documents",
  // How to read the graph: the curve marks (WALK4-13).
  keyCurveCount: "The number of links between two documents",
  keyCurveReplies: "Open replies on the links between two documents",
  keyCurveNotes: "Notes that quote both documents",
  keyPending: "Pending notes, awaiting Accept",
  keyFar: "Zoomed out, link counts and notes show on a lit curve and in the cards; replies always show.",
  noteCurveLabelOne: "1 note quotes {a} and {b}",
  noteCurveLabel: "{n} notes quote {a} and {b}",
  showNote: "Show this note in the notes tray",

  // Note on this link (link-note-composer.tsx)
  noteOnLink: "Note on this link",
  noteOnLinkTitle: "Write a note that quotes both ends of this link",
  noteOnLinkPlaceholder: "What do these two passages say together?",
  // [ui5] WALK5-13: unsent words on a link
  linkDraft: "Draft",
  linkDraftTitle: "Words on this link not sent yet: a reply or a note",
  noteOnLinkSection: "Section",
  noteOnLinkSave: "Save",
  noteOnLinkSaving: "Saving…",
  noteOnLinkCancel: "Cancel",
  noteOnLinkSaved: "Note saved in {section}",
  noteOnLinkQueued: "Note saved offline in {section}. It syncs when you are back online.",
  noteOnLinkShow: "Show",
  noteOnLinkNoSection: "Add a section in the notes tray first.",

  // The Notes list beside the canvas (graph-notes-list.tsx)
  notes: "Notes",
  notesToggleTitle: "The notes in focus on the graph, and a section lens",
  notesDesc: "Hover a note to light the documents it quotes. A click reads it here; editing stays in the notes tray.",
  notesAcross: "Notes across documents",
  notesOnPair: "Notes quoting both documents",
  notesOnPick: "Notes quoting the picked documents",
  notesOneDocument: "{n} notes quote one document.",
  notesOneDocumentOne: "1 note quotes one document.",
  notesOneDocumentShow: "Show them",
  notesOneDocumentHide: "Hide them",
  notesFullPage: "Notes full page",
  notesShown: "Shown on graph",
  notesShownAll: "All notes",
  notesLinksBetween: "Links between these documents",
  notesLinksOf: "Links of this document",
  notesBack: "Back to Notes",
  notesEmpty: "No note quotes these documents yet.",
  notesOnProject: "Notes on the project",
  notesSection: "Section",
  notesSectionAll: "All",
  notesSourceOne: "1 source",
  notesSourceMany: "{n} sources",
  notesJump: "Jump",
  notesJumpTitle: "Open the reader at this source",
  notesOpenInNotes: "Open in notes",

  // The notes on a link, in its side panel (graph-notes.tsx LinkNotes)
  linkNotesOne: "1 note on this link",
  linkNotesMany: "{n} notes on this link",

  // Show on graph, from a note card and a link card (note-card.tsx, annotations-panel.tsx)
  showOnGraph: "Show on graph",
  showNoteOnGraphTitle: "Open the graph on this note: its documents lit, and the links between them",
  showLinkOnGraphTitle: "Open the graph on this link",
};

const zh: Record<keyof typeof en, string> = {
  replyCountOne: "1 条回复",
  replyCountMany: "{n} 条回复",
  openRepliesTitle: "这两个文档之间链接上的未解决回复",

  nodeNotesOne: "1 条笔记",
  nodeNotesMany: "{n} 条笔记",
  nodeNotesPending: "{n} 条待定",
  nodeNotesTitle: "在这个文档中写下或引用它的笔记",
  nodeNotesMore: "+ 另外 {n} 条",
  pairNotes: "同时引用两者的笔记",
  pairNotesTitle: "同时引用这两个文档的笔记",
  noteCurveHint: "有笔记同时引用这两个文档",
  keyCurveCount: "两个文档之间的链接数",
  keyCurveReplies: "两个文档之间链接上的未解决回复",
  keyCurveNotes: "同时引用这两个文档的笔记",
  keyPending: "待定笔记，等待接受",
  keyFar: "缩小视图时，链接数和笔记显示在点亮的曲线上和卡片里；回复始终显示。",
  noteCurveLabelOne: "1 条笔记同时引用 {a} 和 {b}",
  noteCurveLabel: "{n} 条笔记同时引用 {a} 和 {b}",
  showNote: "在笔记栏中显示这条笔记",

  noteOnLink: "就此链接写笔记",
  noteOnLinkTitle: "写一条引用这个链接两端的笔记",
  noteOnLinkPlaceholder: "这两个片段放在一起说明了什么？",
  // [ui5] WALK5-13
  linkDraft: "草稿",
  linkDraftTitle: "这个链接上有还没发送的文字：一条回复或一条笔记",
  noteOnLinkSection: "章节",
  noteOnLinkSave: "保存",
  noteOnLinkSaving: "正在保存…",
  noteOnLinkCancel: "取消",
  noteOnLinkSaved: "笔记已保存到 {section}",
  noteOnLinkQueued: "笔记已离线保存到 {section}，恢复联网后同步。",
  noteOnLinkShow: "显示",
  noteOnLinkNoSection: "请先在笔记栏中添加一个章节。",

  notes: "笔记",
  notesToggleTitle: "图谱上当前关注的笔记，以及按章节筛选",
  notesDesc: "悬停一条笔记，点亮它引用的文档。点击可在这里阅读；编辑仍在笔记栏中进行。",
  notesAcross: "跨文档的笔记",
  notesOnPair: "同时引用这两个文档的笔记",
  notesOnPick: "引用所选文档的笔记",
  notesOneDocument: "{n} 条笔记只引用一个文档。",
  notesOneDocumentOne: "1 条笔记只引用一个文档。",
  notesOneDocumentShow: "显示",
  notesOneDocumentHide: "收起",
  notesFullPage: "整页笔记",
  notesShown: "在图谱中显示",
  notesShownAll: "全部笔记",
  notesLinksBetween: "这些文档之间的链接",
  notesLinksOf: "这个文档的链接",
  notesBack: "返回笔记",
  notesEmpty: "还没有笔记引用这些文档。",
  notesOnProject: "整个项目的笔记",
  notesSection: "章节",
  notesSectionAll: "全部",
  notesSourceOne: "1 个出处",
  notesSourceMany: "{n} 个出处",
  notesJump: "跳转",
  notesJumpTitle: "在阅读器中打开这个出处",
  notesOpenInNotes: "在笔记中打开",

  linkNotesOne: "此链接上的 1 条笔记",
  linkNotesMany: "此链接上的 {n} 条笔记",

  showOnGraph: "在图谱中显示",
  showNoteOnGraphTitle: "在图谱中打开这条笔记：点亮它的文档，以及它们之间的链接",
  showLinkOnGraphTitle: "在图谱中打开这个链接",
};

export const graphNotes = { en, zh } as const;
