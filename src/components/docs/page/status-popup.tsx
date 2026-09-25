"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/components/lang-provider";
import type { SaveState } from "@/components/docs/use-docs-save";
import type { TKey } from "@/lib/i18n/dictionaries";

// The document status popup (SPEC.md §29), Google Docs': under the status
// beside the title, a header in the state's color with its title, then one
// line on what the state means. A press outside or Escape closes it.

const TEXT: Record<SaveState, [title: TKey, body: TKey]> = {
  saved: ["docs.saved", "docsPage.statusSaved"],
  saving: ["docs.saving", "docsPage.statusSaving"],
  unsaved: ["docs.saving", "docsPage.statusSaving"],
  offline: ["docs.offlineSaving", "docsPage.statusOffline"],
  error: ["docs.saveFailed", "docsPage.statusFailed"],
};

export function StatusPopup({
  state,
  anchorRef,
  onClose,
}: {
  state: SaveState;
  anchorRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
}) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  useLayoutEffect(() => {
    const r = anchorRef.current?.getBoundingClientRect();
    if (!r) return;
    setPos({ top: r.bottom + 6, left: Math.max(8, Math.min(r.left, window.innerWidth - 336)) });
  }, [anchorRef]);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (ref.current?.contains(target) || anchorRef.current?.contains(target)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [anchorRef, onClose]);
  const failed = state === "error" || state === "offline";
  const title = t(TEXT[state][0]);
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={title}
      className={`docs-status-popup${failed ? " docs-status-popup-failed" : ""}`}
      style={pos ? { top: pos.top, left: pos.left } : { visibility: "hidden" }}
      data-edit-control
    >
      <div className="docs-status-popup-head">{title}</div>
      <p className="docs-status-popup-body">{t(TEXT[state][1])}</p>
    </div>,
    document.body,
  );
}
