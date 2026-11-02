// UI strings of the works surfaces, the guide dialog, and the feedback
// button. zh glossary: dict/common.ts. Every key exists in both languages —
// zh's type enforces it. In the guide dialog every tool and every side panel
// tab is one card: a name key and a body key that stands alone.

export const en = {
  // Works shelf
  corpora: "Projects",
  newWork: "New project",
  untitledProject: "Untitled project",
  deleteProjectTitle: "Delete “{title}”?",
  deleteProjectNotes: "The project, its sections, and all its notes go. This cannot be undone.",
  deleteProjectKeeps: "These documents are in this project only. They stay in the library, with their words; Add a document › Library puts one in a project again:",
  deleteProjectKeepsNone: "Its documents stay in the library and in their other projects.",
  deleteProject: "Delete project",
  corpusTitle: "Project title",
  renameCorpus: "Rename project",
  // Work card
  sectionCountOne: "{n} section",
  sectionCountOther: "{n} sections",
  documentCountOne: "{n} document",
  documentCountOther: "{n} documents",
  pendingCount: "{n} pending",
  moreActionsFor: "More actions for {title}",
  projectActions: "Project actions",
  notes: "Notes",
  rename: "Rename",
  // Offline copy (SPEC.md §17, Unitos Ultra): the menu item, the card's badge
  saveOffline: "Save for offline",
  removeOffline: "Remove offline copy",
  savingOffline: "Saving for offline…",
  savingOfflinePages: "Saving pages…",
  savingOfflineFiles: "Saving images…",
  progressCounting: "Counting…",
  offlineBadge: "Offline",
  offlineNeedsUltra: "Save for offline is Unitos Ultra.",
  offlineSaved: "Saved for offline. It opens without a connection.",
  offlineSaveFailed: "Save for offline failed. Try again.",
  // Welcome flow (first visit): the splash, then the nudges — the onboarding
  // feature look: the target glows, one small translucent caption beside it
  welcomeName: "Welcome {name}",
  welcomeTagline: "Unitos Notebook, your all-powerful notemaker",
  nudgeProject: "Start here: press New project. A project binds documents and notes.",
  nudgeDocument: "Add more documents with +: a PDF, a web page, a video, or Google Drive.",
  nudgeSelect: "Select any passage of the text. A toolbar appears: the Assistant, Explain, Simplify, Comment, and colors.",
  nudgeRail:
    "The side panel: Assistant, Graph, Notes, Annotations, Extract. Open one and explore.",
  nudgeTools:
    "Extract answers one question with quotes. Contents, top left, jumps to any part of the article.",
  nudgeMerge: "Hold a note over another note until the ring closes. The two join into one note.",
  nudgeFloat: "Hold a note and drag it onto the article. The note floats there while you read.",
  nudgeFullPage: "The four arrows open the notes full page: every note of the project, and each section as a board.",
  nudgeBoard: "Click a section's title to open it as a board: its notes side by side, filling the screen.",

  // Companions (SPEC.md §23): the web apps for the steps around dissecting a
  // document that Unitos does not do, under Projects on the dashboard.
  companions: "Companions",
  companionsIntro:
    "Web apps for the steps around a document that Unitos does not do. Each opens in a new tab.",
  companionsBefore: "Before the reading",
  companionsAfter: "After the reading",
  companionSponsored: "Sponsored",
  companionMathpix:
    "A photo of handwriting or maths becomes text and LaTeX. Unitos converts a whole handwritten PDF; this is for one formula.",
  companionPdf24:
    "Split, merge, rotate, and OCR a PDF before it goes into a project. Unitos takes a PDF whole.",
  companionConnectedPapers:
    "The papers around one paper, for deciding what is worth dissecting in the first place.",
  companionDeepl:
    "Translate loose text and whole files. Unitos translates an open document's blocks, not a file you are sending on.",
  companionOverleaf: "Write the LaTeX the notes feed, with the notes beside it.",
  companionZotero: "Keep and cite the references a project's documents rest on.",
  companionAnki: "Turn the notes into cards that come back until they stick.",
  nudgeSettings: "Settings live under More. Open it to connect Google Drive.",
  nudgeDrive: "Link Google Drive: add a file straight from your Drive, no download.",
  nudgeDone: "Got it",
  // Guide dialog
  guideLabel: "Guide",
  guideTitle: "How to dissect a document",
  guideDistillHeader: "Extract — ask the article one question",
  guideDistillBody:
    "Press Extract at the top right and ask one question. The AI scans the whole document and opens the extract page: your question at the top, under it the quotes that answer it, each with a caption saying how it answers the question.",
  guideDistillNotesBody:
    "Click a quote to jump to its exact words. Add to notes files a quote as a pending note. The Extract tab in the side panel lists every extraction of the open document.",
  guideCircleHeader: "Circle & ask — draw on anything",
  guideCircleBody:
    "Hold and circle any part of a figure or equation. The Assistant reads the visual and answers; Analyze reads a figure or table in three sections; Explain deciphers the visual; a color marks it; Comment and Link work as on text.",
  guideCirclePagesBody:
    "Handwritten PDFs import as pages, and every page is a figure: circle a formula, a sketch, or a margin note, then Ask, Explain, Comment, or pick a color.",
  guideSelectHeader: "Select text and use the AI toolbar",
  guideDefine: "Define",
  guideDefineBody:
    "Shows when the selection is one word: the first row, under the highlight colors. Not on Chinese text. The meaning the word has in this sentence, in plain words, tuned to your background. A key term shows the glossary's definition. Nothing is saved.",
  guideAssistant: "Assistant",
  guideAssistantBody:
    "Type or speak a question or a command about the selection. A question is answered from the passages across the article that match the selection, each cited with a ¶ chip that jumps to it. A command proposes a plan: Ask mode waits for your approval, Auto mode runs it. The reply opens a chat beside the article; every turn applies to the selection.",
  guideExplain: "Explain",
  guideExplainBody:
    "A short explanation of the selection, tuned to your background. Saved under Annotations; click the highlight to reopen it.",
  guideSimplify: "Simplify",
  guideSimplifyBody:
    "Rewrites the selection in plain words in a bubble beside the article. Press a sentence to light up the original it restates. Saved under Annotations.",
  guideColors: "Colors",
  guideColorsBody: "Highlight the selection. Type a comment first and it rides on the highlight.",
  guideComment: "Comment",
  guideCommentBody:
    "Attach a comment to the selection without a highlight. Click the comment icon beside the text to open it.",
  guideAddTo: "Add to",
  guideAddToBody: "File the selection verbatim as a note in a section you pick. No AI.",
  guideLink: "Link across texts",
  guideLinkBody:
    "Connect this passage to one in this or another document. Select the other end and press Link here.",
  guideVoice: "Voice",
  guideVoiceBody:
    "The round bubble under the tools reads the selection aloud, Chinese and English alike. Press it again to stop.",
  guideDistill: "Extract",
  guidePanelHeader: "Side panel",
  guidePanelNotesBody:
    "The open document's notes: the notes written in it and the notes that quote it, under your sections, with the pending queue on top. Hold a note to pick it up and drag it; a line says where it lands. Hold it over another note: a ring draws around that note, and at the full ring the two join into one note. Drop a note on the article to float it there. Select notes with the circle at their top right to merge, pin, or delete them together. The four arrows open the notes full page: every note of the project, and By document — the notes as a grid, one column per document, one row per section, to compare across documents.",
  guidePanelAssistantBody:
    "Ask about this page or the whole project, and run checks (contradictions, gaps). Conversations, at the top, lists your conversations of the project; click one to open it. New conversation starts an empty one and keeps the old one. Right above the box: the scope, then the thinking chip (Auto Thinking, Fast Thinking, or Deep Thinking), and Web. Layman summary and Professional summary are two of its suggestions: the whole document, in plain words or for an expert.",
  guidePanelDistillBody: "Every extraction of the open document; open one to read it.",
  guidePanelAnnotations: "Annotations",
  guidePanelAnnotationsBody:
    "Highlights, comments, explanations, links; Jump scrolls to the source. Every kind carries one color everywhere — the mark in the text, the card, the tab: comment blue, explain violet, simplify green, analyze teal, visualize magenta, assistant Unitos orange; a highlight keeps its own hue. Drag an annotation by its grip onto a note: the note gets the quote, a row that opens the annotation, and its text. The four arrows open the annotations full page: every annotation of the project, grouped by document.",
  guidePanelEdits: "History",
  guidePanelEditsBody: "Every edit and deletion in the project, from History at the top (More › History on a phone). This document narrows it to the open document's edits and deletions.",
  guidePanelGraphBody: "The project's documents and links drawn as nodes and curves. Stitch runs across the documents you pick in it, or every document.",
  guidePanelReaderViewBody: "Normal, Side by Side, or Top and Bottom: two documents at once.",
  // Collapse (SPEC.md §28) and Contents (SPEC.md §26): the article's own controls.
  guideCollapseHeader: "Collapse — every block to its core",
  guideCollapseBody:
    "The Collapse button at the top right of the article, beside Extract. Every paragraph, list, figure, table, and equation shows its core: what it really says, in plain words, at a tenth to a third of its length, written in the light of the whole article.",
  guideCollapseWholeBody:
    "The button to the right of a collapsed block reads it whole; the same button collapses it to its core again. Press Collapse again to show the article whole. Contents, at the top left, lists the article's parts and stays there as you scroll.",
  // Breakwork (SPEC.md §32): the document's blocks sorted into buckets on a canvas.
  guideStructureHeader: "Breakwork — the document sorted into buckets",
  guideStructureBody:
    "The Breakwork button at the top right of the article, beside Collapse. The document's blocks sorted into buckets on a canvas: drag a bucket by its header, drag a block between buckets or back to Unsorted, open a block to read it whole with its annotations, and drag from the dot at the side of a bucket or a block to another to connect them with a label and a comment.",
  guideStructureAssistantBody:
    "The Breakwork assistant on the left: say how to sort the document — by its parts, by keywords, by what the paragraphs share — then ask for a structure. It proposes the buckets, places every block, and draws connections; you apply it or discard it, and Undo takes it back.",
  // The reading position and the left-off mark (SPEC.md §6).
  guideLeftOffHeader: "Where you left off",
  // Keys (guide-dialog.tsx): every key the reader answers to.
  guideKeysHeader: "Keys",
  guideKeyEscape: "Close the open card, list, or dialog. In the graph, leave the Stitch box first; the typed command stays.",
  guideKeyUndo: "Undo the last edit in the article.",
  guideKeyRedo: "Redo it.",
  guideKeyCopy: "Copy the selected passage while the toolbar is open.",
  guideKeyEnter: "Send in the Assistant box and the Stitch box. Shift + Enter starts a new line.",
  guideKeySaveNote: "Save the note you are editing.",
  guideKeyIndent: "Indent or outdent the list lines of a note.",
  guideKeyPick: "Pick a document in the graph for Stitch, or drop it from the pick.",
  guideKeyPlay: "Play or pause a video or audio document.",
  guideKeySeek: "Go back or forward 5 seconds.",
  guideKeyFullscreen: "Show the video full screen.",
  guideKeySelectAll: "Select the article's text and open the toolbar on it.",
  guideKeyExtend: "Grow or shrink the selection; the toolbar opens on it.",
  guideKeyQueueDecide: "In the pending queue: accept or reject the pending note.",
  guideKeyQueueMove: "In the pending queue: go to the next or the previous pending note.",
  guideKeyQueueEdit: "In the pending queue: edit the pending note.",
  guideKeyQueueJump: "In the pending queue: jump to the pending note's quote in the article.",
  guideKeyList: "In the document list: move between documents, or type a title's first letters to go to it. → opens a folder, ← leaves it. Alt + ↑ ↓ moves the row one place.",
  guideLeftOffBody:
    "A document opens where you left off, in any tab and on any device you sign in on. A small ribbon above the block marks the place, so you can find it again after you scroll away.",
  // The release notifications (SPEC.md §18, lib/releases.ts): one per release, on the dashboard.
  release20260924Title: "New: Collapse, the annotations full page, By document, Conversations",
  release20260924Body:
    "- **Collapse** — the button at the top right of the article, beside Extract. Every block shows its core: what it really says, in plain words. Click a collapsed block to read it whole.\n- **Annotations full page** — the four arrows in the Annotations tab: every annotation of the project, grouped by document. Every kind of annotation now carries one color everywhere: comment blue, explain violet, simplify green, analyze teal, visualize magenta, assistant Unitos orange.\n- **By document** — on the notes full page: the project's notes as a grid, one column per document, one row per section. The notes tray now shows the open document's notes only.\n- **Conversations** — at the top of the Assistant tab: your conversations of the project, one click to open each. New conversation keeps the old one. The scope and thinking rows sit right above the box.\n- **Drag an annotation onto a note** — the note gets the quote, a row that opens the annotation, and the annotation's text.\n- **Contents** stays at the top left as you scroll.\n\nThe controls that are new glow until you press them. Open the guide with the ? at the top right of the reader, or More › Guide on a phone.",
  release20260925Title: "New: Define",
  release20260925Body:
    "- **Define** — select one word in any document: an article, a PDF, a transcript, slides, a sheet, a blank document. Not on Chinese text. Define is the first row of the AI toolbar, under the highlight colors. It gives the meaning the word has in that sentence, in plain words, tuned to your background. A key term shows the glossary's definition at once. Nothing is saved.\n\nThe controls that are new glow until you press them. Open the guide with the ? at the top right of the reader, or More › Guide on a phone.",
  release20260925bTitle: "New: the reader opens where you left off",
  release20260925bBody:
    "- **Where you left off** — a document opens where you left off, in any tab and on any device you sign in on.\n- **The left-off mark** — a small ribbon above the block marks the place, so you can find it again after you scroll away.\n\nOpen the guide with the ? at the top right of the reader, or More › Guide on a phone.",
  release20261013Title: "New: Breakwork",
  release20261013Body:
    "- **Breakwork** — the button at the top right of the article, beside Collapse. The document's blocks sorted into buckets on a canvas: drag blocks between buckets, nest buckets, label blocks, and draw labeled connections between buckets or blocks. Every block opens whole with its annotations and the Explain and Simplify tools.\n- **The Breakwork assistant** — talk about how to sort the document, then ask for a structure. It proposes the buckets, places every block, and draws connections; you apply it or discard it, and it changes the structure as much as you ask.\n\nThe controls that are new glow until you press them. Open the guide with the ? at the top right of the reader, or More › Guide on a phone.",
  // Feedback button
  feedback: "Feedback",
  feedbackBug: "bug",
  feedbackIdea: "idea",
  feedbackOther: "other",
  feedbackPlaceholder: "What happened, or what would help?",
  feedbackFailed: "Not sent. Try again.",
  feedbackSent: "Sent ✓",
  feedbackSending: "Sending…",
  feedbackSend: "Send",
  // Photos and links on feedback (SPEC.md §18)
  feedbackAddPhoto: "Add photo",
  feedbackAddPhotoTitle: "Attach a photo: a screenshot of what happened",
  feedbackAddLink: "Add link",
  feedbackLinkPlaceholder: "Paste a link, then press Enter",
  feedbackLinkInvalid: "That is not a link. It must start with http:// or https://.",
  feedbackPhotoFailed: "The photo did not upload. Try again.",
  feedbackPhotoLimit: "At most {n} photos.",
  feedbackLinkLimit: "At most {n} links.",
  feedbackRemovePhoto: "Remove this photo",
  feedbackRemoveLink: "Remove this link",
  // A reply to feedback: a notification on the dashboard (SPEC.md §18). The
  // card reads this title, the feedback's message, then the reply.
  feedbackReplyTitle: "Reply to your feedback",
  // Share target: /share, where a shared URL or file lands
  shareAddTitle: "Add to a project",
  shareAddChoose: "Choose a project",
  shareAddNothing: "Nothing to add. Share a link or a PDF to Unitos from another app.",
  shareAddNoProjects: "No projects yet. Create one first.",
  shareAddGoHome: "Go to Projects",
  shareAddFailed: "Not added. Try again.",
  // Shared with you shelf
  sharedWithYou: "Shared with you",
  byOwner: "by {name}",
  sharedBadge: "Shared · {n}",
  // Notifications (SPEC.md §18): one pop-up over the dashboard
  notifications: "Notifications",
  dismiss: "Dismiss",
  dismissAll: "Dismiss all",
  notificationCount: "{n} of {total}",
  // The not-found page under a project's URL (SPEC.md §12)
  projectNotFoundBody: "This project was deleted, or it is no longer shared with you.",
};
