import type { DerivationType, NoteStatus } from "@prisma/client";
import type { ChatTurn } from "@/lib/conversation";
import type { SuggestResult } from "@/lib/docs/assistant-suggestions";
import type { BlockKind } from "@/lib/block-kind";
import type { ToggleStyle } from "@/lib/text-style";
import type { DocumentKind } from "@/lib/document-order";

/** One reply in the discussion under a note, an edit, or a link. */
export type ReplyView = {
  id: string;
  content: string;
  userId: string;
  resolvedById: string | null; // account that resolved it; null = open
  createdAt: string; // ISO
};

export type SourceChip = {
  id: string;
  documentId: string;
  documentTitle: string;
  quotedText: string;
  orphaned: boolean;
};

export type NoteView = {
  id: string;
  content: string;
  gist: string | null; // the phrase the collapsed row shows; null = not written yet (SPEC.md §6)
  status: NoteStatus;
  derivationType: DerivationType | null;
  pinned: boolean;
  order: number;
  // Account that wrote the note; null = before attribution existed. The author
  // label renders from this when the corpus is shared.
  createdById: string | null;
  // When the note last changed on the server (ISO). A local draft older than
  // this lost to an edit made elsewhere and is not replayed (lib/note-drafts.ts).
  updatedAt: string;
  // When the note was made (ISO): the notes group by week or month of it.
  // Absent on a note made in this tab before the refresh lands.
  createdAt?: string;
  // The document the note was written in (SPEC.md §6); null = the project
  // as a whole. The tray lists the open document's notes: this, or a source.
  documentId: string | null;
  sources: SourceChip[];
  replies: ReplyView[];
};

export type SectionView = {
  id: string;
  title: string;
  order: number;
  parentId: string | null;
  notes: NoteView[];
  children: SectionView[];
};

export type NotebookView = {
  id: string;
  title: string;
  sections: SectionView[];
  // The project's documents, in attach order: the columns of the notes full
  // page's By document view (SPEC.md §6).
  documents: { id: string; title: string }[];
};

// ── SUMMARIZE: document-level summary, one per depth ───────────────────────

export const SUMMARY_DEPTHS = ["layman", "professional"] as const;
export type SummaryDepth = (typeof SUMMARY_DEPTHS)[number];
/** Stored on NotebookDocument.summaries: one summary per generated depth. */
export type SummaryLevels = Partial<Record<SummaryDepth, string>>;

// ── DISTILL: question → the quotes that answer it ──────────────────────────

/** One quote of a distillation: a verbatim span (same dual anchor as Source,
    SPEC.md §5) plus the caption saying how it answers the question. */
export type DistillQuote = {
  blockId: string;
  start: number;
  end: number;
  quotedText: string;
  prefix: string;
  suffix: string;
  caption: string;
};

/** How many times one extraction may run again (Regenerate). The count
    rides on the extraction that replaces it. */
export const DISTILL_REGENERATE_MAX = 2;

/** Stored on NotebookDocument.distillations, newest first. */
export type Distillation = {
  id: string;
  question: string;
  createdAt: string; // ISO
  createdById?: string; // account that ran the distillation; absent = before attribution
  regenerations?: number; // times this question ran again to make this one; absent = 0
  quotes: DistillQuote[];
};

/** One distillation as the reader sees it: quotes re-resolved against the
    current blocks, orphaned visibly when the words are gone (SPEC.md §5). */
export type DistillationView = Omit<Distillation, "quotes"> & {
  quotes: (DistillQuote & { orphaned: boolean })[];
};

/** Tolerant read of the Json column; anything malformed reads as empty. */
export function distillationList(value: unknown): Distillation[] {
  return Array.isArray(value) ? (value as Distillation[]) : [];
}

// ── Corpus-scope DISTILL (SPEC.md §13): one question, every document ───────

/** One quote of a corpus distillation: a DistillQuote plus the document it
    lives in — quotes span the whole corpus. */
export type CorpusDistillQuote = DistillQuote & { documentId: string };

/** Stored on Notebook.distillations, newest first. */
export type CorpusDistillation = {
  id: string;
  question: string;
  createdAt: string; // ISO
  createdById?: string;
  regenerations?: number; // as on Distillation
  quotes: CorpusDistillQuote[];
};

/** One corpus distillation as the reader sees it: quotes re-resolved against
    the current blocks, each carrying its document's title. */
export type CorpusDistillationView = Omit<CorpusDistillation, "quotes"> & {
  quotes: (CorpusDistillQuote & { orphaned: boolean; documentTitle: string })[];
};

