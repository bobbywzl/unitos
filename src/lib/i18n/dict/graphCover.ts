// UI strings of what the notes cover on the graph and of Add to note
// (SPEC.md §13; components/graph/coverage.tsx, note-gather.tsx): the parts
// noted, Not opened, Gaps only, No reply, and the note composer that
// collects quotes from the graph. zh glossary: dict/common.ts — part 部分 ·
// note 笔记 · quote 引文 · section 章节 · link 链接 · reply 回复 ·
// document 文档 · passage 片段.

const en = {
  // Coverage (coverage.tsx)
  partsNoted: "{n} of {m} parts noted",
  notOpened: "Not opened",
  notOpenedTitle: "You have not opened this document",
  partNotedOne: "1 note quotes this part",
  partNotedMany: "{n} notes quote this part",
  partEmpty: "No note quotes this part",
  partAnnotationsOne: "1 annotation",
  partAnnotationsMany: "{n} annotations",
  wholeNoted: "A note quotes this document",
  headUnopened: "{n} of {m} documents not opened",
  headNoReply: "{n} of {m} links with no reply",
  gapsOnly: "Gaps only",
  gapsOnlyTitle: "Keep the parts no note quotes, the documents you have not opened, and the links with no reply",
  gapsNone: "No gaps: every part is noted, every document is opened, and every link has a reply.",
  noReply: "No reply",
  noReplyTitle: "Keep the links with no reply",
  noReplyNone: "Every link has a reply.",

  // Add to note (note-gather.tsx)
  addToNote: "Add to note",
  addToNoteTitle: "Add this passage to the new note as a quote",
  addedToNote: "In the note",
  addedToNoteTitle: "Remove this quote from the new note",
  composerTitle: "New note",
  composerQuotes: "{n} quote{s} · {d} document{ds}",
  composerSection: "Section",
  composerNoSection: "Add a section in the notes tray first.",
  composerPlaceholder: "Your own words (optional)",
  composerRemove: "Remove this quote",
  composerSave: "Save note",
  composerSaving: "Saving…",
  composerDiscard: "Discard",
  composerDiscardConfirm: "Discard this note's words and quotes?",
  composerFold: "Fold the new note",
  composerUnfold: "Open the new note",
  composerFull: "A note holds at most {n} quotes.",
  composerSaved: "Saved in {section}.",
  composerQueued: "Saved offline. It lands in {section} once you are back online.",
  composerShow: "Show",
  composerOpenQuote: "Open this passage in the reader",

  // The reader's Annotations tab (link-card-extras.tsx)
  provenanceUsedBy: "Used by {title}",
  provenanceFrom: "From {title}",
  provenancePassages: "{n} passage{s}",
  provenanceTitle: "Stitch wrote this generated document from passages of this one. Open it",
  linkNoteShow: "Show this note in the notes tray",
};

const zh: Record<keyof typeof en, string> = {
  partsNoted: "{m} 个部分中 {n} 个有笔记",
  notOpened: "未打开",
  notOpenedTitle: "你还没有打开这个文档",
  partNotedOne: "1 条笔记引用了这个部分",
  partNotedMany: "{n} 条笔记引用了这个部分",
  partEmpty: "没有笔记引用这个部分",
  partAnnotationsOne: "1 条批注",
  partAnnotationsMany: "{n} 条批注",
  wholeNoted: "有笔记引用了这个文档",
  headUnopened: "{m} 个文档中 {n} 个未打开",
  headNoReply: "{m} 条链接中 {n} 条无回复",
  gapsOnly: "只看空缺",
  gapsOnlyTitle: "只留下没有笔记引用的部分、你未打开的文档和没有回复的链接",
  gapsNone: "没有空缺：每个部分都有笔记，每个文档都已打开，每条链接都有回复。",
  noReply: "无回复",
  noReplyTitle: "只留下没有回复的链接",
  noReplyNone: "每条链接都有回复。",

  addToNote: "加入笔记",
  addToNoteTitle: "把这个片段作为引文加入新笔记",
  addedToNote: "已在笔记中",
  addedToNoteTitle: "从新笔记中移除这条引文",
  composerTitle: "新笔记",
  composerQuotes: "{n} 条引文 · {d} 个文档",
  composerSection: "章节",
  composerNoSection: "请先在笔记栏中添加一个章节。",
  composerPlaceholder: "你自己的话（可不填）",
  composerRemove: "移除这条引文",
  composerSave: "保存笔记",
  composerSaving: "正在保存…",
  composerDiscard: "舍弃",
  composerDiscardConfirm: "舍弃这条笔记的文字和引文？",
  composerFold: "收起新笔记",
  composerUnfold: "展开新笔记",
  composerFull: "一条笔记最多 {n} 条引文。",
  composerSaved: "已保存到 {section}。",
  composerQueued: "已离线保存。恢复联网后会存入 {section}。",
  composerShow: "查看",
  composerOpenQuote: "在阅读器中打开这个片段",

  provenanceUsedBy: "被 {title} 使用",
  provenanceFrom: "来自 {title}",
  provenancePassages: "{n} 个片段",
  provenanceTitle: "缝合用这个文档的片段写出了这个生成文档。打开它",
  linkNoteShow: "在笔记栏中显示这条笔记",
};

export const graphCover = { en, zh } as const;
