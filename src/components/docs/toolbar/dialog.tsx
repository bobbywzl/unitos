"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/components/lang-provider";
import { CloseIcon } from "@/components/docs/icons";

// The toolbar's dialogs (SPEC.md §29) in Google Docs' Material 3 look: a
// white card over a dimmed page (or an undimmed one, as the custom color
// picker has), a title, the body, and the buttons at the bottom right.
// Escape cancels, and so does a press on the backdrop. The close button
// (✕) shows only on a dialog with no Cancel: one way to close per dialog.
// The buttons stay in view while a tall body scrolls (a phone held
// sideways). A dialog the pointer opened draws no focus ring on the button
// that takes the focus, until a key is pressed in it.

// The last input before a dialog opens: a key, or a press.
let lastInput: "key" | "pointer" = "pointer";
if (typeof window !== "undefined") {
  window.addEventListener("keydown", () => (lastInput = "key"), true);
  window.addEventListener("pointerdown", () => (lastInput = "pointer"), true);
}

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
  /** The ✕; never beside the Cancel that `submit` brings. A dialog with
      its own Cancel in `actions` passes false. */
  closeButton?: boolean;
}) {
  const t = useT();
  const showClose = closeButton && !submit;
  const cardRef = useRef<HTMLDivElement>(null);
  const [quiet, setQuiet] = useState(() => lastInput === "pointer");
  const closeRef = useRef(onClose);
  const hasForm = useRef(submit !== undefined);
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
    // The first field takes the focus, else the dialog. A dialog with no
    // form and nothing to type in (Word count, Details: a checkbox at most)
    // gives it to its last footer button, so Enter closes it.
    const card = cardRef.current;
    const typed = card?.querySelector<HTMLElement>("input:not([type=checkbox]):not([type=radio]), select, textarea, [data-autofocus]");
    const footer = hasForm.current || typed ? null : [...(card?.querySelectorAll<HTMLElement>(".docs-tb-dialog-actions button:not(:disabled)") ?? [])].at(-1);
    const first = card?.querySelector<HTMLElement>("input, select, textarea, [data-autofocus]");
    (footer ?? first ?? card)?.focus();
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
        data-quiet={quiet || undefined}
        onKeyDown={(e) => {
          if (quiet) setQuiet(false);
          // Tab stays in the dialog: past the last control it comes back to the first.
          if (e.key !== "Tab") return;
          const controls = [...e.currentTarget.querySelectorAll<HTMLElement>("a[href], button, input, select, textarea, [tabindex]")].filter(
            (el) => el.tabIndex >= 0 && !el.matches(":disabled") && el.getClientRects().length > 0,
          );
          const active = document.activeElement;
          if (active !== (e.shiftKey ? controls[0] : controls.at(-1)) && active !== e.currentTarget) return;
          e.preventDefault();
          (e.shiftKey ? controls.at(-1) : controls[0])?.focus();
        }}
      >
        {(title || showClose) && (
          <div className="docs-tb-dialog-head">
            {title && <h2>{title}</h2>}
            {showClose && (
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
            className="docs-tb-dialog-form"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              submit.run();
            }}
          >
            <div className="docs-tb-dialog-body">{children}</div>
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
