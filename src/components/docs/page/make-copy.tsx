"use client";

import type { Editor } from "@tiptap/core";
import { useState } from "react";
import { useT } from "@/components/lang-provider";
import { projectDocHref } from "@/components/docs/insert/actions";
import { insertContext, toast } from "@/components/docs/insert/context";
import { flushDocument } from "@/components/docs/layer/flush";
import { documentTitle } from "@/components/docs/page/download";
import { DialogButton, ToolbarDialog } from "@/components/docs/toolbar/dialog";
import { api } from "@/lib/api";

// File > Make a copy (SPEC.md §29): Google Docs' Copy document dialog. The
// copy takes the rich text and the page setup, and the suggestions when
// asked, never the notes, annotations, or comments, and opens in this tab.
// An import cannot be copied yet: its figures' media stay with the import,
// so the copy would lose them. The dialog says so.

/** The page editor's document is an import (docs-editor.tsx marks its shell). */
const isImport = (editor: Editor) => editor.view.dom.closest("[data-docs-editor]")?.hasAttribute("data-import") ?? false;

export function CopyDialog({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const t = useT();
  const [name, setName] = useState(() => t("docsPage.copyOf", { title: documentTitle(editor) }));
  const [suggestions, setSuggestions] = useState(false);
  const [busy, setBusy] = useState(false);
  if (isImport(editor)) {
    return (
      <ToolbarDialog
        title={t("docsPage.copyDocument")}
        onClose={onClose}
        className="docs-small-dialog"
        closeButton={false}
        actions={
          <DialogButton primary onClick={onClose}>
            {t("docs.ok")}
          </DialogButton>
        }
      >
        <div className="docs-setup-body">
          <p>{t("docsPage.copyImportOff")}</p>
        </div>
      </ToolbarDialog>
    );
  }
  const submit = async () => {
    const ctx = insertContext(editor);
    const title = name.trim().slice(0, 200);
    if (!ctx || !title || busy) return;
    setBusy(true);
    try {
      // The server copies the stored text: the typing waiting to save goes first.
      await flushDocument(ctx.documentId);
      const copy = await api<{ id: string }>("/api/documents/blank", "POST", {
        notebookId: ctx.notebookId,
        title,
        copyOf: ctx.documentId,
        suggestions,
      });
      onClose();
      ctx.navigate(projectDocHref(ctx.notebookId, copy.id));
    } catch (err) {
      setBusy(false);
      toast(err instanceof Error && err.message ? err.message : t("common.requestFailed"), editor);
    }
  };
  return (
    <ToolbarDialog
      title={t("docsPage.copyDocument")}
      onClose={onClose}
      className="docs-small-dialog"
      closeButton={false}
      submit={{ disabled: !name.trim() || busy, run: () => void submit() }}
    >
      <div className="docs-setup-body">
        <label className="docs-setup-margin">
          <span>{t("docsPage.copyName")}</span>
          <input className="docs-field" value={name} onChange={(e) => setName(e.target.value)} onFocus={(e) => e.currentTarget.select()} />
        </label>
        <label className="docs-setup-radio">
          <input type="checkbox" checked={suggestions} onChange={(e) => setSuggestions(e.target.checked)} />
          {t("docsPage.copySuggestions")}
        </label>
      </div>
    </ToolbarDialog>
  );
}
