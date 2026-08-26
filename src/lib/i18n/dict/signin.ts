// The sign-in page (/signin): a consumer landing page (release-edu login
// pattern) — nav, hero with the CTA card, a showcase of the anchored-note
// moment, value tiles, footer. zh glossary: dict/common.ts.

const en = {
  // Nav
  navSignIn: "Sign in",

  // Hero
  badge: "Every note clicks back to its exact source",
  heroA: "Bring a dense document.",
  heroAccent: "Leave with notes that prove themselves.",
  heroDesc:
    "Unitos is a reader for papers, filings, reports, and lectures — text or video. Highlight a passage and it becomes a note anchored to the exact words. The assistant reads everything you keep and answers with citations you can click.",

  // CTA card
  ctaNew: "New here? Start your first corpus",
  google: "Continue with Google",
  ctaNote: "One Google account — no forms, no passwords.",
  accountNote: "Sign-in creates your account and keeps your corpora yours.",

  // Showcase
  showcaseTitle: "The core move: highlight → anchored note",
  showcaseDocTitle: "Attention Is All You Need",
  showcaseLine1: "The dominant sequence transduction models are based on complex recurrent or convolutional neural networks.",
  showcaseLine2: "We propose a new simple network architecture, the Transformer, based solely on attention mechanisms.",
  showcaseLine3: "Experiments on two machine translation tasks show these models to be superior in quality.",
  showcaseNoteLabel: "Note · pending",
  showcaseNote: "Core claim: attention replaces recurrence entirely — the whole architecture is attention.",
  showcaseSource: "“based solely on attention mechanisms”",
  showcaseAccept: "Enter to accept · Backspace to reject",
  showcaseChip: "✓ Anchored to the exact words",
  showcaseCaption:
    "The chip jumps back and flashes the source. If the words ever change, the note says so — it never points at the wrong text.",

  // Value tiles
  prop1Label: "One corpus per project",
  prop1Sub: "Bind documents, videos, and web pages into corpora, and read them in one place.",
  prop2Label: "Notes with provenance",
  prop2Sub: "Every note anchors to the exact words. Anchors survive reloads and re-parses.",
  prop3Label: "Distill any document",
  prop3Sub: "Ask one question; get the quotes that answer it, in document order, each with a caption.",
  prop4Label: "An assistant that reads it all",
  prop4Sub: "Corpus or Corpora scope: it sees every document, note, and annotation, and cites its blocks.",

  // Footer
  footerTagline: "Anchored notes · distilled questions · an assistant that reads everything",

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
  // Nav
  navSignIn: "登录",

  // Hero
  badge: "每条笔记都能点回它的确切出处",
  heroA: "带来一份难啃的文档。",
  heroAccent: "带走能自证的笔记。",
  heroDesc:
    "Unitos 是面向论文、财报、报告和讲座（文字或视频）的阅读器。高亮一段文字，它就成为锚定在确切字句上的笔记。助手通读你保存的一切，并带可点击的引用作答。",

  // CTA card
  ctaNew: "新来的？建立你的第一个文集",
  google: "使用 Google 继续",
  ctaNote: "一个 Google 账户——没有表单，没有密码。",
  accountNote: "登录会创建你的账户，你的文集只属于你。",

  // Showcase
  showcaseTitle: "核心动作：高亮 → 锚定的笔记",
  showcaseDocTitle: "Attention Is All You Need",
  showcaseLine1: "主流的序列转换模型基于复杂的循环或卷积神经网络。",
  showcaseLine2: "我们提出一种新的简单网络架构——Transformer，完全基于注意力机制。",
  showcaseLine3: "在两项机器翻译任务上的实验表明，这些模型在质量上更胜一筹。",
  showcaseNoteLabel: "笔记 · 待定",
  showcaseNote: "核心主张：注意力完全取代循环——整个架构就是注意力。",
  showcaseSource: "“完全基于注意力机制”",
  showcaseAccept: "Enter 接受 · Backspace 拒绝",
  showcaseChip: "✓ 锚定在确切字句上",
  showcaseCaption:
    "出处标签会跳回原文并闪烁高亮。如果原文的字句变了，笔记会如实标明——绝不指向错误的文字。",

  // Value tiles
  prop1Label: "一个项目一个文集",
  prop1Sub: "把文档、视频和网页装订成文集，在一处阅读。",
  prop2Label: "带出处的笔记",
  prop2Sub: "每条笔记锚定在确切字句上。锚点在重新加载和重新解析后依然有效。",
  prop3Label: "提炼任何文档",
  prop3Sub: "问一个问题，得到按文档顺序排列、各带说明的引文。",
  prop4Label: "通读一切的助手",
  prop4Sub: "文集或全部文集两种范围：它看到每个文档、笔记和批注，并引用具体的块。",

  // Footer
  footerTagline: "锚定的笔记 · 提炼的问题 · 通读一切的助手",

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
