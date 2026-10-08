import type { DocumentKind } from "@/lib/document-order";

// One row of the project's document list (SPEC.md §6), as the reader's
// document bar, Documents list, folders, and re-parse read it.
export type AttachedDocument = {
  id: string;
  title: string;
  sourceUrl: string | null;
  parserVersion: number;
  hasFile: boolean;
  pdf: boolean; // the stored file is a PDF: Re-parse asks which shape (SPEC.md §16)
  hasVideo: boolean; // re-parses by transcribing again (SPEC.md §11)
  handwritten: boolean; // pages, not text blocks; the menu flips the shape (SPEC.md §16)
  // The browser render for scripted figures (Document.figureRenderAt,
  // figureRenderError): none has run, or when the last ran and why it did
  // not deliver (SPEC.md §15).
  figureRenderAt: string | null;
  figureRenderError: string | null;
  // The folder the document sits in within this project (SPEC.md §6); null
  // = the project itself.
  folderId: string | null;
  // An import edited since it was imported (SPEC.md §29): Re-parse asks
  // before it replaces the edits. Absent: the server's 409 "edited" asks.
  importEdited?: boolean;
  // The document list's Sort by (SPEC.md §6; lib/document-order.ts): what
  // the document was made from, when it was added, and its last edit in
  // this project (documentEditedAt).
  kind: DocumentKind;
  addedAt: string;
  editedAt: string;
};

// COST6-08: the page sends one list of the documents, and every prop that
// needs a list (the document bar, the panes' pickers, the text layer, the
// project view) gets that one array, so the payload carries it once. A row
// leaves out every field at its default (below); the workspace puts the
// defaults back (withDocumentDefaults) before any reader reads a field.
const DEFAULTS = {
  sourceUrl: null,
  parserVersion: 0,
  hasFile: false,
  pdf: false,
  hasVideo: false,
  handwritten: false,
  figureRenderAt: null,
  figureRenderError: null,
  folderId: null,
  importEdited: false,
} satisfies Partial<AttachedDocument>;
type Defaulted = keyof typeof DEFAULTS;

/** A row as the page sends it: the defaulted fields only when they differ,
    and editedAt only when it is not addedAt. */
export type AttachedDocumentRow = Omit<AttachedDocument, Defaulted | "editedAt"> &
  Partial<Pick<AttachedDocument, Defaulted | "editedAt">>;

export function compactDocument(d: AttachedDocument): AttachedDocumentRow {
  const row: Record<string, unknown> = { id: d.id, title: d.title, kind: d.kind, addedAt: d.addedAt };
  if (d.editedAt !== d.addedAt) row.editedAt = d.editedAt;
  for (const key of Object.keys(DEFAULTS) as Defaulted[]) {
    if (d[key] !== undefined && d[key] !== DEFAULTS[key]) row[key] = d[key];
  }
  return row as AttachedDocumentRow;
}

export function withDocumentDefaults(row: AttachedDocumentRow): AttachedDocument {
  return { ...DEFAULTS, ...row, editedAt: row.editedAt ?? row.addedAt };
}
