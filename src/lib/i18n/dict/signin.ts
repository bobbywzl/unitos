// The sign-in page (/signin), minimal: wordmark, hero, one button, legal
// links. zh glossary: dict/common.ts.

const en = {
  heroA: "Dissect content.",
  heroAccent: "Your understanding, your pace.",
  google: "Continue with Google",
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
  fn1: "Corpora of documents, videos, and web pages",
  fn2: "Notes anchored to the exact words",
  fn3: "Highlights and comments",
  fn4: "Explain and Simplify on any selection",
  fn5: "Distill: one question, the quotes that answer it",
  fn6: "Extract: every passage on one topic",
  fn7: "Summaries at three depths",
  fn8: "Video transcripts, moments, and Find",
  fn9: "Links across texts",
  fn10: "The assistant at Corpus and Corpora scope",
  fn11: "Export to Markdown and Word",
  fn12: "English and 中文",

  // Single-reader mode
  singleTitle: "Sign-in is off on this instance.",
  singleDesc:
    "It runs as a single reader. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and SESSION_SECRET to open Google sign-in.",
  singleContinue: "Open Unitos",

  // Callback errors
  errNoCode: "Google returned no code",
  errState: "Sign-in state mismatch — try again",
  errVerify: "Could not verify your Google identity",
};

const zh: Record<keyof typeof en, string> = {
  heroA: "拆解内容。",
  heroAccent: "你的理解，你的节奏。",
  google: "使用 Google 继续",
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
  fn1: "由文档、视频和网页组成的文集",
  fn2: "锚定在确切字句上的笔记",
  fn3: "高亮与评论",
  fn4: "对任意选中内容解释与简化",
  fn5: "提炼：一个问题，得到回答它的引文",
  fn6: "提取：同一主题的每个片段",
  fn7: "三种深度的摘要",
  fn8: "视频逐字稿、时刻与查找",
  fn9: "跨文本链接",
  fn10: "文集与全部文集两种范围的助手",
  fn11: "导出为 Markdown 和 Word",
  fn12: "中文与英文",

  // Single-reader mode
  singleTitle: "此实例未开启登录。",
  singleDesc:
    "当前以单人阅读器模式运行。设置 GOOGLE_CLIENT_ID、GOOGLE_CLIENT_SECRET 和 SESSION_SECRET 即可开启 Google 登录。",
  singleContinue: "打开 Unitos",

  // Callback errors
  errNoCode: "Google 未返回授权码",
  errState: "登录状态不匹配——请重试",
  errVerify: "无法验证你的 Google 身份",
};

export const signin = { en, zh } as const;
