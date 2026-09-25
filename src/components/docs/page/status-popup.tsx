"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/components/lang-provider";
import type { SaveState } from "@/components/docs/use-docs-save";

// The document status popup (SPEC.md §29), Google Docs': under the status
// beside the title, a header in the state's color with its title, then one
// line on what the state means. A press outside or Escape closes it.

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
  const title =
    state === "saved"
      ? t("docs.saved")
      : state === "offline"
        ? t("docs.offlineSaving")
        : state === "error"
          ? t("docs.saveFailed")
          : t("docs.saving");
  const body =
    state === "saved"
      ? t("docsPage.statusSaved")
      : state === "offline"
        ? t("docsPage.statusOffline")
        : state === "error"
          ? t("docsPage.statusFailed")
          : t("docsPage.statusSaving");
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
      <p className="docs-status-popup-body">{body}</p>
    </div>,
    document.body,
  );
}
