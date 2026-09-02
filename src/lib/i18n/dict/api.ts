// Error strings the API routes return in { error } bodies — the UI shows them
// verbatim in toasts and error paragraphs. zh glossary: dict/common.ts. Every
// key exists in both languages — zh's type enforces it. en stays byte-identical
// to the original route copy.

const en = {
  // Guards and lookups
  signInRequired: "Sign in to continue.",
  corpusNotFound: "Project not found",
  documentNotFound: "Document not found",
  documentNotFoundOrEmpty: "Document not found or empty",
  sectionNotFound: "Section not found",
  parentSectionNotFound: "Parent section not found",
  noteNotFound: "Note not found",
  mergeNeedsTwo: "Pick at least two notes to merge",
  mergeSameProject: "Notes must be in the same project",
  mergeAcceptedOnly: "Only accepted notes can merge. Decide pending notes first.",
  blockNotFound: "Block not found",
  blockNotInDocument: "Block not found in this document",
  blockNotInTargetDocument: "Block not found in the target document",
  linkNotFound: "Link not found",
  videoNotFound: "Video not found",
  uploadNotFound: "Upload not found",
  feedbackNotFound: "Feedback not found",
  documentNotAttached: "Document is not attached",
  documentNotAttachedToCorpus: "Document is not attached to this project",
  validationFailed: "Validation failed",
  bodyNotJson: "Body is not valid JSON",

  // Anchors, offsets, ranges
  anchorMissing: "Anchor is missing",
  anchorOffsetsInvalid: "Anchor offsets are invalid",
  anchorMismatch: "Anchor does not match the block text",
  anchorNotResolvedInDocument: "Anchor does not resolve in this document",
  styleOffsetsInvalid: "Style offsets are invalid",
  endBeforeStart: "The end must be after the start",
  startPastVideoEnd: "Start is past the end of the video",

  // Sections
  sectionsNestOneLevel: "Sections nest one level deep",

  // Blocks
  onlyTextBlocksEdited: "Only text blocks can be edited",
  onlyTextBlocksRemoved: "Only text blocks can be removed",
  onlyTextBlocksStyled: "Only text blocks can be styled",
  editNotRemovedParagraph: "Edit is not a removed paragraph",
  paragraphAlreadyBack: "Paragraph is already back",

  // Links
  linkSelfTarget: "A document-level link cannot point at itself",

  // Annotations
  commentEmpty: "Comment is empty",
  noVideo: "This document has no video",
  noVideoBlock: "This document has no video block",

  // Assistant
  assistantNeedsKey: "ANTHROPIC_API_KEY is not set. The assistant needs it.",
  assistantFailed: "The assistant failed. {reason}",
  taskCorpusScope: "This task runs at Project scope",
  questionRequired: "Question is required",
  taskFailed: "Task failed. {reason}",
  planFailed: "The assistant could not form a plan. {reason}",
  warnSourceQuoteNotFound: "Note source dropped: the quote was not found. ({description})",
  warnBlockNotFoundOrNotText: "Skipped: block not found or not text. ({description})",
  warnQuoteNotFound: "Skipped: the quote was not found in its block. ({description})",
  warnBlockNotFound: "Skipped: block not found. ({description})",
  warnOnlyTextEdited: "Skipped: only text blocks can be edited. ({description})",
  warnLinkTargetNotAttached: "Skipped: the link target is not another attached document. ({description})",

  // Derivations
  deriveNeedsKey: "ANTHROPIC_API_KEY is not set. Derivations need it.",
  typeNotBuilt: "{type} is not built yet",
  typeRequiresAnchor: "{type} requires an anchor",
  findRequiresQuery: "FIND requires a query",
  distillRequiresQuestion: "DISTILL requires a question",
  formalizeRequiresFormat: "FORMALIZE requires a format",
  findNeedsTranscript: "Transcribe the video first — Find searches the transcript",
  formalizeNeedsTranscript: "Transcribe first — Formalize rewrites the transcript",
  noStoredArticle: "This document has no article yet. Formalize the transcript first.",
  pastedTranscriptNoTimes:
    "The pasted text has no times. Copy the lines from YouTube's transcript panel, each with its time.",
  pastedTranscriptNoWords: "The pasted text has times but no words under them.",
  pastedTranscriptTooLong: "The pasted text is too long.",
  youtubeUnavailable:
    "This YouTube video did not load. It may be private, removed, or embedding-disabled.",
  mediaUnavailable: "This media link did not load. The file may be private, removed, or blocked.",
  unreadableContent:
    "No readable text was found on this page. The page may draw its text with scripts after loading, which this reader cannot run. Open the page in your browser, save it as a PDF, and upload that PDF.",
  reparseFailedReason: "Re-parse failed. {reason}",
  exportCitation: "{title}, block {blockId}",
  annotationNotSaved: "The annotation did not save. Try again.",
  findFailed: "Find failed. {reason}",
  salienceFailed: "Salience failed. {reason}",
  extractFailed: "Extract failed. {reason}",
  distillFailed: "Distill failed. {reason}",
  formalizeFailed: "Formalize failed. {reason}",
  salienceNoSpans: "Salience returned no resolvable spans",
  extractNoSpans: "Extract returned no resolvable spans",
  distillNoQuotes: "Distill returned no resolvable quotes",
  formalizeNoTopics: "Formalize returned no resolvable topics",

  // Documents and ingest
  parsingUnavailable: "Document parsing is unavailable: {message}",
  missingFile: "Missing file",
  notPdf: "File is not a PDF",
  pdfTooLarge: "PDF is larger than 50 MB",
  pdfParseFailedReason: "Could not read this PDF. {reason}",
  urlIngestFailedReason: "Could not ingest this URL. {reason}",
  pdfEncrypted: "This PDF is password-protected. Remove the password and upload it again.",
  pdfDamaged: "This PDF could not be opened. The file may be damaged, or not a PDF.",
  modelBusy: "The AI service is busy right now. Wait a minute and try again.",
  modelKeyInvalid: "The AI service rejected the key. Check ANTHROPIC_API_KEY.",
  ingestTimedOut: "The add ran out of time. Try again; a long page or a large PDF may need splitting.",
  // Why a page could not be fetched (lib/parse/fetch-page.ts), in plain words
  fetchBlocked:
    "{host} refused the request (HTTP {status}). The site blocks automated readers, and no archived copy exists. Open the page in your browser, save it as a PDF, and upload that PDF.",
  fetchChallenge:
    "{host} showed a human check instead of the page, and no archived copy exists. Open the page in your browser, save it as a PDF, and upload that PDF.",
  fetchNotFound: "{host} has no page at this link (HTTP {status}). Check the link.",
  fetchRateLimited:
    "{host} is limiting requests right now (HTTP 429), and no archived copy exists. Wait a minute and try again.",
  fetchServerError: "{host} answered with a server error (HTTP {status}). Try again later.",
  fetchTimeout: "{host} did not answer within 30 seconds. Try again.",
  fetchUnreachable: "{host} could not be reached. Check the link.",
  fetchArchivedCopy: "{host} refused the request. Reading the archived copy…",
  notesCiteDocument: "Notes cite this document. Delete those notes first.",
  glossaryNeedsKey: "ANTHROPIC_API_KEY is not set. Glossary extraction needs it.",
  glossaryFailed: "Glossary extraction failed",
  videoNoReparse: "Video documents do not re-parse",
  shapeSwitchNeedsPdf: "This document has no stored PDF to switch from",
  noStoredPdf: "This document has no stored PDF",

  // Upload assistant (SPEC.md §15)
  reviewFailed: "Could not review this URL",
  instructionsVideo:
    "A video or audio add stores the file and transcribes it. Upload instructions cannot steer it.",
  instructionsUnchecked:
    "The instructions could not be checked. The content adds without them.",

  // Uploads
  emptyChunk: "Empty chunk",
  chunkTooLarge: "Chunk is larger than 4 MB",
  uploadMissingChunks: "Upload is missing chunks. Try again.",
  videoTooLarge: "Video or audio is larger than 200 MB",
  notMedia: "File is not a supported video (mp4, webm, mov, ogg) or audio (mp3, m4a, wav, flac, ogg)",
  videoCopyIncomplete: "Video bytes did not copy completely. Try again.",
  videoSaveFailed: "Could not save this video",

  // Google Drive upload (SPEC.md §14)
  driveTokenMissing: "Missing Google Drive authorization",
  driveTokenExpired: "Your Google Drive access expired. Try again.",
  driveUnsupportedType:
    "This Drive file type isn't supported. Pick a PDF, Google Doc, Sheet, Slide, Drawing, video, or audio file.",
  driveExportTooLarge:
    "This Google Doc, Sheet, Slide, or Drawing is larger than Drive's 10 MB export limit",
  driveFetchFailed: "This Drive file did not load. It may be private, removed, or no longer accessible.",
  driveNotLinked: "Google Drive is not linked",
  driveTokenMintFailed: "Google Drive did not issue a token. Try again.",
  driveLinkUseDrive: "This is a Google Drive link. Use Add from Google Drive.",

  // Video playback and frames
  videoPlaysFromYouTube: "This video plays from YouTube",
  noStoryboard: "This video has no storyboard",
  frameUnavailable: "Frame is unavailable",
  frameFetchFailed: "Frame fetch failed ({status})",

  // Voice
  speechNeedsKey: "Voice failed; OPENAI_API_KEY is not set",
  voiceFailedRetry: "Voice failed. Try again.",
  voiceFailedStatus: "Voice failed ({status})",

  // Feedback
  feedbackLimit: "Feedback limit reached. Try again tomorrow.",
  feedbackNoAccount: "This feedback has no account to notify.",

  // Export
  exportFormatInvalid: "format must be md or docx",

  // Admin
  adminNotConfigured: "Admin login is not configured (ADMIN_PASSWORD unset).",
  invalidPassword: "Invalid password",
  accountNotFound: "Account not found",
  accountConfirmMismatch: "The confirmation does not match this account.",

  // Sharing
  viewingOnly: "You can view this project, not change it.",
  ownerOnly: "Only the owner can do this.",
  sharingNeedsSignIn: "Sharing needs sign-in. This instance runs as a single reader.",
  invalidEmail: "Enter a valid email address.",
  cannotShareWithOwner: "The owner already has access.",
  collaboratorLimit: "A project can have at most 30 collaborators.",
  collaboratorNotFound: "Collaborator not found",

  // Profile
  profileNeedsSignIn: "Profile editing needs sign-in. This instance runs as a single reader.",
  pictureInvalid: "Picture must be a JPEG, PNG, or WebP data URL under 300 KB.",

  // Project distillation
  corpusDistillNeedsDocuments: "Attach a document first — the project is empty.",

  // Replies
  editNotFound: "Edit not found",
  replyNotFound: "Reply not found",
  replyNotYours: "Only the reply's author or the owner can delete it.",

  // Notifications (SPEC.md §18)
  notificationNotFound: "Notification not found",
  notificationNoRecipients: "No recipients. Pick at least one account.",
};

