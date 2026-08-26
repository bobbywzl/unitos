// The sign-in page (/signin), minimal: wordmark, hero, one button, legal
// links. zh glossary: dict/common.ts.

const en = {
  heroA: "Dissect content.",
  heroAccent: "Your understanding, your pace.",
  google: "Continue with Google",
  accountNote: "Sign-in creates your account and keeps your corpora yours.",

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
