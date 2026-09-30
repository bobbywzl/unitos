"use client";

import type { Editor } from "@tiptap/core";
import { useState } from "react";
import { useT } from "@/components/lang-provider";
import { projectDocHref } from "@/components/docs/insert/actions";
import { insertContext, toast } from "@/components/docs/insert/context";
import { flushDocument } from "@/components/docs/layer/flush";
import { documentTitle } from "@/components/docs/page/download";
import { translatedCopy } from "@/components/docs/page/translate";
import { DialogButton, ToolbarDialog } from "@/components/docs/toolbar/dialog";
import { api } from "@/lib/api";
import type { RichNode } from "@/lib/docs/schema";
import type { Lang } from "@/lib/i18n/config";

// Tools > Translate document (SPEC.md §29), Google Docs' dialog: the new
// document's name and the language to translate into, English or Chinese,
// the two the Translate bar reads (DeepL, SPEC.md §19). Translate makes a
// copy of this document as Make a copy does, without its suggestions,
// translates the copy's paragraphs through the Translate bar's route, puts
// the translations in its text (page/translate.ts), and opens it. When the
// translation fails, the copy goes: nothing half made stays.

const LANGS: [Lang, "docsPage.translateEnglish" | "docsPage.translateChinese"][] = [
  ["en", "docsPage.translateEnglish"],
  ["zh", "docsPage.translateChinese"],
];

/** The words are mostly Chinese characters. */
function mostlyChinese(text: string): boolean {
  const sample = text.slice(0, 4000);
  const han = sample.match(/\p{Script=Han}/gu)?.length ?? 0;
  const latin = sample.match(/\p{Script=Latin}/gu)?.length ?? 0;
  return han > latin / 2;
}

export function TranslateDialog({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const t = useT();
  const [name, setName] = useState(() => t("docsPage.translatedCopyOf", { title: documentTitle(editor) }));
  // Into the other of the two languages.
  const [lang, setLang] = useState<Lang>(() => (mostlyChinese(editor.state.doc.textContent) ? "en" : "zh"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    const ctx = insertContext(editor);
    const title = name.trim().slice(0, 200);
    if (!ctx || !title || busy) return;
    setBusy(true);
    setError(null);
    let copyId: string | null = null;
    try {
      // The server copies the stored text: the typing waiting to save goes first.
      await flushDocument(ctx.documentId);
      const copy = await api<{ id: string }>("/api/documents/blank", "POST", {
        notebookId: ctx.notebookId,
        title,
        copyOf: ctx.documentId,
        suggestions: false,
      });
      copyId = copy.id;
      const { translations } = await api<{ translations: Record<string, string> }>(`/api/documents/${copy.id}/translate`, "POST", { lang });
      const res = await fetch(`/api/documents/${copy.id}/rich-text`, { cache: "no-store" });
      if (!res.ok) throw new Error(t("common.requestFailed"));
      const stored = (await res.json()) as { richText: RichNode; rev: number };
      const out = translatedCopy(stored.richText, translations);
      await api(`/api/documents/${copy.id}/rich-text`, "PUT", { rev: stored.rev, richText: out.doc });
      if (out.kept > 0) toast(t(out.kept === 1 ? "docsPage.translateKeptOne" : "docsPage.translateKept", { n: out.kept }), editor);
      onClose();
      ctx.navigate(projectDocHref(ctx.notebookId, copy.id));
    } catch (err) {
      // Nothing half made stays: the copy goes.
      if (copyId) await api(`/api/documents/${copyId}`, "DELETE").catch(() => {});
      setError(err instanceof Error && err.message ? err.message : t("common.requestFailed"));
      setBusy(false);
    }
  }

  return (
    <ToolbarDialog
      title={t("docsPage.translateDocument")}
      onClose={onClose}
      className="docs-small-dialog docs-translate-dialog"
      closeButton={false}
      actions={
        <>
          <DialogButton onClick={onClose}>{t("docs.cancel")}</DialogButton>
          <button
            type="button"
            className="docs-tb-button docs-tb-button-primary"
            data-track="docs:translate:run"
            disabled={!name.trim() || busy}
            onClick={() => void run()}
          >
            {t(busy ? "docsPage.translating" : "docsPage.translate")}
          </button>
        </>
      }
    >
      <div className="docs-setup-body">
        <label className="docs-setup-margin">
          <span>{t("docsPage.copyName")}</span>
          <input
            className="docs-field"
            value={name}
            data-track="docs:translate:name"
            onChange={(e) => setName(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void run();
              }
            }}
          />
        </label>
        <label className="docs-setup-margin">
          <span>{t("docsPage.translateInto")}</span>
          <select className="docs-field" value={lang} data-track="docs:translate:lang" onChange={(e) => setLang(e.target.value === "en" ? "en" : "zh")}>
            {LANGS.map(([value, label]) => (
              <option key={value} value={value}>
                {t(label)}
              </option>
            ))}
          </select>
        </label>
        {error && (
          <p className="docs-setup-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </ToolbarDialog>
  );
}
