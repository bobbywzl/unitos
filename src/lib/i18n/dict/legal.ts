// The privacy policy and terms, both languages. Rendered by /privacy and
// /terms through lib/legal.ts. Plain words, short sentences: a reader decides
// whether to sign in from these pages, so they say what actually happens.

const en = {
  // Shared
  updated: "Last updated: 26 August 2026",
  backToApp: "Back to Unitos",
  privacyTitle: "Privacy Policy",
  termsTitle: "Terms of Service",
  seeTerms: "Terms of Service",
  seePrivacy: "Privacy Policy",

  // ── Privacy ──────────────────────────────────────────────────────────────
  pIntro:
    "Unitos is a reading and note-taking app at unitosnotebook.com. This policy says what the app stores, who it sends your material to, and what you can do about it. It covers the app only.",

  pWhoHeading: "Who runs Unitos",
  pWho:
    "Unitos is run by an independent developer, not a company. Questions about this policy, your data, or a deletion request go to robertwzl311@gmail.com.",

  pCollectHeading: "What Unitos stores",
  pCollectIntro: "Unitos stores what it needs to be your notebook, and nothing else:",
  pCollectAccount:
    "Your account: the email address, name, and profile picture on the Google account you sign in with. Unitos asks Google for those three things and nothing more — it cannot read your Gmail, Drive, or Calendar.",
  pCollectContent:
    "What you put in: the documents and videos you upload, the pages you add by URL and the text parsed from them, and every corpus, section, note, annotation, highlight, comment, distillation, extraction, and summary you make.",
  pCollectContext:
    "Your context: the background, purpose, and application you optionally write in the Context tab, which conditions what the assistant says.",
  pCollectPrefs: "Your preferences: interface language and theme.",
  pCollectFeedback:
    "Feedback you send: the message, the page you sent it from, and your browser's user-agent string.",
  pCollectLogs:
    "Ordinary server logs kept by the hosting provider, such as IP addresses and request times.",

  pCookiesHeading: "Cookies",
  pCookies:
    "Unitos sets three cookies, all functional: one that keeps you signed in, one that remembers your language, and one for the administrator area. There are no advertising, analytics, or tracking cookies, and no third-party trackers on any page.",

  pAiHeading: "Where your material goes",
  pAiIntro:
    "Unitos is an AI reading tool, so parts of what you store are sent to AI providers to answer your requests. This only happens when you ask for something — nothing is sent in the background:",
  pAiAnthropic:
    "Anthropic (Claude) receives document text, your notes and annotations, and your context, when you use Explain, Simplify, Distill, Extract, Summarize, or the assistant.",
  pAiOpenAI:
    "OpenAI receives the text you ask to be read aloud, and the audio of videos you upload, for transcription.",
  pAiGoogle:
    "Google (Gemini) receives videos you upload, or the link to a YouTube video you add, for transcription and for describing a frame you ask about.",
  pAiYouTube:
    "YouTube receives a request for captions and preview frames when you add a YouTube video.",
  pAiTraining:
    "These providers process this material to return a result. Unitos does not sell your material and does not use it to train any model. Each provider handles it under its own API terms — Anthropic and OpenAI do not train on API content by default; Google's terms depend on the Gemini plan in use.",

  pWhereHeading: "Where it is stored",
  pWhere:
    "Everything is stored in a PostgreSQL database, including uploaded files, and the app runs on Vercel. Both are third-party providers that hold the data on Unitos's behalf.",

  pRetentionHeading: "How long it is kept",
  pRetention:
    "Your material stays until you delete it. Deleting a corpus deletes its notes and annotations. Rejected notes are kept seven days so you can undo, then permanently deleted by a daily job. To delete your account and everything in it, email robertwzl311@gmail.com and it will be done.",

  pRightsHeading: "Your choices",
  pRightsIntro: "It is your material, and you can:",
  pRightsExport: "Export any corpus to Markdown or Word from the app, at any time.",
  pRightsEdit: "Edit or delete any document, note, or annotation yourself.",
  pRightsDelete: "Ask for a copy of your data, a correction, or full deletion, by email.",
  pRightsLaw:
    "If you are in the EEA, the UK, or California, you have rights of access, correction, deletion, and portability under laws such as the GDPR and CCPA. Unitos honours these for everyone, by email, without charge.",

  pChildrenHeading: "Children",
  pChildren:
    "Unitos is not intended for children under 13, and is not knowingly used by them. If a child's data has ended up here, email and it will be removed.",

  pSecurityHeading: "Security",
  pSecurity:
    "Traffic is encrypted over HTTPS, the sign-in cookie cannot be read by scripts, and each account can only reach its own corpora. No service can promise perfect security, so please do not store anything you could not bear to lose or to see exposed.",

  pChangesHeading: "Changes to this policy",
  pChanges:
    "If this policy changes, the date at the top changes with it. A change that materially affects what happens to your material will be announced in the app before it takes effect.",

  pContactHeading: "Contact",
  pContact: "Email robertwzl311@gmail.com about anything on this page.",

  // ── Terms ────────────────────────────────────────────────────────────────
  tIntro:
    "These terms are the agreement between you and Unitos. Using the app at unitosnotebook.com means you accept them. If you do not, please do not use the app.",

  tServiceHeading: "What Unitos is",
  tService:
    "Unitos is a tool for reading documents and videos closely and keeping notes anchored to them, with an assistant that reads what you have collected. It is early software, run by one developer, and provided free.",

  tAccountHeading: "Your account",
  tAccount:
    "You sign in with a Google account, and that account is yours alone — keep it secure, and do not share it. You must be at least 13 years old. Unitos may suspend an account that breaks these terms.",

  tContentHeading: "Your material",
  tContent:
    "What you upload and write stays yours. You give Unitos only the permission it needs to run the app for you: to store your material, to process it, and to send the relevant parts to the AI providers named in the Privacy Policy when you ask for something. That permission ends when you delete the material.",

  tUseHeading: "Using it fairly",
  tUseIntro: "When you use Unitos, do not:",
  tUseRights:
    "Upload documents or videos you have no right to use, or use Unitos in a way that breaks someone's copyright.",
  tUseIllegal: "Store or produce anything unlawful, or anything designed to harm someone.",
  tUseAbuse:
    "Attack, overload, or probe the service, work around its limits, or use it to build a competing product from its output.",
  tUseAutomate: "Run automated bulk requests that are not ordinary use of the app.",

  tAiHeading: "What the assistant says",
  tAi:
    "The assistant and every AI feature can be wrong, incomplete, or confidently mistaken, including when they quote or cite a document. Check anything that matters against the source itself — that is what the anchors and source chips are for. Nothing Unitos produces is legal, financial, medical, or investment advice, and decisions you make from it are yours.",

  tThirdHeading: "Services Unitos relies on",
  tThird:
    "Signing in uses Google, and the AI features use Anthropic, OpenAI, Google, and YouTube. Their own terms apply to their part of the work, and an outage or change at any of them can affect Unitos.",

  tAvailabilityHeading: "Availability",
  tAvailability:
    "Unitos is provided as it is, with no promise that it will be available, uninterrupted, or free of faults, and features may change or be withdrawn. Keep your own copies of anything you cannot afford to lose — the export in the app is there for that.",

  tLiabilityHeading: "Liability",
  tLiability:
    "To the extent the law allows, Unitos is not liable for lost material, lost profit, or any indirect or consequential loss arising from your use of it. Nothing here limits liability that cannot legally be limited.",

  tEndHeading: "Ending your use",
  tEnd:
    "You can stop at any time, and email robertwzl311@gmail.com to have your account and material deleted. Unitos may end or restrict access if these terms are broken, or if running the service is no longer possible.",

  jurisdiction: "the State of California, United States",
  tLawHeading: "Governing law",
  tLaw:
    "These terms are governed by the laws of {jurisdiction}, and disputes belong to the courts there.",

  tChangesHeading: "Changes to these terms",
  tChanges:
    "If these terms change, the date at the top changes with them, and continuing to use Unitos means accepting the new version.",

  tContactHeading: "Contact",
  tContact: "Email robertwzl311@gmail.com about anything on this page.",
};

