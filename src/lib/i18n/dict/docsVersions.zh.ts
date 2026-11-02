import type { en } from "@/lib/i18n/dict/docsVersions";

export const zh: Record<keyof typeof en, string> = {
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
