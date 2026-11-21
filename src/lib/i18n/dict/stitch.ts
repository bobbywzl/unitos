// UI strings of Stitch and the generated content, both in the graph
// (SPEC.md §22). zh glossary: dict/common.ts — stitch 缝合 · generated
// document 生成文档 · pick(为缝合选中节点) 选取.

export const en = {
  generated: "Generated content",
  generatedDesc: "Every page Stitch wrote for the project, newest first. A row opens it in the reader.",
  generatedEmpty: "Nothing generated yet. Ask Stitch below for a page built from the documents.",
  generatedFrom: "From the command: {command}",
  generatedToggleTitle: "Show the pages Stitch wrote for the project",
  openGenerated: "Open this generated document",
  blockCount: "{n} blocks",
  deleteGenerated: "Delete",
  deleteGeneratedTitle: "Delete this generated document",
  confirmDeleteGenerated: "Delete this generated document? Its annotations go with it. Notes that quote it keep their quotes.",

  // The Stitch box (stitch-box.tsx)
  stitch: "Stitch",
  stitchTitle: "Stitch: the assistant works across the project's documents — answers and extracts, and when asked draws links or writes a new page",
  stitchPlaceholder: "What should the assistant do across these documents?",
  stitchHint:
    "The assistant reads the documents picked in the graph, or every document when none is picked; a video or audio document as its transcript. It answers here: ask a question, or ask it to extract what the documents say on a topic. It draws links between passages or writes a new page only when you ask for one. Links await Accept in Recommended links; a page lands under Generated content. Every reply says what was read of each document.",
  stitchSend: "Send",
  stitchRunning: "Reading the documents…",
  stitchStop: "Stop",
  stitchExpand: "Expand Stitch",
  stitchCollapse: "Collapse Stitch",
  // Which documents the command reads: the nodes picked in the graph, or
  // every document when none is picked.
  stitchScopeAll: "Every document ({n})",
  stitchScopePicked: "{n} documents picked",
  stitchScopePickedOne: "1 document picked",
  stitchPick: "Pick documents",
  stitchPickTitle: "Click nodes in the graph to pick the documents Stitch reads. ⇧-click picks without this.",
  stitchPickDone: "Done",
  stitchPickClear: "Clear",
  stitchPickClearTitle: "Read every document again",
  stitchUnpick: "Remove {title} from the pick",
  // The chips. Each says what it makes: the first two answer in the box,
  // the third asks for links, the fourth for a page.
  stitchSuggestGather: "Extract the points on…",
  stitchSuggestContradict: "Find where these documents contradict each other",
  stitchSuggestConnect: "Link the passages that answer…",
  stitchSuggestSynthesis: "Write one page that combines what they say about…",
  stitchLinksMade1: "{n} link proposed, between the documents read. Accept it under Recommended links.",
  stitchLinksMadeN: "{n} links proposed, between the documents read. Accept them under Recommended links.",
  // Added to a reply when the model wanted to make links and the command named none.
  stitchLinksHeld: "No links were made: this command did not ask for links. Say \"link these passages\" to get them.",
  stitchDocumentMade: "Page written: {title}",
  stitchOpenDocument: "Open",
  stitchNothingStored: "Nothing was stored.",
  stitchFailed: "Stitch failed. {reason}",
  stitchViewer: "Viewers can read the documents. Ask an editor to run Stitch.",
  // What was read of each document (StitchDocument). A document not read
  // shows why; a transcript that failed shows the stored reason.
  stitchDocumentsRead: "Read {read} of {total} documents",
  stitchNotEnoughRead: "Stitch did not run. It needs two documents it can read.",
  stitchUnitText: "blocks",
  stitchUnitTranscript: "transcript lines",
  stitchUnitConverted: "converted blocks",
  stitchDocumentRead: "{n} {unit} read",
  stitchDocumentTranscriptPending: "Not read: the transcript is still being written",
  stitchDocumentTranscriptStale: "Not read: the last transcription run did not finish",
  stitchDocumentTranscriptFailed: "Not read: transcription failed. {detail}",
  stitchDocumentTranscriptNone: "Not read: no transcript yet. Open the document to transcribe it",
  stitchDocumentConversionPending: "Not read: conversion to text is still running",
  stitchDocumentConversionFailed: "Not read: conversion to text failed. {detail}",
  stitchDocumentConversionNone: "Not read: handwritten and not converted to text yet",
  stitchDocumentNoText: "Not read: no text",
};