const zh: Record<keyof typeof en, string> = {
  signInRequired: "请登录后继续。",
  corpusNotFound: "未找到该项目",
  documentNotFound: "未找到文档",
  documentNotFoundOrEmpty: "未找到文档或文档为空",
  sectionNotFound: "未找到章节",
  parentSectionNotFound: "未找到父章节",
  noteNotFound: "未找到笔记",
  mergeNeedsTwo: "至少选择两条笔记才能合并",
  mergeSameProject: "笔记必须在同一个项目中",
  mergeAcceptedOnly: "只有已接受的笔记可以合并。请先处理待定笔记。",
  blockNotFound: "未找到块",
  blockNotInDocument: "此文档中未找到该块",
  blockNotInTargetDocument: "目标文档中未找到该块",
  linkNotFound: "未找到链接",
  videoNotFound: "未找到视频",
  uploadNotFound: "未找到该次上传",
  feedbackNotFound: "未找到反馈",
  documentNotAttached: "文档未加入项目",
  documentNotAttachedToCorpus: "文档未加入此项目",
  validationFailed: "校验失败",
  bodyNotJson: "请求体不是有效的 JSON",

  anchorMissing: "缺少锚点",
  anchorOffsetsInvalid: "锚点偏移无效",
  anchorMismatch: "锚点与块文本不匹配",
  anchorNotResolvedInDocument: "锚点在此文档中无法定位",
  styleOffsetsInvalid: "样式偏移无效",
  endBeforeStart: "结束必须晚于开始",
  startPastVideoEnd: "开始时间超过了视频结尾",

  sectionsNestOneLevel: "章节只能嵌套一层",

  onlyTextBlocksEdited: "只有文本块可以编辑",
  onlyTextBlocksRemoved: "只有文本块可以移除",
  onlyTextBlocksStyled: "只有文本块可以设置样式",
  editNotRemovedParagraph: "此编辑不是被移除的段落",
  paragraphAlreadyBack: "段落已经恢复了",

  linkSelfTarget: "文档级链接不能指向自身",

  commentEmpty: "评论为空",
  noVideo: "此文档没有视频",
  noVideoBlock: "此文档没有视频块",

  assistantNeedsKey: "未设置 ANTHROPIC_API_KEY。助手需要它。",
  assistantFailed: "助手请求失败。{reason}",
  taskCorpusScope: "此任务在项目范围运行",
  questionRequired: "请输入问题",
  taskFailed: "任务失败。{reason}",
  planFailed: "助手无法生成计划。{reason}",
  warnSourceQuoteNotFound: "笔记出处已丢弃：未找到该引文。（{description}）",
  warnBlockNotFoundOrNotText: "已跳过：未找到块或不是文本块。（{description}）",
  warnQuoteNotFound: "已跳过：块中未找到该引文。（{description}）",
  warnBlockNotFound: "已跳过：未找到块。（{description}）",
  warnOnlyTextEdited: "已跳过：只有文本块可以编辑。（{description}）",
  warnLinkTargetNotAttached: "已跳过：链接目标不是此项目中的另一个文档。（{description}）",

  deriveNeedsKey: "未设置 ANTHROPIC_API_KEY。AI 生成需要它。",
  typeNotBuilt: "{type} 尚未实现",
  typeRequiresAnchor: "{type} 需要锚点",
  findRequiresQuery: "FIND 需要查询词",
  distillRequiresQuestion: "DISTILL 需要问题",
  formalizeRequiresFormat: "FORMALIZE 需要格式",
  findNeedsTranscript: "请先生成视频逐字稿——查找搜索的是逐字稿",
  formalizeNeedsTranscript: "请先生成逐字稿——整理改写的是逐字稿",
  noStoredArticle: "该文档还没有文章。请先整理逐字稿。",
  pastedTranscriptNoTimes: "粘贴的文字没有时间。请从 YouTube 的逐字稿面板复制各行，每行带时间。",
  pastedTranscriptNoWords: "粘贴的文字有时间，但时间下面没有文字。",
  pastedTranscriptTooLong: "粘贴的文字太长。",
  youtubeUnavailable: "这个 YouTube 视频无法加载。它可能已设为私密、被删除或禁止嵌入。",
  mediaUnavailable: "这个媒体链接无法加载。文件可能已设为私密、被删除或被拦截。",
  unreadableContent:
    "此页面上没有找到可读取的文字。页面可能在加载后用脚本生成文字，本阅读器无法运行脚本。请在浏览器中打开页面，另存为 PDF，再上传该 PDF。",
  reparseFailedReason: "重新解析失败。{reason}",
  exportCitation: "{title}，块 {blockId}",
  annotationNotSaved: "批注未保存。请重试。",
  findFailed: "查找失败。{reason}",
  salienceFailed: "要点识别失败。{reason}",
  extractFailed: "提取失败。{reason}",
  distillFailed: "提炼失败。{reason}",
  formalizeFailed: "整理失败。{reason}",
  salienceNoSpans: "要点识别未返回可定位的片段",
  extractNoSpans: "提取未返回可定位的片段",
  distillNoQuotes: "提炼未返回可定位的引文",
  formalizeNoTopics: "整理未返回可用的主题",

  parsingUnavailable: "文档解析不可用：{message}",
  missingFile: "缺少文件",
  notPdf: "文件不是 PDF",
  pdfTooLarge: "PDF 超过 50 MB",
  pdfParseFailedReason: "无法读取此 PDF。{reason}",
  urlIngestFailedReason: "无法导入此 URL。{reason}",
  pdfEncrypted: "此 PDF 有密码保护。请去掉密码后重新上传。",
  pdfDamaged: "此 PDF 无法打开。文件可能已损坏，或不是 PDF。",
  modelBusy: "AI 服务当前繁忙。请稍等一分钟再试。",
  modelKeyInvalid: "AI 服务拒绝了密钥。请检查 ANTHROPIC_API_KEY。",
  ingestTimedOut: "添加超时。请重试；很长的页面或很大的 PDF 可能需要拆分。",
  fetchBlocked:
    "{host} 拒绝了请求（HTTP {status}）。该网站拦截自动读取，也没有存档副本。请在浏览器中打开页面，另存为 PDF，再上传该 PDF。",
  fetchChallenge:
    "{host} 返回了人机验证页面而不是文章，也没有存档副本。请在浏览器中打开页面，另存为 PDF，再上传该 PDF。",
  fetchNotFound: "{host} 上没有此链接对应的页面（HTTP {status}）。请检查链接。",
  fetchRateLimited: "{host} 正在限制请求（HTTP 429），也没有存档副本。请稍等一分钟再试。",
  fetchServerError: "{host} 返回了服务器错误（HTTP {status}）。请稍后再试。",
  fetchTimeout: "{host} 在 30 秒内没有响应。请重试。",
  fetchUnreachable: "无法连接 {host}。请检查链接。",
  fetchArchivedCopy: "{host} 拒绝了请求。正在读取存档副本……",
  notesCiteDocument: "有笔记引用此文档。请先删除这些笔记。",
  glossaryNeedsKey: "未设置 ANTHROPIC_API_KEY。术语表生成需要它。",
  glossaryFailed: "术语表生成失败",
  videoNoReparse: "视频文档不能重新解析",
  shapeSwitchNeedsPdf: "此文档没有存储的 PDF，无法切换",
  noStoredPdf: "此文档没有存储的 PDF",

  reviewFailed: "无法审阅此 URL",
  instructionsVideo: "添加视频或音频时只存储文件并生成逐字稿。上传要求无法改变这一过程。",
  instructionsUnchecked: "上传要求未能检查。内容将不按要求添加。",

  emptyChunk: "分块为空",
  chunkTooLarge: "分块超过 4 MB",
  uploadMissingChunks: "上传缺少分块。请重试。",
  videoTooLarge: "视频或音频超过 200 MB",
  notMedia: "文件不是支持的视频格式（mp4、webm、mov、ogg）或音频格式（mp3、m4a、wav、flac、ogg）",
  videoCopyIncomplete: "视频数据未完整复制。请重试。",
  videoSaveFailed: "无法保存此视频",

  driveTokenMissing: "缺少 Google Drive 授权",
  driveTokenExpired: "Google Drive 访问已过期。请重试。",
  driveUnsupportedType:
    "此 Drive 文件类型暂不支持。请选择 PDF、Google 文档、表格、幻灯片、绘图、视频或音频文件。",
  driveExportTooLarge: "此 Google 文档/表格/幻灯片/绘图超过 Drive 10 MB 的导出限制",
  driveFetchFailed: "这个 Drive 文件无法加载。文件可能已设为私密、被删除，或已无法访问。",
  driveNotLinked: "Google Drive 未关联",
  driveTokenMintFailed: "Google Drive 未签发访问令牌。请重试。",
  driveLinkUseDrive: "这是 Google Drive 链接。请使用“从 Google Drive 添加”。",

  videoPlaysFromYouTube: "此视频从 YouTube 播放",
  noStoryboard: "此视频没有预览画面",
  frameUnavailable: "画面不可用",
  frameFetchFailed: "画面获取失败（{status}）",

  speechNeedsKey: "朗读失败，且未设置 OPENAI_API_KEY",
  voiceFailedRetry: "朗读失败。请重试。",
  voiceFailedStatus: "朗读失败（{status}）",

  feedbackLimit: "反馈已达上限。请明天再试。",
  feedbackNoAccount: "这条反馈没有可通知的账户。",

  exportFormatInvalid: "format 必须是 md 或 docx",

  adminNotConfigured: "管理登录未配置（未设置 ADMIN_PASSWORD）。",
  invalidPassword: "密码错误",
  accountNotFound: "未找到账户",
  accountConfirmMismatch: "确认内容与该账户不匹配。",

  viewingOnly: "你可以查看此项目，但不能修改。",
  ownerOnly: "只有所有者可以执行此操作。",
  sharingNeedsSignIn: "共享需要登录。此实例以单人阅读器模式运行。",
  invalidEmail: "请输入有效的邮箱地址。",
  cannotShareWithOwner: "所有者已经拥有访问权限。",
  collaboratorLimit: "一个项目最多可有 30 位协作者。",
  collaboratorNotFound: "未找到协作者",

  profileNeedsSignIn: "编辑个人资料需要登录。此实例以单人阅读器模式运行。",
  pictureInvalid: "头像必须是 300 KB 以内的 JPEG、PNG 或 WebP data URL。",

  corpusDistillNeedsDocuments: "请先添加文档——项目为空。",

  editNotFound: "未找到该编辑",
  replyNotFound: "未找到该回复",
  replyNotYours: "只有回复的作者或所有者可以删除它。",

  notificationNotFound: "未找到通知",
  notificationNoRecipients: "没有收件人。请至少选择一个账户。",
};

export const api = { en, zh } as const;
