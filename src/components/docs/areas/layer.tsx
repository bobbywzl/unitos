"use client";

import { useEffect } from "react";
import type { DocsAreaProps } from "@/components/docs/areas/types";
import { PAGE_EDITED_EVENT } from "@/components/docs/layer/events";

// The Unitos layer inside the page editor (SPEC.md §29). The marks are
// annotation-marks.tsx; the toolbar and cards are the reader's.
export function UnitosLayer({ editor, documentId }: DocsAreaProps) {
  // The words changed: the reader closes its toolbar over the old words.
  useEffect(() => {
    const onUpdate = () => window.dispatchEvent(new CustomEvent(PAGE_EDITED_EVENT, { detail: { documentId } }));
    editor.on("update", onUpdate);
    return () => {
      editor.off("update", onUpdate);
    };
  }, [editor, documentId]);
  return null;
}
