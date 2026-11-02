// UI strings of the assistant surfaces. zh glossary: dict/common.ts. Every key
// exists in both languages — zh's type enforces it.

export const en = {
  // Recommended functions
  recommended: "Recommended",
  habits: "You often ask",
  habitsHint: "Asked {n} times in the last two months, on two documents or more",
  habitsHide: "Hide",
  recLaymanLabel: "Layman summary",
  recLaymanHint: "The core of the document, in plain words",
  recProfessionalLabel: "Professional summary",
  recProfessionalHint: "In the author's own industry wording",
  // Scope control (SPEC.md §7): This page, or Project
  scopeDocumentLabel: "This page",
  scopeDocumentHint:
    "This page: the open document in full, plus every note, annotation, and extraction on it.",
  scopeDocumentNoDocument: "Open a document to ask about this page",
  scopeProjectLabel: "Project",
  scopeProjectHint:
    "This project: every document in full, plus every note, annotation, and extraction.",
  // Ask
  askPlaceholderDocument: "Ask about this page",
  askPlaceholderProject: "Ask about this project",
  ask: "Ask",
  stopAsk: "Stop. Whatever answered so far stays on screen.",
  // The conversation (SPEC.md §7)
  loadingConversation: "Loading your conversation…",
  followUpPlaceholder: "Ask a follow-up",
  send: "Send",
  newConversation: "New conversation",
  newConversationTitle: "Start a new conversation. This one stays in Conversations.",
  // The conversations list (SPEC.md §7): this reader's conversations of the
  // project, newest first; one opens on a click, and Delete removes one.
  conversations: "Conversations",
  conversationsTitle: "Your conversations in this project: open one, or start a new one",
  conversationsBack: "Back",
  conversationsBackTitle: "Back to the conversation",
  conversationsLoading: "Loading conversations…",
  conversationsEmpty: "No conversations yet. Ask something to start one.",
  conversationOpenTitle: "Open this conversation",
  conversationCurrent: "open",
  conversationDelete: "Delete this conversation",
  conversationDeleteFailed: "Not deleted. The conversation is back; try again.",
  // Clear conversation (SPEC.md §21): the one way a kept conversation goes.
  clearConversation: "Clear",
  clearConversationTitle: "Clear this conversation. It is kept until you clear it.",
  attach: "Attach an image or a file",
  attachTitle:
    "Attach images (png, jpg, gif, webp, bmp), PDFs, video, audio, or text files to your message. Video and audio are transcribed. Paste or drop works too.",
  attachDrive: "Add from Google Drive",
  attachDriveTitle:
    "Attach a Google Drive file to your message: a Doc, Sheet, Slide, Drawing, PDF, video, audio, image, or text file.",
  removeAttachment: "Remove {name}",
  attachmentNotTaken: "{name}: not an image, a PDF, a video, an audio file, or a text file",
  attachmentsMax: "At most {images} images and {files} files per message",
  reading: "Reading {name}…",
  you: "You",
  // The queue (SPEC.md §7): messages sent while an answer runs wait, then go out in order
  queue: "Queue",
  queueTitle: "Send this message after the answer lands. Queued messages go out in order.",
  queuePlaceholder: "Queue a message",
  // The one placeholder of a card's box that talks to the assistant.
  messagePlaceholder: "Message the assistant…",
  queued: "{n} queued",
  removeQueued: "Remove from the queue",
  // Highlighting an answer (SPEC.md §7): side chat, ask, comment
  startSideChat: "Start side chat",
  startSideChatTitle:
    "Start a side chat on these words: a conversation of its own, kept with this one and out of assistant history.",
  sideChatNeedsConversation: "Send a message first: a side chat belongs to a conversation.",
  askAboutThis: "Ask about this",
  askAboutThisTitle: "Quote these words in the next message of this conversation.",
  comment: "Comment",
  commentTitle: "Comment on these words. Collaborators read the comment under the answer.",
  commentPlaceholder: "Comment on this answer",
  commentDelete: "Delete this comment",
  comments: "Comments",
  quoteRemove: "Remove the quote",
  sideChat: "Side chat",
  sideChats: "Side chats",
  sideChatPlaceholder: "Ask about the quote",
  backToConversation: "Back",
  backToConversationTitle: "Back to the conversation this side chat came from.",
  sideChatOpened: "Side chat",
  // A tool's output continued into a conversation (SPEC.md §21): the pill on
  // the card's foot row; its tooltip names it whole.
  continue: "Continue",
  // Thinking control (SPEC.md §7): one chip that names the choice, Auto
  // Thinking, Fast Thinking, or Deep Thinking; a click switches to the next.
  thinkingAuto: "Auto Thinking",
  thinkingAutoHint:
    "Auto Thinking is on: the assistant decides from the message how hard to think. A lookup, a one-place change, or a confirmation runs fast; a question of meaning runs deep; a change across the document, a comparison, or several asks at once run deepest. Click for Fast Thinking.",
  thinkingFast: "Fast Thinking",
  thinkingFastHint:
    "Fast Thinking is on: the assistant reasons as little as it can before it answers. Quicker, and enough for a question the material answers directly. Click for Deep Thinking.",
  thinkingDeep: "Deep Thinking",
  thinkingDeepHint:
    "Deep Thinking is on: the assistant reasons the question through before it answers. Slower, and better for a question that has to be worked out across the material. Click for Auto Thinking.",
  // Web access (SPEC.md §7)
  web: "Web",
  webOnTitle:
    "Web is on: the assistant checks its answer against the web and cites the outside sources it uses. Click to answer from the project only.",
  webOffTitle:
    "Web is off: the assistant answers from the project only. Click to let it search the web and cite outside sources.",
  // Tasks: button labels, then the noun inside noTaskFound
  taskContradictions: "Contradictions",
  taskGaps: "Gaps",
  taskUnsourced: "Unsourced",
  taskContradictionsTitle: "Find notes in this project that contradict each other",
  taskGapsTitle: "Find gaps in the notes: thin sections, claims without support, open questions",
  taskUnsourcedTitle: "Find accepted notes that state facts with no source",
  regenerateTitle: "Write this again; the current one is replaced",
  summaryStopTitle: "Stop the summary. The stored summary, if there is one, stays.",
  showNoteTitle: "Show this note in the notes tray",
  taskNounContradictions: "contradictions",
  taskNounGaps: "gaps",
  taskNounUnsourced: "unsourced",
  noTaskFound: "No {task} found. Clean.",
  noteChip: "note {id}",
  // Assistant history (SPEC.md §7): every conversation of the project, on its own page
  history: "History",
  historyTitle: "Assistant history: every assistant conversation you had in this project",
  historyPageTitle: "Assistant history",
  historyEmpty: "No assistant conversations in this project yet.",
  // Where a conversation comes from: the badge and the line under it
  historyOriginSidebar: "Sidebar assistant",
  historyOriginSidebarHint: "Started in the assistant tab of the side panel. Not anchored in a document; it stays in that tab.",
  historyOriginSelection: "Selection chat",
  historyOriginSelectionHint: "Started from a highlighted text in the reader.",
  historyOriginTool: "Tool conversation",
  historyOriginToolHint: "Continued from a tool card's output in the reader.",
  historyOpenInReader: "Open in the reader",
  historyOpenAnchorTitle: "Open the document at the highlighted text this conversation started from",
  historyTurns: "{n} messages",
  historyAnchorOrphaned: "The highlighted text is no longer in the document",
  // Plan (SPEC.md §7, This page scope)
  proposedActions: "Proposed {n} action{s}",
  reviewPlan: "Review in the plan card",
  saveAsNote: "Save as note",
  saveAsNoteTitle: "Organize this answer into a note: a title, the key points, and the quotes they rest on. It lands pending in your notes.",
  savingAsNote: "Organizing into a note…",
  savedAsNote: "Saved in {section} as a pending note",
  showSavedNote: "Show",
  noteAssistant: "Assistant",
  noteAssistantTitle: "Ask the assistant about this note, or describe a change to make to it",
  noteAssistantPlaceholder: "Describe any changes you want to make…",
  noteAssistantClose: "Close the assistant",
  noteAssistantStop: "Stop",
  noteAssistantApplied: "Accepted",
  noteAssistantUndo: "Undo",
  noteAssistantChange: "Proposed change",
  noteAssistantQuotesLost: "This change takes out {n} quote{s} of the note, and with it the link back to the document.",
  noteAssistantEmpty: "Ask about this note, or ask for a change: \"group the points by theme\", \"shorten the commentary, keep the quotes\", \"add what the document says about this\".",
  // The assistant's suggestions (SPEC.md §29): the row under a command's turn
  suggestWriting: "Writing suggestions…",
  suggestReview: "Review",
  suggestReviewTitle: "Step through these suggestions",
  suggestAcceptAllTitle: "Accept these suggestions",
  suggestRejectAllTitle: "Reject these suggestions",
  suggestSkipped: "{n} skipped",
  suggestSkippedTitle: "Why these changes did not land",
  suggestFailedStatus: "The suggestions failed ({status})",
  suggestNoPage: "The document is not open.",
  barChatTitle: "Open this conversation in the card beside the text",

  // Errors
  emptyResponse: "The model returned an empty response. Try again.",
  // One failure line (SPEC.md §7): what failed, then what to do.
  failedConnection: "No answer: Unitos could not reach the server. Try again.",
  failedServer: "No answer: the assistant had a problem. Try again.",
  assistantFailed: "Assistant failed",
  assistantFailedStatus: "Assistant failed ({status})",
  taskFailed: "Task failed",
  taskFailedStatus: "Task failed ({status})",
};
