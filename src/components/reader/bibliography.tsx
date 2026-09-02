"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDownIcon, ChevronRightIcon } from "@/components/icons";
import { useT } from "@/components/lang-provider";
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
  const t = useT();
  const [open, setOpen] = useState(false);
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const onOpenReference = (e: Event) => {
      const detail = (e as CustomEvent).detail as
        | { referenceId?: string; origin?: Element }
        | undefined;
      const referenceId = detail?.referenceId;
      if (!referenceId || !sectionRef.current) return;
      // Split view runs one reader per pane: only the pane the citation was
      // clicked in opens its References section.
      const root = sectionRef.current.closest("[data-reader-root]");
      if (detail?.origin && root && detail.origin.closest("[data-reader-root]") !== root) return;
      setOpen(true);
      // Scroll after the expanded list paints. Retries while it does. The
      // entry is found inside this section — pane ids can repeat across panes.
      let tries = 0;
      const seek = () => {
        const el = sectionRef.current?.querySelector<HTMLElement>(`#reference-${referenceId}`);
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
    <section ref={sectionRef} className="mx-auto w-full max-w-[720px] px-6 pb-14 print:pb-0">
      <div className="border-t border-line pt-5">
        <button
          onClick={() => setOpen((v) => !v)}
          data-track="references"
          aria-expanded={open}
          className="flex items-center gap-1.5 text-[12px] font-bold tracking-[0.09em] text-clay-700 uppercase hover:text-clay-800 print:hidden"
        >
          {open ? <ChevronDownIcon size={13} /> : <ChevronRightIcon size={13} />}
          {t("panes.referencesCount", { n: references.length })}
        </button>
        <p className="hidden text-[12px] font-bold tracking-[0.09em] text-clay-700 uppercase print:block">
          {t("panes.referencesCount", { n: references.length })}
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
                      className="weblink-mark whitespace-nowrap font-semibold"
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
