// Error strings the API routes return in { error } bodies — the UI shows them
// verbatim in toasts and error paragraphs. zh glossary: dict/common.ts. Every
// key exists in both languages — zh's type enforces it. en stays byte-identical
// to the original route copy.

const en = {
  // Guards and lookups
  signInRequired: "Sign in to continue.",
  corpusNotFound: "Corpus not found",
  documentNotFound: "Document not found",
  documentNotFoundOrEmpty: "Document not found or empty",
  sectionNotFound: "Section not found",
  parentSectionNotFound: "Parent section not found",
  noteNotFound: "Note not found",
  blockNotFound: "Block not found",
  blockNotInDocument: "Block not found in this document",
  blockNotInTargetDocument: "Block not found in the target document",
  linkNotFound: "Link not found",
  videoNotFound: "Video not found",
  uploadNotFound: "Upload not found",
  feedbackNotFound: "Feedback not found",
  documentNotAttached: "Document is not attached",
  documentNotAttachedToCorpus: "Document is not attached to this corpus",
  validationFailed: "Validation failed",
  bodyNotJson: "Body is not valid JSON",

  // Anchors, offsets, ranges
  anchorMissing: "Anchor is missing",
  anchorOffsetsInvalid: "Anchor offsets are invalid",
  anchorMismatch: "Anchor does not match the block text",
  anchorNotResolved: "Anchor does not resolve",
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
  taskCorpusScope: "This task runs at Corpus scope",
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
  findNeedsTranscript: "Transcribe the video first — Find searches the transcript",
  annotationNotSaved: "The annotation did not save. Try again.",
  findFailed: "Find failed. {reason}",
  salienceFailed: "Salience failed. {reason}",
  extractFailed: "Extract failed. {reason}",
  distillFailed: "Distill failed. {reason}",
  salienceNoSpans: "Salience returned no resolvable spans",
  extractNoSpans: "Extract returned no resolvable spans",
  distillNoQuotes: "Distill returned no resolvable quotes",

  // Documents and ingest
  parsingUnavailable: "Document parsing is unavailable: {message}",
  missingFile: "Missing file",
  notPdf: "File is not a PDF",
  pdfTooLarge: "PDF is larger than 50MB",
  pdfParseFailed: "Could not parse this PDF",
  urlIngestFailed: "Could not ingest this URL",
  notesCiteDocument: "Notes cite this document. Delete those notes first.",
  glossaryNeedsKey: "ANTHROPIC_API_KEY is not set. Glossary extraction needs it.",
  glossaryFailed: "Glossary extraction failed",
  videoNoReparse: "Video documents do not re-parse",
  reparseFailed: "Re-parse failed",

  // Uploads
  emptyChunk: "Empty chunk",
  chunkTooLarge: "Chunk is larger than 4 MB",
  uploadMissingChunks: "Upload is missing chunks. Try again.",
  videoTooLarge: "Video is larger than 200MB",
  notVideo: "File is not a supported video (mp4, webm, or ogg)",
  videoCopyIncomplete: "Video bytes did not copy completely. Try again.",
  videoSaveFailed: "Could not save this video",

  // Video playback and frames
  videoPlaysFromYouTube: "This video plays from YouTube",
  noStoryboard: "This video has no storyboard",
  frameUnavailable: "Frame is unavailable",
  frameFetchFailed: "Frame fetch failed ({status})",

  // Voice
  speechNeedsKey: "OPENAI_API_KEY is not set",
  voiceFailedRetry: "Voice failed. Try again.",
  voiceFailedStatus: "Voice failed ({status})",

  // Feedback
  feedbackLimit: "Feedback limit reached. Try again tomorrow.",

  // Export
  exportFormatInvalid: "format must be md or docx",

  // Admin
  adminNotConfigured: "Admin login is not configured (ADMIN_PASSWORD unset).",
  invalidPassword: "Invalid password",

  // Sharing
  viewingOnly: "You can view this corpus, not change it.",
  ownerOnly: "Only the owner can do this.",
  sharingNeedsSignIn: "Sharing needs sign-in. This instance runs as a single reader.",
  invalidEmail: "Enter a valid email address.",
  cannotShareWithOwner: "The owner already has access.",
  collaboratorLimit: "A corpus can have at most 30 collaborators.",
  collaboratorNotFound: "Collaborator not found",

  // Profile
  profileNeedsSignIn: "Profile editing needs sign-in. This instance runs as a single reader.",
  pictureInvalid: "Picture must be a JPEG, PNG, or WebP data URL under 300 KB.",

  // Replies
  editNotFound: "Edit not found",
  replyNotFound: "Reply not found",
  replyNotYours: "Only the reply's author or the owner can delete it.",
};

