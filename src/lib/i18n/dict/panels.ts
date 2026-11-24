// UI strings of the panels surfaces. zh glossary: dict/common.ts. Every key
// exists in both languages — zh's type enforces it.

export const en = {
  // Annotations tab
  annotationsEmpty: "No annotations yet. Select text in the reader to highlight, comment, or link.",
  // The annotations full page (SPEC.md §6): every annotation of the project, grouped by document.
  annotationsFullPage: "Annotations full page",
  annotationsFullPageTitle: "Every annotation of the project, grouped by document",
  annotationsPageTitle: "Annotations",
  annotationsPageEmpty: "No annotations yet. Select text in the reader to highlight, comment, or link.",
  projectGroup: "Project",
  projectGroupHint: "The sidebar assistant's conversations, anchored in no document",
  openDocumentTitle: "Open this document in the reader",
  highlights: "Highlights",
  comments: "Comments",
  // Resolved comments (SPEC.md §29), with Reopen in the menu.
  resolved: "Resolved",
  reopenCommentTitle: "Reopen this comment; its mark comes back",
  explanations: "Explanations",
  analyses: "Analyses",
  visualizations: "Visualizations",
  assistant: "Assistant",
  simplified: "Simplified",
  links: "Links",
  jumpToAnchor: "Jump to the anchor in the reader",
  openAndJumpTitle: "Open this annotation and jump to it in the text",
  anchorUnresolved: "Anchor unresolved",
  otherEndUnresolved: "Other end unresolved",
  wasAnchoredTo: "was anchored to: {text}",
  notAttached: "not attached",
  // The conversation continued from the output (SPEC.md §21)
  conversation: "Conversation",
  // Extract tab. Key names are code identifiers: distill* = the reader's
  // Extract (DISTILL).
  distillNoDoc: "Open a text document to extract from it.",
  distillArticle: "Extract from the article",
  distillCorpusTitle: "One question; the AI scans every document in the project",
  distillButtonTitle: "Ask the article one question; the AI pulls the quotes that answer it",
  distillEmpty:
    "No extractions yet. Ask the article one question; the quotes that answer it list here.",
  openDistillation: "Open this extraction",
  quoteCountOne: "{n} quote",
  quoteCountMany: "{n} quotes",
  // Edits tab
  layerWhole: "Whole text",
  layerCore: "Collapsed",
  layerTitle: "Which annotations to list",
  layerWholeTitle: "The annotations on the whole text",
  layerCoreTitle: "The annotations on the collapsed view: made on the cores",
  // An edit's row in History (history-control.tsx): a line's voice, a move's
  // place, a re-parse, and the open document's Revert and Restore.
  speakerNone: "No speaker",
  // A move's place: the words of the block it now follows.
  movedAfter: "Now after “{text}”",
  movedToStart: "Now at the document's start",
  // A re-parse of an import (SPEC.md §29): one row for the whole document.
  reparseKeptText: "Version history keeps the text from before the re-parse.",
  revert: "Revert",
  reverting: "Reverting…",
  revertFailed: "Revert failed",
  restore: "Restore",
  restoring: "Restoring…",
  restoreFailed: "Restore failed",
  revertTitle: "Put the paragraph back to the text before this edit",
  restoreTitle: "Put the removed paragraph back",
  dragAnnotationTitle:
    "Drag this annotation onto a note: the note gets its quote, a row that opens it, and its text",
  deleteAnnotationTitle: "Delete this annotation and its mark in the reader",
  // The three-dots menu on every annotation (annotation-menu.tsx)
  annotationMenu: "Annotation actions",
  annotationMenuTitle: "Put this annotation into a note, jump to it, or delete it",
  annotationNewNote: "New note from this annotation",
  annotationNewNoteTitle:
    "A new note with this annotation's text and anchors. The annotation stays in the article.",
  annotationAddToNote: "Add to a note…",
  annotationAddToNoteTitle:
    "Put this annotation into a note you pick: its quote, an annotation reference, and its text. The annotation stays in the article.",
  annotationPickSection: "Which section?",
  annotationPickNote: "Which note?",
  annotationNoNotes: "No notes match. Make a new note instead.",
  annotationNoteMade: "New note {id} in {section}",
  annotationNoteAdded: "Added to note {id}",
  // The label on an annotation of a figure, table, or equation ("A1", "A2", …)
  figureLabelTitle:
    "Label {label}: this annotation is on a figure, table, or equation. The block carries the same label in the article. Labels count such annotations in document order.",
  removeLinkTitle: "Remove this link from both documents",
  linkAbout: "About this link",
  linkAboutPlaceholder: "What is this link about?",
  describeLink: "Describe",
  describeLinkTitle: "Say what this link is about",
  editLinkAboutTitle: "Change what this link is about",
  styleApplied: "{style} on “{text}”",
  styleRemoved: "{style} removed from “{text}”",
  styleFallback: "style",
  styleBold: "bold",
  styleItalic: "italic",
  styleUnderline: "underline",
  styleColorInk: "black text",
  styleColorCustom: "colored text",
  styleHighlight: "highlight",
  styleColorClay: "clay text",
  styleColorSage: "sage text",
  styleColorGold: "gold text",
  styleColorPlum: "plum text",
  formatParagraph: "paragraph",
  formatH1: "h1",
  formatH2: "h2",
  formatH3: "h3",
  formatList: "list",
  formatNumbered: "numbered",
  formatCode: "code",
  documentFallback: "document",
  // Markdown block chips
  jumpToBlock: "Jump to this block in the document",
  jumpToBlocks: "Jump to these {n} blocks in the document",
  showCitedNote: "Show this note in the notes tray",
};
