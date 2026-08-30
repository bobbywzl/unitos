"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";
import { isImeKey, useImeGuard } from "@/lib/ime";
import { useT } from "@/components/lang-provider";

export function NotebookTitle({ id, title }: { id: string; title: string }) {
  const router = useRouter();
  const t = useT();
  const ime = useImeGuard();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);

  async function save() {
    const trimmed = draft.trim();
    setEditing(false);
    if (!trimmed || trimmed === title) {
      setDraft(title);
      return;
    }
    await api(`/api/notebooks/${id}`, "PATCH", { title: trimmed });
    router.refresh();
  }

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void save()}
        {...ime.props}
        onKeyDown={(e) => {
          if (ime.isImeEnter(e) || isImeKey(e)) return;
          if (e.key === "Enter") void save();
          if (e.key === "Escape") {
            setDraft(title);
            setEditing(false);
          }
        }}
        aria-label={t("works.corpusTitle")}
        className="min-w-0 rounded-full bg-card px-4 py-1 font-display text-xl shadow-soft outline-none"
      />
    );
  }

  return (
    <button
      onClick={() => setEditing(true)}
      className="max-w-64 shrink-0 truncate font-display text-xl"
      title={t("works.renameCorpus")}
    >
      {title}
    </button>
  );
}