/** Tolerant read of the Json column; anything malformed reads as empty. */
export function corpusDistillationList(value: unknown): CorpusDistillation[] {
  return Array.isArray(value) ? (value as CorpusDistillation[]) : [];
}

// ── FORMALIZE: transcript → formal article / bullet-point notes ────────────

export const FORMALIZE_FORMATS = ["article", "notes"] as const;
export type FormalizeFormat = (typeof FORMALIZE_FORMATS)[number];

/** Stored on NotebookDocument.formalized as {article}: the transcript
    rewritten as a formal article. Regenerate overwrites. The notes format
    lands PENDING notes instead and stores nothing here. */
export type FormalizedArticle = {
  title: string;
  markdown: string;
  createdAt: string; // ISO
  createdById?: string;
  // The article as a document in the corpus: parsed into blocks so every
  // reader tool works on it. Regenerate rewrites the same document's blocks.
  documentId?: string;
};

/** Tolerant read of the Json column; anything malformed reads as null. */
export function formalizedArticle(value: unknown): FormalizedArticle | null {
  if (typeof value !== "object" || value === null) return null;
  const article = (value as { article?: unknown }).article;
  if (typeof article !== "object" || article === null) return null;
  const a = article as FormalizedArticle;
  return typeof a.title === "string" && typeof a.markdown === "string" ? a : null;
}

// ── EXTRACT: origin phrase → the passages that reveal its topic ────────────

/** One anchored span of an extraction (same dual anchor as Source, SPEC.md §5). */
export type ExtractionSpan = {
  blockId: string;
  start: number;
  end: number;
  quotedText: string;
  prefix: string;
  suffix: string;
};

/** Stored on NotebookDocument.extractions, oldest first — the index gives the
    label (M1, M2, …). origin = the phrase Match-it was applied on; spans = the
    passages across the document most revealing about its topic. */
export type Extraction = {
  id: string;
  createdAt: string; // ISO
  createdById?: string; // account that ran the extraction; absent = before attribution
  origin: ExtractionSpan;
  spans: ExtractionSpan[];
};

/** One extraction as the reader sees it: spans re-resolved against the
    current blocks; an unresolvable span stays stored but unpainted. */
export type ExtractionView = Omit<Extraction, "origin" | "spans"> & {
  label: string; // "M1"…
  origin: ExtractionSpan & { orphaned: boolean };
  spans: (ExtractionSpan & { orphaned: boolean })[];
};

/** Tolerant read of the Json column; anything malformed reads as empty. */
export function extractionList(value: unknown): Extraction[] {
  return Array.isArray(value) ? (value as Extraction[]) : [];
}

// ── Reader side panel: annotations and edit history ────────────────────────

/** One annotation on the open document, shown in the Annotations tab.
    kind: "highlight" = manual color highlight, "comment" = margin comment,
    "explain" = AI explanation, "simplify" = AI simplified rewrite, "analyze" =
    AI analysis of a figure or table, "visualize" = AI picture of the selection
    (SPEC.md §20), "assistant" = assistant conversation. All
    live as notes in the hidden Annotations section; highlights carry a color,
    comments carry the user's text. */
export type AnnotationItem = {
  id: string; // note id
  kind: "explain" | "simplify" | "analyze" | "visualize" | "highlight" | "comment" | "assistant";
  content: string;
  gist: string | null; // the phrase the collapsed row shows; null = not written yet (SPEC.md §6)
  color: string | null; // "clay" | "sage" | "gold" for highlights
  sourceId: string | null;
  quotedText: string | null;
  orphaned: boolean;
  createdById: string | null;
  // A resolved comment (SPEC.md §29): it paints no mark and lists under Resolved.
  resolved: boolean;
  replies: ReplyView[];
  // Set when the anchor sits on a figure, table, or equation block: the label
  // ("A1", "A2", …) shown at the block in the reader and on this card.
  figureLabel: string | null;
  // "core": the annotation was made on a block's core in the collapsed view
  // (SPEC.md §28), and lists with the collapsed view's annotations; null for
  // one on the whole text, and for a sidebar conversation.
  layer: "core" | null;
  // The conversation's turns (SPEC.md §21): the turns after a tool's output
  // (Explain+, Simplify+, Analyze+, Visualize+), or the assistant
  // conversation's own; [] for every other annotation.
  conversation: ChatTurn[];
};

