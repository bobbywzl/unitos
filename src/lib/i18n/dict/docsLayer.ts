// UI strings of the Unitos layer on the page editor (SPEC.md §29): the
// reader's toolbar, cards, and marks over a blank document. zh glossary:
// dict/common.ts.

const en = {
  leftOut: "Images and equations in the selection are left out",
  selectWordsFirst: "Select the words first",
  // A comment's card, as Google Docs draws it.
  resolveTitle: "Close the open replies; they move under Resolved",
  moreOptions: "More options",
  getLink: "Get link to this comment",
  // View > Comments, in Search the menus.
  showAllComments: "Show all comments",
  minimizeComments: "Minimize comments",
  hideComments: "Hide comments",
  // The Comments group of the keyboard shortcuts.
  comments: "Comments",
  nextComment: "Next comment",
  previousComment: "Previous comment",
  backToText: "Back to the text",
};

const zh: Record<keyof typeof en, string> = {
  leftOut: "选中内容中的图片和公式不计入",
  selectWordsFirst: "先选中文字",
  resolveTitle: "关闭未解决的回复；它们会移到“已解决”下",
  moreOptions: "更多选项",
  getLink: "获取此评论的链接",
  showAllComments: "显示所有评论",
  minimizeComments: "最小化评论",
  hideComments: "隐藏评论",
  comments: "评论",
  nextComment: "下一条评论",
  previousComment: "上一条评论",
  backToText: "返回正文",
};

export const docsLayer = { en, zh } as const;
