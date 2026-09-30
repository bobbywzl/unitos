"use client";

import type { RichNode } from "@/lib/docs/schema";
import { DOC_DRAFTS, tx } from "@/lib/offline/db";

// The page editor's unsaved text (SPEC.md §17, §29), kept in the browser's
// IndexedDB until the server confirms a save of it. The editor saves over the
// network; offline, or when the tab closes, reloads, or opens another
// document before a save lands, the words typed would otherwise be gone. A
// draft holds the text, and the revision and stored copy it was typed over,
// so the next open sends it through the same merge a save that met a newer
// revision takes (use-docs-save.ts).

export type DocDraft = {
  id: string; // the document
  // The account that typed it (the tab's account); null with sign-in off.
  // Another account signed in on this browser never gets it.
  account: string | null;
  richText: RichNode;
  rev: number;
  base: RichNode;
  savedAt: number;
};

// A draft nobody opened in this long is stale: the document was deleted.
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export async function readDocDraft(id: string): Promise<DocDraft | null> {
  try {
    const draft = await tx<DocDraft | undefined>(DOC_DRAFTS, "readonly", (s) => s.get(id));
    if (!draft) return null;
    if (Date.now() - draft.savedAt > MAX_AGE_MS) {
      await clearDocDraft(id);
      return null;
    }
    return draft;
  } catch {
    return null;
  }
}

export async function writeDocDraft(draft: DocDraft): Promise<void> {
  try {
    await tx(DOC_DRAFTS, "readwrite", (s) => s.put(draft));
  } catch {
    // Storage blocked or full: the server save alone carries the text.
  }
}

export async function clearDocDraft(id: string): Promise<void> {
  try {
    await tx(DOC_DRAFTS, "readwrite", (s) => s.delete(id));
  } catch {
    // Nothing to clear.
  }
}
