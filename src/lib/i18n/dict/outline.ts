// UI strings of the outline surfaces. zh glossary: dict/common.ts. Every key
// exists in both languages — zh's type enforces it.

const en = {
  // Notes full page header (notes/page.tsx, export-menu.tsx, outline.tsx)
  reader: "Reader",
  export: "Export",
  exportMarkdown: "Markdown",
  exportWord: "Word",
  pendingCount: "{n} pending",
  pageKeyHint: "⏎ accept · ⌫ reject · e edit · g source",

  // Search and empty states
  searchNotes: "Search notes",
  noNotesMatch: "No notes match “{query}”.",
  emptySections: "No sections yet. Add one to start taking notes.",
  emptyTrayPrefix: "No sections yet. Add one on the ",
  notesFullPage: "notes full page",
  emptyTraySuffix: ".",

  // Sections
  addSection: "Add section",
  addSectionSmall: "+ Add section",
  sectionTitle: "Section title",
  renameSection: "Rename section",
  reorderSection: "Reorder section {title}",
  confirmDeleteSection: "Delete this section and its notes?",

  // Note cards
  addNoteBtn: "+ note",
  writeNotePlaceholder: "Write a note (markdown)",
  reorderNote: "Reorder note",
  acceptTitle: "Accept (Enter)",
  rejectTitle: "Reject (Backspace)",
  editTitle: "Edit (e)",
  editLower: "edit",
  copy: "Copy",
  copied: "Copied",
  copyTitle: "Copy the note text",
  moveTo: "Move to…",
  moveNoteAria: "Move this note to another section",
  confirmDeleteNote: "Delete this note?",
  anchorUnresolvedTitle: "Anchor unresolved. Quoted text: {quote}",
  unresolvedLabel: "unresolved:",

  // Pending queue
  pendingHeader: "Pending · {n}",
  trayKeyHint: "⏎ accept · ⌫ reject",
  noteRejected: "Note rejected",
  undo: "Undo",
};

const zh: Record<keyof typeof en, string> = {
  reader: "阅读器",
  export: "导出",
  exportMarkdown: "Markdown",
  exportWord: "Word",
  pendingCount: "{n} 条待定",
  pageKeyHint: "⏎ 接受 · ⌫ 拒绝 · e 编辑 · g 出处",

  searchNotes: "搜索笔记",
  noNotesMatch: "没有匹配“{query}”的笔记。",
  emptySections: "还没有章节。添加一个，开始记笔记。",
  emptyTrayPrefix: "还没有章节。到",
  notesFullPage: "整页笔记",
  emptyTraySuffix: "添加一个。",

  addSection: "添加章节",
  addSectionSmall: "+ 添加章节",
  sectionTitle: "章节标题",
  renameSection: "重命名章节",
  reorderSection: "调整章节 {title} 的顺序",
  confirmDeleteSection: "删除此章节及其笔记？",

  addNoteBtn: "+ 笔记",
  writeNotePlaceholder: "写一条笔记（markdown）",
  reorderNote: "调整笔记顺序",
  acceptTitle: "接受（Enter）",
  rejectTitle: "拒绝（Backspace）",
  editTitle: "编辑（e）",
  editLower: "编辑",
  copy: "复制",
  copied: "已复制",
  copyTitle: "复制笔记文本",
  moveTo: "移到…",
  moveNoteAria: "把此笔记移到其他章节",
  confirmDeleteNote: "删除此笔记？",
  anchorUnresolvedTitle: "锚点无法定位。引文：{quote}",
  unresolvedLabel: "无法定位：",

  pendingHeader: "待定 · {n}",
  trayKeyHint: "⏎ 接受 · ⌫ 拒绝",
  noteRejected: "笔记已拒绝",
  undo: "撤销",
};

export const outline = { en, zh } as const;
