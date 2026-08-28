import type { DerivationType, NoteStatus } from "@prisma/client";

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
  status: NoteStatus;
  derivationType: DerivationType | null;
  order: number;
  // Account that wrote the note; null = before attribution existed. The author
  // label renders from this when the corpus is shared.
  createdById: string | null;
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
};

// ── SUMMARIZE: document-level summary, one per depth ───────────────────────

// Depth "insights" is Insiders Insights: industry-insider findings, with
// declared insufficiency as a correct answer.
export const SUMMARY_DEPTHS = ["insights", "layman", "professional"] as const;
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

/** Stored on NotebookDocument.distillations, newest first. */
export type Distillation = {
  id: string;
  question: string;
  createdAt: string; // ISO
  createdById?: string; // account that ran the distillation; absent = before attribution
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
    label (E1, E2, …). origin = the phrase Extract was applied on; spans = the
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
  label: string; // "E1"…
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
    "explain" = AI explanation, "simplify" = AI simplified rewrite. All live as
    notes in the hidden Annotations section; highlights carry a color, comments
    carry the user's text. */
export type AnnotationItem = {
  id: string; // note id
  kind: "explain" | "simplify" | "highlight" | "comment" | "assistant";
  content: string;
  color: string | null; // "clay" | "sage" | "gold" for highlights
  sourceId: string | null;
  quotedText: string | null;
  orphaned: boolean;
  createdById: string | null;
  replies: ReplyView[];
  // Set when the anchor sits on a figure, table, or equation block: the label
  // ("A1", "A2", …) shown at the block in the reader and on this card.
  figureLabel: string | null;
};

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
    | "FORMAT"
    | "STYLE"
    | "NOTE_REMOVE"
    | "SECTION_REMOVE"
    | "DOCUMENT_DETACH";
  // The snippet the entry shows: the edited or removed text, the section or
  // document title, the linked quote.
  content: string;
  documentTitle: string | null; // BlockEdit entries: the document it happened in
  createdAt: string; // ISO
};

// ── Graph view (SPEC.md §13): documents as nodes, links as weighted edges ──

export type GraphNode = {
  id: string; // document id
  title: string;
  hasVideo: boolean;
};

/** One undirected pair of documents. Edge thickness scales with the total;
    a pair connected only by recommended links draws dashed. */
export type GraphEdge = {
  a: string; // document id
  b: string; // document id
  accepted: number;
  recommended: number;
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
  | { type: "insert_paragraph"; afterBlockId: string; text: string; description: string }
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
  | { type: "link"; anchor: AssistantAnchor; toDocumentId: string; description: string }
  | {
      type: "format_block";
      blockId: string;
      kind: "paragraph" | "h1" | "h2" | "h3";
      description: string;
    }
  | { type: "style"; anchor: AssistantAnchor; style: "bold" | "italic"; description: string };

export type AssistantPlan = {
  reply: string | null;
  actions: AssistantAction[];
  warnings: string[];
  // The persisted conversation note, when the chat is anchored to a selection.
  conversationNoteId: string | null;
};

/** One row of the Edits tab. TEXT_EDIT rows can revert (PATCH the block back
    to `before`); link rows describe the link via meta. */
export type EditItem = {
  id: string;
  kind: "TEXT_EDIT" | "LINK_ADD" | "LINK_REMOVE" | "BLOCK_ADD" | "BLOCK_REMOVE" | "FORMAT" | "STYLE";
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
    from?: string;
    to?: string;
    style?: string; // STYLE rows: "bold" | "italic"
    on?: boolean; // STYLE rows: applied or removed
    restoredFrom?: string; // BLOCK_ADD rows that restore a removed paragraph
  } | null;
  createdAt: string;
};