const zh: Record<keyof typeof en, string> = {
  signInRequired: "请登录后继续。",
  corpusNotFound: "未找到文集",
  documentNotFound: "未找到文档",
  documentNotFoundOrEmpty: "未找到文档或文档为空",
  sectionNotFound: "未找到章节",
  parentSectionNotFound: "未找到父章节",
  noteNotFound: "未找到笔记",
  blockNotFound: "未找到块",
  blockNotInDocument: "此文档中未找到该块",
  blockNotInTargetDocument: "目标文档中未找到该块",
  linkNotFound: "未找到链接",
  videoNotFound: "未找到视频",
  uploadNotFound: "未找到上传",
  feedbackNotFound: "未找到反馈",
  documentNotAttached: "文档未附加",
  documentNotAttachedToCorpus: "文档未附加到此文集",
  validationFailed: "校验失败",
  bodyNotJson: "请求体不是有效的 JSON",

  anchorMissing: "缺少锚点",
  anchorOffsetsInvalid: "锚点偏移无效",
  anchorMismatch: "锚点与块文本不匹配",
  anchorNotResolved: "锚点无法解析",
  anchorNotResolvedInDocument: "锚点在此文档中无法解析",
  styleOffsetsInvalid: "样式偏移无效",
  endBeforeStart: "结束必须晚于开始",
  startPastVideoEnd: "开始时间超过了视频结尾",

  sectionsNestOneLevel: "章节只嵌套一层",

  onlyTextBlocksEdited: "只有文本块可以编辑",
  onlyTextBlocksRemoved: "只有文本块可以移除",
  onlyTextBlocksStyled: "只有文本块可以设置样式",
  editNotRemovedParagraph: "此编辑不是被移除的段落",
  paragraphAlreadyBack: "段落已恢复",

  linkSelfTarget: "文档级链接不能指向自身",

  commentEmpty: "评论为空",
  noVideo: "此文档没有视频",
  noVideoBlock: "此文档没有视频块",

  assistantNeedsKey: "未设置 ANTHROPIC_API_KEY。助手需要它。",
  assistantFailed: "助手失败了。{reason}",
  taskCorpusScope: "此任务在文集范围运行",
  questionRequired: "请输入问题",
  taskFailed: "任务失败。{reason}",
  planFailed: "助手无法生成计划。{reason}",
  warnSourceQuoteNotFound: "笔记出处已丢弃：未找到该引文。（{description}）",
  warnBlockNotFoundOrNotText: "已跳过：未找到块或不是文本块。（{description}）",
  warnQuoteNotFound: "已跳过：块中未找到该引文。（{description}）",
  warnBlockNotFound: "已跳过：未找到块。（{description}）",
  warnOnlyTextEdited: "已跳过：只有文本块可以编辑。（{description}）",
  warnLinkTargetNotAttached: "已跳过：链接目标不是另一个已附加的文档。（{description}）",

  deriveNeedsKey: "未设置 ANTHROPIC_API_KEY。派生需要它。",
  typeNotBuilt: "{type} 尚未实现",
  typeRequiresAnchor: "{type} 需要锚点",
  findRequiresQuery: "FIND 需要查询词",
  distillRequiresQuestion: "DISTILL 需要问题",
  findNeedsTranscript: "请先生成视频逐字稿——查找搜索的是逐字稿",
  annotationNotSaved: "批注未保存。请重试。",
  findFailed: "查找失败。{reason}",
  salienceFailed: "要点生成失败。{reason}",
  extractFailed: "提取失败。{reason}",
  distillFailed: "提炼失败。{reason}",
  salienceNoSpans: "要点生成未返回可解析的片段",
  extractNoSpans: "提取未返回可解析的片段",
  distillNoQuotes: "提炼未返回可解析的引文",

  parsingUnavailable: "文档解析不可用：{message}",
  missingFile: "缺少文件",
  notPdf: "文件不是 PDF",
  pdfTooLarge: "PDF 超过 50MB",
  pdfParseFailed: "无法解析此 PDF",
  urlIngestFailed: "无法导入此 URL",
  notesCiteDocument: "有笔记引用此文档。请先删除那些笔记。",
  glossaryNeedsKey: "未设置 ANTHROPIC_API_KEY。术语表生成需要它。",
  glossaryFailed: "术语表生成失败",
  videoNoReparse: "视频文档不能重新解析",
  reparseFailed: "重新解析失败",

  emptyChunk: "分块为空",
  chunkTooLarge: "分块超过 4 MB",
  uploadMissingChunks: "上传缺少分块。请重试。",
  videoTooLarge: "视频超过 200MB",
  notVideo: "文件不是支持的视频格式（mp4、webm 或 ogg）",
  videoCopyIncomplete: "视频数据未完整复制。请重试。",
  videoSaveFailed: "无法保存此视频",

  videoPlaysFromYouTube: "此视频从 YouTube 播放",
  noStoryboard: "此视频没有故事板",
  frameUnavailable: "帧不可用",
  frameFetchFailed: "帧获取失败（{status}）",

  speechNeedsKey: "未设置 OPENAI_API_KEY",
  voiceFailedRetry: "朗读失败。请重试。",
  voiceFailedStatus: "朗读失败（{status}）",

  feedbackLimit: "反馈已达上限。请明天再试。",

  exportFormatInvalid: "format 必须是 md 或 docx",

  adminNotConfigured: "管理登录未配置（未设置 ADMIN_PASSWORD）。",
  invalidPassword: "密码错误",

  viewingOnly: "你可以查看此文集，但不能修改。",
  ownerOnly: "只有所有者可以执行此操作。",
  sharingNeedsSignIn: "共享需要登录。此实例以单人阅读器模式运行。",
  invalidEmail: "请输入有效的邮箱地址。",
  cannotShareWithOwner: "所有者已经拥有访问权限。",
  collaboratorLimit: "一个文集最多可有 30 位协作者。",
  collaboratorNotFound: "未找到协作者",

  profileNeedsSignIn: "编辑个人资料需要登录。此实例以单人阅读器模式运行。",
  pictureInvalid: "头像必须是 300 KB 以内的 JPEG、PNG 或 WebP data URL。",

  editNotFound: "未找到该编辑",
  replyNotFound: "未找到该回复",
  replyNotYours: "只有回复的作者或所有者可以删除它。",
};

export const api = { en, zh } as const;
