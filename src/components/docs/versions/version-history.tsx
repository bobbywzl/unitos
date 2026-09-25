"use client";

import type { Editor } from "@tiptap/react";
import { useEffect, useState } from "react";
import { useT } from "@/components/lang-provider";
import type { DocsAreaProps } from "@/components/docs/areas/types";
import { registerDocsCommands } from "@/components/docs/commands";
import { keys, matchesCombo } from "@/components/docs/keys";
import { flushDocument } from "@/components/docs/layer/flush";
import { DialogButton, ToolbarDialog } from "@/components/docs/toolbar/dialog";
import { VersionView } from "@/components/docs/versions/version-view";
import { api } from "@/lib/api";

// Version history of a blank document (SPEC.md §29): See version history
// (Ctrl+Alt+Shift+H, the clock at the title row's right end) opens the
// version view; Name current version names the text as it stands.

const VERSIONS_EVENT = "docs:versions";
const OPEN_KEYS = "Mod+Alt+Shift+H";
type Action = "open" | "name";

const request = (editor: Editor, action: Action) =>
  editor.view.dom.dispatchEvent(new CustomEvent<Action>(VERSIONS_EVENT, { detail: action }));

registerDocsCommands([
  {
    id: "versions:see",
    label: "docsVersions.seeHistory",
    menu: "file",
    keywords: ["version history", "revision history", "restore", "history", "版本"],
    shortcut: OPEN_KEYS,
    run: (editor) => request(editor, "open"),
  },
  {
    id: "versions:name",
    label: "docsVersions.nameCurrent",
    menu: "file",
    keywords: ["version", "named version", "版本"],
    run: (editor) => request(editor, "name"),
    enabled: (editor) => editor.isEditable && !editor.isEmpty,
  },
]);

/** The clock at the right end of the title row. */
export function VersionHistoryButton({ editor }: { editor: Editor }) {
  const t = useT();
  const label = t("docsVersions.seeHistory");
  return (
    <button
      type="button"
      className="docs-versions-icon docs-versions-open"
      aria-label={label}
      data-tip={`${label} (${keys(OPEN_KEYS)})`}
      data-track="docs:version-history"
      onClick={() => request(editor, "open")}
    >
      <svg width={24} height={24} viewBox="0 0 24 24" fill="currentColor" aria-hidden focusable="false">
        <path d="M13 3c-4.97 0-9 4.03-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42C8.27 19.99 10.51 21 13 21c4.97 0 9-4.03 9-9s-4.03-9-9-9zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z" />
      </svg>
    </button>
  );
}

export function VersionHistory({ editor, documentId, pageSetup, canEdit }: DocsAreaProps) {
  const [open, setOpen] = useState(false);
  const [naming, setNaming] = useState(false);

  useEffect(() => {
    const dom = editor.view.dom;
    const onRequest = (e: Event) => ((e as CustomEvent<Action>).detail === "name" ? setNaming(true) : setOpen(true));
    // The shortcut, while the focus is in this page editor.
    const onKey = (e: KeyboardEvent) => {
      const shell = dom.closest(".docs-shell");
      const active = document.activeElement;
      if (!matchesCombo(e, OPEN_KEYS) || !shell || !(active === document.body || shell.contains(active))) return;
      e.preventDefault();
      setOpen(true);
    };
    dom.addEventListener(VERSIONS_EVENT, onRequest);
    window.addEventListener("keydown", onKey);
    return () => {
      dom.removeEventListener(VERSIONS_EVENT, onRequest);
      window.removeEventListener("keydown", onKey);
    };
  }, [editor]);

  return (
    <>
      {open && (
        <VersionView
          editor={editor}
          documentId={documentId}
          pageSetup={pageSetup}
          canEdit={canEdit}
          onClose={() => setOpen(false)}
        />
      )}
      {naming && <NameDialog documentId={documentId} onClose={() => setNaming(false)} />}
    </>
  );
}

/** Name current version: the text as it stands, kept as a named version. */
function NameDialog({ documentId, onClose }: { documentId: string; onClose: () => void }) {
  const t = useT();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    if (!name.trim()) return;
    try {
      await flushDocument(documentId);
      await api(`/api/documents/${documentId}/versions`, "POST", { name });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.requestFailed"));
    }
  };
  return (
    <ToolbarDialog
      title={t("docsVersions.nameCurrent")}
      onClose={onClose}
      closeButton={false}
      actions={
        <>
          <DialogButton onClick={onClose}>{t("common.cancel")}</DialogButton>
          <DialogButton primary disabled={!name.trim()} onClick={() => void save()}>
            {t("common.save")}
          </DialogButton>
        </>
      }
    >
      <input
        className="docs-tb-field docs-versions-name"
        value={name}
        maxLength={100}
        aria-label={t("docsVersions.nameCurrent")}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void save();
        }}
      />
      {error && <p className="docs-versions-error">{error}</p>}
    </ToolbarDialog>
  );
}
