"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";

export type NotebookListItem = {
  id: string;
  title: string;
  sectionCount: number;
  documentCount: number;
  updatedAt: string;
};

export function NotebookList({
  notebooks,
  hasProfile,
}: {
  notebooks: NotebookListItem[];
  hasProfile: boolean;
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  async function create() {
    const trimmed = title.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      const notebook = await api<{ id: string }>("/api/notebooks", "POST", { title: trimmed });
      setTitle("");
      // Profile onboarding on first notebook creation (SPEC.md §6).
      router.push(`/n/${notebook.id}${hasProfile ? "" : "?onboard=1"}`);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this notebook and all its notes?")) return;
    await api(`/api/notebooks/${id}`, "DELETE");
    router.refresh();
  }

  async function rename(id: string, current: string) {
    const next = prompt("Notebook title", current)?.trim();
    if (!next || next === current) return;
    await api(`/api/notebooks/${id}`, "PATCH", { title: next });
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="New notebook title"
          className="w-72 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-900"
        />
        <button
          type="submit"
          disabled={!title.trim() || busy}
          className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-40 dark:bg-white dark:text-neutral-900"
        >
          Create notebook
        </button>
      </form>

      {notebooks.length === 0 ? (
        <p className="text-sm text-neutral-500">No notebooks yet. Create one.</p>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {notebooks.map((n) => (
            <li
              key={n.id}
              className="group rounded-lg border border-neutral-200 bg-white p-4 transition-shadow hover:border-neutral-400 hover:shadow-md dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-neutral-500"
            >
              <Link href={`/n/${n.id}`} className="block">
                <h2 className="font-medium">{n.title}</h2>
                <p className="mt-1 text-xs text-neutral-500">
                  {n.sectionCount} sections · {n.documentCount} documents
                </p>
              </Link>
              <div className="mt-3 flex gap-2 opacity-0 transition-opacity group-hover:opacity-100">
                <button
                  onClick={() => void rename(n.id, n.title)}
                  className="text-xs text-neutral-500 hover:text-neutral-900 dark:hover:text-white"
                >
                  Rename
                </button>
                <button
                  onClick={() => void remove(n.id)}
                  className="text-xs text-red-500 hover:text-red-700"
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
