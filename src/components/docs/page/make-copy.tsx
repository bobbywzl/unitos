"use client";

import type { Editor } from "@tiptap/core";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { LangProvider, useT } from "@/components/lang-provider";
import { projectDocHref } from "@/components/docs/insert/actions";
import { insertContext, toast } from "@/components/docs/insert/context";
import { flushDocument } from "@/components/docs/layer/flush";
import { documentTitle } from "@/components/docs/page/download";
import { DialogButton, ToolbarDialog } from "@/components/docs/toolbar/dialog";
import { api } from "@/lib/api";
import { DEFAULT_LANG } from "@/lib/i18n/config";

// File > Make a copy (SPEC.md §29): Google Docs' Copy document dialog. The
// copy takes the rich text and the page setup, never the notes, annotations,
// or comments, and opens in this tab.

function CopyDialog({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const t = useT();
  const [name, setName] = useState(() => t("docsPage.copyOf", { title: documentTitle(editor) }));
  const [busy, setBusy] = useState(false);
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
      });
      onClose();
      ctx.navigate(projectDocHref(ctx.notebookId, copy.id));
    } catch (err) {
      setBusy(false);
      toast(err instanceof Error && err.message ? err.message : t("common.requestFailed"));
    }
  };
  return (
    <ToolbarDialog
      title={t("docsPage.copyDocument")}
      onClose={onClose}
      className="docs-small-dialog"
      closeButton={false}
      actions={
        <>
          <DialogButton onClick={onClose}>{t("docs.cancel")}</DialogButton>
          <DialogButton primary disabled={!name.trim() || busy} onClick={() => void submit()}>
            {t("docs.ok")}
          </DialogButton>
        </>
      }
    >
      <form
        className="docs-setup-body"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label className="docs-setup-margin">
          <span>{t("docsPage.copyName")}</span>
          <input className="docs-field" value={name} onChange={(e) => setName(e.target.value)} onFocus={(e) => e.currentTarget.select()} />
        </label>
      </form>
    </ToolbarDialog>
  );
}

/** Open the Copy document dialog over the page; closed, the page takes the keys back. */
export function openMakeCopy(editor: Editor): void {
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  const close = () => {
    root.unmount();
    host.remove();
    if (!editor.isDestroyed) editor.commands.focus();
  };
  root.render(
    <LangProvider lang={insertContext(editor)?.lang ?? DEFAULT_LANG}>
      <CopyDialog editor={editor} onClose={close} />
    </LangProvider>,
  );
}
