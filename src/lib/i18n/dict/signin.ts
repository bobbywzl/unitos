// The sign-in page (/signin). zh glossary: dict/common.ts.

const en = {
  tagline: "One place to completely dissect what you read and watch.",
  pointCorpora: "Bind documents into corpora — papers, filings, web articles, videos.",
  pointNotes:
    "Highlight, comment, and distill in the reader. Every note clicks back to its exact source.",
  pointAssistant:
    "The assistant reads your whole corpus — or all your corpora — and answers with citations.",
  google: "Continue with Google",
  accountNote: "Sign-in creates your account and keeps your corpora yours.",
  singleTitle: "Sign-in is off on this instance.",
  singleDesc:
    "It runs as a single reader. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and SESSION_SECRET to open Google sign-in.",
  singleContinue: "Open Unitos",
  errNoCode: "Google returned no code",
  errState: "Sign-in state mismatch — try again",
  errVerify: "Could not verify your Google identity",
};

const zh: Record<keyof typeof en, string> = {
  tagline: "一个把你读的和看的彻底拆解清楚的地方。",
  pointCorpora: "把文档装订成文集——论文、财报、网页文章、视频。",
  pointNotes: "在阅读器里高亮、评论、提炼。每条笔记都能点回它的确切出处。",
  pointAssistant: "助手通读你的整个文集——或全部文集——并带引用作答。",
  google: "使用 Google 继续",
  accountNote: "登录会创建你的账户，你的文集只属于你。",
  singleTitle: "此实例未开启登录。",
  singleDesc:
    "当前以单人阅读器模式运行。设置 GOOGLE_CLIENT_ID、GOOGLE_CLIENT_SECRET 和 SESSION_SECRET 即可开启 Google 登录。",
  singleContinue: "打开 Unitos",
  errNoCode: "Google 未返回授权码",
  errState: "登录状态不匹配——请重试",
  errVerify: "无法验证你的 Google 身份",
};

export const signin = { en, zh } as const;
