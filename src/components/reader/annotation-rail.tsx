"use client";

import Link from "next/link";
import { useState } from "react";
import { Markdown } from "@/components/markdown";
import { ChevronDownIcon, ChevronRightIcon } from "@/components/icons";

export type AnnotationView = {
  id: string;
  content: string;
  sourceId: string | null;
  orphaned: boolean;
};

// Annotations for the open document: EXPLAIN notes from the hidden Annotations
// section. A quiet strip above the reading column, closed until asked for.
export function AnnotationRail({
  notebookId,
  documentId,
  annotations,
}: {
  notebookId: string;
  documentId: string;
  annotations: AnnotationView[];
}) {
  const [open, setOpen] = useState(false);
  if (annotations.length === 0) return null;

  return (
    <div className="shrink-0 border-b border-line px-5 py-2">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded-full py-1 text-[11px] font-bold tracking-[0.08em] text-clay-800 uppercase hover:text-clay-600"
      >
        {open ? <ChevronDownIcon size={13} /> : <ChevronRightIcon size={13} />}
        Annotations · {annotations.length}
      </button>
      {open && (
        <ul className="mt-2 flex max-h-80 flex-col gap-2 overflow-y-auto pb-2">
          {annotations.map((a) => (
            <li key={a.id} className="rounded-2xl bg-card p-3.5 text-sm shadow-soft">
              <Markdown>{a.content}</Markdown>
              {a.sourceId && !a.orphaned && (
                <Link
                  href={`/n/${notebookId}?doc=${documentId}&src=${a.sourceId}`}
                  className="mt-2 inline-block rounded-full bg-clay-100 px-2.5 py-0.5 text-[11px] font-semibold text-clay-800 hover:bg-clay-200"
                >
                  Jump to passage
                </Link>
              )}
              {a.orphaned && (
                <span className="mt-2 inline-block text-[11px] font-semibold text-red-500">
                  Anchor unresolved
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
