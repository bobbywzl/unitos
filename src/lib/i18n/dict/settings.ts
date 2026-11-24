// UI strings of the settings surfaces. zh glossary: dict/common.ts. Every key
// exists in both languages — zh's type enforces it.

export const en = {
  autoSave: "Changes save automatically",
  profile: "Profile",
  profileDesc:
    "How you appear on shared projects — your picture, symbol, and color label your notes and edits.",
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
    "Who you are and what you read for. Every AI tool reads it: notes, extraction, analysis. Optional.",
  backgroundPh: "e.g. Stanford student, stochastic calc + stats + quantum. Reading for due diligence.",
  singleReader:
    "Sign-in is off — this instance runs as a single reader. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and SESSION_SECRET to open Google sign-in at /signin.",
  // Subscription (SPEC.md §24, TIERS.md): the subscription panel — the
  // plan, its status, the card, the actions on the subscription
  // (billing.panel*), then what the tier holds.
  subscription: "Subscription",
  planPremium:
    "Offline work — notes, non-AI annotations, edits, uploads — saves on this device and syncs when you are back online. Images up to 25 MB drop into notes.",
  planUltra:
    "Everything in Unitos Premium. Visualize: the selection as a picture — a diagram, a drawing, or a short animation. Conversations: continue a Simplify, Analyze, or Visualize card into a conversation.",
  planExpired: "Offline changes do not save, and images over 5 MB do not drop.",
  planMark:
    "The tier mark beside your badge says your tier everywhere: the white crystal is Unitos Premium, the black diamond is Unitos Ultra.",
  // Connections (SPEC.md §14): the services connected to the account and what
  // each one reaches.
  connections: "Connections",
  connectionsDesc: "The services connected to this account, and what each one can reach.",
  connectionsNone:
    "None. Sign-in is off, so there is no account to connect; Google Drive asks for access each visit.",
  signIn: "Sign-in",
  signInDesc: "{email}. Google, Apple, and email sign-in all open this account. Password: {password}.",
  passwordSet: "set",
  passwordNone: "none",
  drive: "Google Drive",
  driveDescAll:
    "Link Google Drive to pick files without a popup and to add any Drive link directly. Unitos gets read access to all files in your Google Drive.",
  driveDescPicked:
    "Link Google Drive to pick files without a popup. Unitos reads only the files you pick.",
  driveLinkedAll: "Google Drive is linked: all files. Picks and pasted Drive links use this grant.",
  driveLinkedPicked:
    "Google Drive is linked: picked files only. Picks use this grant; a pasted Drive link works for picked files only.",
  driveLink: "Link Google Drive",
  driveRelink: "Link again for all files",
  driveUnlink: "Unlink",
  // Your data: every stored field and count about the account
  // (lib/account-data.ts), read-only.
  // Storage (TIERS.md): the account's files against the tier's limit
  storage: "Storage",
  storageUsed: "{used} used",
  storageOf: "{used} of {limit} used",
  storageNoLimit: "No storage limit is set for {tier} yet.",
  storageDocuments: "Documents",
  storageImages: "Images",
  storageVideos: "Videos",
  data: "Your data",
  dataDesc: "Everything Unitos holds about this account. The Privacy Policy says where each part goes:",
  dataEmail: "Email",
  dataName: "Name",
  dataPicture: "Picture",
  dataPassword: "Password",
  dataStored: "stored",
  dataNone: "none",
  dataCreated: "Account created",
  dataLastSeen: "Last active",
  dataLastSeenDesc: "Updated about once every five minutes while you use the app.",
  dataSessions: "Signed-in sessions",
  dataSessionsDesc: "Browsers signed in to this account. Sign out ends this one.",
  dataBackground: "Background",
  dataBackgroundDesc: "Injected into every AI prompt.",
  dataProjects: "Projects",
  dataDocuments: "Documents",
  dataDocumentsDesc: "The files and pages you added, and the text parsed from them.",
  dataNotes: "Notes",
  dataDigests: "Digests",
  dataDigestsDesc: "The stored project context the assistant reads, one per project.",
  dataKeptChats: "Kept conversations",
  dataKeptChatsDesc: "Your questions and the assistant's answers, one conversation per project and place, kept until you clear them.",
  dataPositions: "Reading positions",
  dataPositionsDesc: "Where you left off in each document, so the reader opens there.",
  dataClicks: "Clicks",
  dataClicksDesc: "Which controls you click, with the open project. Read by the administrator's usage page.",
  dataUsage: "AI calls",
  dataUsageDesc: "Provider, model, token counts, and cost of each call. Never the text.",
  dataFeedback: "Feedback",
  dataFeedbackDesc: "Each message, the page it was sent from, and your browser's user-agent string.",
  dataNotifications: "Notifications",
  dataDriveAll: "linked: all files",
  dataDrivePicked: "linked: picked files only",
  dataDriveNone: "not linked",
  dataDriveDesc: "Linked: a refresh token Unitos uses to read a Drive file when you add it. Unlink revokes it.",
  dataBrowser: "In your browser only",
  dataBrowserValue:
    "Language cookie, theme, typed words not saved yet, offline work queued on this device, and the offline copies of saved projects.",
  dataOffline: "Projects saved for offline",
  dataOfflineDesc: "Each copy is the project's pages and images in this browser's cache. Sign out removes them.",
  dataLogs: "Server logs",
  dataLogsValue: "The hosting provider keeps IP addresses and request times.",
  dataDelete: "To delete this account and everything in it, email {email}.",
  language: "Language",
  theme: "Theme",
  themeLight: "Light",
  themeLightDesc: "Always light",
  themeDark: "Dark",
  themeDarkDesc: "Always dark",
  themeSystem: "System",
  themeSystemDesc: "Follow the device",
};
