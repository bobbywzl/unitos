// UI strings of the video surfaces. zh glossary: dict/common.ts. Every key
// exists in both languages — zh's type enforces it.
//
// zh terms fixed for this namespace (one term per concept):
//   transcribe 转写 · frame 画面 · circle (a spot) 圈选 · moment 时刻 ·
//   range 区间 · line 行 · Find 查找 · seek/jump 跳转 · Visual 画面批注

const en = {
  // Player controls
  play: "Play",
  pause: "Pause",
  playSpace: "Play (space)",
  pauseSpace: "Pause (space)",
  seek: "Seek",
  mute: "Mute",
  unmute: "Unmute",
  annotate: "Annotate",
  annotateTitle: "Circle a spot on the frame and comment on it",
  fullscreen: "Fullscreen",
  exitFullscreen: "Exit fullscreen",
  fullscreenF: "Fullscreen (f)",
  exitFullscreenF: "Exit fullscreen (f)",
  annotationAt: "Annotation at {time}",
  useWholeFrame: "Use the whole frame",
  youtubeError: "This YouTube video did not play. It may be private or embedding-disabled.",
  videoError: "This video did not play in this browser.",

  // Pane: header, tool caption, tool bar
  kindVideo: "Video",
  hintCaption: "Circle a spot to comment · Search the video · Click a transcript line to seek",
  circleComment: "Circle & comment",
  circleCommentTitle:
    "Pause and circle a spot on the frame — or take the whole frame — then comment or explain",
  linesCount: "{n} lines",
  transcriptFailedChip: "Transcript failed",
  transcribing: "Transcribing…",
  drawHelp:
    "Draw around a spot on the frame — the loop closes itself — or use the whole frame. Esc cancels.",

  // Find
  findPlaceholder: "Find in this video…",
  findPlaceholderNeedsTranscript: "Find in this video (needs the transcript)…",
  findAria: "Find in this video",
  findEmpty: "Nothing in the video answers that.",
  findFailed: "Find failed",
  jumpToPart: "Jump the player to this part",
  addedPending: "Added — pending in Notes",
  addSectionFirst: "Add a section first",
  addAsPendingNote: "Add as a pending note in {section}",
  adding: "Adding…",
  addToNotes: "Add to notes",
  saveFailed: "Save failed",

  // Composer and annotation cards
  newAnnotation: "New annotation",
  startTime: "Start time",
  endTime: "End time",
  to: "to",
  regionShows: "The annotation shows whenever playback is inside this range.",
  wholeFrameShows: "Whole frame: the comment shows over the video in this range.",
  commentCircledPlaceholder: "Comment on the circled spot",
  commentMomentPlaceholder: "Comment on this moment",
  timesInvalid: "Times are m:ss, and the end must be after the start.",
  writeCommentFirst: "Write the comment first.",
  saveAnnotation: "Save annotation",
  explainCircled: "Explain the circled spot",
  explainThisMoment: "Explain this moment",
  explainButtonTitle:
    "The model reads the frame and the transcript; the explanation saves as an annotation here",
  explanation: "Explanation",
  comment: "Comment",
  streaming: "streaming…",
  savedAsAnnotation: "Saved as an annotation",
  explainFailed: "Explain failed",
  requestFailedStatus: "Request failed ({status})",

  // Transcript
  transcript: "Transcript",
  transcribeAgain: "Transcribe again",
  transcribeAgainTitle: "Transcribe the video again; the lines are replaced",
  jumpHere: "Jump here",
  commentOnLineTitle: "Comment on this line",
  explain: "Explain",
  openNote: "Open note",
  openNoteTitle: "Open the note on this moment",
  transcribingLong:
    "Transcribing… takes a minute or two. Read along, click a line to seek, and search the video once it lands.",
  transcriptFailedBody: "The transcript did not land. It powers read-along, click-to-seek, and Find.",
  transcriptionFailed: "Transcription failed",
  lastRunUnfinished: "The last run did not finish.",

  // Visual
  visual: "Visual",
  jumpOpenNote: "Jump here and open the note",
  deleteAnnotation: "Delete the annotation",
};

