// UI strings of Breakwork (SPEC.md §32): the button, the overlay, the
// buckets, the pieces, the connections, the unsorted tray, and the structure
// assistant. zh glossary: dict/common.ts — structure 结构 · bucket 类别 ·
// piece 片块 · connection 关联 · unsorted 未归类 · Breakwork 不翻译.

export const en = {
  // The button beside Collapse (reader-interactions.tsx)
  structure: "Breakwork",
  structureButtonTitle:
    "Breakwork: sort the document's blocks into buckets on a canvas, by hand or with the assistant, and draw connections between them",
  // The overlay header
  counts: "{buckets} buckets · {placed} of {total} blocks placed",
  saveFailed: "Not saved",
  undo: "Undo",
  undoTitle: "Undo the last change to the structure",
  addBucket: "Add bucket",
  addBucketTitle: "Add an empty bucket to the canvas",
  // The canvas
  empty:
    "No buckets yet. Add a bucket and drag blocks into it from Unsorted, or ask the assistant on the left to sort the document for you.",
  emptyViewer: "No buckets yet. An editor can sort the document here.",
  canvasHint:
    "Drag a bucket by its header. Drag a block between buckets, or back to Unsorted. Drag from the dot at the side of a bucket or a block to another to connect them; click a connection's label to name it.",
  // Buckets
  bucketUntitled: "Untitled bucket",
  bucketTitle: "Bucket title",
  bucketTitlePlaceholder: "Name this bucket",
  bucketRenameTitle: "Rename this bucket",
  bucketDescription: "Bucket description",
  bucketDescriptionPlaceholder: "What belongs here",
  bucketMenu: "Bucket menu",
  bucketColor: "Color",
  bucketAddInside: "Add a bucket inside",
  bucketPutInside: "Put inside",
  bucketOnCanvas: "The canvas",
  bucketEmpty: "Empty this bucket",
  bucketRemove: "Delete this bucket",
  bucketEmptyHint: "Drop blocks here",
  bucketEmptyViewer: "Empty",
  // Pieces
  pieceGone: "This block is no longer in the document. The words it had are kept here.",
  pieceChanged: "The block's text changed since it was placed here.",
  pieceLabel: "Block label",
  pieceLabelPlaceholder: "What this block contributes",
  pieceAddLabel: "Add a label",
  pieceRelabel: "Change the label",
  pieceUnplace: "Unsort",
  pieceUnplaceTitle: "Take this block out of its bucket, back to Unsorted",
  openBlock: "Open in reader",
  openBlockTitle: "Close the structure and jump to this block in the reader",
  openAnnotationTitle: "Open this in the reader",
  explainTitle: "Explain this block. The explanation is saved as an annotation on the block.",
  simplifyTitle: "Simplify this block. The simplification is saved as an annotation on the block.",
  kindHighlight: "Highlight",
  kindComment: "Comment",
  kindNote: "Note",
  kindAnalyze: "Analyze",
  kindVisualize: "Visualize",
  kindAssistant: "Assistant conversation",
  kindEquation: "Equation",
  kindCode: "Code",
  kindHeading: "Heading",
  // Connections
  connectionTitle: "Open this connection: its label and comment",
  connectionUnlabeled: "Unlabeled",
  // The card's first line: the two ends by name, in the arrow's direction.
  connectionBetween: "From {from} to {to}",
  connectionEndBucket: "the bucket “{name}”",
  connectionEndPiece: "the block “{name}”",
  connectionLabel: "Connection label",
  connectionLabelPlaceholder: "How they relate: supports, contradicts, example of…",
  connectionComment: "Connection comment",
  connectionCommentPlaceholder: "What each side says, in a sentence or two",
  connectionRemoveTitle: "Delete this connection",
  // The unsorted tray
  unsorted: "Unsorted",
  unsortedHint: "Every block not yet in a bucket, in reading order. Drag one into a bucket, or click it and pick a bucket.",
  unsortedViewer: "Every block not yet in a bucket, in reading order.",
  unsortedFind: "Find a block",
  unsortedEmpty: "Every block is in a bucket.",
  unsortedNoMatch: "No block matches.",
  unsortedPlaceTitle: "Put this block in {bucket}",
  // The Breakwork assistant
  assistant: "Breakwork assistant",
  assistantTitle: "The Breakwork assistant: talk about how to sort the document, then ask for a structure",
  assistantExpand: "Show the Breakwork assistant",
  assistantCollapse: "Hide the Breakwork assistant",
  assistantHint:
    "Say how to sort the document: by its parts, by keywords, by what the paragraphs have in common, by the questions they answer. Ask for a structure and it proposes one; you apply it or discard it. It can change the structure as much as you ask.",
  assistantWelcome:
    "Tell me how you want this document sorted, or ask what would work. When you are ready, ask for a structure: I will propose the buckets, put every block in one, and draw the connections. You apply it or discard it.",
  assistantWelcomeAgain:
    "The structure is on the canvas. Ask for any change: split a bucket, merge two, re-sort by another rule, label the blocks, connect what belongs together.",
  assistantPlaceholder: "How should the document be sorted?",
  assistantSend: "Send",
  assistantRunning: "Reading the document…",
  assistantRunningFor: "Reading the document… {s} s",
  retry: "Try again",
  assistantViewer: "Viewers can read the structure. Ask an editor to run the assistant.",
  suggestParts: "Sort the document by its parts, one bucket each",
  suggestThemes: "Sort the paragraphs by the themes they share",
  suggestQuestions: "Sort the blocks by the question each one answers",
  suggestConnect: "Connect the blocks that support or contradict each other",
  // Proposals
  proposal: "Proposed structure",
  proposalNoReply: "Here is the structure.",
  proposalSummary:
    "{buckets} buckets, {placed} blocks placed. Against the canvas: {added} buckets added, {removed} removed, {moved} blocks placed or moved, {connections} connections added.",
  proposalBlocks: "{n} blocks",
  apply: "Apply",
  applyTitle: "Put this structure on the canvas. Undo takes it back.",
  discard: "Discard",
  discardTitle: "Leave the canvas as it is",
  proposalApplied: "Applied",
  proposalDiscarded: "Discarded",
  proposalPending: "Not applied",
};
