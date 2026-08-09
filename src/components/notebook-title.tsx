"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";

export function NotebookTitle({ id, title }: { id: string; title: string }) {
  const router = useRouter();
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
        onKeyDown={(e) => {
          if (e.key === "Enter") void save();
          if (e.key === "Escape") {
            setDraft(title);
            setEditing(false);
          }
        }}
        className="rounded border border-neutral-300 bg-white px-2 py-0.5 text-xl font-semibold outline-none dark:border-neutral-700 dark:bg-neutral-900"
      />
    );
  }

  return (
    <button onClick={() => setEditing(true)} className="text-xl font-semibold" title="Rename notebook">
      {title}
    </button>
  );
}
