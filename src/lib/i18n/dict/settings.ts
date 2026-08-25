// UI strings of the settings surfaces. zh glossary: dict/common.ts. Every key
// exists in both languages — zh's type enforces it.

const en = {
  autoSave: "Changes save automatically",
  account: "Account",
  singleReader:
    "Sign-in is off — this instance runs as a single reader. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and SESSION_SECRET to open Google sign-in at /signin.",
  language: "Language",
  theme: "Theme",
  themeLight: "Light",
  themeLightDesc: "Always light",
  themeDark: "Dark",
  themeDarkDesc: "Always dark",
  themeSystem: "System",
  themeSystemDesc: "Follow the device",
  context: "Context",
  contextDesc:
    "Injected into every AI prompt: notes, distillation, analysis. Every field is optional. A work can override this from its Context tab.",
  background: "Background",
  backgroundPh: "e.g. Stanford student, stochastic calc + stats + quantum",
  purpose: "Purpose",
  purposePh: "e.g. due diligence, exam prep, replicate results",
  application: "Application",
  applicationPh: "e.g. investment decision for Bough Capital",
  services: "Services",
  svcAnthropic: "Derivations, assistant, glossary",
  svcGoogle: "Google sign-in at /signin",
  svcAdmin: "Feedback inbox and digest at /admin",
  set: "Set",
  notSet: "Not set",
  envHint:
    "Set these in your host's environment variables and redeploy. On Vercel: Settings → Environment Variables.",
  openInbox: "Open the feedback inbox",
};

const zh: Record<keyof typeof en, string> = {
  autoSave: "修改自动保存",
  account: "账户",
  singleReader:
    "此实例未开启登录——当前以单人阅读器模式运行。设置 GOOGLE_CLIENT_ID、GOOGLE_CLIENT_SECRET 和 SESSION_SECRET 即可在 /signin 开启 Google 登录。",
  language: "语言",
  theme: "主题",
  themeLight: "浅色",
  themeLightDesc: "始终浅色",
  themeDark: "深色",
  themeDarkDesc: "始终深色",
  themeSystem: "系统",
  themeSystemDesc: "跟随设备",
  context: "上下文",
  contextDesc:
    "注入每个 AI 提示词：笔记、提炼、分析。每个字段都可选。作品可在其上下文标签页覆盖此设置。",
  background: "背景",
  backgroundPh: "例如：斯坦福学生，随机微积分 + 统计 + 量子",
  purpose: "目的",
  purposePh: "例如：尽职调查、备考、复现结果",
  application: "用途",
  applicationPh: "例如：为 Bough Capital 做投资决策",
  services: "服务",
  svcAnthropic: "派生、助手、术语表",
  svcGoogle: "位于 /signin 的 Google 登录",
  svcAdmin: "位于 /admin 的反馈收件箱与汇编",
  set: "已设置",
  notSet: "未设置",
  envHint:
    "在托管平台的环境变量中设置这些值并重新部署。Vercel 上：Settings → Environment Variables。",
  openInbox: "打开反馈收件箱",
};

export const settings = { en, zh } as const;
