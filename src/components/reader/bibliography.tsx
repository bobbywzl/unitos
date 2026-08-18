"use client";

import { useEffect, useState } from "react";
import { ChevronDownIcon, ChevronRightIcon } from "@/components/icons";
import type { DocumentReference } from "@/lib/parse/types";

function referenceHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

// The References section: every reference of the open document, at the bottom
// of the content body, collapsed by default. Clicking a citation mark in the
// text expands the section, scrolls to the entry, and flashes it. Entries with
// a URL link out. Print always shows the entries.
export function Bibliography({ references }: { references: DocumentReference[] }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onOpenReference = (e: Event) => {
      const referenceId = (e as CustomEvent).detail?.referenceId as string | undefined;
      if (!referenceId) return;
      setOpen(true);
      // Scroll after the expanded list paints. Retries while it does.
      let tries = 0;
      const seek = () => {
        const el = document.getElementById(`reference-${referenceId}`);
        if (el && el.getBoundingClientRect().height > 0) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          el.classList.add("anchor-flash");
          setTimeout(() => el.classList.remove("anchor-flash"), 2000);
        } else if (tries++ < 20) {
          requestAnimationFrame(seek);
        }
      };
      requestAnimationFrame(seek);
    };
    window.addEventListener("dissect:open-reference", onOpenReference);
    return () => window.removeEventListener("dissect:open-reference", onOpenReference);
  }, []);

  if (references.length === 0) return null;

  return (
    <section className="mx-auto w-[720px] max-w-full px-6 pb-14 print:pb-0">
      <div className="border-t border-line pt-5">
        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex items-center gap-1.5 text-[12px] font-bold tracking-[0.09em] text-clay-700 uppercase hover:text-clay-800 print:hidden"
        >
          {open ? <ChevronDownIcon size={13} /> : <ChevronRightIcon size={13} />}
          References ({references.length})
        </button>
        <p className="hidden text-[12px] font-bold tracking-[0.09em] text-clay-700 uppercase print:block">
          References ({references.length})
        </p>
        <ol className={`mt-4 space-y-2 ${open ? "" : "hidden print:block"}`}>
          {references.map((reference) => (
            <li
              key={reference.id}
              id={`reference-${reference.id}`}
              className="flex gap-2.5 rounded-lg px-1.5 py-0.5 text-[13.5px] leading-relaxed text-sand-700"
            >
              <span className="min-w-7 shrink-0 text-right font-semibold text-sand-500 tabular-nums">
                {reference.label}.
              </span>
              <span>
                {reference.text}
                {reference.url && (
                  <>
                    {" "}
                    <a
                      href={reference.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="whitespace-nowrap font-semibold text-clay-700 hover:text-clay-800 hover:underline"
                    >
                      {referenceHost(reference.url)} ↗
                    </a>
                  </>
                )}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
