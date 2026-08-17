import type { DerivationType, NoteStatus } from "@prisma/client";

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
  sources: SourceChip[];
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

export const SUMMARY_DEPTHS = ["layman", "intermediate", "professional"] as const;
export type SummaryDepth = (typeof SUMMARY_DEPTHS)[number];
/** Stored on NotebookDocument.summaries: one summary per generated depth. */
export type SummaryLevels = Partial<Record<SummaryDepth, string>>;

// ── Reader side panel: annotations and edit history ────────────────────────

/** One annotation on the open document, shown in the Annotations tab.
    kind: "highlight" = manual color highlight, "comment" = margin comment,
    "explain" = AI explanation, "simplify" = AI simplified rewrite. All live as
    notes in the hidden Annotations section; highlights carry a color, comments
    carry the user's text. */
export type AnnotationItem = {
  id: string; // note id
  kind: "explain" | "simplify" | "highlight" | "comment";
  content: string;
  color: string | null; // "clay" | "sage" | "gold" for highlights
  sourceId: string | null;
  quotedText: string | null;
  orphaned: boolean;
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
};
export type LinkIn = {
  id: string;
  fromDocumentId: string;
  fromTitle: string;
  quotedText: string; // the other end's quote
  hereQuotedText: string | null; // this document's end; null = document-level
  orphaned: boolean; // this document's end no longer resolves
  fromOrphaned: boolean; // the other end no longer resolves in its text
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
};

/** One row of the Edits tab. TEXT_EDIT rows can revert (PATCH the block back
    to `before`); link rows describe the link via meta. */
export type EditItem = {
  id: string;
  kind: "TEXT_EDIT" | "LINK_ADD" | "LINK_REMOVE" | "BLOCK_ADD" | "BLOCK_REMOVE" | "FORMAT" | "STYLE";
  blockId: string | null;
  before: string | null;
  after: string | null;
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