/** Set on a link with no project whose documents sit in projects of more
    than one account (SPEC.md §13): no one deletes another account's reply on
    it. outside = the viewer is not in a project of the link's maker: it
    reads the link and changes only its own replies. removable = the viewer
    made the link: only the maker removes or dismisses it, and the removal
    hides it in the maker's projects only. Absent = a link of one project,
    or of one account. */
export type CrossAccountView = { outside: boolean; removable: boolean };

export type LinkOut = {
  id: string;
  toDocumentId: string;
  toTitle: string;
  quotedText: string; // this document's end
  targetQuotedText: string | null; // the other end's quote; null = document-level
  orphaned: boolean; // anchor no longer resolves in the source text
  targetOrphaned: boolean; // the other end no longer resolves in the target text
  detached: boolean; // target document is not attached to this notebook
  recommended: boolean; // AI-proposed, awaiting Accept; paints nowhere until accepted
  reason: string | null; // why the AI connected the two passages
  createdById: string | null;
  replies: ReplyView[];
  crossAccount?: CrossAccountView;
};
export type LinkIn = {
  id: string;
  fromDocumentId: string;
  fromTitle: string;
  quotedText: string; // the other end's quote
  hereQuotedText: string | null; // this document's end; null = document-level
  orphaned: boolean; // this document's end no longer resolves
  fromOrphaned: boolean; // the other end no longer resolves in its text
  recommended: boolean;
  reason: string | null;
  createdById: string | null;
  replies: ReplyView[];
  crossAccount?: CrossAccountView;
};

// ── History (SPEC.md §12): every edit and deletion in the corpus, attributed ──

/** One entry of the History panel: a NotebookEvent (note and section removals,
    detachments) or a BlockEdit (document edits and links), merged newest first. */
export type HistoryEntry = {
  id: string;
  userId: string | null;
  kind:
    | "TEXT_EDIT"
    | "LINK_ADD"
    | "LINK_REMOVE"
    | "BLOCK_ADD"
    | "BLOCK_REMOVE"
    | "BLOCK_MOVE"
    | "FORMAT"
    | "STYLE"
    // A video's or an audio's transcript lines (SPEC.md §11).
    | "LINE_JOIN"
    | "LINE_SPLIT"
    | "SPEAKER"
    | "NOTE_REMOVE"
    | "SECTION_REMOVE"
    | "DOCUMENT_DETACH"
    | "NOTE_MERGE"
    // A re-parse of an import (SPEC.md §29): one entry, never one per paragraph.
    | "REPARSE";
  // A small edit (lib/history/trivial.ts): a typo fixed, a style toggled.
  // The panel folds a run of them into one row.
  trivial?: boolean;
  // The snippet the entry shows: the edited or removed text, the section or
  // document title, the linked quote.
  content: string;
  documentTitle: string | null; // BlockEdit entries: the document it happened in
  createdAt: string; // ISO
};

// ── Stitch (SPEC.md §22): the assistant over the project's documents, from the graph ──

/** One generated document of the project (SPEC.md §22): Stitch wrote it
    from the project's documents. */
export type GeneratedDocumentView = {
  id: string; // document id
  title: string;
  command: string | null;
  createdAt: string; // ISO
  blockCount: number;
};

/** What Stitch read of one document (SPEC.md §22). read: every block of
    it was under the reading passes (its skeleton's lines, or the text
    whole). empty: the document has nothing to read, and `reason` says why
    — a video or audio document reads as its transcript lines, a
    handwritten document as its converted text, so a transcript or
    conversion that has not landed is an empty document. `detail` is the
    stored transcription or conversion error. */
export type StitchDocument = {
  id: string;
  title: string;
  kind: "text" | "video" | "audio" | "handwritten";
  status: "read" | "empty";
  blocks: number;
  total: number;
  // After selection: how many of its blocks the answer pass read whole
  // (the rest were judged off the command). Null on the whole read, and
  // for a document not read.
  shown: number | null;
  reason:
    | "transcriptPending"
    | "transcriptStale"
    | "transcriptFailed"
    | "transcriptNone"
    | "conversionPending"
    | "conversionFailed"
    | "conversionNone"
    | "noText"
    | null;
  detail: string | null;
};

/** What one Stitch command produced (SPEC.md §22): the reply, how many links
    it proposed (each a recommended link awaiting Accept), the generated
    document when it wrote one, and what was read of each document. With
    fewer than two documents read, the command did not run: reply is empty,
    nothing is stored, and documents says why. */
