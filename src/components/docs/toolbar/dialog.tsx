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
  submit,
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
  /** Cancel and the primary button (OK unless labelled). The body is a
      form: Enter in a field presses the primary. */
  submit?: { label?: string; disabled?: boolean; run: () => void };
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
      // A menu open in the dialog closes first, by its own Escape.
      if (e.key !== "Escape" || document.querySelector("[data-docs-menu]")) return;
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
        {submit ? (
          <form
            className="docs-tb-dialog-body"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              submit.run();
            }}
          >
            {children}
            <div className="docs-tb-dialog-actions">
              <DialogButton onClick={() => closeRef.current()}>{t("docs.cancel")}</DialogButton>
              <DialogButton primary type="submit" disabled={submit.disabled}>
                {submit.label ?? t("docs.ok")}
              </DialogButton>
            </div>
          </form>
        ) : (
          <>
            <div className="docs-tb-dialog-body">{children}</div>
            {actions && <div className="docs-tb-dialog-actions">{actions}</div>}
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

export function DialogButton({
  primary,
  type = "button",
  disabled,
  onClick,
  children,
}: {
  primary?: boolean;
  type?: "button" | "submit";
  disabled?: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={primary ? "docs-tb-button docs-tb-button-primary" : "docs-tb-button"}
    >
      {children}
    </button>
  );
}
