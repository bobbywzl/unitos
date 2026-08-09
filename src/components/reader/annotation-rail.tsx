"use client";

import Link from "next/link";
import { useState } from "react";
import { Markdown } from "@/components/markdown";

export type AnnotationView = {
  id: string;
  content: string;
  sourceId: string | null;
  orphaned: boolean;
};

// Annotations for the open document: EXPLAIN notes from the hidden Annotations section.
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
    <div className="border-b border-neutral-200 bg-amber-50/50 px-4 py-1.5 dark:border-neutral-800 dark:bg-neutral-950">
      <button
        onClick={() => setOpen(!open)}
        className="text-xs font-medium text-amber-700 hover:text-amber-900 dark:text-amber-400"
      >
        {open ? "▾" : "▸"} Annotations ({annotations.length})
      </button>
      {open && (
        <ul className="mt-2 max-h-80 space-y-2 overflow-y-auto pb-2">
          {annotations.map((a) => (
            <li
              key={a.id}
              className="rounded-md border border-amber-200 bg-white p-2 dark:border-amber-900 dark:bg-neutral-900"
            >
              <Markdown>{a.content}</Markdown>
              {a.sourceId && !a.orphaned && (
                <Link
                  href={`/n/${notebookId}?doc=${documentId}&src=${a.sourceId}`}
                  className="mt-1 inline-block text-xs text-amber-700 hover:underline dark:text-amber-400"
                >
                  ⚓ Jump to passage
                </Link>
              )}
              {a.orphaned && <span className="mt-1 inline-block text-xs text-red-500">⚠ anchor unresolved</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
