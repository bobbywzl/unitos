// UI strings of the settings surfaces. zh glossary: dict/common.ts. Every key
// exists in both languages — zh's type enforces it.

const en = {
  autoSave: "Changes save automatically",
  profile: "Profile",
  profileDesc:
    "How you appear on shared corpora — your picture, symbol, and color label your notes and edits.",
  picture: "Picture",
  uploadPicture: "Upload picture",
  removePicture: "Remove",
  pictureFailed: "Picture upload failed. Try a smaller image.",
  name: "Name",
  namePh: "Your name",
  symbol: "Symbol",
  symbolDesc: "1–2 characters shown on your badge. Empty = the first letter of your name.",
  color: "Color",
  background: "Background",
  backgroundDesc:
    "Who you are and what you read for. Injected into every AI prompt: notes, distillation, analysis. Optional. A work can override this from its Context tab.",
  backgroundPh: "e.g. Stanford student, stochastic calc + stats + quantum. Reading for due diligence.",
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
};

const zh: Record<keyof typeof en, string> = {
  autoSave: "修改自动保存",
  profile: "个人资料",
  profileDesc: "你在共享文集中的形象——头像、符号和颜色会标注你的笔记和编辑。",
  picture: "头像",
  uploadPicture: "上传头像",
  removePicture: "移除",
  pictureFailed: "头像上传失败。请尝试更小的图片。",
  name: "名字",
  namePh: "你的名字",
  symbol: "符号",
  symbolDesc: "徽章上显示的 1–2 个字符。留空 = 姓名首字符。",
  color: "颜色",
  background: "背景",
  backgroundDesc:
    "你是谁、为什么而读。注入到每个 AI 提示词中：笔记、提炼、分析。可选。各文集可在其“背景”页签覆盖此设置。",
  backgroundPh: "如：斯坦福学生，修过随机微积分、统计和量子力学。为尽职调查而读。",
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
};

export const settings = { en, zh } as const;
