// Shared vocabulary: the app name, generic actions, and statuses.
//
// zh terminology glossary — every namespace keeps to these exact terms
// (CLAUDE.md rule 2 holds in Chinese too: one term per concept, everywhere):
//   project 项目 · Projects(全部) 全部项目 · section 章节 ·
//   note 笔记 · source 出处 · anchor 锚点 · block 块 · pending 待定 ·
//   accepted 已接受 · extract/extraction(问题→引文; code DISTILL) 提取 ·
//   quote 引文 · caption 说明 · Match-it/match(短语→片段; code EXTRACT) 匹配 ·
//   summary 摘要 · digest 汇编 · annotation 批注 ·
//   annotation reference(笔记里指向批注的行) 批注链接 ·
//   highlight 高亮 · comment 评论 · explain 解释 · simplify 简化 ·
//   side chat(从回答引用分出的对话) 支线对话 ·
//   comment on an answer(对回答引用的评论) 评论 ·
//   assistant 助手 · thinking(助手思考档位) 思考 · Fast Thinking 快速思考 ·
//   Deep Thinking 深度思考 · document 文档 · video 视频 · audio 音频 ·
//   transcript 逐字稿 · formalize 整理 · article (formalized) 文章 ·
//   salient 要点 · link 链接 · edit 编辑 · reader 阅读器 · glossary 术语表 ·
//   sign in 登录 · sign out 退出登录 · settings 设置 · admin 管理 ·
//   feedback 反馈 · depths: layman 通俗 / intermediate 进阶 /
//   professional 专业 · share 共享 · collaborator 协作者 · role 角色 ·
//   owner 所有者 · editor 编辑者 · viewer 查看者 · profile 个人资料 ·
//   symbol 符号 · background 背景 · reply 回复 · resolve 解决 ·
//   recommended link 推荐链接 · graph 图谱 · history 历史 ·
//   floating card 浮动卡片 · wrap text(文本环绕笔记) 环绕文本 ·
//   attach(加入项目) 加入 · detach 移出 · figure 插图 · passage 片段 ·
//   key term 关键术语 · Edits(页签) 编辑记录 · notes tray 笔记栏 ·
//   define(选中一个词的工具) 定义 · definition 定义 ·
//   command 指令 · voice command(笔记栏里说出的指令) 语音指令 · key takeaways 主要收获 ·
//   selection 选中内容 · bullet-point notes 分条笔记 · gaps(检查) 疏漏 ·
//   anchor unresolved 无法定位 · app tab 页签 · browser tab 标签页 ·
//   upload assistant 上传助手 · review(上传审阅) 审阅 · page 页面 ·
//   split 拆分 · handwritten 手写 ·
//   conversion(手写转文本) 转换 · Circle & ask 圈选并提问 · image 图片 ·
//   offline 离线 · sync(离线同步) 同步 · offline copy(离线保存的项目) 离线副本 ·
//   Save for offline 离线保存 · Unitos Premium 不翻译 ·
//   Unitos Ultra 不翻译 · plan(账户方案) 方案 · trial 试用 ·
//   tier(账户等级) 方案 · tier mark(方案标记) 方案标记 · black diamond 黑钻 ·
//   white crystal 白水晶 ·
//   visualize 可视化 · visualization(可视化生成的图) 可视化图 ·
//   link Google Drive(账号关联) 关联 · pages(手写页面) 页面 ·
//   lasso highlight(页面圈选高亮) 圈选高亮 ·
//   account 账户 · block 封禁 · unblock 解封 · block list 封禁名单 ·
//   account 账户 · notification 通知 · recipient 收件人 ·
//   dismiss(通知) 关闭 · update(通知类型) 更新 · account change 账户变更 ·
//   gist 要旨 · checklist 清单 · dash list 短横线列表 ·
//   quote(笔记格式，> 行) 引用 · notes full page 整页笔记 ·
//   conversation 对话 · attachment 附件 · file 文件 ·
//   stitch 缝合 · generated document 生成文档 · pick(为缝合选中节点) 选取 ·
//   contents(文章的目录) 目录 · part(目录的一项) 部分 · merge(两条笔记合为一条) 合并 ·
//   Merge with AI 用 AI 合并 · Join text 拼接文本 ·
//   hold ring(合并进度环) 合并环 · drop line(落位线) 落位线 ·
//   board(章节的笔记铺满屏幕) 看板 · tile(看板上的一条笔记) 方块 ·
//   storage(账户文件占用) 存储空间 · storage limit 存储上限 ·
//   companion(仪表板上的外部网页应用) 配套应用
//   billing(付款流程与开关) 付费 · plan page 方案页 · order(付款前的订单页) 订单 ·
//   checkout(Stripe 结账) 结账 · receipt(一次付款; code Purchase) 收据 ·
//   subscription 订阅 · Manage subscription 管理订阅 · confirmation 确认 ·
//   billing switch 付费开关 · Stripe 不翻译 · card(银行卡) 银行卡 ·
//   subscription panel(设置里的订阅面板) 订阅面板 · upgrade panel 升级面板 ·
//   billing ask(30 分钟后请求绑卡) 绑卡提醒 · active time 活跃时长 ·
//   tier button(仪表板顶部的方案按钮) 方案按钮 ·
//   slides(幻灯片文档) 幻灯片 · slide(一页幻灯片) 幻灯片 · replica(复刻) 复刻 ·
//   picture(幻灯片的图片) 图片 · speaker notes 演讲者备注 ·
//   sheets(电子表格文档) 电子表格 · sheet(一个工作表) 工作表 · cell 单元格 ·
//   frozen(冻结的行列) 冻结 ·
//   funnel(注册漏斗) 漏斗 · step(漏斗的一步) 步骤 · visitor(一个浏览器) 访客 ·
//   collapse(整篇文章按块折叠为核心) 折叠 · core(块的核心) 核心 ·
//   annotations full page 整页批注 · kind color(每类批注的颜色) 类别色 ·
//   folder(项目里的文档分组) 文件夹 ·
//   release(一次上线的新功能) 版本更新 · New glow(新功能光晕) 新功能光晕 ·
//   version(空白文档某一时刻的文本) 版本 · version history 版本历史记录 ·
//   suggestion(建议模式下的一处修改) 建议 · Suggesting(模式) 建议模式 ·
//   spelling suggestion(右键菜单给拼错的英文单词的替换词) 拼写建议 ·
//   reading position 阅读位置 · left-off mark(上次读到的块上方的小书签) 阅读标记
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
  send: "Send",
  // The rating of an AI tool's output (SPEC.md §25)
  rateUp: "Good answer",
  rateDown: "Poor answer",
  rateWhatWasWrong: "What was wrong? (optional)",
  rateThanks: "Noted",
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
  // Tiers (TIERS.md): the tier's name, as the tier chip and the tier mark's
  // tooltip say it. On a trial or after it, the trial's end.
  tierUltra: "Unitos Ultra",
  tierPremium: "Unitos Premium",
  tierTrial: "Unitos Premium · trial until {date}",
  tierExpired: "Unitos Premium · trial ended {date}",
  // Offline work (SPEC.md §17, Unitos Premium)
  offline: "Offline. This change did not save.",
  offlineQueued: "Offline · AI is off · {n} saved for sync · Unitos Premium",
  offlinePremium: "Offline · AI is off · notes and edits save and sync later · Unitos Premium",
  offlineReadOnly: "Offline · AI is off · changes do not save. Unitos Premium saves offline work.",
  // A call that needs a model, offline (SPEC.md §17): the same words as the
  // service worker's answer (public/sw.js)
  offlineAi:
    "AI is off while offline. Notes, highlights, comments, and edits save on this device and sync when you are back online.",
  offlineSyncing: "Syncing {n} offline changes…",
  // The offline page (SPEC.md §17, Unitos Ultra): what loads without a network
  offlineTitle: "Offline",
  offlinePageBody: "Only projects saved for offline are shown. Everything else needs a connection.",
  offlineEmpty:
    "No project is saved for offline. Online, open a project's ⋯ menu and press Save for offline. Unitos Ultra.",
  offlineSavedAt: "Saved {date}",
  offlineOpen: "Open",
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
  resolveTitle: "Close this reply; it moves under Resolved",
  reopenTitle: "Reopen this reply",
  replyTitle: "Start a reply",
  resolvedCountOne: "1 resolved",
  resolvedCountMany: "{n} resolved",
  // Notifications (SPEC.md §18): the kind chip, on the admin pages and the
  // dashboard. "Feedback" marks a reply to feedback the account sent.
  notificationUpdate: "Update",
  // The New pill on a control a release added (components/new-feature.tsx).
  newFeature: "New",
  notificationAccount: "Account change",
  notificationFeedback: "Feedback",
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
  send: "发送",
  rateUp: "回答得好",
  rateDown: "回答不好",
  rateWhatWasWrong: "哪里不对？（可不填）",
  rateThanks: "已记录",
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
  tierUltra: "Unitos Ultra",
  tierPremium: "Unitos Premium",
  tierTrial: "Unitos Premium · 试用至 {date}",
  tierExpired: "Unitos Premium · 试用已于 {date} 结束",
  // Offline work (SPEC.md §17, Unitos Premium)
  offline: "已离线。此更改未保存。",
  offlineQueued: "离线 · AI 不可用 · 已保存 {n} 项待同步 · Unitos Premium",
  offlinePremium: "离线 · AI 不可用 · 笔记和编辑会保存并稍后同步 · Unitos Premium",
  offlineReadOnly: "离线 · AI 不可用 · 更改不会保存。Unitos Premium 可保存离线工作。",
  // A call that needs a model, offline (SPEC.md §17): the same words as the
  // service worker's answer (public/sw.js)
  offlineAi: "离线时 AI 不可用。笔记、高亮、评论和编辑会保存在此设备上，联网后同步。",
  offlineSyncing: "正在同步 {n} 项离线更改…",
  // The offline page (SPEC.md §17, Unitos Ultra): what loads without a network
  offlineTitle: "离线",
  offlinePageBody: "只显示已离线保存的项目。其他内容需要网络。",
  offlineEmpty: "没有离线保存的项目。联网时打开项目的 ⋯ 菜单，按离线保存。Unitos Ultra 功能。",
  offlineSavedAt: "保存于 {date}",
  offlineOpen: "打开",
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
  resolveTitle: "关闭此回复；它会移到“已解决”下",
  reopenTitle: "重新打开此回复",
  replyTitle: "开始回复",
  resolvedCountOne: "1 条已解决",
  resolvedCountMany: "{n} 条已解决",
  // Notifications (SPEC.md §18): the kind chip, on the admin page and the dashboard.
  notificationUpdate: "更新",
  newFeature: "新功能",
  notificationAccount: "账户变更",
  notificationFeedback: "反馈",
};

export const common = { en, zh } as const;
