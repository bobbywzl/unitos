"use client";

import { useEffect } from "react";
import type { DocsAreaProps } from "@/components/docs/areas/types";
import { PAGE_EDITED_EVENT } from "@/components/docs/layer/events";

// The Unitos layer's own controls on the page editor (SPEC.md §29): what
// the reader's tools need that lives inside the editor. The marks are
// annotation-marks.tsx; the toolbar and the cards are the reader's
// (reader-interactions.tsx), placed by layer/margin.ts.
export function UnitosLayer({ editor, documentId }: DocsAreaProps) {
  // The words under the reader's toolbar changed — typing, a paste, an undo:
  // its anchor no longer names them, so the reader closes it. A stored copy
  // put on screen does not emit an update.
  useEffect(() => {
    const onUpdate = () => {
      window.dispatchEvent(new CustomEvent(PAGE_EDITED_EVENT, { detail: { documentId } }));
    };
    editor.on("update", onUpdate);
    return () => {
      editor.off("update", onUpdate);
    };
  }, [editor, documentId]);
  return null;
}
