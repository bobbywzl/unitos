// UI strings of the page editor's version history (SPEC.md §29). The English
// follows Google Docs' own labels. zh glossary: dict/common.ts — version 版本 ·
// version history 版本历史记录.

export const en = {
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
