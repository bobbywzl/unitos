"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/components/lang-provider";
import { CloseIcon } from "@/components/docs/icons";

// The toolbar's dialogs (SPEC.md §29) in Google Docs' Material 3 look: a
// white card over a dimmed page (or an undimmed one, as the custom color
// picker has), a title, the body, and the buttons at the bottom right.
// Escape or the close button cancels; a press on the backdrop cancels.

export function ToolbarDialog({
  title,
  label,
  onClose,
  children,
  actions,
  className = "",
  dim = true,
  closeButton = true,
}: {
  /** The shown title; none for a dialog whose title bar is hidden. */
  title?: string;
  /** The accessible name when there is no shown title. */
  label?: string;
  onClose: () => void;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
  /** False: the page behind stays undimmed. */
  dim?: boolean;
  closeButton?: boolean;
}) {
  const t = useT();
  const cardRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      closeRef.current();
    };
    document.addEventListener("keydown", onKey, true);
    // The first field takes the focus, else the dialog.
    const card = cardRef.current;
    const first = card?.querySelector<HTMLElement>("input, select, textarea, [data-autofocus]");
    (first ?? card)?.focus();
    return () => document.removeEventListener("keydown", onKey, true);
  }, []);
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className={`docs-tb-backdrop${dim ? "" : " docs-tb-backdrop-clear"}`}
      data-edit-control
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closeRef.current();
      }}
    >
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-label={title ?? label}
        tabIndex={-1}
        className={`docs-tb-dialog ${className}`}
      >
        {(title || closeButton) && (
          <div className="docs-tb-dialog-head">
            {title && <h2>{title}</h2>}
            {closeButton && (
              <button
                type="button"
                aria-label={t("docs.close")}
                data-tip={t("docs.close")}
                onClick={() => closeRef.current()}
                className="docs-tb-dialog-close"
              >
                <CloseIcon size={20} />
              </button>
            )}
          </div>
        )}
        <div className="docs-tb-dialog-body">{children}</div>
        {actions && <div className="docs-tb-dialog-actions">{actions}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function DialogButton({
  primary,
  disabled,
  onClick,
  children,
}: {
  primary?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={primary ? "docs-tb-button docs-tb-button-primary" : "docs-tb-button"}
    >
      {children}
    </button>
  );
}
