"use client";

import type { Editor } from "@tiptap/core";
import { useState } from "react";
import { useCollab } from "@/components/collab/collab-context";
import { useT } from "@/components/lang-provider";
import { projectDocHref } from "@/components/docs/insert/actions";
import { insertContext } from "@/components/docs/insert/context";
import { flushDocument } from "@/components/docs/layer/flush";
import { compareDocuments } from "@/components/docs/page/compare";
import { documentTitle } from "@/components/docs/page/download";
import { DialogButton, ToolbarDialog } from "@/components/docs/toolbar/dialog";
import { api } from "@/lib/api";
import type { RichNode } from "@/lib/docs/schema";

// Tools > Compare documents (SPEC.md §29), Google Docs' dialog: another
// document of the project to compare this one with. Compare makes a copy of
// this document, puts the other's differences in it as suggestions by the
// reader (page/compare.ts), and opens it, as Make a copy opens its copy.
// This document stays as it is.

type RichText = { richText: RichNode; rev: number };

/** A document's stored rich text; null for a document without (a block document). */
async function richTextOf(documentId: string): Promise<RichText | null> {
  const res = await fetch(`/api/documents/${documentId}/rich-text`, { cache: "no-store" });
  return res.ok ? ((await res.json()) as RichText) : null;
}

export function CompareDialog({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const t = useT();
  const { myId } = useCollab();
  const ctx = insertContext(editor);
  const others = ctx?.documents.filter((d) => d.id !== ctx.documentId) ?? [];
  const [pick, setPick] = useState<string | null>(others[0]?.id ?? null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function run() {
    const other = others.find((d) => d.id === pick);
    if (!ctx || !other || busy) return;
    setBusy(true);
    setNote(null);
    try {
      const theirs = await richTextOf(other.id);
      if (!theirs) {
        setNote(t("docsPage.compareNoText", { title: other.title }));
        setBusy(false);
        return;
      }
      const title = documentTitle(editor);
      // Nothing to show: the same words, nothing made.
      if (compareDocuments(editor.schema, editor.getJSON() as RichNode, theirs.richText, myId).differences === 0) {
        setNote(t("docsPage.compareSame", { title: other.title }));
        setBusy(false);
        return;
      }
      // The server copies the stored text: the typing waiting to save goes first.
      await flushDocument(ctx.documentId);
      const copy = await api<{ id: string }>("/api/documents/blank", "POST", {
        notebookId: ctx.notebookId,
        title: t("docsPage.comparisonOf", { a: title, b: other.title }).slice(0, 200),
        copyOf: ctx.documentId,
        suggestions: false,
      });
      // The copy's own text, with its own block ids and figures, takes the differences.
      const mine = await richTextOf(copy.id);
      if (!mine) throw new Error(t("common.requestFailed"));
      const compared = compareDocuments(editor.schema, mine.richText, theirs.richText, myId);
      await api(`/api/documents/${copy.id}/rich-text`, "PUT", { rev: mine.rev, richText: compared.doc });
      onClose();
      ctx.navigate(projectDocHref(ctx.notebookId, copy.id));
    } catch (err) {
      setNote(err instanceof Error && err.message ? err.message : t("common.requestFailed"));
      setBusy(false);
    }
  }

  return (
    <ToolbarDialog
      title={t("docsPage.compareDocuments")}
      onClose={onClose}
      className="docs-small-dialog docs-compare-dialog"
      actions={
        <>
          <DialogButton onClick={onClose}>{t("docs.cancel")}</DialogButton>
          <button
            type="button"
            className="docs-tb-button docs-tb-button-primary"
            data-track="docs:compare:run"
            disabled={!pick || busy}
            onClick={() => void run()}
          >
            {t(busy ? "docsPage.comparing" : "docsPage.compare")}
          </button>
        </>
      }
    >
      <div className="docs-setup-body">
        <p className="docs-compare-note">{t("docsPage.compareHow", { title: documentTitle(editor) })}</p>
        {others.length === 0 ? (
          <p className="docs-compare-note">{t("docsPage.compareNone")}</p>
        ) : (
          <label className="docs-setup-margin">
            <span>{t("docsPage.compareWith")}</span>
            <select className="docs-field" value={pick ?? ""} data-track="docs:compare:with" onChange={(e) => setPick(e.target.value)}>
              {others.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title}
                </option>
              ))}
            </select>
          </label>
        )}
        {note && <p className="docs-compare-note" role="status">{note}</p>}
      </div>
    </ToolbarDialog>
  );
}
