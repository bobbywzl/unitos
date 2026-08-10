"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDownIcon } from "@/components/icons";

// Markdown and Word fold into one Export menu (design 2b).
export function ExportMenu({ notebookId }: { notebookId: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded-full border border-line px-4 py-1.5 text-[13px] text-sand-700 hover:bg-clay-100 hover:text-clay-800"
      >
        Export
        <ChevronDownIcon size={13} />
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-2 flex w-40 flex-col overflow-hidden rounded-2xl bg-card py-1 shadow-float">
          <a
            href={`/api/notebooks/${notebookId}/export?format=md`}
            onClick={() => setOpen(false)}
            className="px-4 py-2 text-sm text-sand-700 hover:bg-clay-100 hover:text-clay-800"
          >
            Markdown
          </a>
          <a
            href={`/api/notebooks/${notebookId}/export?format=docx`}
            onClick={() => setOpen(false)}
            className="px-4 py-2 text-sm text-sand-700 hover:bg-clay-100 hover:text-clay-800"
          >
            Word
          </a>
        </div>
      )}
    </div>
  );
}
