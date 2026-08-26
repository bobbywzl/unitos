// The sign-in page (/signin), minimal: wordmark, hero, one button, legal
// links. zh glossary: dict/common.ts.

const en = {
  heroA: "Dissect content.",
  heroAccentA: "Your understanding,",
  heroAccentB: "your pace.",
  google: "Continue with Google",
  apple: "Continue with Apple",
  accountNote: "Sign-in creates your account and keeps your corpora yours.",

  // The reader, as it is — callouts point from the text
  screenshotAlt: "The Unitos reader on Attention Is All You Need: highlights, notes, annotations, and links in place.",
  calloutAssistant: "The assistant: summarize, explain, ask, distill",
  calloutHighlight: "Highlight, comment, link across texts",
  calloutComment: "Margin comment",
  calloutExtract: "Extract: every passage on one topic",
  calloutPending: "Anchored note — Enter to accept",
  calloutDistill: "Distill: ask the document one question",

  // Key functions
  functionsTitle: "Key functions",
  fn1: "Corpora",
  fn2: "Anchored notes",
  fn3: "Highlights & comments",
  fn4: "Explain & Simplify",
  fn5: "Distill",
  fn6: "Extract",
  fn7: "Summaries",
  fn8: "Video & transcripts",
  fn9: "Links across texts",
  fn10: "The assistant",
  fn11: "Export",
  fn12: "English · 中文",

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
  heroA: "拆解内容。",
  heroAccentA: "你的理解，",
  heroAccentB: "你的节奏。",
  google: "使用 Google 继续",
  apple: "使用 Apple 继续",
  accountNote: "登录会创建你的账户，你的文集只属于你。",

  // The reader, as it is — callouts point from the text
  screenshotAlt: "Unitos 阅读器中的 Attention Is All You Need：高亮、笔记、批注和链接一应俱全。",
  calloutAssistant: "助手：摘要、解释、提问、提炼",
  calloutHighlight: "高亮、评论、跨文本链接",
  calloutComment: "页边评论",
  calloutExtract: "提取：同一主题的每个片段",
  calloutPending: "锚定的笔记——Enter 接受",
  calloutDistill: "提炼：向文档问一个问题",

  // Key functions
  functionsTitle: "核心功能",
  fn1: "文集",
  fn2: "锚定笔记",
  fn3: "高亮与评论",
  fn4: "解释与简化",
  fn5: "提炼",
  fn6: "提取",
  fn7: "摘要",
  fn8: "视频与逐字稿",
  fn9: "跨文本链接",
  fn10: "助手",
  fn11: "导出",
  fn12: "中文 · English",

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
