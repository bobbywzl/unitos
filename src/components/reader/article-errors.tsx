"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { WarningIcon } from "@/components/icons";
import { useT } from "@/components/lang-provider";
import { Presence } from "@/components/presence";
import { dismissErrors, useErrorLog } from "@/lib/error-log";

// The article's errors (lib/error-log.ts): a red triangle under the Distill
// and Extract buttons while the document has entries. Click lists them;
// Dismiss drops them. Renders nothing while the document has no entries.
// The parent places it: under the floating controls in Normal view, under
// the pane header in a split view.
export function ArticleErrors({ documentId }: { documentId: string }) {
  const t = useT();
  const log = useErrorLog();
  const errors = useMemo(() => log.filter((e) => e.documentId === documentId), [log, documentId]);
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

  if (errors.length === 0) return null;

  return (
    <div ref={ref} className="pointer-events-auto relative">
      <button
        onClick={() => setOpen((v) => !v)}
        data-track="errors"
        aria-label={t("panes.errors")}
        data-tip={t("panes.errorsTitle")}
        aria-expanded={open}
        className="flex size-7 items-center justify-center rounded-full bg-card text-red-600 shadow-soft hover:bg-red-50 dark:hover:bg-red-950"
      >
        <WarningIcon size={14} />
      </button>
      <Presence show={open} exit="menu">
        {open && (
          <div className="menu-in absolute top-full right-0 mt-2 flex w-72 flex-col overflow-hidden rounded-2xl bg-card py-1 shadow-float">
            <div className="flex items-center justify-between px-4 py-1.5">
              <span className="text-xs font-semibold text-sand-700">{t("panes.errors")}</span>
              <button
                onClick={() => {
                  dismissErrors(documentId);
                  setOpen(false);
                }}
                data-track="errors-dismiss"
                className="text-xs text-sand-600 hover:text-clay-800"
              >
                {t("panes.errorsDismiss")}
              </button>
            </div>
            <ul className="max-h-72 overflow-y-auto">
              {errors.map((e) => (
                <li
                  key={e.id}
                  className="flex items-start gap-2 px-4 py-1.5 text-[12.5px] text-sand-800"
                >
                  <WarningIcon size={12} className="mt-[3px] shrink-0 text-red-600" />
                  <span className="min-w-0 flex-1 break-words">{e.message}</span>
                  <time
                    dateTime={new Date(e.at).toISOString()}
                    className="shrink-0 text-[11px] text-sand-500"
                  >
                    {new Date(e.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </time>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Presence>
    </div>
  );
}
