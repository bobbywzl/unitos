import type { Editor } from "@tiptap/react";
import type { PageSetup } from "@/lib/docs/schema";

/** What every area of the page editor receives (SPEC.md §29). */
export type DocsAreaProps = {
  editor: Editor;
  documentId: string;
  /** The project the document is open in. */
  notebookId: string;
  /** The reader may edit the document (editor or owner). */
  canEdit: boolean;
  /** The reader is an editor or the owner of the project: the reader may add
      a document to it (Make a copy), whether or not this one may be edited. */
  projectEditor: boolean;
  /** The page takes typing now: canEdit and the mode is Editing or Suggesting. */
  editing: boolean;
  pageSetup: PageSetup;
  /** The project's documents, for links and file chips. */
  documents: { id: string; title: string }[];
};
