"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { api } from "@/lib/api";
import { useT } from "@/components/lang-provider";
import { WorkCard, type WorkItem } from "@/components/works/work-card";

export type { WorkItem };

// The works shelf: the front door (design 2a). Shared with you renders as its
// own shelf under the reader's corpora.
export function WorksShelf({
  works,
  sharedWorks,
  myEmail,
}: {
  works: WorkItem[];
  sharedWorks: WorkItem[];
  myEmail: string;
}) {
  const router = useRouter();
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  async function create() {
    const trimmed = title.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      const work = await api<{ id: string }>("/api/notebooks", "POST", { title: trimmed });
      setTitle("");
      router.push(`/n/${work.id}`);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!confirm(t("works.deleteCorpusConfirm"))) return;
    await api(`/api/notebooks/${id}`, "DELETE");
    router.refresh();
  }

  async function rename(id: string, current: string) {
    const next = prompt(t("works.corpusTitle"), current)?.trim();
    if (!next || next === current) return;
    await api(`/api/notebooks/${id}`, "PATCH", { title: next });
    router.refresh();
  }

  async function leave(id: string) {
    if (!confirm(t("panes.leaveConfirm"))) return;
    await api(`/api/notebooks/${id}/collaborators`, "DELETE", { email: myEmail });
    router.refresh();
  }

  return (
    <>
      <h1 className="mb-7 text-[46px]">{t("works.corpora")}</h1>

      <form
        className="mb-11 flex gap-2.5"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <input
          ref={inputRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t("works.newCorpusTitle")}
          aria-label={t("works.newCorpusTitle")}
          className="w-[340px] rounded-full bg-card px-5 py-3 text-sm shadow-soft outline-none placeholder:text-sand-500"
        />
        <button
          type="submit"
          disabled={!title.trim() || busy}
          className="rounded-full bg-clay px-6 py-3 text-sm font-semibold text-clay-fg hover:bg-clay-600 disabled:opacity-40"
        >
          {t("works.create")}
        </button>
      </form>

      <ul className="mt-[76px] grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {works.map((work) => (
          <WorkCard key={work.id} work={work} onRename={rename} onDelete={remove} />
        ))}
        <li className="list-none">
          <button
            onClick={() => inputRef.current?.focus()}
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
            {t("works.newWork")}
          </button>
        </li>
      </ul>

      {sharedWorks.length > 0 && (
        <>
          <h2 className="mt-16 mb-7 text-[28px]">{t("works.sharedWithYou")}</h2>
          <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {sharedWorks.map((work) => (
              <WorkCard
                key={work.id}
                work={work}
                onRename={rename}
                onDelete={remove}
                onLeave={leave}
              />
            ))}
          </ul>
        </>
      )}
    </>
  );
}
