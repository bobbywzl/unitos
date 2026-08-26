// The sign-in page (/signin): dark front door — badge, hero, one CTA card,
// the reader as it is, key functions as cards. zh glossary: dict/common.ts.

const en = {
  heroA: "Your All-Powerful Notebook",
  heroAccent: "Your Understanding, Your Pace.",
  ctaTitle: "New here? Bind your first corpus",
  unitos: "Continue with a Unitos account",
  nameLabel: "Name",
  emailLabel: "Email",
  or: "or",
  google: "Continue with Google",
  apple: "Continue with Apple",
  accountNote: "Sign-in creates your account and keeps your corpora yours.",

  // Check-your-email state (/signin?sent=<email>)
  sentTitle: "Check your email",
  sentTo: "We sent a confirmation link to",
  sentRest: "Click it to create your account. The link expires in 30 minutes.",
  sentBack: "Use a different email",

  // The confirmation email
  emailSubject: "Confirm your email — Unitos",
  emailTitle: "Confirm your email",
  emailBody: "Click the button to confirm this email address and create your Unitos account.",
  emailCta: "Confirm email",
  emailExpiry: "The link expires in 30 minutes.",
  emailIgnore: "If you did not request this, ignore this email.",

  // The reader, as it is — callouts point from the text
  showcaseTitle: "The reader, as it is",
  showcaseCaption: "A real paper in the reader — every function shown is live.",
  chipAccepted: "✓ Note accepted · anchored",
  screenshotAlt: "The Unitos reader on Attention Is All You Need: highlights, notes, annotations, and links in place.",
  calloutAssistant: "The assistant: summarize, explain, ask, distill",
  calloutHighlight: "Highlight, comment, link across texts",
  calloutComment: "Margin comment",
  calloutExtract: "Extract: every passage on one topic",
  calloutPending: "Anchored note — Enter to accept",
  calloutDistill: "Distill: ask the document one question",

  // Only functions you need
  functionsTitle: "Only functions you need",
  fnAssistant: "Smart assistant",
  fnAssistantSub: "Summarize, explain, ask, distill — grounded in the whole corpus.",
  fnNotes: "Anchored notes",
  fnNotesSub: "Every note clicks back to its source in the document.",
  fnHighlight: "Highlight and comment",
  fnHighlightSub: "Highlight a passage, comment in the margin.",
  fnExplain: "Explain",
  fnExplainSub: "Select a passage — explained at your depth, in place.",
  fnSimplify: "Simplify",
  fnSimplifySub: "Select a passage — rewritten in plain words, in place.",
  fnDistill: "Distill",
  fnDistillSub: "One question to the document; the quotes that answer it.",
  fnExtract: "Extract",
  fnExtractSub: "One origin phrase; every passage on its topic.",

  tagline: "One corpus · every note anchored · accepted by you",

  // Single-reader mode
  singleTitle: "Sign-in is off on this instance.",
  singleDesc:
    "It runs as a single reader. Set SESSION_SECRET plus Google (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET), Apple (APPLE_CLIENT_ID, APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY), or email (RESEND_API_KEY, EMAIL_FROM) credentials to open sign-in.",
  singleContinue: "Open Unitos",

  // Callback errors
  errNoCode: "Google returned no code",
  errState: "Sign-in state mismatch — try again",
  errVerify: "Could not verify your Google identity",
  errAppleNoCode: "Apple returned no code",
  errAppleVerify: "Could not verify your Apple identity",
  errEmailInvalid: "Enter a valid email",
  errEmailSend: "Could not send the confirmation email — try again",
  errEmailToken: "Confirmation link expired or already used — request a new one",
};

const zh: Record<keyof typeof en, string> = {
  heroA: "你的全能笔记本",
  heroAccent: "你的理解，你的节奏。",
  ctaTitle: "新来的？装订你的第一个文集",
  unitos: "使用 Unitos 账户继续",
  nameLabel: "名字",
  emailLabel: "邮箱",
  or: "或",
  google: "使用 Google 继续",
  apple: "使用 Apple 继续",
  accountNote: "登录会创建你的账户，你的文集只属于你。",

  // Check-your-email state (/signin?sent=<email>)
  sentTitle: "查收你的邮件",
  sentTo: "确认链接已发送至",
  sentRest: "点击链接即可创建账户。链接 30 分钟内有效。",
  sentBack: "换一个邮箱",

  // The confirmation email
  emailSubject: "确认你的邮箱——Unitos",
  emailTitle: "确认你的邮箱",
  emailBody: "点击按钮确认这个邮箱地址，创建你的 Unitos 账户。",
  emailCta: "确认邮箱",
  emailExpiry: "链接 30 分钟内有效。",
  emailIgnore: "如果这不是你发起的请求，忽略这封邮件即可。",

  // The reader, as it is — callouts point from the text
  showcaseTitle: "阅读器，原样呈现",
  showcaseCaption: "阅读器中的一篇真实论文——展示的功能都是真的。",
  chipAccepted: "✓ 笔记已接受 · 已锚定",
  screenshotAlt: "Unitos 阅读器中的 Attention Is All You Need：高亮、笔记、批注和链接一应俱全。",
  calloutAssistant: "助手：摘要、解释、提问、提炼",
  calloutHighlight: "高亮、评论、跨文本链接",
  calloutComment: "页边评论",
  calloutExtract: "提取：同一主题的每个片段",
  calloutPending: "锚定的笔记——Enter 接受",
  calloutDistill: "提炼：向文档问一个问题",

  // Only functions you need
  functionsTitle: "只有你需要的功能",
  fnAssistant: "智能助手",
  fnAssistantSub: "摘要、解释、提问、提炼——基于整个文集。",
  fnNotes: "锚定笔记",
  fnNotesSub: "每条笔记都能点回文档中的出处。",
  fnHighlight: "高亮与评论",
  fnHighlightSub: "高亮一个片段，在页边评论。",
  fnExplain: "解释",
  fnExplainSub: "选中一段——按你的深度就地解释。",
  fnSimplify: "简化",
  fnSimplifySub: "选中一段——用通俗的话就地重写。",
  fnDistill: "提炼",
  fnDistillSub: "向文档问一个问题，得到回答它的引文。",
  fnExtract: "提取",
  fnExtractSub: "一个起点短语，同一主题的每个片段。",

  tagline: "一个文集 · 每条笔记有锚点 · 由你接受",

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
};

export const signin = { en, zh } as const;
