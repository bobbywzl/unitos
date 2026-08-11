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

// ── Reader side panel: annotations and edit history ────────────────────────

/** One annotation on the open document, shown in the Annotations tab.
    kind: "highlight" = manual color highlight, "comment" = margin comment,
    "explain" = AI explanation. All live as notes in the hidden Annotations
    section; highlights carry a color, comments carry the user's text. */
export type AnnotationItem = {
  id: string; // note id
  kind: "explain" | "highlight" | "comment";
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
  quotedText: string;
  orphaned: boolean; // anchor no longer resolves in the source text
  detached: boolean; // target document is not attached to this notebook
};
export type LinkIn = { id: string; fromDocumentId: string; fromTitle: string; quotedText: string };

/** One row of the Edits tab. TEXT_EDIT rows can revert (PATCH the block back
    to `before`); link rows describe the link via meta. */
export type EditItem = {
  id: string;
  kind: "TEXT_EDIT" | "LINK_ADD" | "LINK_REMOVE";
  blockId: string | null;
  before: string | null;
  after: string | null;
  meta: { linkId?: string; toDocumentId?: string; toTitle?: string; quotedText?: string } | null;
  createdAt: string;
};
