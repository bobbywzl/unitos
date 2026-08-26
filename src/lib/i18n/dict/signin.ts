// The sign-in page (/signin): dark front door — badge, hero, one CTA card,
// the reader as it is, key functions as cards. zh glossary: dict/common.ts.

const en = {
  heroA: "All-powerful notebook.",
  heroB: "Dissect anything.",
  heroAccent: "Your understanding, your pace.",
  ctaTitle: "New here? Bind your first corpus",
  google: "Continue with Google",
  apple: "Continue with Apple",
  accountNote: "Sign-in creates your account and keeps your corpora yours.",

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
    "It runs as a single reader. Set SESSION_SECRET plus Google (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET) or Apple (APPLE_CLIENT_ID, APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY) credentials to open sign-in.",
  singleContinue: "Open Unitos",

  // Callback errors
  errNoCode: "Google returned no code",
  errState: "Sign-in state mismatch — try again",
  errVerify: "Could not verify your Google identity",
  errAppleNoCode: "Apple returned no code",
  errAppleVerify: "Could not verify your Apple identity",
};

const zh: Record<keyof typeof en, string> = {
  heroA: "全能笔记本。",
  heroB: "拆解一切。",
  heroAccent: "你的理解，你的节奏。",
  ctaTitle: "新来的？装订你的第一个文集",
  google: "使用 Google 继续",
  apple: "使用 Apple 继续",
  accountNote: "登录会创建你的账户，你的文集只属于你。",

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
    "当前以单人阅读器模式运行。设置 SESSION_SECRET，并配置 Google（GOOGLE_CLIENT_ID、GOOGLE_CLIENT_SECRET）或 Apple（APPLE_CLIENT_ID、APPLE_TEAM_ID、APPLE_KEY_ID、APPLE_PRIVATE_KEY）凭据即可开启登录。",
  singleContinue: "打开 Unitos",

  // Callback errors
  errNoCode: "Google 未返回授权码",
  errState: "登录状态不匹配——请重试",
  errVerify: "无法验证你的 Google 身份",
  errAppleNoCode: "Apple 未返回授权码",
  errAppleVerify: "无法验证你的 Apple 身份",
};

export const signin = { en, zh } as const;
