// UI strings of the video surfaces. zh glossary: dict/common.ts. Every key
// exists in both languages — zh's type enforces it.
//
// zh terms fixed for this namespace (one term per concept):
//   transcribe 转写 · frame 画面 · circle (a spot) 圈选 · moment 时刻 ·
//   range 区间 · line 行 · Find 查找 · seek/jump 跳转 · Visual 画面批注

export const en = {
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
  audioAnnotateTitle: "Pause and comment on this moment",
  fullscreen: "Fullscreen",
  exitFullscreen: "Exit fullscreen",
  fullscreenF: "Fullscreen (f)",
  exitFullscreenF: "Exit fullscreen (f)",
  annotationAt: "Annotation at {time}",
  useWholeFrame: "Use the whole frame",
  youtubeError: "This YouTube video did not play. It may be private or embedding-disabled.",
  videoError: "This video did not play in this browser.",
  audioError: "This audio did not play in this browser.",

  // Pane: header, tool caption, tool bar
  kindVideo: "Video",
  kindAudio: "Audio",
  hintCaption: "Circle a spot to comment · Search the video · Click a line to seek",
  hintCaptionAudio: "Comment on a moment · Search the audio · Click a line to seek",
  circleComment: "Circle & comment",
  circleCommentTitle:
    "Pause and circle a spot on the frame — or take the whole frame — then comment or explain",
  audioCommentTitle: "Pause on this moment, then comment or explain",
  linesCount: "{n} lines",
  transcriptFailedChip: "Transcription failed",
  transcribing: "Transcribing…",
  drawHelp:
    "Draw around a spot on the frame — the loop closes itself — or use the whole frame. Esc cancels.",

  // Find
  findPlaceholder: "Find in this video…",
  findPlaceholderAudio: "Find in this audio…",
  findPlaceholderNeedsTranscript: "Find in this video (needs the transcription)…",
  findPlaceholderNeedsTranscriptAudio: "Find in this audio (needs the transcription)…",
  findAria: "Find in this video",
  findAriaAudio: "Find in this audio",
  findEmpty: "Nothing in the video answers that.",
  findEmptyAudio: "Nothing in the audio answers that.",
  findFailed: "Find failed",
  jumpToPart: "Jump the player to this part",
  addedPending: "Added — pending in Notes",
  addSectionFirst: "Add a section first",
  addAsPendingNote: "Add as a pending note in {section}",
  adding: "Adding…",
  addToNotes: "Add to notes",
  saveFailed: "Not saved. Try again.",

  // Composer and annotation cards
  newAnnotation: "New annotation",
  startTime: "Start time",
  endTime: "End time",
  to: "to",
  regionShows: "The annotation shows whenever playback is inside this range.",
  wholeFrameShows: "Whole frame: the comment shows over the video in this range.",
  audioRangeShows: "The comment shows over the player in this range.",
  commentCircledPlaceholder: "Comment on the circled spot",
  commentMomentPlaceholder: "Comment on this moment",
  timesInvalid: "Times are m:ss, and the end must be after the start.",
  writeCommentFirst: "Write the comment first.",
  saveAnnotation: "Save annotation",
  explainCircled: "Explain the circled spot",
  explainThisMoment: "Explain this moment",
  explainButtonTitle:
    "The model reads the frame and the transcription; the explanation saves as an annotation here",
  audioExplainButtonTitle:
    "The model reads the transcription at this range; the explanation saves as an annotation here",
  savedAsAnnotation: "Saved as an annotation",
  explainFailed: "Explain failed",
  regenerateExplainTitle: "Explain this moment again. The new explanation replaces this one.",
  explanation: "Explanation",
  explain: "Explain",
  comment: "Comment",
  regenerateAnswerTitle: "Ask this question again. The new answer replaces this one.",
  regenerateFindTitle: "Search this query again. The new matches replace these.",
  requestFailedStatus: "Request failed ({status})",

  // Transcription
  transcript: "Transcription",
  chapters: "Chapters",
  chaptersTitle: "The chapters of the recording: a jump to where each topic starts",
  chaptersAsk: "AI reads the transcript and marks where each topic starts. A chapter's title is its first words.",
  chaptersGenerate: "Generate chapters",
  chaptersStopTitle: "Stop making the chapters. Nothing is stored.",
  chaptersGenerating: "Reading the transcript…",
  chaptersViewer: "An editor can generate the chapters.",
  chaptersNone: "This recording is too short to have chapters.",
  chaptersFailed: "The chapters could not be built. Try again.",
  transcribeAgain: "Transcribe again",
  transcribeAgainTitle: "Transcribe the video again; the lines are replaced",
  transcribeAgainTitleAudio: "Transcribe the audio again; the lines are replaced",
  jumpHere: "Jump here",
  openNote: "Open note",
  openNoteTitle: "Open the note on this moment",
  transcribingLong:
    "Transcribing… takes a minute or two. Read along, click a line to seek, and search the video once it lands.",
  transcribingLongAudio:
    "Transcribing… takes a minute or two. Read along, click a line to seek, and search the audio once it lands.",
  transcriptFailedBody: "The transcription did not land. It powers read-along, click-to-seek, and Find.",
  triedSoFar: "Tried so far: {list}. Now on the next provider.",
  transcriptionFailed: "Transcription failed",
  lastRunUnfinished: "The last run did not finish.",
  pasteTranscript: "Paste transcription",
  pasteTranscriptTitle: "Paste the transcription YouTube shows; it becomes this video's transcription",
  pasteHelpYoutube:
    "Open the video on YouTube, click ...more under it, click Show transcript, select all the lines, copy, and paste them here.",
  pasteHelpFile: "Paste a timed transcription: a time on one line and its words on the next, or an SRT or WebVTT file.",
  pastePlaceholder: "0:33\nfirst line\n0:35\nnext line",
  savePastedTranscript: "Save transcription",
  // Known transcription failure classes; unknown ones show the raw diagnostic.
  errNoSpeech: "No speech was found in the recording.",
  errTooLarge: "The file is larger than the transcription cap. Try a smaller file.",
  errCaptions: "The video's captions could not be read.",
  errNotConfigured: "Transcription is not configured on the server.",

  // Visual
  visual: "Visual",
  visualAudio: "Moments",
  jumpOpenNote: "Jump here and open the note",
  deleteAnnotation: "Delete the annotation",

  // Ask about a range
  askRange: "Ask about a range",
  askButtonTitle: "Ask a question about a stretch of the video; the model answers from the transcription in that range",
  askButtonTitleAudio: "Ask a question about a stretch of the audio; the model answers from the transcription in that range",
  askPlaceholder: "What is said in this range?",
  askPlaceholderAudio: "What is said in this range?",
  ask: "Ask",
  askTitle: "Answer from the transcription in this range",
  stopAsk: "Stop. Whatever answered so far stays on screen.",

  // Assistant on the media pane, with the two formalize skills
  assistant: "Assistant",
  assistantButtonTitle: "Ask the assistant; it reads the whole transcription",
  assistantPlaceholder: "Ask the assistant…",
  assistantSend: "Send",
  stopAssistant: "Stop the assistant. Your message stays; no reply lands.",
  assistantSpotChip: "Circled spot · {range}",
  assistantSpotClear: "Ask without the circled spot",
  assistantNoReply: "No answer came back. Try again.",
  assistantActionsUnsupported:
    "Document actions from this chat are not available on video and audio yet.",
  skillArticle: "Formalize into an article",
  skillArticleTitle:
    "Rewrite the transcription as a formal article; it shows under the player and becomes a document in this project, with every reader tool",
  skillNotes: "Formalize into bullet-point notes",
  skillNotesTitle:
    "Turn the transcription into bullet-point notes; they land pending in the notes tray",
  skillNeedsTranscript: "Needs the transcription",
  articleReady: "The article is ready — it shows under the player.",
  notesReady: "{n} notes are pending in {section}. Accept them in the notes tray.",

  // Speakers on the transcription
  detectSpeakers: "Detect speakers",
  detectSpeakersTitle:
    "Read the recording again and say who speaks each line; names come from the introductions",
  detectingSpeakers: "Listening for speakers…",
  speakersStopTitle: "Stop detecting speakers. Nothing is saved.",
  speakersFound: "{n} speakers",
  oneSpeaker: "One voice — nothing to name",
  speakersFailed: "Detecting speakers failed",
  renameSpeaker: "Speaker name",
  renameSpeakerTitle: "Rename this speaker; every line they say follows",

  // The formalized article, the view bar's other view under the player
  article: "Article",
  openArticle: "Open as document",
  openArticleTitle:
    "Open the article as a document in this project — highlight, comment, edit, and distill it like any document",
  copyMarkdown: "Copy markdown",
  copyMarkdownTitle: "Copy the article as markdown, for publishing",
  copied: "Copied",
  copyFailed: "Copy failed",
  regenerateArticleTitle: "Formalize the transcription into an article again; this one is replaced",
  regenerateArticleStopTitle: "Stop the rewrite. The article stays as it was.",
};