const zh: Record<keyof typeof en, string> = {
  // Player controls
  play: "播放",
  pause: "暂停",
  playSpace: "播放（空格）",
  pauseSpace: "暂停（空格）",
  seek: "进度条",
  mute: "静音",
  unmute: "取消静音",
  annotate: "批注",
  annotateTitle: "在画面上圈选一处并评论",
  fullscreen: "全屏",
  exitFullscreen: "退出全屏",
  fullscreenF: "全屏（f）",
  exitFullscreenF: "退出全屏（f）",
  annotationAt: "{time} 处的批注",
  useWholeFrame: "使用整个画面",
  youtubeError: "这个 YouTube 视频无法播放。它可能已设为私密或禁止嵌入。",
  videoError: "这个视频在此浏览器中无法播放。",

  // Pane: header, tool caption, tool bar
  kindVideo: "视频",
  hintCaption: "圈选一处来评论 · 查找视频内容 · 点击逐字稿行跳转",
  circleComment: "圈选并评论",
  circleCommentTitle: "暂停并在画面上圈选一处——或使用整个画面——然后评论或解释",
  linesCount: "{n} 行",
  transcriptFailedChip: "转写失败",
  transcribing: "转写中…",
  drawHelp: "在画面上圈选一处——圈会自动闭合——或使用整个画面。按 Esc 取消。",

  // Find
  findPlaceholder: "在视频中查找…",
  findPlaceholderNeedsTranscript: "在视频中查找（需要逐字稿）…",
  findAria: "在视频中查找",
  findEmpty: "视频中没有能回答这个问题的内容。",
  findFailed: "查找失败",
  jumpToPart: "让播放器跳到这一段",
  addedPending: "已添加——在笔记中待定",
  addSectionFirst: "请先添加章节",
  addAsPendingNote: "添加为 {section} 中的待定笔记",
  adding: "添加中…",
  addToNotes: "添加到笔记",
  saveFailed: "保存失败",

  // Composer and annotation cards
  newAnnotation: "新批注",
  startTime: "开始时间",
  endTime: "结束时间",
  to: "至",
  regionShows: "播放进入此区间时，批注就会显示。",
  wholeFrameShows: "整个画面：评论会在此区间内显示在视频上。",
  commentCircledPlaceholder: "评论圈选的位置",
  commentMomentPlaceholder: "评论这个时刻",
  timesInvalid: "时间格式为 m:ss，结束须晚于开始。",
  writeCommentFirst: "请先写下评论。",
  saveAnnotation: "保存批注",
  explainCircled: "解释圈选的位置",
  explainThisMoment: "解释这个时刻",
  explainButtonTitle: "模型会读取画面和逐字稿；解释会在这里保存为批注",
  explanation: "解释",
  comment: "评论",
  streaming: "生成中…",
  savedAsAnnotation: "已保存为批注",
  explainFailed: "解释失败",
  requestFailedStatus: "请求失败（{status}）",

  // Transcript
  transcript: "逐字稿",
  transcribeAgain: "重新转写",
  transcribeAgainTitle: "重新转写视频；逐字稿行会被替换",
  jumpHere: "跳到这里",
  commentOnLineTitle: "评论这一行",
  explain: "解释",
  openNote: "打开笔记",
  openNoteTitle: "打开这个时刻的笔记",
  transcribingLong: "转写中…需要一两分钟。完成后可以跟读、点击行跳转、查找视频内容。",
  transcriptFailedBody: "逐字稿没有生成。跟读、点击跳转和查找都依赖它。",
  transcriptionFailed: "转写失败",
  lastRunUnfinished: "上一次转写没有完成。",

  // Visual
  visual: "画面批注",
  jumpOpenNote: "跳到这里并打开笔记",
  deleteAnnotation: "删除批注",
};

export const video = { en, zh } as const;