export type StitchResult = {
  reply: string;
  linkCount: number;
  document: { id: string; title: string } | null;
  documents: StitchDocument[];
  // Every stored block id the reply cites as [block <id>]: its document's
  // id and title, and the block's text cut to 600 chars, so a chip can say
  // where it points and open it. {} when the reply cites nothing.
  cited: Record<string, { documentId: string; title: string; text: string }>;
  // The ids of the recommended links this run made, for the graph to light
  // in place (SPEC.md §22). Absent on a result stored before it existed.
  linkIds?: string[];
  // Links the answer proposed that were already in the graph (the same two
  // blocks, an overlapping end), not stored again; the reply says so.
  linksExisting?: number;
  // What this answer stored, for the next command's history (ANS4-02): the
  // box sends it back with the reply as the turn's record.
  record?: StitchRecord;
};

/** What one Stitch answer stored, as the box sends it back with the turn
    (the route's history `record`): each link's id and its two ends'
    document titles, in the order the answer proposed them, and the
    generated document. The route reads the links and the page again by id
    inside the project; the titles name a link that is gone. */
export type StitchRecord = {
  links: { id: string; from: string; to: string }[];
  document: { id: string; title: string } | null;
};

/** What a Stitch command asks for (lib/graph/stitch.ts commandKind): an
    answer, links, or a page. It sets what the answer pass reads after
    selection (STITCH_SELECTED_BUDGET). */
export type StitchCommandKind = "question" | "links" | "page";

// ── Graph view (SPEC.md §13): documents as nodes, links as weighted edges ──

export type GraphNode = {
  id: string; // document id
  title: string;
  hasVideo: boolean;
  // The node's card and dot (SPEC.md §13): what the document is, and its
  // length in blocks (the dot grows with it).
  kind?: DocumentKind;
  blockCount?: number;
};

/** One link of a pair, listed when the pair's curve is hovered or pinned
    (SPEC.md §13): its description — the reader's, or the AI's reason for a
    recommended link — both quotes, and the end the reader lands on. */
export type GraphEdgeLink = {
  id: string;
  fromDocumentId: string;
  fromTitle: string;
  toDocumentId: string;
  toTitle: string;
  quotedText: string; // the from end
  toQuotedText: string | null; // the to end; null = document-level
  // The block each end's quote sits in, whole: the passage the expanded link
  // shows around the quote. Null when the block is gone or the end is
  // document-level. Absent on the graph's data: the link panel reads it
  // when the link opens (GET .../graph/passages, link-passages.ts).
  fromBlockText?: string | null;
  toBlockText?: string | null;
  reason: string | null;
  recommended: boolean;
  // A generated document's provenance link (lib/graph/provenance.ts): drawn
  // only while the graph shows where generated documents come from.
  provenance?: boolean;
  // The discussion on the link, oldest first, and who made it (SPEC.md §13):
  // the curve's list shows the replies under the expanded link. Filled by
  // withLinkReplies in lib/graph/view.ts; absent = none read.
  replies?: ReplyView[];
  createdById?: string | null;
  crossAccount?: CrossAccountView;
};

/** One undirected pair of documents. Edge width and clay depth scale with
    the total; a pair connected only by recommended links draws dashed.
    a === b: the links inside one document, drawn as a loop on its node. */
export type GraphEdge = {
  a: string; // document id
  b: string; // document id; equal to a for a loop
  accepted: number; // the reader's accepted links; provenance links not counted
  recommended: number;
  provenance?: number; // a generated document's provenance links (SPEC.md §22)
  links: GraphEdgeLink[]; // accepted first, oldest first
};

/** One recommended link of the project, listed in the graph (SPEC.md §13):
    both ends, the AI's reason, and the replies. Accept and Dismiss act on it
    there; it paints nowhere until accepted. */
export type RecommendedLinkView = {
  id: string;
  fromDocumentId: string;
  fromTitle: string;
  toDocumentId: string;
  toTitle: string;
  quotedText: string; // the from end
  toQuotedText: string | null; // the to end; null = document-level
  fromBlockText?: string | null; // the block around each end's quote, as on GraphEdgeLink
  toBlockText?: string | null;
  reason: string | null;
  createdById: string | null;
  replies: ReplyView[];
  crossAccount?: CrossAccountView;
};

// ── The assistant as an actor ──────────────────────────────────────────────

export type AssistantAnchor = {
  blockId: string;
  startOffset: number;
  endOffset: number;
  quotedText: string;
  prefix: string;
  suffix: string;
};

/** One approved-or-pending step of an assistant plan, enriched server-side so
    the client can execute it through the normal API routes. */
