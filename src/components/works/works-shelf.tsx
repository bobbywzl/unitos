"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";
import { WorkCard, type WorkItem } from "@/components/works/work-card";

export type { WorkItem };

// The works shelf: the front door (design 2a).
export function WorksShelf({
  works,
  hasProfile,
}: {
  works: WorkItem[];
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
      const work = await api<{ id: string }>("/api/notebooks", "POST", { title: trimmed });
      setTitle("");
      // Profile onboarding on first work creation (SPEC.md §6).
      router.push(`/n/${work.id}${hasProfile ? "" : "?onboard=1"}`);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this work and all its notes?")) return;
    await api(`/api/notebooks/${id}`, "DELETE");
    router.refresh();
  }

  async function rename(id: string, current: string) {
    const next = prompt("Work title", current)?.trim();
    if (!next || next === current) return;
    await api(`/api/notebooks/${id}`, "PATCH", { title: next });
    router.refresh();
  }

  return (
    <>
      <h1 className="mb-7 text-[46px]">Works</h1>

      <form
        className="mb-11 flex gap-2.5"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="New work title"
          aria-label="New work title"
          className="w-[340px] rounded-full bg-card px-5 py-3 text-sm shadow-soft outline-none placeholder:text-sand-500"
        />
        <button
          type="submit"
          disabled={!title.trim() || busy}
          className="rounded-full bg-clay px-6 py-3 text-sm font-semibold text-clay-fg hover:bg-clay-600 disabled:opacity-40"
        >
          Create
        </button>
      </form>

      <ul className="mt-[76px] grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {works.map((work) => (
          <WorkCard key={work.id} work={work} onRename={rename} onDelete={remove} />
        ))}
        <li className="list-none">
          <button
            onClick={() => document.querySelector<HTMLInputElement>("input[aria-label='New work title']")?.focus()}
            className="flex aspect-[5.5/8.5] w-full flex-col items-center justify-center gap-2 rounded-[18px] border-[1.5px] border-dashed border-sand-400 text-sm text-sand-600 hover:bg-clay-100 hover:text-clay-800"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M5 12h14" />
              <path d="M12 5v14" />
            </svg>
            New work
          </button>
        </li>
      </ul>
    </>
  );
}
