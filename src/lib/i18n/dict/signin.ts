// The sign-in page (/signin): dark front door — badge, hero, one CTA card,
// the reader as it is, key functions as cards. zh glossary: dict/common.ts.

const en = {
  badge: "Every note clicks back to its source",
  heroA: "Dissect content.",
  heroAccent: "Your understanding, your pace.",
  heroSub:
    "Unitos binds papers, reports, pages, and video into one corpus. Read it with an assistant that explains, distills, and extracts — every note anchored to its source, pending until you accept it.",
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

  // Key functions
  functionsTitle: "Key functions",
  fn1: "Corpora",
  fn1Sub: "Papers, reports, pages, and video — bound into one corpus.",
  fn2: "Anchored notes",
  fn2Sub: "Every note clicks back to its source in the document.",
  fn3: "Highlights & comments",
  fn3Sub: "Highlight a passage, comment in the margin.",
  fn4: "Explain & Simplify",
  fn4Sub: "Select a passage — explained at your depth, in place.",
  fn5: "Distill",
  fn5Sub: "One question to the document; the quotes that answer it.",
  fn6: "Extract",
  fn6Sub: "One origin phrase; every passage on its topic.",
  fn7: "Summaries",
  fn7Sub: "One summary per document, at three depths.",
  fn8: "Video & transcripts",
  fn8Sub: "Ingest video; read and anchor on the transcript.",
  fn9: "Links across texts",
  fn9Sub: "Link a passage here to a passage in another document.",
  fn10: "The assistant",
  fn10Sub: "Summarize, explain, ask, distill — grounded in the whole corpus.",
  fn11: "Export",
  fn11Sub: "Corpus to Markdown or .docx, notes with their citations.",
  fn12: "English · 中文",
  fn12Sub: "The whole surface in English and Chinese — switch anytime.",

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
  badge: "每条笔记都能点回出处",
  heroA: "拆解内容。",
  heroAccent: "你的理解，你的节奏。",
  heroSub:
    "Unitos 把论文、报告、网页和视频装订成一个文集。与助手一起阅读：解释、提炼、提取——每条笔记都锚定出处，待定直到你接受。",
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

  // Key functions
  functionsTitle: "核心功能",
  fn1: "文集",
  fn1Sub: "论文、报告、网页和视频——装订成一个文集。",
  fn2: "锚定笔记",
  fn2Sub: "每条笔记都能点回文档中的出处。",
  fn3: "高亮与评论",
  fn3Sub: "高亮一个片段，在页边评论。",
  fn4: "解释与简化",
  fn4Sub: "选中一段——按你的深度就地解释。",
  fn5: "提炼",
  fn5Sub: "向文档问一个问题，得到回答它的引文。",
  fn6: "提取",
  fn6Sub: "一个起点短语，同一主题的每个片段。",
  fn7: "摘要",
  fn7Sub: "每个文档一份摘要，三种深度。",
  fn8: "视频与逐字稿",
  fn8Sub: "导入视频，在逐字稿上阅读和锚定。",
  fn9: "跨文本链接",
  fn9Sub: "把这里的片段链接到另一个文档的片段。",
  fn10: "助手",
  fn10Sub: "摘要、解释、提问、提炼——基于整个文集。",
  fn11: "导出",
  fn11Sub: "文集导出为 Markdown 或 .docx，笔记附出处。",
  fn12: "中文 · English",
  fn12Sub: "全界面中英双语——随时切换。",

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