export type AssistantAction =
  | { type: "edit_block"; blockId: string; newText: string; description: string }
  // kind: the new block's format (a heading, a list); absent = a paragraph.
  // afterBlockId null: the document's start.
  | { type: "insert_paragraph"; afterBlockId: string | null; text: string; kind?: BlockKind; description: string }
  | { type: "remove_block"; blockId: string; description: string }
  | {
      type: "highlight";
      anchor: AssistantAnchor;
      color: "clay" | "sage" | "gold" | "plum";
      comment?: string;
      description: string;
    }
  | { type: "comment"; anchor: AssistantAnchor; comment: string; description: string }
  | {
      type: "add_note";
      content: string;
      sectionId?: string;
      sectionTitle?: string;
      source?: AssistantAnchor & { documentId: string };
      description: string;
    }
  | { type: "add_section"; title: string; description: string }
  // A link to another attached document, or (href) to a web address.
  | { type: "link"; anchor: AssistantAnchor; toDocumentId?: string; href?: string; description: string }
  | { type: "format_block"; blockId: string; kind: BlockKind; description: string }
  // bold, italic, underline, a text color ("color:#rrggbb"), or a highlight
  // ("highlight:#rrggbb"): the edit toolbar's styles (lib/text-style.ts).
  | { type: "style"; anchor: AssistantAnchor; style: ToggleStyle; description: string }
  // A block moved after another; afterBlockId null = the document's start.
  | { type: "move_block"; blockId: string; afterBlockId: string | null; description: string }
  // A change to a document with rich text (SPEC.md §29): the reader runs it
  // as the assistant's suggestions, never through the plan card.
  | { type: "suggest"; instruction: string; blockIds?: string[]; reorder?: boolean; description: string }
  // A document without rich text: the edits of many blocks, found part by
  // part on the server (lib/assistant/revise.ts); the plan carries those
  // edits in its place.
  | { type: "revise"; instruction: string; blockIds?: string[]; reorder?: boolean; description: string }
  // A video's or an audio's transcript (SPEC.md §11, app/api/blocks/lines):
  // two lines next to each other joined into one; one line split in two, the
  // second from `offset` (its first words, `quote`); a line given to another
  // voice (`name`: the voice's; `previous`: the line's voice before, for
  // Undo); a voice renamed on every line (`previousName`: its name before).
  | { type: "join_lines"; blockId: string; nextBlockId: string; description: string }
  | { type: "split_line"; blockId: string; offset: number; quote: string; description: string }
  | { type: "set_speaker"; blockId: string; speakerId: string; name: string; previous: string | null; description: string }
  | { type: "rename_speaker"; speakerId: string; name: string; previousName: string; description: string };

export type AssistantPlan = {
  reply: string | null;
  actions: AssistantAction[];
  warnings: string[];
  // The persisted conversation note, when the chat is anchored to a selection.
  conversationNoteId: string | null;
  // The selection chat's suggestions: the page lands their ops.
  suggestions?: SuggestResult;
};

/** One row of the Edits tab. TEXT_EDIT rows can revert (PATCH the block back
    to `before`); link rows describe the link via meta; a REPARSE row is a
    re-parse of an import, one row for the whole document (SPEC.md §29). */
export type EditItem = {
  id: string;
  kind:
    | "TEXT_EDIT"
    | "LINK_ADD"
    | "LINK_REMOVE"
    | "BLOCK_ADD"
    | "BLOCK_REMOVE"
    | "BLOCK_MOVE"
    | "FORMAT"
    | "STYLE"
    | "REPARSE"
    // A video's or an audio's transcript lines (SPEC.md §11): two lines
    // joined, a line split (before: the words before; after: the words
    // after, a line each), a line given to another voice (meta from, to).
    | "LINE_JOIN"
    | "LINE_SPLIT"
    | "SPEAKER";
  blockId: string | null;
  before: string | null;
  after: string | null;
  userId: string | null; // account that made the edit; null = before attribution
  replies: ReplyView[];
  meta: {
    linkId?: string;
    toDocumentId?: string;
    toTitle?: string;
    quotedText?: string;
    from?: string | null; // FORMAT rows: the format before; SPEAKER rows: the voice's name before
    to?: string | null;
    style?: string; // STYLE rows: "bold" | "italic"
    on?: boolean; // STYLE rows: applied or removed
    restoredFrom?: string; // BLOCK_ADD rows that restore a removed paragraph
    movedAfter?: string | null; // BLOCK_MOVE rows: the words of the block it now follows; null = the document's start
  } | null;
  createdAt: string;
};
