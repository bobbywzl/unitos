// UI strings of the page editor's version history (SPEC.md §29). The English
// follows Google Docs' own labels. zh glossary: dict/common.ts — version 版本 ·
// version history 版本历史记录.

const en = {
  versionHistory: "Version history",
  seeHistory: "See version history",
  nameCurrent: "Name current version",
  nameThis: "Name this version",
  restore: "Restore this version",
  // Restore this version could not keep the current text as a version first.
  restoreNotKept: "Your current text could not be kept as a version, so nothing was restored. Check your connection and try again.",
  // Name current version with typing the server does not hold yet.
  notSaved: "Your current text is not saved yet. Check your connection and try again.",
  current: "Current version",
  namedOnly: "Only show named versions",
  showChanges: "Show changes",
  back: "Back",
  moreActions: "More actions",
  today: "Today",
  yesterday: "Yesterday",
  // A version's time: "September 25, 2:07 PM".
  dateTime: "{date}, {time}",
  // The navigation keys' N or P, then U (typing/navigate.ts): "No next suggestion".
};

const zh: Record<keyof typeof en, string> = {
  versionHistory: "版本历史记录",
  seeHistory: "查看版本历史记录",
  nameCurrent: "为当前版本命名",
  nameThis: "为此版本命名",
  restore: "恢复此版本",
  restoreNotKept: "无法将当前文本保存为版本，因此未恢复。请检查网络连接后重试。",
  notSaved: "当前文本尚未保存。请检查网络连接后重试。",
  current: "当前版本",
  namedOnly: "仅显示已命名的版本",
  showChanges: "显示更改",
  back: "返回",
  moreActions: "更多操作",
  today: "今天",
  yesterday: "昨天",
  dateTime: "{date} {time}",
};

export const docsVersions = { en, zh } as const;
