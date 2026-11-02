// UI strings of the outline surfaces. zh glossary: dict/common.ts. Every key
// exists in both languages — zh's type enforces it.

export const en = {
  // Notes full page header (notes/page.tsx, export-menu.tsx, outline.tsx)
  reader: "Reader",
  export: "Export",
  exportMarkdown: "Markdown",
  exportWord: "Word",

  // Search and empty states
  searchNotes: "Search notes",
  noNotesMatch: "No notes match “{query}”.",
  emptySections: "No sections yet. Add one to start taking notes.",
  emptyTrayPrefix: "No sections yet. Add one on the ",
  notesFullPage: "notes full page",
  emptyTraySuffix: ".",

  // Sections
  addSection: "Add section",
  sectionTitle: "Section title",
  renameSection: "Rename section",
  reorderSection: "Drag to reorder section {title}",

  // Note cards
  addNoteBtn: "Note",
  writeNotePlaceholder: "Write a note (markdown)",
  // The save state at the top of a note being edited (SPEC.md §6)
  saving: "Saving…",
  saved: "Saved",
  saveFailed: "Not saved",
  savedOffline: "Saved on this device · syncs when online",
  waitingSync: "Waiting to sync",
  // Two saves of one note from the same text (lib/notes/conflict.ts): lines
  // both changed are kept twice, under these marker lines.
  savedBoth: "Saved · both versions kept",
  conflictOther: "Changed in two places at once. The other version:",
  conflictYours: "Your version:",
  conflictEnd: "End of the two versions. Keep one, then delete these marker lines.",
  // Hold to drag (SPEC.md §6): a hold anywhere on a note picks it up. One
  // short line: the tip sits on the cards around the one under the pointer.
  holdToDrag: "Hold to move, merge, or float the note\nAlt+↑ or Alt+↓ moves it",
  holdToDragPage: "Hold to move or merge the note\nAlt+↑ or Alt+↓ moves it",
  holdToMoveCard: "Hold to move this card. Drop it on the notes tray to put the note back.",
  holdToDragTile: "Click to open. Hold to move or merge the note",
  // A section's board (SPEC.md §6): the section's notes filling the screen as tiles.
  openBoardTitle: "Open this section as a board: its notes side by side, filling the screen",
  boardSections: "Sections inside",
  boardEmpty: "No notes in this section yet.",
  openNoteTitle: "Open this note",
  pendingLabel: "Pending",
  acceptTitle: "Accept (Enter)",
  rejectTitle: "Reject (Backspace)",
  editTitle: "Edit",
  noteText: "Note text",
  // The note's title and body (SPEC.md §6).
  titlePlaceholder: "Title",
  noteTitleLabel: "Note title",
  // The note floats: dragged out of the tray, over the article, and back.
  dockBack: "Back to the tray",
  dockBackTitle: "Put the note back in the notes tray",
  dropToDock: "Let go to put the note back in the tray",
  floatingLabel: "In a floating card over the article",
  floatingTitle: "Note",
  dropLinkIntoNote: "Drop the link into this note",
  wrapText: "Wrap text",
  wrapTextTitle: "Flow the article's text around this note; the note scrolls with the text",
  copy: "Copy",
  copied: "Copied",
  copyTitle: "Copy the note text",
  noteDeleted: "Note deleted",
  notesDeleted: "{n} notes deleted",
  undoDeleteTitle: "Put the deleted notes back",
  undoPostedTitle: "Put back what was deleted",
  sectionDeleted: "“{title}” deleted",
  sectionDeletedNotes: "“{title}” deleted · {n} notes",
  sectionDeletedOneNote: "“{title}” deleted · 1 note",
  highlightDeleted: "Highlight deleted",
  commentDeleted: "Comment deleted",
  annotationDeleted: "Annotation deleted",
  conversationDeleted: "Conversation deleted",
  undoSectionDeleteTitle: "Put the section back with its notes",
  sectionUndoFailed: "The section did not come back: {reason}. History keeps it: Restore is on its row.",
  editCanceled: "Edit canceled",
  undoCancelTitle: "Put back the words typed in this edit",
  deleteFailed: "The note was not deleted and is back in its place: {reason}",
  // Words kept when their note went (SPEC.md §6, lib/notes/gone.ts).
  keptAsNewNote: "This note was deleted elsewhere. Your words are kept in a new note.",
  historyRestoreMergeTitle: "Put the merged notes back beside the note they went into, with their sources and replies. The note keeps its text",
  // A quote whose place the document no longer has (SPEC.md §6).
  quoteSourceLost: "The quote is in the note. Its passage changed in the document, so it has no source.",
  // The merge's Undo, once the merged note changed (SPEC.md §6).
  mergeEditedSince: "Edited since the merge",
  // The voice command's recording, kept after a send that failed (SPEC.md §6).
  sendCommandAgain: "Send again",
  sendCommandAgainTitle: "Send the recorded command again",
  discardCommand: "Discard the recording",
  anchorUnresolvedTitle: "Anchor unresolved. Quoted text: {quote}",
  unresolvedLabel: "unresolved:",

  // Ticker selection (upper-right of every accepted note)
  selectNote: "Select note",
  // What the circle is for: the tray has merge, pin, delete; the notes full page adds compare.
  selectNoteTitle: "Select this note. Merge, pin, or delete the selected notes together.",
  selectNoteTitleCompare:
    "Select this note. Merge, pin, compare, or delete the selected notes together.",
  selectedCount: "{n} selected",
  merge: "Merge",
  // A merged note's seam (lib/notes/join.ts): the subtitle over a note's
  // text when the note had no title. Dimmed, and deleted like any line.
  mergedNote: "Merged note",
  // A quote in a note points back to the reader (SPEC.md §6).
  quoteJump: "Jump to this quote in the reader",
  quoteUnresolved: "This quote's place in the document is gone",
  // A quote whose document was deleted keeps its words (SPEC.md §5).
  quoteDocumentDeleted: "This quote's document was deleted",
  deletedDocument: "Deleted document",
  // A quote dragged from the reader (lib/quote-drag.ts): the caret says where it lands.
  dropQuoteHere: "Let go to put the quote here",
  dropQuoteIntoNote: "Let go to add the quote to this note",
  mergeTitle: "Merge the selected notes into one: their text as it is, the note on top first",
  // Merging (SPEC.md §6): a note held over another until the ring closes, or
  // a card dropped on the floating note card, joins the text as it is. Merge
  // with AI is the ticker's other bulk action.
  mergeWithAi: "Merge with AI",
  mergeWithAiTitle: "Write the one note that takes both notes' place: the key points of each note, structured, each with the quotes that support it",
  joinText: "Join text",
  joinTextTitle: "Put the text into this note as it is",
  merging: "Merging with AI…",
  mergeStopTitle: "Stop the merge. Nothing merges, and the notes stay as they were.",
  mergedNotes: "{n} notes merged into one",
  undoMergeTitle: "Put the merged notes back as they were",
  dropNote: "Drop to merge this note in",
  dropQuoteSectionTop: "Let go to make a new note at the top of {section}",
  dropQuoteSectionEnd: "Let go to make a new note at the end of {section}",
  dropAnnotation: "Drop to put this annotation in the note: its quote, then its text",
  // An annotation reference in a note (lib/annotation-reference.ts): the
  // row's second line, its tooltip, and the annotation beside the note on the
  // notes full page (annotation-side.tsx).
  annotationReference: "Annotation",
  annotationReferenceTitle: "Open this annotation",
  // The log lines an annotation reference lands (lib/annotation-reference.ts): who said each
  referenceYou: "You",
  referenceAssistant: "Assistant",
  annotationJump: "Jump to this annotation in the reader",
  annotationGone: "This annotation was deleted. History can restore it.",
  pin: "Pin",
  unpin: "Unpin",
  pinnedLabel: "Pinned",
  clearSelection: "Clear selection",
  holdToMerge: "Hold here until the ring closes to merge into this note",

  // Pending queue
  pendingHeader: "Pending · {n}",
  acceptAll: "Accept all",
  acceptAllTitle: "Accept every pending note shown here\nOn a pending note: ⏎ accept · ⌫ reject · e edit · g source",
  noteRejected: "Note rejected",
  undo: "Undo",

  // Note structure: the header row's id and collapse, Collapse all, the compare view
  noteIdTitle: "Note {id} · click to copy",
  copyNoteId: "Copy note ID",
  collapseNote: "Collapse note",
  expandNote: "Expand note",
  collapseAll: "Collapse all",
  collapseAllTitle: "Fold every note to one line",
  copyAnnotationId: "Copy annotation ID",
  annotationIdTitle: "Annotation {id} · click to copy",
  collapseAnnotation: "Collapse annotation",
  expandAnnotation: "Expand annotation",
  expandAllAnnotationsTitle: "Show every annotation whole",
  collapseAllAnnotationsTitle: "Fold every annotation to one line",
  expandAll: "Expand all",
  expandAllTitle: "Show every note whole",
  compare: "Compare",
  compareTitle: "Open the selected notes in one screen",
  compareCount: "Compare · {n} notes",
  layoutColumns: "Side by side",
  layoutRows: "Stacked",
  // The notes tray holds the open document's notes (SPEC.md §6): the line
  // under the queue counts the pending notes the notes full page holds.
  pendingElsewhere: "{n} pending in other documents · Notes full page",
  pendingElsewhereTitle: "Pending notes of other documents and of the project wait on the notes full page",
  // Document columns (SPEC.md §6): the project's notes as a grid over the page,
  // one column per document, one row per section.
  documentColumns: "Document columns",
  notesViewMenu: "Show and group the notes",
  groupBy: "Group by",
  groupByEdited: "Last edited",
  groupBySection: "Section",
  groupByDocument: "Document",
  groupByWeek: "Week added",
  groupByMonth: "Month added",
  groupByTitle: "Title, A to Z",
  groupProject: "Project",
  groupUntitled: "No title",
  groupWeekOf: "Week of {date}",
  notesScope: "Which notes show",
  scopeProject: "All notes",
  scopeProjectTitle: "Show every note of the project",
  scopeDocument: "This document",
  scopeDocumentTitle: "Show the notes written in this document or quoting it",
  byDocumentTitle: "Compare notes across documents: one column per document, one row per section",
  byDocumentHint: "One column per document, one row per section. A note sits under the document it was written in or quotes.",
  byDocumentCount: "{n} documents",
  byDocumentEmpty: "No notes yet. Select text and press Add to notes.",
  projectColumn: "Project",
  addToCompare: "Add note…",
  removeFromCompare: "Remove from compare",
  notesLabel: "Notes",

  collapseSectionTitle: "Collapse or expand this section",
  addNoteTitle: "Write a note in this section",
  addNoteInTitle: "Write a note in {section}",
  // Voice command (SPEC.md §6)
  speakNote: "Command",
  speakNoteTitle:
    "Speak a command: what the note should say and do. The assistant reads the open document, quotes it, and writes the notes. They land pending in this section",
  stopRecording: "Stop recording; the command runs",
  voiceNoteTranscribing: "Transcribing…",
  voiceStagePlan: "Reading the document…",
  voiceStageWrite: "Writing the notes…",
  voiceNoteEmpty: "Nothing was recorded.",
  voiceNoteUnsupported: "This browser cannot record audio.",
  micDenied: "Microphone access was refused. Allow it in the browser to speak a command.",
  deleteSectionTitle: "Delete this section and its notes",
  addSectionTitle: "Add a section to file notes in",
  exportTitle: "Export the notes as Markdown or Word",
  pinTitle: "Pin the selected notes to the top of their section",
  unpinTitle: "Unpin the selected notes",
  deleteSelectedTitle: "Delete the selected notes",
  deleteNoteTitle: "Delete this note",
  undoRejectTitle: "Put the rejected note back as pending",

  // The note editor's bar (note-editor.tsx): every tool's tooltip names the
  // tool on the first line and the key or the typed shortcut on the second.
  // {mod} is ⌘ on a Mac and Ctrl elsewhere.
  tipUndo: "Undo\n{mod}+Z",
  tipRedo: "Redo\nShift+{mod}+Z",
  tipLineMenu: "Line style\nText, headings, lists, quote, indent, image",
  lineText: "Text",
  tipLineText: "Text\nBackspace at the start of a line drops its marker",
  tipHeading1: "Heading 1\nType # and a space",
  tipHeading2: "Heading 2\nType ## and a space",
  tipHeading3: "Heading 3\nType ### and a space",
  tipBulletedList: "Bulleted list\nType - or * (Shift+8) and a space",
  tipDashList: "Dash list\nType + and a space",
  tipNumberedList: "Numbered list\nType 1. and a space",
  tipChecklist: "Checklist\nType [ ] and a space. Click the box to tick it.",
  tipQuote: "Quote\nType > and a space",
  tipBold: "Bold\n{mod}+B",
  tipItalic: "Italic\n{mod}+I",
  tipUnderline: "Underline\n{mod}+U",
  tipColor: "Color the text {color}\nSelect text first, or click before typing",
  tipOutdent: "Outdent\nShift+Tab",
  tipIndent: "Indent\nTab",
  tipImage: "Add an image or GIF\nPick a file, drop it on the note, or paste it. Drag the corner to resize.",
  // The tray's editor has the core tools; the notes full page adds H1, indent, and the image.
  tipColors: "Color the text\nFour colors",
  // The note's history (SPEC.md §12): who wrote and edited this note, and when.
  history: "History",
  historyTitle: "Who wrote and edited this note, and when",
  historyCreated: "wrote the note",
  historyEdited: "edited the note",
  historyRestore: "Restore",
  historyRestoreTitle: "Make this version the note's text again",
  historyShow: "Show text",
  historyHide: "Hide text",
  repliesTitle: "{n} replies under this note",
  // The source count's tooltip: how many, then each document once.
  sourceTitle: "1 source · {titles}",
  sourcesTitle: "{n} sources · {titles}",
  taskToggleTitle: "Tick or clear this item",
};
