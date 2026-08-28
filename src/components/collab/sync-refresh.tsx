"use client";

import { useCollab } from "@/components/collab/collab-context";
import { useNotebookSync } from "@/components/collab/use-sync";

// Live sync with nothing to render: the notes full page polls through this so
// another account's changes land there too.
export function SyncRefresh({ notebookId, rev }: { notebookId: string; rev: number }) {
  const { authOn, myId } = useCollab();
  useNotebookSync({
    notebookId,
    documentId: null,
    rev,
    enabled: true,
    accountId: authOn ? myId : null,
  });
  return null;
}
