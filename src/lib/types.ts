import type { DerivationType, NoteStatus } from "@prisma/client";

export type NoteView = {
  id: string;
  content: string;
  status: NoteStatus;
  derivationType: DerivationType | null;
  order: number;
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
