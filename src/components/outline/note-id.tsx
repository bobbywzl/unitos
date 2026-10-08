"use client";

import { TOUCH_HIT } from "@/components/outline/touch-hit";
import { useState } from "react";
import { useT } from "@/components/lang-provider";

// The note's id, shown on every card so a note can be named — in a reply, to
// a collaborator, in the search box. The cuid is the unique id; its last six
// characters are its random tail, so the short form tells notes apart in a
// project and search matches either form (use-outline.ts noteMatches).

export function shortNoteId(id: string): string {
  return `#${id.slice(-6)}`;
}

/** The id chip: click copies the short form; the title carries the full id. */
export function NoteId({
  id,
  className,
  annotation = false,
}: {
  id: string;
  className?: string;
  /** An annotation's id chip: its own words, not a note's. */
  annotation?: boolean;
}) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(shortNoteId(id));
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      data-track="note-id-copy"
      title={t(annotation ? "outline.annotationIdTitle" : "outline.noteIdTitle", { id })}
      aria-label={t(annotation ? "outline.copyAnnotationId" : "outline.copyNoteId")}
      className={`shrink-0 rounded-full font-mono text-[10.5px] tracking-tight text-sand-500 hover:text-clay-700 ${TOUCH_HIT} ${className ?? ""}`}
    >
      {copied ? t("outline.copied") : shortNoteId(id)}
    </button>
  );
}
