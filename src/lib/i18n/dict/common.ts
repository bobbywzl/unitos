// Shared vocabulary: the app name, generic actions, and statuses.
//
// zh terminology glossary — every namespace keeps to these exact terms
// (CLAUDE.md rule 2 holds in Chinese too: one term per concept, everywhere):
//   corpus 文集 · Corpora(全部) 全部文集 · works shelf 书架 · section 章节 ·
//   note 笔记 · source 出处 · anchor 锚点 · block 块 · pending 待定 ·
//   accepted 已接受 · distill/distillation 提炼 · quote 引文 · caption 说明 ·
//   extract/extraction 提取 · summary 摘要 · digest 汇编 · annotation 批注 ·
//   highlight 高亮 · comment 评论 · explain 解释 · simplify 简化 ·
//   assistant 助手 · document 文档 · video 视频 · transcript 逐字稿 ·
//   salient 要点 · link 链接 · edit 编辑 · reader 阅读器 · glossary 术语表 ·
//   sign in 登录 · sign out 退出登录 · settings 设置 · admin 管理 ·
//   feedback 反馈 · depths: insights 行家洞见 / layman 通俗 / intermediate 进阶 /
//   professional 专业 · share 共享 · collaborator 协作者 · role 角色 ·
//   owner 所有者 · editor 编辑者 · viewer 查看者 · profile 个人资料 ·
//   symbol 符号 · background 背景 · reply 回复

const en = {
  appName: "Unitos",
  works: "Works",
  settings: "Settings",
  signOut: "Sign out",
  cancel: "Cancel",
  close: "Close",
  delete: "Delete",
  save: "Save",
  saving: "Saving…",
  saved: "Saved",
  edit: "Edit",
  retry: "Retry",
  regenerate: "Regenerate",
  working: "Working…",
  loading: "Loading…",
  accept: "Accept",
  reject: "Reject",
  pending: "pending",
  none: "none",
  app: "App",
  add: "Add",
  remove: "Remove",
  done: "Done",
  open: "Open",
  requestFailed: "Request failed",
  requestFailedStatus: "Request failed ({status})",
  signInToContinue: "Sign in to continue.",
  corpusNotFound: "Corpus not found",
  unauthorized: "Unauthorized",
  modelCallFailed: "The model call failed.",
  // Stale tab: the browser signed out or switched accounts in another tab.
  accountChanged: "This tab was open with a different account. Reload the page.",
  accountChangedTitle: "Account changed",
  accountSwitchedBody:
    "You signed in as {name} in another tab. This tab was open with a different account.",
  accountSignedOutBody: "You signed out in another tab.",
  accountContinue: "Continue",
  accountSignIn: "Sign in",
  // Replies: the discussion under a note or an edit.
  reply: "Reply",
  replyCountOne: "1 reply",
  replyCountMany: "{n} replies",
  replyPlaceholder: "Reply…",
};

const zh: Record<keyof typeof en, string> = {
  appName: "Unitos",
  works: "书架",
  settings: "设置",
  signOut: "退出登录",
  cancel: "取消",
  close: "关闭",
  delete: "删除",
  save: "保存",
  saving: "保存中…",
  saved: "已保存",
  edit: "编辑",
  retry: "重试",
  regenerate: "重新生成",
  working: "处理中…",
  loading: "加载中…",
  accept: "接受",
  reject: "拒绝",
  pending: "待定",
  none: "无",
  app: "应用",
  add: "添加",
  remove: "移除",
  done: "完成",
  open: "打开",
  requestFailed: "请求失败",
  requestFailedStatus: "请求失败（{status}）",
  signInToContinue: "登录后继续。",
  corpusNotFound: "未找到该文集",
  unauthorized: "未授权",
  modelCallFailed: "模型调用失败。",
  accountChanged: "此标签页原先属于其他账户。请刷新页面。",
  accountChangedTitle: "账户已切换",
  accountSwitchedBody: "你在另一个标签页登录了 {name}。此标签页原先属于其他账户。",
  accountSignedOutBody: "你在另一个标签页退出了登录。",
  accountContinue: "继续",
  accountSignIn: "登录",
  reply: "回复",
  replyCountOne: "1 条回复",
  replyCountMany: "{n} 条回复",
  replyPlaceholder: "回复…",
};

export const common = { en, zh } as const;
