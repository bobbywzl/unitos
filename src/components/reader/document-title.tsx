"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";
import { isImeKey, useImeGuard } from "@/lib/ime";
import { useCollab } from "@/components/collab/collab-context";
import { useT } from "@/components/lang-provider";

// The document title, editable in place like the blocks under it: click it,
// type, Enter or blur saves, Escape cancels. Viewers see plain text. The
// pattern is NotebookTitle's; the save goes to the document route.
export function DocumentTitle({ documentId, title }: { documentId: string; title: string }) {
  const router = useRouter();
  const t = useT();
  const ime = useImeGuard();
  const { canEdit } = useCollab();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  // Shows the new title until the refreshed page carries it.
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const shown = saved ?? title;

  async function save() {
    const trimmed = draft.trim();
    setEditing(false);
    if (!trimmed || trimmed === shown) {
      setDraft(shown);
      return;
    }
    setSaved(trimmed);
    setError(null);
    try {
      await api(`/api/documents/${documentId}`, "PATCH", { title: trimmed });
      router.refresh();
    } catch (err) {
      setSaved(null);
      setDraft(shown);
      setError(err instanceof Error ? err.message : t("common.requestFailed"));
    }
  }

  if (!canEdit) return <h2 className="mb-[26px] text-[33px]">{shown}</h2>;

  if (editing) {
    return (
      <textarea
        autoFocus
        rows={1}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void save()}
        {...ime.props}
        onKeyDown={(e) => {
          if (ime.isImeEnter(e) || isImeKey(e)) return;
          if (e.key === "Enter") {
            e.preventDefault();
            void save();
          }
          if (e.key === "Escape") {
            setDraft(shown);
            setEditing(false);
          }
        }}
        aria-label={t("reader.documentTitle")}
        className="mb-[26px] w-full resize-none rounded-xl bg-sand-100 px-2 py-1 font-display text-[33px] leading-tight outline-none field-sizing-content"
      />
    );
  }

  return (
    <>
      <h2
        onClick={() => {
          setDraft(shown);
          setEditing(true);
        }}
        data-tip={t("reader.renameDocumentTitle")}
        className={`cursor-text rounded-xl hover:bg-sand-100 ${error ? "mb-1" : "mb-[26px]"}`}
      >
        <span className="text-[33px]">{shown}</span>
      </h2>
      {error && <p className="mb-[26px] text-xs text-red-500">{error}</p>}
    </>
  );
}
