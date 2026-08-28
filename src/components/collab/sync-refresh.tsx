"use client";

import { useNotebookSync } from "@/components/collab/use-sync";

// Live sync with nothing to render: the notes full page polls through this so
// another account's changes land there too.
export function SyncRefresh({ notebookId, rev }: { notebookId: string; rev: number }) {
  useNotebookSync({ notebookId, documentId: null, rev, enabled: true });
  return null;
}
