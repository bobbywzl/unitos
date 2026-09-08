"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
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
  const [busy, setBusy] = useState(false);

  // New project: one press. The project gets the default title (renamed in
  // the reader's title) and opens on the add-document dialog (?add=1), so the
  // first thing a new project asks for is a document.
  async function create() {
    if (busy) return;
    setBusy(true);
    try {
      const work = await api<{ id: string }>("/api/notebooks", "POST", {
        title: t("works.untitledProject"),
      });
      router.push(`/n/${work.id}?add=1`);
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
      <h1 className="mb-7 text-[34px] sm:text-[46px]">{t("works.corpora")}</h1>

      <button
        onClick={() => void create()}
        disabled={busy}
        data-track="new-project"
        data-nudge="project"
        className="mb-11 flex items-center gap-2.5 rounded-full bg-clay px-7 py-3.5 text-[15px] font-semibold text-clay-fg shadow-soft hover:bg-clay-600 disabled:opacity-40"
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
        {busy ? t("common.working") : t("works.newWork")}
      </button>

      <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {works.map((work) => (
          <WorkCard key={work.id} work={work} onRename={rename} onDelete={remove} />
        ))}
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
