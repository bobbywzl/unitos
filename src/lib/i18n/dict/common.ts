// Shared vocabulary: the app name, generic actions, and statuses.
//
// zh terminology glossary — every namespace keeps to these exact terms
// (CLAUDE.md rule 2 holds in Chinese too: one term per concept, everywhere):
//   project 项目 · Projects(全部) 全部项目 · section 章节 ·
//   note 笔记 · source 出处 · anchor 锚点 · block 块 · pending 待定 ·
//   accepted 已接受 · distill/distillation 提炼 · quote 引文 · caption 说明 ·
//   extract/extraction 提取 · summary 摘要 · digest 汇编 · annotation 批注 ·
//   highlight 高亮 · comment 评论 · explain 解释 · simplify 简化 ·
//   assistant 助手 · document 文档 · video 视频 · audio 音频 ·
//   transcript 逐字稿 · formalize 整理 · article (formalized) 文章 ·
//   salient 要点 · link 链接 · edit 编辑 · reader 阅读器 · glossary 术语表 ·
//   sign in 登录 · sign out 退出登录 · settings 设置 · admin 管理 ·
//   feedback 反馈 · depths: insights 行家洞见 / layman 通俗 / intermediate 进阶 /
//   professional 专业 · share 共享 · collaborator 协作者 · role 角色 ·
//   owner 所有者 · editor 编辑者 · viewer 查看者 · profile 个人资料 ·
//   symbol 符号 · background 背景 · reply 回复 · resolve 解决 ·
//   recommended link 推荐链接 · graph 图谱 · history 历史 ·
//   attach(加入项目) 加入 · detach 移出 · figure 插图 · passage 片段 ·
//   key term 关键术语 · Edits(页签) 编辑记录 · notes tray 笔记栏 ·
//   command 指令 · key takeaways 主要收获 ·
//   selection 选中内容 · bullet-point notes 分条笔记 · gaps(检查) 疏漏 ·
//   anchor unresolved 无法定位 · app tab 页签 · browser tab 标签页 ·
//   upload assistant 上传助手 · review(上传审阅) 审阅 · page 页面 ·
//   split 拆分 · upload instructions 上传要求 · handwritten 手写 ·
//   conversion(手写转文本) 转换 · Circle & ask 圈选并提问 ·
//   offline 离线 · sync(离线同步) 同步 · Unitos Premium 不翻译 ·
//   link Google Drive(账号关联) 关联 · pages(手写页面) 页面 ·
//   lasso highlight(页面圈选高亮) 圈选高亮 ·
//   account 账户 · notification 通知 · recipient 收件人 ·
//   dismiss(通知) 关闭 · update(通知类型) 更新 · account change 账户变更
// highlight 高亮 仅指高亮功能；表示选取文字一律用 选中。

const en = {
  appName: "Unitos",
  appDescription: "Notes-centric app for deep reading",
  works: "Projects",
  settings: "Settings",
  signOut: "Sign out",
  cancel: "Cancel",
  stop: "Stop",
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
  // Offline work (SPEC.md §17, Unitos Premium)
  offline: "Offline. This change did not save.",
  offlineQueued: "Offline · {n} saved for sync · Unitos Premium",
  offlinePremium: "Offline · edits save and sync later · Unitos Premium",
  offlineReadOnly: "Offline · changes do not save. Unitos Premium saves offline work.",
  offlineSyncing: "Syncing {n} offline changes…",
  streamIncomplete: "The answer did not arrive whole. Try again.",
  signInToContinue: "Sign in to continue.",
  corpusNotFound: "Project not found",
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
  // The app-wide 404
  notFoundTitle: "Page not found",
  notFoundBody: "This page does not exist, or its link is stale.",
  notFoundHome: "Back to Projects",
  // Replies: the discussion under a note, an edit, or a link.
  reply: "Reply",
  replyPlaceholder: "Reply…",
  resolve: "Resolve",
  reopen: "Reopen",
  resolvedCountOne: "1 resolved",
  resolvedCountMany: "{n} resolved",
  // Notifications (SPEC.md §18): the kind chip, on the admin page and the dashboard.
  notificationUpdate: "Update",
  notificationAccount: "Account change",
};

const zh: Record<keyof typeof en, string> = {
  appName: "Unitos",
  appDescription: "以笔记为中心的深度阅读应用",
  works: "全部项目",
  settings: "设置",
  signOut: "退出登录",
  cancel: "取消",
  stop: "停止",
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
  // Offline work (SPEC.md §17, Unitos Premium)
  offline: "已离线。此更改未保存。",
  offlineQueued: "离线 · 已保存 {n} 项待同步 · Unitos Premium",
  offlinePremium: "离线 · 编辑会保存并稍后同步 · Unitos Premium",
  offlineReadOnly: "离线 · 更改不会保存。Unitos Premium 可保存离线工作。",
  offlineSyncing: "正在同步 {n} 项离线更改…",
  streamIncomplete: "回答没有完整送达。请重试。",
  signInToContinue: "请登录后继续。",
  corpusNotFound: "未找到该项目",
  unauthorized: "未授权",
  modelCallFailed: "模型调用失败。",
  accountChanged: "此标签页原先属于其他账户。请刷新页面。",
  accountChangedTitle: "账户已变更",
  accountSwitchedBody: "你在另一个标签页登录了 {name}。此标签页原先属于其他账户。",
  accountSignedOutBody: "你在另一个标签页退出了登录。",
  accountContinue: "继续",
  accountSignIn: "登录",
  notFoundTitle: "页面不存在",
  notFoundBody: "此页面不存在，或链接已失效。",
  notFoundHome: "返回全部项目",
  reply: "回复",
  replyPlaceholder: "回复…",
  resolve: "解决",
  reopen: "重新打开",
  resolvedCountOne: "1 条已解决",
  resolvedCountMany: "{n} 条已解决",
  // Notifications (SPEC.md §18): the kind chip, on the admin page and the dashboard.
  notificationUpdate: "更新",
  notificationAccount: "账户变更",
};

export const common = { en, zh } as const;