const zh: Record<keyof typeof en, string> = {
  // Shared
  updated: "最后更新：2026年8月26日",
  backToApp: "返回 Unitos",
  privacyTitle: "隐私政策",
  termsTitle: "服务条款",
  seeTerms: "服务条款",
  seePrivacy: "隐私政策",

  // ── Privacy ──────────────────────────────────────────────────────────────
  pIntro:
    "Unitos 是 unitosnotebook.com 上的阅读与笔记应用。本政策说明应用存储什么、把你的材料发给谁，以及你可以如何处理这些数据。本政策仅适用于本应用。",

  pWhoHeading: "谁在运营 Unitos",
  pWho:
    "Unitos 由一位独立开发者运营，不是公司。关于本政策、你的数据或删除请求，请联系 robertwzl311@gmail.com。",

  pCollectHeading: "Unitos 存储什么",
  pCollectIntro: "Unitos 只存储作为你的笔记本所必需的内容：",
  pCollectAccount:
    "你的账户：你用于登录的 Google 账户上的邮箱地址、姓名和头像。Unitos 只向 Google 请求这三项，不请求更多——它无法读取你的 Gmail、云端硬盘或日历。",
  pCollectContent:
    "你放进去的内容：你上传的文档和视频、你通过网址添加的页面及其解析出的文字，以及你做的每一个文集、章节、笔记、批注、高亮、评论、提炼、提取和摘要。",
  pCollectContext:
    "你的背景：你在“背景”页签中选填的背景、目的和用途，它们决定助手如何作答。",
  pCollectPrefs: "你的偏好：界面语言和主题。",
  pCollectFeedback: "你发送的反馈：内容本身、发送时所在的页面，以及浏览器的 user-agent 字符串。",
  pCollectLogs: "托管服务商保留的常规服务器日志，例如 IP 地址和请求时间。",

  pCookiesHeading: "Cookie",
  pCookies:
    "Unitos 设置三个 Cookie，全部为功能性：一个保持你的登录状态，一个记住你的语言，一个用于管理员区域。没有广告、分析或追踪 Cookie，任何页面上也没有第三方追踪器。",

  pAiHeading: "你的材料去往何处",
  pAiIntro:
    "Unitos 是 AI 阅读工具，因此你存储的部分内容会发送给 AI 服务商以响应你的请求。这只在你主动发起时发生——后台不发送任何内容：",
  pAiAnthropic:
    "当你使用解释、简化、提炼、提取、摘要或助手时，Anthropic（Claude）会收到文档文字、你的笔记和批注，以及你的背景。",
  pAiOpenAI: "OpenAI 会收到你要求朗读的文字，以及你上传的视频的音频，用于转写。",
  pAiGoogle:
    "Google（Gemini）会收到你上传的视频，或你添加的 YouTube 视频链接，用于转写以及描述你所询问的画面。",
  pAiYouTube: "当你添加 YouTube 视频时，YouTube 会收到获取字幕和预览画面的请求。",
  pAiTraining:
    "这些服务商处理这些材料以返回结果。Unitos 不出售你的材料，也不用它训练任何模型。各服务商依其自身的 API 条款处理这些材料——Anthropic 和 OpenAI 默认不使用 API 内容训练模型；Google 的条款取决于所用的 Gemini 方案。",

  pWhereHeading: "存储在哪里",
  pWhere:
    "所有内容（包括上传的文件）存储在 PostgreSQL 数据库中，应用运行在 Vercel 上。两者都是代 Unitos 保存数据的第三方服务商。",

  pRetentionHeading: "保留多久",
  pRetention:
    "你的材料一直保留，直到你删除它。删除文集会同时删除其笔记和批注。被拒绝的笔记保留七天以便撤销，随后由每日任务永久删除。要删除你的账户及其中的一切，请发邮件至 robertwzl311@gmail.com，即可办妥。",

  pRightsHeading: "你的选择",
  pRightsIntro: "这是你的材料，你可以：",
  pRightsExport: "随时在应用中把任何文集导出为 Markdown 或 Word。",
  pRightsEdit: "自行编辑或删除任何文档、笔记或批注。",
  pRightsDelete: "通过邮件索取你的数据副本、要求更正或彻底删除。",
  pRightsLaw:
    "如果你身处欧洲经济区、英国或加利福尼亚州，你依 GDPR、CCPA 等法律享有访问、更正、删除和可携带的权利。Unitos 对所有人一视同仁，通过邮件免费办理。",

  pChildrenHeading: "儿童",
  pChildren:
    "Unitos 不面向 13 岁以下儿童，也不会在知情的情况下被他们使用。如果儿童的数据出现在这里，请发邮件告知，数据会立即删除。",

  pSecurityHeading: "安全",
  pSecurity:
    "流量经 HTTPS 加密，登录 Cookie 无法被脚本读取，每个账户只能访问自己的文集。没有任何服务能承诺绝对安全，因此请不要存储你无法承受丢失或泄露的内容。",

  pChangesHeading: "本政策的变更",
  pChanges:
    "本政策变更时，顶部的日期会随之更新。若变更实质影响你的材料的处理方式，会在生效前于应用内告知。",

  pContactHeading: "联系",
  pContact: "本页任何事宜，请发邮件至 robertwzl311@gmail.com。",

  // ── Terms ────────────────────────────────────────────────────────────────
  tIntro:
    "本条款是你与 Unitos 之间的协议。使用 unitosnotebook.com 上的应用即表示你接受本条款。若不接受，请勿使用本应用。",

  tServiceHeading: "Unitos 是什么",
  tService:
    "Unitos 是精读文档与视频、并把笔记锚定其上的工具，配有能读取你所收集材料的助手。它是早期软件，由一位开发者运营，免费提供。",

  tAccountHeading: "你的账户",
  tAccount:
    "你使用 Google 账户登录，该账户仅属于你——请妥善保管，不要共享。你须年满 13 岁。对违反本条款的账户，Unitos 可暂停其使用。",

  tContentHeading: "你的材料",
  tContent:
    "你上传和写下的内容仍归你所有。你只授予 Unitos 运行本应用所必需的权限：存储你的材料、处理它，并在你发起请求时把相关部分发送给隐私政策中列明的 AI 服务商。你删除材料时，该权限即告终止。",

  tUseHeading: "合理使用",
  tUseIntro: "使用 Unitos 时，请勿：",
  tUseRights: "上传你无权使用的文档或视频，或以侵犯他人著作权的方式使用 Unitos。",
  tUseIllegal: "存储或生成任何违法内容，或任何意在伤害他人的内容。",
  tUseAbuse:
    "攻击、超载或探测本服务，规避其限制，或利用其输出构建竞争产品。",
  tUseAutomate: "发起超出应用正常使用范围的自动化批量请求。",

  tAiHeading: "助手所说的话",
  tAi:
    "助手和所有 AI 功能都可能出错、不完整，或在引用文档时言之凿凿却是错的。重要内容请对照原文核对——锚点和出处标签正是为此而设。Unitos 生成的内容均不构成法律、财务、医疗或投资建议，据此作出的决定由你自己负责。",

  tThirdHeading: "Unitos 依赖的服务",
  tThird:
    "登录使用 Google，AI 功能使用 Anthropic、OpenAI、Google 和 YouTube。它们各自的条款适用于其承担的部分，其中任何一方中断或变更都可能影响 Unitos。",

  tAvailabilityHeading: "可用性",
  tAvailability:
    "Unitos 按现状提供，不承诺持续可用、不中断或无缺陷，功能也可能变更或撤除。请自行备份你无法承受丢失的内容——应用内的导出功能正是为此而设。",

  tLiabilityHeading: "责任",
  tLiability:
    "在法律允许的范围内，Unitos 不对因你使用而产生的材料丢失、利润损失或任何间接或后果性损失承担责任。本条款不限制法律上不可限制的责任。",

  tEndHeading: "结束使用",
  tEnd:
    "你可以随时停止使用，并发邮件至 robertwzl311@gmail.com 删除你的账户和材料。若违反本条款，或服务无法继续运营，Unitos 可终止或限制访问。",

  jurisdiction: "美国加利福尼亚州",
  tLawHeading: "适用法律",
  tLaw: "本条款受 {jurisdiction} 法律管辖，争议由该地法院管辖。",

  tChangesHeading: "本条款的变更",
  tChanges:
    "本条款变更时，顶部的日期会随之更新，继续使用 Unitos 即表示接受新版本。",

  tContactHeading: "联系",
  tContact: "本页任何事宜，请发邮件至 robertwzl311@gmail.com。",
};

export const legal = { en, zh } as const;
