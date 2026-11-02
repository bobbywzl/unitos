import type { en } from "@/lib/i18n/dict/signin";

export const zh: Record<keyof typeof en, string> = {
  heroA: "搞不懂的{item}？",
  heroItems: "视频|音频|文章|研究论文|法律文件|PDF 作业",
  heroB: "就用 Unitos Notebook。",
  heroPitch: "你的理解，你的节奏。",
  trialLead: "拆解一切，看见你的每一步进展。",
  trialOffer: "现在就试用，两个月免费！",
  ctaTitle: "第一次来？创建你的第一个项目",
  signinTitle: "欢迎回来",
  forgotTitle: "重置密码",
  startNow: "立即开始——免费",
  signIn: "登录",
  emailLabel: "邮箱",
  passwordLabel: "密码",
  confirmPasswordLabel: "确认密码",
  forgot: "忘记密码？",
  toSignin: "已有账户？登录",
  toSignup: "第一次来？创建账户",
  sendReset: "发送重置链接",
  or: "或",
  google: "使用 Google 继续",
  apple: "使用 Apple 继续",
  accountNote: "登录会创建你的账户，你的项目只属于你。",
  noCardKicker: "不需要付款信息",
  noCard: "输入邮箱，现在就开始工作。",
  noCardSub: "Unitos Premium 免费两个月。开始时我们从不索要银行卡。",

  // The beta notice: opens once per tab when the page loads.
  betaTitle: "Unitos 正处于测试阶段",
  betaThanks: "感谢你这么早就来到这里。你建立的每个项目、发来的每条反馈，都在塑造 Unitos 的未来。",
  betaFree:
    "作为感谢，目前每个测试账户都可以免费、不限量地使用 Unitos：整个笔记本，以及它所使用的 GLM、Kimi、Claude、Gemini 和 Groq 的 token，全部免费。",
  betaSigned: "——Unitos 团队",
  betaContinue: "继续",

  // Check-your-email state (/signin?sent=<email>; mode=forgot after a reset)
  sentTitle: "请查收邮件",
  sentTo: "确认链接已发送至",
  sentRest: "点击链接即可进入账户。链接 30 分钟内有效。",
  resetSentTo: "如果已有账户，重置链接将发往",
  resetSentRest: "点击链接设置新密码。链接 30 分钟内有效。",
  sentBack: "换一个邮箱",

  // The confirmation email
  emailSubject: "确认你的邮箱——Unitos",
  emailTitle: "确认你的邮箱",
  emailBody: "点击按钮确认这个邮箱地址，创建你的 Unitos 账户。",
  emailCta: "确认邮箱",
  emailExpiry: "链接 30 分钟内有效。",
  emailIgnore: "如果这不是你发起的请求，忽略这封邮件即可。",

  // The reset email
  resetEmailSubject: "重置密码——Unitos",
  resetEmailTitle: "重置密码",
  resetEmailBody: "点击按钮为你的 Unitos 账户设置新密码。",
  resetEmailCta: "设置新密码",

  // The reset page (/reset)
  setPassword: "设置密码",
  resetTitle: "设置新密码",

  deckTabs: "阅读器|笔记全页|阅读器旁的笔记|图谱与缝合|协作",
  deckCaptions:
    "选中一段：简化、分析、可视化、匹配、提问。每个结果都是待定卡片，由你接受或拒绝；提取向文档问一个问题，返回引文。|笔记全页：并排或堆叠对比笔记，选中两条，用 AI 合并——一条笔记，两处来源都保留，随时可撤销。|笔记就在阅读器旁。把高亮拖到笔记上它就并入；把笔记拖到文章上它就浮在那里，边读边写。|图谱把每篇文档画成节点，每条链接画成曲线。缝合读取你选取的文档——论文、逐字稿、网页——并提出由你接受的链接。|共享项目：协作者高亮、在笔记下回复、解决线程、提出由你接受的编辑——每次更改都有署名。",
  deckPrev: "上一屏",
  deckNext: "下一屏",

  tagline: "一个项目 · 每条笔记有锚点 · 由你接受",

  // Single-reader mode
  singleTitle: "此实例未开启登录。",
  singleDesc:
    "当前以单人阅读器模式运行。设置 SESSION_SECRET，并配置 Google（GOOGLE_CLIENT_ID、GOOGLE_CLIENT_SECRET）、Apple（APPLE_CLIENT_ID、APPLE_TEAM_ID、APPLE_KEY_ID、APPLE_PRIVATE_KEY）或邮箱（RESEND_API_KEY、EMAIL_FROM）凭据即可开启登录。",
  singleContinue: "打开 Unitos",

  // Callback errors
  errNoCode: "Google 未返回授权码",
  errState: "登录状态不匹配——请重试",
  errVerify: "无法验证你的 Google 身份",
  errAppleNoCode: "Apple 未返回授权码",
  errAppleVerify: "无法验证你的 Apple 身份",
  errEmailInvalid: "请输入有效的邮箱",
  errEmailSend: "确认邮件发送失败——请重试",
  errEmailToken: "确认链接已过期或已使用——请重新申请",
  errBadLogin: "邮箱或密码不正确",
  errNoPassword: "该账户还没有密码——请用“忘记密码”设置一个",
  errBlocked: "该邮箱已被封禁",
  errPasswordShort: "密码至少 8 个字符",
  errPasswordMatch: "两次输入的密码不一致",
};
